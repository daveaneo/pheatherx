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
import {FaucetToken} from "../src/tokens/FaucetToken.sol";
import {FhenixFHERC20Faucet} from "../src/tokens/FhenixFHERC20Faucet.sol";

/// @title DeployArbSepolia
/// @notice Deploy FheatherXv6 complete stack on Arbitrum Sepolia
/// @dev Run with: source .env && forge script script/DeployArbSepolia.s.sol:DeployArbSepolia --rpc-url $ARB_SEPOLIA_RPC --broadcast -vvv
///
/// This script deploys:
/// 1. Faucet tokens (WETH, USDC, fheWETH, fheUSDC) - all new
/// 2. FheatherXv6 hook using CREATE2
/// 3. Initializes 4 pools via PoolManager
/// 4. Seeds initial liquidity
/// 5. Exports deployment addresses to JSON
contract DeployArbSepolia is Script {
    using stdJson for string;
    using PoolIdLibrary for PoolKey;

    // ============ Arbitrum Sepolia Addresses ============
    // Uniswap v4 (from https://docs.uniswap.org/contracts/v4/deployments)
    address constant POOL_MANAGER = 0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317;
    address constant SWAP_ROUTER = 0xf3A39C86dbd13C45365E57FB90fe413371F65AF8;  // PoolSwapTest
    address constant POSITION_MANAGER = 0xAc631556d3d4019C95769033B5E719dD77124BAc;

    // CREATE2 Deployer Proxy (standard across EVM chains)
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    // ============ Deployment Config ============
    uint256 constant SWAP_FEE_BPS = 30; // 0.3%
    uint24 constant POOL_FEE = 3000;    // 0.3% for Uniswap V4
    int24 constant TICK_SPACING = 60;

    // Initial sqrt price for 1:1 ratio (scaled by 2^96)
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    // Initial liquidity amounts
    uint256 constant INIT_WETH_AMOUNT = 10 ether;
    uint256 constant INIT_USDC_AMOUNT = 10_000 * 1e6;
    uint256 constant INIT_FHE_WETH_AMOUNT = 10 ether;
    uint256 constant INIT_FHE_USDC_AMOUNT = 10_000 * 1e6;

    string constant DEPLOYMENTS_PATH = "deployments/v6-arb-sepolia.json";

    // Deployed token addresses
    address weth;
    address usdc;
    address fheWeth;
    address fheUsdc;

    // Pool IDs
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
        console.log("  FheatherXv6 Complete Deployment");
        console.log("  Arbitrum Sepolia (Chain ID: 421614)");
        console.log("===========================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("Pool Manager:", POOL_MANAGER);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // ============ Step 1: Deploy Faucet Tokens ============
        console.log("--- Step 1: Deploying Faucet Tokens ---");

        // Deploy ERC20 tokens
        FaucetToken wethToken = new FaucetToken("Wrapped Ether", "WETH", 18);
        weth = address(wethToken);
        console.log("WETH deployed at:", weth);

        FaucetToken usdcToken = new FaucetToken("USD Coin", "USDC", 6);
        usdc = address(usdcToken);
        console.log("USDC deployed at:", usdc);

        // Deploy FHERC20 tokens (using official Fhenix FHERC20 with faucet extension)
        FhenixFHERC20Faucet fheWethToken = new FhenixFHERC20Faucet("FHE Wrapped Ether", "fheWETH", 18);
        fheWeth = address(fheWethToken);
        console.log("fheWETH deployed at:", fheWeth);

        FhenixFHERC20Faucet fheUsdcToken = new FhenixFHERC20Faucet("FHE USD Coin", "fheUSDC", 6);
        fheUsdc = address(fheUsdcToken);
        console.log("fheUSDC deployed at:", fheUsdc);

        // Mint initial supply to deployer (need extra for 6 pools + wrapping pairs)
        uint256 wethMint = 2_000 * 1e18;     // 2000 WETH (for 4 WETH pools)
        uint256 usdcMint = 2_000_000 * 1e6;  // 2M USDC (for 4 USDC pools)

        wethToken.mint(deployer, wethMint);
        usdcToken.mint(deployer, usdcMint);
        // Use mintPlaintext for FHERC20 so addLiquidity can use transferFrom
        // The hook will wrap() them to encrypted balance as needed
        fheWethToken.mintPlaintext(deployer, wethMint);
        fheUsdcToken.mintPlaintext(deployer, usdcMint);
        console.log("Minted initial supply to deployer");
        console.log("");

        // ============ Step 2: Deploy Hook ============
        console.log("--- Step 2: Deploying FheatherXv6 Hook ---");

        // Calculate required hook flags for v6
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG |
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.AFTER_SWAP_FLAG |
            Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        );

        console.log("Required flags:", flags);

        bytes memory creationCode = type(FheatherXv6).creationCode;
        bytes memory constructorArgs = abi.encode(
            IPoolManager(POOL_MANAGER),
            deployer,
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
        (bool success,) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, bytecode));
        require(success, "CREATE2 deployment failed");

        FheatherXv6 hook = FheatherXv6(payable(hookAddress));
        require(address(hook).code.length > 0, "Hook not deployed");
        console.log("Hook deployed at:", hookAddress);
        console.log("");

        // ============ Step 3: Initialize Pools ============
        console.log("--- Step 3: Initializing Pools ---");

        IPoolManager pm = IPoolManager(POOL_MANAGER);

        // Pool A: WETH/USDC (ERC20:ERC20)
        (address token0A, address token1A) = _sortTokens(weth, usdc);
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
        (address token0B, address token1B) = _sortTokens(fheWeth, fheUsdc);
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
        (address token0C, address token1C) = _sortTokens(weth, fheUsdc);
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
        (address token0D, address token1D) = _sortTokens(fheWeth, usdc);
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

        // Pool E: WETH/fheWETH (ERC20:FHERC20) - Wrapping pair
        (address token0E, address token1E) = _sortTokens(weth, fheWeth);
        PoolKey memory keyE = PoolKey({
            currency0: Currency.wrap(token0E),
            currency1: Currency.wrap(token1E),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hookAddress)
        });
        pm.initialize(keyE, SQRT_PRICE_1_1);
        poolIdE = PoolId.unwrap(keyE.toId());
        console.log("Pool E (WETH/fheWETH) initialized");
        console.log("  PoolId:", vm.toString(poolIdE));

        // Pool F: USDC/fheUSDC (ERC20:FHERC20) - Wrapping pair
        (address token0F, address token1F) = _sortTokens(usdc, fheUsdc);
        PoolKey memory keyF = PoolKey({
            currency0: Currency.wrap(token0F),
            currency1: Currency.wrap(token1F),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hookAddress)
        });
        pm.initialize(keyF, SQRT_PRICE_1_1);
        poolIdF = PoolId.unwrap(keyF.toId());
        console.log("Pool F (USDC/fheUSDC) initialized");
        console.log("  PoolId:", vm.toString(poolIdF));
        console.log("");

        // ============ Step 4: Seed Liquidity ============
        console.log("--- Step 4: Seeding Initial Liquidity ---");

        // Approve hook for all tokens
        IERC20(weth).approve(hookAddress, type(uint256).max);
        IERC20(usdc).approve(hookAddress, type(uint256).max);
        IERC20(fheWeth).approve(hookAddress, type(uint256).max);
        IERC20(fheUsdc).approve(hookAddress, type(uint256).max);
        console.log("Approved hook for all tokens");

        // Add liquidity to Pool A (WETH/USDC)
        (uint256 amt0A, uint256 amt1A) = _getOrderedAmounts(
            token0A, token1A, weth, usdc, INIT_WETH_AMOUNT, INIT_USDC_AMOUNT
        );
        hook.addLiquidity(PoolId.wrap(poolIdA), amt0A, amt1A);
        console.log("Added liquidity to Pool A");

        // Add liquidity to Pool B (fheWETH/fheUSDC)
        (uint256 amt0B, uint256 amt1B) = _getOrderedAmounts(
            token0B, token1B, fheWeth, fheUsdc, INIT_FHE_WETH_AMOUNT, INIT_FHE_USDC_AMOUNT
        );
        hook.addLiquidity(PoolId.wrap(poolIdB), amt0B, amt1B);
        console.log("Added liquidity to Pool B");

        // Add liquidity to Pool C (WETH/fheUSDC)
        (uint256 amt0C, uint256 amt1C) = _getOrderedAmounts(
            token0C, token1C, weth, fheUsdc, INIT_WETH_AMOUNT, INIT_FHE_USDC_AMOUNT
        );
        hook.addLiquidity(PoolId.wrap(poolIdC), amt0C, amt1C);
        console.log("Added liquidity to Pool C");

        // Add liquidity to Pool D (fheWETH/USDC)
        (uint256 amt0D, uint256 amt1D) = _getOrderedAmounts(
            token0D, token1D, fheWeth, usdc, INIT_FHE_WETH_AMOUNT, INIT_USDC_AMOUNT
        );
        hook.addLiquidity(PoolId.wrap(poolIdD), amt0D, amt1D);
        console.log("Added liquidity to Pool D");

        // Add liquidity to Pool E (WETH/fheWETH) - 1:1 wrapping pair
        (uint256 amt0E, uint256 amt1E) = _getOrderedAmounts(
            token0E, token1E, weth, fheWeth, INIT_WETH_AMOUNT, INIT_FHE_WETH_AMOUNT
        );
        hook.addLiquidity(PoolId.wrap(poolIdE), amt0E, amt1E);
        console.log("Added liquidity to Pool E");

        // Add liquidity to Pool F (USDC/fheUSDC) - 1:1 wrapping pair
        (uint256 amt0F, uint256 amt1F) = _getOrderedAmounts(
            token0F, token1F, usdc, fheUsdc, INIT_USDC_AMOUNT, INIT_FHE_USDC_AMOUNT
        );
        hook.addLiquidity(PoolId.wrap(poolIdF), amt0F, amt1F);
        console.log("Added liquidity to Pool F");

        // Set default pool to Pool A
        hook.setDefaultPool(PoolId.wrap(poolIdA));
        console.log("Set default pool to Pool A (WETH/USDC)");

        vm.stopBroadcast();

        // ============ Step 5: Save Deployment ============
        _saveDeployment(
            hookAddress,
            token0A, token1A,
            token0B, token1B,
            token0C, token1C,
            token0D, token1D,
            token0E, token1E,
            token0F, token1F
        );

        // ============ Print Summary ============
        console.log("");
        console.log("===========================================");
        console.log("  DEPLOYMENT COMPLETE - FheatherXv6");
        console.log("  Arbitrum Sepolia");
        console.log("===========================================");
        console.log("");
        console.log("Hook:", hookAddress);
        console.log("Pool Manager:", POOL_MANAGER);
        console.log("Swap Router:", SWAP_ROUTER);
        console.log("");
        console.log("Tokens:");
        console.log("  WETH:", weth);
        console.log("  USDC:", usdc);
        console.log("  fheWETH:", fheWeth);
        console.log("  fheUSDC:", fheUsdc);
        console.log("");
        console.log("Pools (6 total):");
        console.log("  A (WETH/USDC):", vm.toString(poolIdA));
        console.log("  B (fheWETH/fheUSDC):", vm.toString(poolIdB));
        console.log("  C (WETH/fheUSDC):", vm.toString(poolIdC));
        console.log("  D (fheWETH/USDC):", vm.toString(poolIdD));
        console.log("  E (WETH/fheWETH):", vm.toString(poolIdE));
        console.log("  F (USDC/fheUSDC):", vm.toString(poolIdF));
        console.log("");
        console.log("Deployment saved to:", DEPLOYMENTS_PATH);
    }

    function _sortTokens(address tokenA, address tokenB) internal pure returns (address, address) {
        return tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    }

    function _getOrderedAmounts(
        address token0,
        address token1,
        address desiredToken0,
        address, // desiredToken1 unused
        uint256 amount0,
        uint256 amount1
    ) internal pure returns (uint256, uint256) {
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
        address t0D, address t1D,
        address t0E, address t1E,
        address t0F, address t1F
    ) internal {
        string memory json = string.concat(
            '{\n',
            '  "version": "v6",\n',
            '  "network": "arb-sepolia",\n',
            '  "chainId": 421614,\n',
            '  "deployedAt": "', vm.toString(block.timestamp), '",\n',
            '  "contracts": {\n',
            '    "hook": "', vm.toString(hook), '",\n',
            '    "poolManager": "', vm.toString(POOL_MANAGER), '",\n',
            '    "swapRouter": "', vm.toString(SWAP_ROUTER), '",\n',
            '    "positionManager": "', vm.toString(POSITION_MANAGER), '"\n',
            '  },\n',
            '  "tokens": {\n',
            '    "WETH": { "address": "', vm.toString(weth), '", "decimals": 18, "type": "ERC20" },\n',
            '    "USDC": { "address": "', vm.toString(usdc), '", "decimals": 6, "type": "ERC20" },\n',
            '    "fheWETH": { "address": "', vm.toString(fheWeth), '", "decimals": 18, "type": "FHERC20" },\n',
            '    "fheUSDC": { "address": "', vm.toString(fheUsdc), '", "decimals": 6, "type": "FHERC20" }\n',
            '  },\n'
        );

        json = string.concat(
            json,
            '  "pools": {\n',
            '    "WETH_USDC": {\n',
            '      "poolId": "', vm.toString(poolIdA), '",\n',
            '      "token0": "', vm.toString(t0A), '",\n',
            '      "token1": "', vm.toString(t1A), '",\n',
            '      "type": "ERC:ERC"\n',
            '    },\n',
            '    "fheWETH_fheUSDC": {\n',
            '      "poolId": "', vm.toString(poolIdB), '",\n',
            '      "token0": "', vm.toString(t0B), '",\n',
            '      "token1": "', vm.toString(t1B), '",\n',
            '      "type": "FHE:FHE"\n',
            '    },\n',
            '    "WETH_fheUSDC": {\n',
            '      "poolId": "', vm.toString(poolIdC), '",\n',
            '      "token0": "', vm.toString(t0C), '",\n',
            '      "token1": "', vm.toString(t1C), '",\n',
            '      "type": "ERC:FHE"\n',
            '    },\n'
        );

        json = string.concat(
            json,
            '    "fheWETH_USDC": {\n',
            '      "poolId": "', vm.toString(poolIdD), '",\n',
            '      "token0": "', vm.toString(t0D), '",\n',
            '      "token1": "', vm.toString(t1D), '",\n',
            '      "type": "FHE:ERC"\n',
            '    },\n',
            '    "WETH_fheWETH": {\n',
            '      "poolId": "', vm.toString(poolIdE), '",\n',
            '      "token0": "', vm.toString(t0E), '",\n',
            '      "token1": "', vm.toString(t1E), '",\n',
            '      "type": "ERC:FHE"\n',
            '    },\n',
            '    "USDC_fheUSDC": {\n',
            '      "poolId": "', vm.toString(poolIdF), '",\n',
            '      "token0": "', vm.toString(t0F), '",\n',
            '      "token1": "', vm.toString(t1F), '",\n',
            '      "type": "ERC:FHE"\n',
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
