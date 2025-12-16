// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {FheatherXv6} from "../src/FheatherXv6.sol";

/// @title InitializeMissingPoolsArbSepolia
/// @notice Initialize the wrap pair pools (E and F) on existing FheatherXv6 hook on Arbitrum Sepolia
/// @dev Run with: source .env && forge script script/InitializeMissingPoolsArbSepolia.s.sol:InitializeMissingPoolsArbSepolia --rpc-url $ARB_SEPOLIA_RPC --broadcast -vvv
contract InitializeMissingPoolsArbSepolia is Script {
    using PoolIdLibrary for PoolKey;

    // ============ Arbitrum Sepolia Addresses ============
    address constant POOL_MANAGER = 0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317;

    // Existing FheatherXv6 Hook on Arb Sepolia
    address constant HOOK = 0xbE26c52CC34C11297D57A797cC089211947090C8;

    // Tokens (Arb Sepolia)
    address constant WETH = 0x34010C7b06cD65365C129223A466032Bc7897110;
    address constant USDC = 0xbdDd18385FE6Ad2C81E3c1Adf40f28E3AA2a41e5;
    address constant FHE_WETH = 0x9E0b37Ec3eC64ac667C3Bc7aD82DaC27bF82D55c;
    address constant FHE_USDC = 0xF6f6a3162Ca3162E3855d0B201d2264de64a52F6;

    // Pool config
    uint24 constant POOL_FEE = 3000;
    int24 constant TICK_SPACING = 60;
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    // Initial liquidity
    uint256 constant INIT_WETH_AMOUNT = 10 ether;
    uint256 constant INIT_USDC_AMOUNT = 10_000 * 1e6;
    uint256 constant INIT_FHE_WETH_AMOUNT = 10 ether;
    uint256 constant INIT_FHE_USDC_AMOUNT = 10_000 * 1e6;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("===========================================");
        console.log("  Initialize Missing Pools (E & F)");
        console.log("  Arbitrum Sepolia");
        console.log("===========================================");
        console.log("Deployer:", deployer);
        console.log("Hook:", HOOK);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        IPoolManager pm = IPoolManager(POOL_MANAGER);
        FheatherXv6 hook = FheatherXv6(payable(HOOK));

        // Pool E: WETH/fheWETH (wrap pair)
        console.log("--- Initializing Pool E (WETH/fheWETH) ---");
        (address token0E, address token1E) = _sortTokens(WETH, FHE_WETH);
        PoolKey memory keyE = PoolKey({
            currency0: Currency.wrap(token0E),
            currency1: Currency.wrap(token1E),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(HOOK)
        });

        try pm.initialize(keyE, SQRT_PRICE_1_1) {
            bytes32 poolIdE = PoolId.unwrap(keyE.toId());
            console.log("Pool E initialized!");
            console.log("  PoolId:", vm.toString(poolIdE));
            console.log("  token0:", token0E);
            console.log("  token1:", token1E);
        } catch Error(string memory reason) {
            console.log("Pool E already exists or failed:", reason);
        }

        // Pool F: USDC/fheUSDC (wrap pair)
        console.log("");
        console.log("--- Initializing Pool F (USDC/fheUSDC) ---");
        (address token0F, address token1F) = _sortTokens(USDC, FHE_USDC);
        PoolKey memory keyF = PoolKey({
            currency0: Currency.wrap(token0F),
            currency1: Currency.wrap(token1F),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(HOOK)
        });

        try pm.initialize(keyF, SQRT_PRICE_1_1) {
            bytes32 poolIdF = PoolId.unwrap(keyF.toId());
            console.log("Pool F initialized!");
            console.log("  PoolId:", vm.toString(poolIdF));
            console.log("  token0:", token0F);
            console.log("  token1:", token1F);
        } catch Error(string memory reason) {
            console.log("Pool F already exists or failed:", reason);
        }

        // Seed liquidity
        console.log("");
        console.log("--- Seeding Liquidity ---");

        // Check balances
        uint256 wethBal = IERC20(WETH).balanceOf(deployer);
        uint256 usdcBal = IERC20(USDC).balanceOf(deployer);
        uint256 fheWethBal = IERC20(FHE_WETH).balanceOf(deployer);
        uint256 fheUsdcBal = IERC20(FHE_USDC).balanceOf(deployer);

        console.log("Deployer balances:");
        console.log("  WETH:", wethBal);
        console.log("  USDC:", usdcBal);
        console.log("  fheWETH:", fheWethBal);
        console.log("  fheUSDC:", fheUsdcBal);

        bool canSeedE = wethBal >= INIT_WETH_AMOUNT && fheWethBal >= INIT_FHE_WETH_AMOUNT;
        bool canSeedF = usdcBal >= INIT_USDC_AMOUNT && fheUsdcBal >= INIT_FHE_USDC_AMOUNT;

        if (canSeedE) {
            IERC20(WETH).approve(HOOK, type(uint256).max);
            IERC20(FHE_WETH).approve(HOOK, type(uint256).max);

            bytes32 poolIdE = PoolId.unwrap(keyE.toId());
            (uint256 amt0E, uint256 amt1E) = _getOrderedAmounts(
                token0E, token1E,
                WETH, FHE_WETH,
                INIT_WETH_AMOUNT, INIT_FHE_WETH_AMOUNT
            );
            hook.addLiquidity(PoolId.wrap(poolIdE), amt0E, amt1E);
            console.log("Added liquidity to Pool E (WETH/fheWETH)");
        } else {
            console.log("Insufficient balance for Pool E liquidity");
        }

        if (canSeedF) {
            IERC20(USDC).approve(HOOK, type(uint256).max);
            IERC20(FHE_USDC).approve(HOOK, type(uint256).max);

            bytes32 poolIdF = PoolId.unwrap(keyF.toId());
            (uint256 amt0F, uint256 amt1F) = _getOrderedAmounts(
                token0F, token1F,
                USDC, FHE_USDC,
                INIT_USDC_AMOUNT, INIT_FHE_USDC_AMOUNT
            );
            hook.addLiquidity(PoolId.wrap(poolIdF), amt0F, amt1F);
            console.log("Added liquidity to Pool F (USDC/fheUSDC)");
        } else {
            console.log("Insufficient balance for Pool F liquidity");
        }

        vm.stopBroadcast();

        console.log("");
        console.log("===========================================");
        console.log("  COMPLETE");
        console.log("===========================================");
    }

    function _sortTokens(address tokenA, address tokenB) internal pure returns (address, address) {
        return tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    }

    function _getOrderedAmounts(
        address token0,
        address,
        address desiredToken0,
        address,
        uint256 amount0,
        uint256 amount1
    ) internal pure returns (uint256, uint256) {
        if (token0 == desiredToken0) {
            return (amount0, amount1);
        } else {
            return (amount1, amount0);
        }
    }
}
