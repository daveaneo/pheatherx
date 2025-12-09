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
import {FheatherXv6} from "../src/FheatherXv6.sol";

/// @title DeployV6Complete
/// @notice Deploy FheatherXv6 hook with all 4 pool types on Ethereum Sepolia
/// @dev Run with: source .env && forge script script/DeployV6Complete.s.sol:DeployV6Complete --rpc-url $ETH_SEPOLIA_RPC --broadcast -vvv
///
/// This script:
/// 1. Deploys FheatherXv6 hook using CREATE2
/// 2. Initializes 4 pools via PoolManager:
///    - Pool A: WETH/USDC (ERC20:ERC20)
///    - Pool B: fheWETH/fheUSDC (FHERC20:FHERC20)
///    - Pool C: WETH/fheUSDC (ERC20:FHERC20)
///    - Pool D: fheWETH/USDC (FHERC20:ERC20)
/// 3. Seeds initial liquidity to each pool
/// 4. Exports deployment addresses to JSON
contract DeployV6Complete is Script {
    using stdJson for string;
    using PoolIdLibrary for PoolKey;

    // ============ Ethereum Sepolia Addresses ============
    // Uniswap v4 (from https://docs.uniswap.org/contracts/v4/deployments)
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant SWAP_ROUTER = 0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe;  // PoolSwapTest
    address constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;

    // CREATE2 Deployer Proxy (standard across EVM chains)
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    // Existing Faucet Tokens (from DeployFaucetTokens.s.sol)
    address constant WETH = 0xe9Df64F549Eb1d2778909F339B9Bd795d14cF32E;
    address constant USDC = 0xF7Ff2A5E74eaA6E0463358BB26780049d3D45C56;
    address constant FHE_WETH = 0xf0F8f49b4065A1B01050Fa358d287106B676a25F;
    address constant FHE_USDC = 0x1D77eE754b2080B354733299A5aC678539a0D740;

    // ============ Deployment Config ============
    uint256 constant SWAP_FEE_BPS = 30; // 0.3%
    uint24 constant POOL_FEE = 3000;    // 0.3% for Uniswap V4
    int24 constant TICK_SPACING = 60;

    // Initial sqrt price for 1:1 ratio (scaled by 2^96)
    // For WETH/USDC at different decimals, we'd need different values
    // But for simplicity in testing, using 1:1 at scale
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336; // sqrt(1) * 2^96

    // Initial liquidity amounts
    uint256 constant INIT_WETH_AMOUNT = 10 ether;           // 10 WETH
    uint256 constant INIT_USDC_AMOUNT = 10_000 * 1e6;       // 10,000 USDC
    uint256 constant INIT_FHE_WETH_AMOUNT = 10 ether;       // 10 fheWETH
    uint256 constant INIT_FHE_USDC_AMOUNT = 10_000 * 1e6;   // 10,000 fheUSDC

    string constant DEPLOYMENTS_PATH = "deployments/v6-eth-sepolia.json";

    // Storage for pool IDs
    bytes32 poolIdA;
    bytes32 poolIdB;
    bytes32 poolIdC;
    bytes32 poolIdD;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("===========================================");
        console.log("  FheatherXv6 Complete Deployment");
        console.log("  Ethereum Sepolia");
        console.log("===========================================");
        console.log("");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Pool Manager:", POOL_MANAGER);
        console.log("");

        // ============ Step 1: Deploy Hook ============
        console.log("--- Step 1: Deploying FheatherXv6 Hook ---");

        vm.startBroadcast(deployerPrivateKey);

        // Calculate required hook flags for v6
        // v6 needs: AFTER_INITIALIZE, BEFORE_SWAP, AFTER_SWAP, BEFORE_SWAP_RETURNS_DELTA
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG |
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.AFTER_SWAP_FLAG |
            Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        );

        console.log("Required flags:", flags);

        // Mine a salt that produces a valid hook address
        bytes memory creationCode = type(FheatherXv6).creationCode;
        bytes memory constructorArgs = abi.encode(
            IPoolManager(POOL_MANAGER),
            deployer,  // owner
            SWAP_FEE_BPS
        );

        console.log("Mining valid hook address...");
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

        // Call CREATE2 deployer
        (bool success,) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, bytecode));
        require(success, "CREATE2 deployment failed");

        // Verify deployment
        FheatherXv6 hook = FheatherXv6(payable(hookAddress));
        require(address(hook).code.length > 0, "Hook not deployed");

        console.log("Hook deployed at:", hookAddress);
        console.log("");

        // ============ Step 2: Initialize Pools ============
        console.log("--- Step 2: Initializing Pools ---");

        IPoolManager pm = IPoolManager(POOL_MANAGER);

        // Pool A: WETH/USDC (ERC20:ERC20)
        // Note: currency0 must be < currency1 by address
        (address token0A, address token1A) = _sortTokens(WETH, USDC);
        PoolKey memory keyA = PoolKey({
            currency0: Currency.wrap(token0A),
            currency1: Currency.wrap(token1A),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hookAddress)
        });
        pm.initialize(keyA, SQRT_PRICE_1_1);
        poolIdA = PoolId.unwrap(keyA.toId());
        console.log("Pool A (WETH/USDC) initialized");
        console.log("  PoolId:", vm.toString(poolIdA));

        // Pool B: fheWETH/fheUSDC (FHERC20:FHERC20)
        (address token0B, address token1B) = _sortTokens(FHE_WETH, FHE_USDC);
        PoolKey memory keyB = PoolKey({
            currency0: Currency.wrap(token0B),
            currency1: Currency.wrap(token1B),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hookAddress)
        });
        pm.initialize(keyB, SQRT_PRICE_1_1);
        poolIdB = PoolId.unwrap(keyB.toId());
        console.log("Pool B (fheWETH/fheUSDC) initialized");
        console.log("  PoolId:", vm.toString(poolIdB));

        // Pool C: WETH/fheUSDC (ERC20:FHERC20)
        (address token0C, address token1C) = _sortTokens(WETH, FHE_USDC);
        PoolKey memory keyC = PoolKey({
            currency0: Currency.wrap(token0C),
            currency1: Currency.wrap(token1C),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hookAddress)
        });
        pm.initialize(keyC, SQRT_PRICE_1_1);
        poolIdC = PoolId.unwrap(keyC.toId());
        console.log("Pool C (WETH/fheUSDC) initialized");
        console.log("  PoolId:", vm.toString(poolIdC));

        // Pool D: fheWETH/USDC (FHERC20:ERC20)
        (address token0D, address token1D) = _sortTokens(FHE_WETH, USDC);
        PoolKey memory keyD = PoolKey({
            currency0: Currency.wrap(token0D),
            currency1: Currency.wrap(token1D),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hookAddress)
        });
        pm.initialize(keyD, SQRT_PRICE_1_1);
        poolIdD = PoolId.unwrap(keyD.toId());
        console.log("Pool D (fheWETH/USDC) initialized");
        console.log("  PoolId:", vm.toString(poolIdD));
        console.log("");

        // ============ Step 3: Seed Liquidity ============
        console.log("--- Step 3: Seeding Initial Liquidity ---");

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

        // Required amounts for all 4 pools
        uint256 requiredWeth = INIT_WETH_AMOUNT * 2;      // Pools A + C
        uint256 requiredUsdc = INIT_USDC_AMOUNT * 2;      // Pools A + D
        uint256 requiredFheWeth = INIT_FHE_WETH_AMOUNT * 2; // Pools B + D
        uint256 requiredFheUsdc = INIT_FHE_USDC_AMOUNT * 2; // Pools B + C

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

        if (canSeedLiquidity) {
            // Approve hook for all tokens
            IERC20(WETH).approve(hookAddress, type(uint256).max);
            IERC20(USDC).approve(hookAddress, type(uint256).max);
            IERC20(FHE_WETH).approve(hookAddress, type(uint256).max);
            IERC20(FHE_USDC).approve(hookAddress, type(uint256).max);
            console.log("Approved hook for all tokens");

            // Add liquidity to Pool A (WETH/USDC)
            (uint256 amt0A, uint256 amt1A) = _getOrderedAmounts(
                token0A, token1A,
                WETH, USDC,
                INIT_WETH_AMOUNT, INIT_USDC_AMOUNT
            );
            hook.addLiquidity(PoolId.wrap(poolIdA), amt0A, amt1A);
            console.log("Added liquidity to Pool A");

            // Add liquidity to Pool B (fheWETH/fheUSDC)
            (uint256 amt0B, uint256 amt1B) = _getOrderedAmounts(
                token0B, token1B,
                FHE_WETH, FHE_USDC,
                INIT_FHE_WETH_AMOUNT, INIT_FHE_USDC_AMOUNT
            );
            hook.addLiquidity(PoolId.wrap(poolIdB), amt0B, amt1B);
            console.log("Added liquidity to Pool B");

            // Add liquidity to Pool C (WETH/fheUSDC)
            (uint256 amt0C, uint256 amt1C) = _getOrderedAmounts(
                token0C, token1C,
                WETH, FHE_USDC,
                INIT_WETH_AMOUNT, INIT_FHE_USDC_AMOUNT
            );
            hook.addLiquidity(PoolId.wrap(poolIdC), amt0C, amt1C);
            console.log("Added liquidity to Pool C");

            // Add liquidity to Pool D (fheWETH/USDC)
            (uint256 amt0D, uint256 amt1D) = _getOrderedAmounts(
                token0D, token1D,
                FHE_WETH, USDC,
                INIT_FHE_WETH_AMOUNT, INIT_USDC_AMOUNT
            );
            hook.addLiquidity(PoolId.wrap(poolIdD), amt0D, amt1D);
            console.log("Added liquidity to Pool D");
        } else {
            console.log("");
            console.log("SKIPPING LIQUIDITY SEEDING - use faucet to get tokens first");
            console.log("Run: cast send <token> 'faucet()' --rpc-url $ETH_SEPOLIA_RPC --private-key $PRIVATE_KEY");
        }

        // Set default pool to Pool A
        hook.setDefaultPool(PoolId.wrap(poolIdA));
        console.log("Set default pool to Pool A (WETH/USDC)");

        vm.stopBroadcast();

        // ============ Step 4: Save Deployment ============
        _saveDeployment(
            hookAddress,
            token0A, token1A,
            token0B, token1B,
            token0C, token1C,
            token0D, token1D
        );

        // ============ Print Summary ============
        console.log("");
        console.log("===========================================");
        console.log("  DEPLOYMENT COMPLETE - FheatherXv6");
        console.log("===========================================");
        console.log("");
        console.log("Hook:", hookAddress);
        console.log("Pool Manager:", POOL_MANAGER);
        console.log("Swap Router:", SWAP_ROUTER);
        console.log("");
        console.log("Pools:");
        console.log("  A (WETH/USDC):", vm.toString(poolIdA));
        console.log("  B (fheWETH/fheUSDC):", vm.toString(poolIdB));
        console.log("  C (WETH/fheUSDC):", vm.toString(poolIdC));
        console.log("  D (fheWETH/USDC):", vm.toString(poolIdD));
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
        console.log("1. Run VerifyDeployment.s.sol to verify");
        console.log("2. Update frontend addresses in .env and addresses.ts");
        console.log("3. If liquidity was skipped, use faucet and run SeedLiquidity.s.sol");
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
        // token0/token1 are sorted by address
        // desiredToken0/desiredToken1 are in our preferred order (e.g., WETH/USDC)
        // amount0/amount1 correspond to desiredToken0/desiredToken1
        if (token0 == desiredToken0) {
            return (amount0, amount1);
        } else {
            return (amount1, amount0);
        }
    }

    function _saveDeployment(
        address hook,
        address t0A, address t1A,
        address t0B, address t1B,
        address t0C, address t1C,
        address t0D, address t1D
    ) internal {
        // Build pool type strings
        string memory poolAType = t0A == WETH ? "ERC:ERC" : "ERC:ERC";
        string memory poolBType = "FHE:FHE";
        string memory poolCType = t0C == WETH ? "ERC:FHE" : "FHE:ERC";
        string memory poolDType = t0D == FHE_WETH ? "FHE:ERC" : "ERC:FHE";

        string memory json = string.concat(
            '{\n',
            '  "version": "v6",\n',
            '  "chainId": ', vm.toString(block.chainid), ',\n',
            '  "deployedAt": "', vm.toString(block.timestamp), '",\n',
            '  "contracts": {\n',
            '    "hook": "', vm.toString(hook), '",\n',
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
            '      "type": "', poolAType, '"\n',
            '    },\n',
            '    "fheWETH_fheUSDC": {\n',
            '      "poolId": "', vm.toString(poolIdB), '",\n',
            '      "token0": "', vm.toString(t0B), '",\n',
            '      "token1": "', vm.toString(t1B), '",\n',
            '      "type": "', poolBType, '"\n',
            '    },\n',
            '    "WETH_fheUSDC": {\n',
            '      "poolId": "', vm.toString(poolIdC), '",\n',
            '      "token0": "', vm.toString(t0C), '",\n',
            '      "token1": "', vm.toString(t1C), '",\n',
            '      "type": "', poolCType, '"\n',
            '    },\n',
            '    "fheWETH_USDC": {\n',
            '      "poolId": "', vm.toString(poolIdD), '",\n',
            '      "token0": "', vm.toString(t0D), '",\n',
            '      "token1": "', vm.toString(t1D), '",\n',
            '      "type": "', poolDType, '"\n',
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
            '    "v4Settlement": true\n',
            '  }\n',
            '}'
        );

        vm.writeFile(DEPLOYMENTS_PATH, json);
    }
}
