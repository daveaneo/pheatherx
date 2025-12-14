// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/StdJson.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {FheatherXv8FHE} from "../src/FheatherXv8FHE.sol";
import {FheatherXv8Mixed} from "../src/FheatherXv8Mixed.sol";

/// @title DeployV8Complete
/// @notice Deploy FheatherXv8 hooks with all 6 pool types on Ethereum Sepolia
/// @dev Run with: source .env && forge script script/DeployV8Complete.s.sol:DeployV8Complete --rpc-url $ETH_SEPOLIA_RPC --broadcast -vvv
///
/// This script:
/// 1. Deploys FheatherXv8FHE hook using CREATE2 (for FHE:FHE pools)
/// 2. Deploys FheatherXv8Mixed hook using CREATE2 (for ERC:FHE and FHE:ERC pools)
/// 3. Initializes 6 pools via PoolManager:
///    - Pool A: WETH/USDC (ERC20:ERC20) - NO HOOK (native Uniswap v4)
///    - Pool B: fheWETH/fheUSDC (FHERC20:FHERC20) - v8FHE hook
///    - Pool C: WETH/fheUSDC (ERC20:FHERC20) - v8Mixed hook
///    - Pool D: fheWETH/USDC (FHERC20:ERC20) - v8Mixed hook
///    - Pool E: WETH/fheWETH (ERC20:FHERC20 wrap pair) - v8Mixed hook
///    - Pool F: USDC/fheUSDC (ERC20:FHERC20 wrap pair) - v8Mixed hook
/// 4. Seeds initial liquidity to each pool
/// 5. Exports deployment addresses to JSON
contract DeployV8Complete is Script {
    using stdJson for string;
    using PoolIdLibrary for PoolKey;

    // ============ Ethereum Sepolia Addresses ============
    // Uniswap v4 (from https://docs.uniswap.org/contracts/v4/deployments)
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant SWAP_ROUTER = 0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe;  // PoolSwapTest
    address constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;

    // CREATE2 Deployer Proxy (standard across EVM chains)
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    // Existing Faucet Tokens (ERC20)
    address constant WETH = 0xe9Df64F549Eb1d2778909F339B9Bd795d14cF32E;
    address constant USDC = 0xF7Ff2A5E74eaA6E0463358BB26780049d3D45C56;
    // New FHERC20 tokens with proper balanceOfEncrypted() interface
    address constant FHE_WETH = 0xa22df71352FbE7f78e9fC6aFFA78a3A1dF57b80e;
    address constant FHE_USDC = 0xCa72923536c48704858C9207D2496010498b77c4;

    // ============ Deployment Config ============
    uint256 constant SWAP_FEE_BPS = 30; // 0.3%
    uint24 constant POOL_FEE = 3000;    // 0.3% for Uniswap V4
    int24 constant TICK_SPACING = 60;

    // Initial sqrt price for 1:1 ratio (scaled by 2^96)
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336; // sqrt(1) * 2^96

    // Initial liquidity amounts
    uint256 constant INIT_WETH_AMOUNT = 10 ether;           // 10 WETH
    uint256 constant INIT_USDC_AMOUNT = 10_000 * 1e6;       // 10,000 USDC
    uint256 constant INIT_FHE_WETH_AMOUNT = 10 ether;       // 10 fheWETH
    uint256 constant INIT_FHE_USDC_AMOUNT = 10_000 * 1e6;   // 10,000 fheUSDC

    string constant DEPLOYMENTS_PATH = "deployments/v8-eth-sepolia.json";

    // Storage for deployed addresses
    address v8FheHook;
    address v8MixedHook;

    // Storage for pool IDs
    bytes32 poolIdA;
    bytes32 poolIdB;
    bytes32 poolIdC;
    bytes32 poolIdD;
    bytes32 poolIdE;
    bytes32 poolIdF;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("===========================================");
        console.log("  FheatherXv8 Complete Deployment");
        console.log("  Ethereum Sepolia");
        console.log("===========================================");
        console.log("");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Pool Manager:", POOL_MANAGER);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // ============ Step 1: Deploy v8FHE Hook ============
        console.log("--- Step 1: Deploying FheatherXv8FHE Hook ---");
        v8FheHook = _deployV8FHEHook(deployer);
        console.log("v8FHE Hook deployed at:", v8FheHook);
        console.log("");

        // ============ Step 2: Deploy v8Mixed Hook ============
        console.log("--- Step 2: Deploying FheatherXv8Mixed Hook ---");
        v8MixedHook = _deployV8MixedHook(deployer);
        console.log("v8Mixed Hook deployed at:", v8MixedHook);
        console.log("");

        // ============ Step 3: Initialize Pools ============
        console.log("--- Step 3: Initializing Pools ---");
        _initializePools();
        console.log("");

        // ============ Step 4: Seed Liquidity ============
        console.log("--- Step 4: Seeding Initial Liquidity ---");
        _seedLiquidity(deployer);

        vm.stopBroadcast();

        // ============ Step 5: Save Deployment ============
        _saveDeployment();

        // ============ Print Summary ============
        _printSummary();
    }

    function _deployV8FHEHook(address deployer) internal returns (address) {
        // v8FHE needs: AFTER_INITIALIZE, BEFORE_SWAP, BEFORE_SWAP_RETURNS_DELTA
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG |
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        );

        console.log("v8FHE required flags:", flags);

        bytes memory creationCode = type(FheatherXv8FHE).creationCode;
        bytes memory constructorArgs = abi.encode(
            IPoolManager(POOL_MANAGER),
            deployer,
            SWAP_FEE_BPS
        );

        console.log("Mining valid v8FHE hook address...");
        (address hookAddress, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER,
            flags,
            creationCode,
            constructorArgs
        );
        console.log("Found valid address:", hookAddress);
        console.log("Salt:", vm.toString(salt));

        // Deploy using CREATE2 via the deployer proxy
        bytes memory bytecode = abi.encodePacked(creationCode, constructorArgs);
        (bool success,) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, bytecode));
        require(success, "CREATE2 deployment failed for v8FHE");
        require(hookAddress.code.length > 0, "v8FHE Hook not deployed");

        return hookAddress;
    }

    function _deployV8MixedHook(address deployer) internal returns (address) {
        // v8Mixed needs: AFTER_INITIALIZE, BEFORE_SWAP, BEFORE_SWAP_RETURNS_DELTA
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG |
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        );

        console.log("v8Mixed required flags:", flags);

        bytes memory creationCode = type(FheatherXv8Mixed).creationCode;
        bytes memory constructorArgs = abi.encode(
            IPoolManager(POOL_MANAGER),
            deployer,
            SWAP_FEE_BPS
        );

        console.log("Mining valid v8Mixed hook address...");
        (address hookAddress, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER,
            flags,
            creationCode,
            constructorArgs
        );
        console.log("Found valid address:", hookAddress);
        console.log("Salt:", vm.toString(salt));

        // Deploy using CREATE2 via the deployer proxy
        bytes memory bytecode = abi.encodePacked(creationCode, constructorArgs);
        (bool success,) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, bytecode));
        require(success, "CREATE2 deployment failed for v8Mixed");
        require(hookAddress.code.length > 0, "v8Mixed Hook not deployed");

        return hookAddress;
    }

    function _initializePools() internal {
        IPoolManager pm = IPoolManager(POOL_MANAGER);

        // Pool A: WETH/USDC (ERC20:ERC20) - NO HOOK (native Uniswap v4)
        (address token0A, address token1A) = _sortTokens(WETH, USDC);
        PoolKey memory keyA = PoolKey({
            currency0: Currency.wrap(token0A),
            currency1: Currency.wrap(token1A),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0)) // No hook - native Uniswap v4
        });
        pm.initialize(keyA, SQRT_PRICE_1_1);
        poolIdA = PoolId.unwrap(keyA.toId());
        console.log("Pool A (WETH/USDC) initialized - NATIVE (no hook)");
        console.log("  PoolId:", vm.toString(poolIdA));

        // Pool B: fheWETH/fheUSDC (FHERC20:FHERC20) - v8FHE hook
        (address token0B, address token1B) = _sortTokens(FHE_WETH, FHE_USDC);
        PoolKey memory keyB = PoolKey({
            currency0: Currency.wrap(token0B),
            currency1: Currency.wrap(token1B),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(v8FheHook)
        });
        pm.initialize(keyB, SQRT_PRICE_1_1);
        poolIdB = PoolId.unwrap(keyB.toId());
        console.log("Pool B (fheWETH/fheUSDC) initialized - v8FHE hook");
        console.log("  PoolId:", vm.toString(poolIdB));

        // Pool C: WETH/fheUSDC (ERC20:FHERC20) - v8Mixed hook
        (address token0C, address token1C) = _sortTokens(WETH, FHE_USDC);
        PoolKey memory keyC = PoolKey({
            currency0: Currency.wrap(token0C),
            currency1: Currency.wrap(token1C),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(v8MixedHook)
        });
        pm.initialize(keyC, SQRT_PRICE_1_1);
        poolIdC = PoolId.unwrap(keyC.toId());
        console.log("Pool C (WETH/fheUSDC) initialized - v8Mixed hook");
        console.log("  PoolId:", vm.toString(poolIdC));

        // Pool D: fheWETH/USDC (FHERC20:ERC20) - v8Mixed hook
        (address token0D, address token1D) = _sortTokens(FHE_WETH, USDC);
        PoolKey memory keyD = PoolKey({
            currency0: Currency.wrap(token0D),
            currency1: Currency.wrap(token1D),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(v8MixedHook)
        });
        pm.initialize(keyD, SQRT_PRICE_1_1);
        poolIdD = PoolId.unwrap(keyD.toId());
        console.log("Pool D (fheWETH/USDC) initialized - v8Mixed hook");
        console.log("  PoolId:", vm.toString(poolIdD));

        // Pool E: WETH/fheWETH (ERC20:FHERC20 wrap pair) - v8Mixed hook
        (address token0E, address token1E) = _sortTokens(WETH, FHE_WETH);
        PoolKey memory keyE = PoolKey({
            currency0: Currency.wrap(token0E),
            currency1: Currency.wrap(token1E),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(v8MixedHook)
        });
        pm.initialize(keyE, SQRT_PRICE_1_1);
        poolIdE = PoolId.unwrap(keyE.toId());
        console.log("Pool E (WETH/fheWETH) initialized - v8Mixed hook");
        console.log("  PoolId:", vm.toString(poolIdE));

        // Pool F: USDC/fheUSDC (ERC20:FHERC20 wrap pair) - v8Mixed hook
        (address token0F, address token1F) = _sortTokens(USDC, FHE_USDC);
        PoolKey memory keyF = PoolKey({
            currency0: Currency.wrap(token0F),
            currency1: Currency.wrap(token1F),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(v8MixedHook)
        });
        pm.initialize(keyF, SQRT_PRICE_1_1);
        poolIdF = PoolId.unwrap(keyF.toId());
        console.log("Pool F (USDC/fheUSDC) initialized - v8Mixed hook");
        console.log("  PoolId:", vm.toString(poolIdF));
    }

    function _seedLiquidity(address deployer) internal {
        // Check deployer balances
        uint256 wethBal = IERC20(WETH).balanceOf(deployer);
        uint256 usdcBal = IERC20(USDC).balanceOf(deployer);
        uint256 fheWethBal = IERC20(FHE_WETH).balanceOf(deployer);
        uint256 fheUsdcBal = IERC20(FHE_USDC).balanceOf(deployer);

        console.log("Deployer balances:");
        console.log("  WETH:", wethBal);
        console.log("  USDC:", usdcBal);
        console.log("  fheWETH:", fheWethBal);
        console.log("  fheUSDC:", fheUsdcBal);

        // Required amounts for all 6 pools
        uint256 requiredWeth = INIT_WETH_AMOUNT * 3;      // Pools A + C + E
        uint256 requiredUsdc = INIT_USDC_AMOUNT * 3;      // Pools A + D + F
        uint256 requiredFheWeth = INIT_FHE_WETH_AMOUNT * 3; // Pools B + D + E
        uint256 requiredFheUsdc = INIT_FHE_USDC_AMOUNT * 3; // Pools B + C + F

        bool canSeedLiquidity = true;
        if (wethBal < requiredWeth) {
            console.log("WARNING: Insufficient WETH. Need:", requiredWeth);
            canSeedLiquidity = false;
        }
        if (usdcBal < requiredUsdc) {
            console.log("WARNING: Insufficient USDC. Need:", requiredUsdc);
            canSeedLiquidity = false;
        }
        if (fheWethBal < requiredFheWeth) {
            console.log("WARNING: Insufficient fheWETH. Need:", requiredFheWeth);
            canSeedLiquidity = false;
        }
        if (fheUsdcBal < requiredFheUsdc) {
            console.log("WARNING: Insufficient fheUSDC. Need:", requiredFheUsdc);
            canSeedLiquidity = false;
        }

        if (!canSeedLiquidity) {
            console.log("");
            console.log("SKIPPING LIQUIDITY SEEDING - use faucet to get tokens first");
            console.log("Run: cast send <token> 'faucet()' --rpc-url $ETH_SEPOLIA_RPC --private-key $PRIVATE_KEY");
            return;
        }

        // Pool A is native (no hook) - use Uniswap v4's position manager for liquidity
        // For simplicity, we'll only seed liquidity to the hook pools via their addLiquidity()
        console.log("Pool A (native) - Use PositionManager for liquidity");

        // Pool B (v8FHE) requires encrypted addLiquidity - cannot be done from Foundry
        // Must be seeded via frontend or separate script with FHE capabilities
        console.log("Pool B (fheWETH/fheUSDC) - v8FHE requires encrypted addLiquidity");
        console.log("  -> Skipping, must seed via frontend with FHE session");

        // Approve v8Mixed hook for all tokens
        IERC20(WETH).approve(v8MixedHook, type(uint256).max);
        IERC20(USDC).approve(v8MixedHook, type(uint256).max);
        IERC20(FHE_WETH).approve(v8MixedHook, type(uint256).max);
        IERC20(FHE_USDC).approve(v8MixedHook, type(uint256).max);
        console.log("Approved v8Mixed hook for all tokens");

        // Add liquidity to Pool C (WETH/fheUSDC) via v8Mixed
        (address token0C, address token1C) = _sortTokens(WETH, FHE_USDC);
        (uint256 amt0C, uint256 amt1C) = _getOrderedAmounts(
            token0C, token1C,
            WETH, FHE_USDC,
            INIT_WETH_AMOUNT, INIT_FHE_USDC_AMOUNT
        );
        FheatherXv8Mixed(payable(v8MixedHook)).addLiquidity(PoolId.wrap(poolIdC), amt0C, amt1C);
        console.log("Added liquidity to Pool C (WETH/fheUSDC)");

        // Add liquidity to Pool D (fheWETH/USDC) via v8Mixed
        (address token0D, address token1D) = _sortTokens(FHE_WETH, USDC);
        (uint256 amt0D, uint256 amt1D) = _getOrderedAmounts(
            token0D, token1D,
            FHE_WETH, USDC,
            INIT_FHE_WETH_AMOUNT, INIT_USDC_AMOUNT
        );
        FheatherXv8Mixed(payable(v8MixedHook)).addLiquidity(PoolId.wrap(poolIdD), amt0D, amt1D);
        console.log("Added liquidity to Pool D (fheWETH/USDC)");

        // Add liquidity to Pool E (WETH/fheWETH) via v8Mixed
        (address token0E, address token1E) = _sortTokens(WETH, FHE_WETH);
        (uint256 amt0E, uint256 amt1E) = _getOrderedAmounts(
            token0E, token1E,
            WETH, FHE_WETH,
            INIT_WETH_AMOUNT, INIT_FHE_WETH_AMOUNT
        );
        FheatherXv8Mixed(payable(v8MixedHook)).addLiquidity(PoolId.wrap(poolIdE), amt0E, amt1E);
        console.log("Added liquidity to Pool E (WETH/fheWETH)");

        // Add liquidity to Pool F (USDC/fheUSDC) via v8Mixed
        (address token0F, address token1F) = _sortTokens(USDC, FHE_USDC);
        (uint256 amt0F, uint256 amt1F) = _getOrderedAmounts(
            token0F, token1F,
            USDC, FHE_USDC,
            INIT_USDC_AMOUNT, INIT_FHE_USDC_AMOUNT
        );
        FheatherXv8Mixed(payable(v8MixedHook)).addLiquidity(PoolId.wrap(poolIdF), amt0F, amt1F);
        console.log("Added liquidity to Pool F (USDC/fheUSDC)");
    }

    function _sortTokens(address tokenA, address tokenB) internal pure returns (address, address) {
        return tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    }

    function _getOrderedAmounts(
        address token0,
        address token1,
        address desiredToken0,
        address desiredToken1,
        uint256 amount0,
        uint256 amount1
    ) internal pure returns (uint256, uint256) {
        if (token0 == desiredToken0) {
            return (amount0, amount1);
        } else {
            return (amount1, amount0);
        }
    }

    function _saveDeployment() internal {
        // Get sorted tokens for each pool
        (address t0A, address t1A) = _sortTokens(WETH, USDC);
        (address t0B, address t1B) = _sortTokens(FHE_WETH, FHE_USDC);
        (address t0C, address t1C) = _sortTokens(WETH, FHE_USDC);
        (address t0D, address t1D) = _sortTokens(FHE_WETH, USDC);
        (address t0E, address t1E) = _sortTokens(WETH, FHE_WETH);
        (address t0F, address t1F) = _sortTokens(USDC, FHE_USDC);

        string memory json = string.concat(
            '{\n',
            '  "version": "v8",\n',
            '  "chainId": ', vm.toString(block.chainid), ',\n',
            '  "deployedAt": "', vm.toString(block.timestamp), '",\n',
            '  "contracts": {\n',
            '    "v8FheHook": "', vm.toString(v8FheHook), '",\n',
            '    "v8MixedHook": "', vm.toString(v8MixedHook), '",\n',
            '    "poolManager": "', vm.toString(POOL_MANAGER), '",\n',
            '    "swapRouter": "', vm.toString(SWAP_ROUTER), '",\n',
            '    "positionManager": "', vm.toString(POSITION_MANAGER), '"\n',
            '  },\n',
            '  "tokens": {\n',
            '    "WETH": { "address": "', vm.toString(WETH), '", "decimals": 18, "type": "ERC20" },\n',
            '    "USDC": { "address": "', vm.toString(USDC), '", "decimals": 6, "type": "ERC20" },\n',
            '    "fheWETH": { "address": "', vm.toString(FHE_WETH), '", "decimals": 18, "type": "FHERC20" },\n',
            '    "fheUSDC": { "address": "', vm.toString(FHE_USDC), '", "decimals": 6, "type": "FHERC20" }\n',
            '  },\n'
        );

        json = string.concat(
            json,
            '  "pools": {\n',
            '    "WETH_USDC": {\n',
            '      "poolId": "', vm.toString(poolIdA), '",\n',
            '      "token0": "', vm.toString(t0A), '",\n',
            '      "token1": "', vm.toString(t1A), '",\n',
            '      "hook": "0x0000000000000000000000000000000000000000",\n',
            '      "type": "native",\n',
            '      "contractType": "native"\n',
            '    },\n',
            '    "fheWETH_fheUSDC": {\n',
            '      "poolId": "', vm.toString(poolIdB), '",\n',
            '      "token0": "', vm.toString(t0B), '",\n',
            '      "token1": "', vm.toString(t1B), '",\n',
            '      "hook": "', vm.toString(v8FheHook), '",\n',
            '      "type": "FHE:FHE",\n',
            '      "contractType": "v8fhe"\n',
            '    },\n'
        );

        json = string.concat(
            json,
            '    "WETH_fheUSDC": {\n',
            '      "poolId": "', vm.toString(poolIdC), '",\n',
            '      "token0": "', vm.toString(t0C), '",\n',
            '      "token1": "', vm.toString(t1C), '",\n',
            '      "hook": "', vm.toString(v8MixedHook), '",\n',
            '      "type": "ERC:FHE",\n',
            '      "contractType": "v8mixed"\n',
            '    },\n',
            '    "fheWETH_USDC": {\n',
            '      "poolId": "', vm.toString(poolIdD), '",\n',
            '      "token0": "', vm.toString(t0D), '",\n',
            '      "token1": "', vm.toString(t1D), '",\n',
            '      "hook": "', vm.toString(v8MixedHook), '",\n',
            '      "type": "FHE:ERC",\n',
            '      "contractType": "v8mixed"\n',
            '    },\n'
        );

        json = string.concat(
            json,
            '    "WETH_fheWETH": {\n',
            '      "poolId": "', vm.toString(poolIdE), '",\n',
            '      "token0": "', vm.toString(t0E), '",\n',
            '      "token1": "', vm.toString(t1E), '",\n',
            '      "hook": "', vm.toString(v8MixedHook), '",\n',
            '      "type": "ERC:FHE",\n',
            '      "contractType": "v8mixed"\n',
            '    },\n',
            '    "USDC_fheUSDC": {\n',
            '      "poolId": "', vm.toString(poolIdF), '",\n',
            '      "token0": "', vm.toString(t0F), '",\n',
            '      "token1": "', vm.toString(t1F), '",\n',
            '      "hook": "', vm.toString(v8MixedHook), '",\n',
            '      "type": "ERC:FHE",\n',
            '      "contractType": "v8mixed"\n',
            '    }\n',
            '  },\n'
        );

        json = string.concat(
            json,
            '  "poolConfig": {\n',
            '    "fee": ', vm.toString(POOL_FEE), ',\n',
            '    "tickSpacing": ', vm.toString(uint256(uint24(TICK_SPACING))), ',\n',
            '    "swapFeeBps": ', vm.toString(SWAP_FEE_BPS), '\n',
            '  },\n',
            '  "features": {\n',
            '    "multiPool": true,\n',
            '    "encryptedAMM": true,\n',
            '    "limitOrders": true,\n',
            '    "mixedPairs": true,\n',
            '    "v4Settlement": true,\n',
            '    "nativePools": true\n',
            '  }\n',
            '}'
        );

        vm.writeFile(DEPLOYMENTS_PATH, json);
    }

    function _printSummary() internal view {
        console.log("");
        console.log("===========================================");
        console.log("  DEPLOYMENT COMPLETE - FheatherXv8");
        console.log("===========================================");
        console.log("");
        console.log("Hooks:");
        console.log("  v8FHE (FHE:FHE):", v8FheHook);
        console.log("  v8Mixed (ERC:FHE):", v8MixedHook);
        console.log("");
        console.log("Infrastructure:");
        console.log("  Pool Manager:", POOL_MANAGER);
        console.log("  Swap Router:", SWAP_ROUTER);
        console.log("");
        console.log("Pools:");
        console.log("  A (WETH/USDC)    - NATIVE:", vm.toString(poolIdA));
        console.log("  B (fheWETH/fheUSDC) - v8FHE:", vm.toString(poolIdB));
        console.log("  C (WETH/fheUSDC)   - v8Mixed:", vm.toString(poolIdC));
        console.log("  D (fheWETH/USDC)   - v8Mixed:", vm.toString(poolIdD));
        console.log("  E (WETH/fheWETH)   - v8Mixed:", vm.toString(poolIdE));
        console.log("  F (USDC/fheUSDC)   - v8Mixed:", vm.toString(poolIdF));
        console.log("");
        console.log("Tokens:");
        console.log("  WETH:", WETH);
        console.log("  USDC:", USDC);
        console.log("  fheWETH:", FHE_WETH);
        console.log("  fheUSDC:", FHE_USDC);
        console.log("");
        console.log("Deployment saved to:", DEPLOYMENTS_PATH);
        console.log("");
        console.log("Next steps:");
        console.log("1. Update frontend addresses in addresses.ts");
        console.log("2. Update poolStore with new hooks");
        console.log("3. Test swaps on each pool type");
    }
}
