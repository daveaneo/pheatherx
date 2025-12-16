// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {FheatherXv8FHE} from "../src/FheatherXv8FHE.sol";
import {FheatherXv8Mixed} from "../src/FheatherXv8Mixed.sol";

/// @title InitAndSeedV8
/// @notice Initialize pools and seed liquidity for v8 hooks
/// @dev Environment variables required:
///   PRIVATE_KEY, POOL_MANAGER, V8_FHE_HOOK, V8_MIXED_HOOK,
///   WETH, USDC, FHE_WETH, FHE_USDC
contract InitAndSeedV8 is Script {
    using PoolIdLibrary for PoolKey;

    uint24 constant POOL_FEE = 3000;
    int24 constant TICK_SPACING = 60;
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    // Liquidity amounts
    uint256 constant INIT_WETH = 10 ether;
    uint256 constant INIT_USDC = 10_000 * 1e6;
    uint256 constant INIT_FHE_WETH = 10 ether;
    uint256 constant INIT_FHE_USDC = 10_000 * 1e6;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address poolManager = vm.envAddress("POOL_MANAGER");
        address v8FheHook = vm.envAddress("V8_FHE_HOOK");
        address v8MixedHook = vm.envAddress("V8_MIXED_HOOK");

        address WETH = vm.envAddress("WETH");
        address USDC = vm.envAddress("USDC");
        address FHE_WETH = vm.envAddress("FHE_WETH");
        address FHE_USDC = vm.envAddress("FHE_USDC");

        console.log("===========================================");
        console.log("  Initialize & Seed V8 Pools");
        console.log("===========================================");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("v8FHE Hook:", v8FheHook);
        console.log("v8Mixed Hook:", v8MixedHook);
        console.log("");

        IPoolManager pm = IPoolManager(poolManager);

        vm.startBroadcast(pk);

        // ============ Initialize Pools ============
        console.log("--- Initializing Pools ---");

        // Pool B: fheWETH/fheUSDC (v8FHE)
        {
            (address t0, address t1) = _sort(FHE_WETH, FHE_USDC);
            PoolKey memory key = PoolKey({
                currency0: Currency.wrap(t0),
                currency1: Currency.wrap(t1),
                fee: POOL_FEE,
                tickSpacing: TICK_SPACING,
                hooks: IHooks(v8FheHook)
            });
            try pm.initialize(key, SQRT_PRICE_1_1) {
                console.log("Pool B (fheWETH/fheUSDC) initialized");
            } catch {
                console.log("Pool B already initialized");
            }
        }

        // Pool C: WETH/fheUSDC (v8Mixed)
        {
            (address t0, address t1) = _sort(WETH, FHE_USDC);
            PoolKey memory key = PoolKey({
                currency0: Currency.wrap(t0),
                currency1: Currency.wrap(t1),
                fee: POOL_FEE,
                tickSpacing: TICK_SPACING,
                hooks: IHooks(v8MixedHook)
            });
            try pm.initialize(key, SQRT_PRICE_1_1) {
                console.log("Pool C (WETH/fheUSDC) initialized");
            } catch {
                console.log("Pool C already initialized");
            }
        }

        // Pool D: fheWETH/USDC (v8Mixed)
        {
            (address t0, address t1) = _sort(FHE_WETH, USDC);
            PoolKey memory key = PoolKey({
                currency0: Currency.wrap(t0),
                currency1: Currency.wrap(t1),
                fee: POOL_FEE,
                tickSpacing: TICK_SPACING,
                hooks: IHooks(v8MixedHook)
            });
            try pm.initialize(key, SQRT_PRICE_1_1) {
                console.log("Pool D (fheWETH/USDC) initialized");
            } catch {
                console.log("Pool D already initialized");
            }
        }

        // Pool E: WETH/fheWETH (v8Mixed)
        {
            (address t0, address t1) = _sort(WETH, FHE_WETH);
            PoolKey memory key = PoolKey({
                currency0: Currency.wrap(t0),
                currency1: Currency.wrap(t1),
                fee: POOL_FEE,
                tickSpacing: TICK_SPACING,
                hooks: IHooks(v8MixedHook)
            });
            try pm.initialize(key, SQRT_PRICE_1_1) {
                console.log("Pool E (WETH/fheWETH) initialized");
            } catch {
                console.log("Pool E already initialized");
            }
        }

        // Pool F: USDC/fheUSDC (v8Mixed)
        {
            (address t0, address t1) = _sort(USDC, FHE_USDC);
            PoolKey memory key = PoolKey({
                currency0: Currency.wrap(t0),
                currency1: Currency.wrap(t1),
                fee: POOL_FEE,
                tickSpacing: TICK_SPACING,
                hooks: IHooks(v8MixedHook)
            });
            try pm.initialize(key, SQRT_PRICE_1_1) {
                console.log("Pool F (USDC/fheUSDC) initialized");
            } catch {
                console.log("Pool F already initialized");
            }
        }

        // ============ Seed Liquidity for v8Mixed Pools ============
        console.log("");
        console.log("--- Seeding v8Mixed Pools ---");
        console.log("(v8FHE pool requires encrypted inputs - seed via frontend)");

        // Check balances
        console.log("");
        console.log("Deployer token balances:");
        console.log("  WETH:", IERC20(WETH).balanceOf(deployer) / 1e18);
        console.log("  USDC:", IERC20(USDC).balanceOf(deployer) / 1e6);
        console.log("  fheWETH:", IERC20(FHE_WETH).balanceOf(deployer) / 1e18);
        console.log("  fheUSDC:", IERC20(FHE_USDC).balanceOf(deployer) / 1e6);

        // Approve v8Mixed hook
        IERC20(WETH).approve(v8MixedHook, type(uint256).max);
        IERC20(USDC).approve(v8MixedHook, type(uint256).max);
        IERC20(FHE_WETH).approve(v8MixedHook, type(uint256).max);
        IERC20(FHE_USDC).approve(v8MixedHook, type(uint256).max);
        console.log("Approved all tokens to v8Mixed");

        FheatherXv8Mixed mixed = FheatherXv8Mixed(payable(v8MixedHook));

        // Pool C: WETH/fheUSDC
        {
            (address t0, address t1) = _sort(WETH, FHE_USDC);
            PoolKey memory key = PoolKey({
                currency0: Currency.wrap(t0),
                currency1: Currency.wrap(t1),
                fee: POOL_FEE,
                tickSpacing: TICK_SPACING,
                hooks: IHooks(v8MixedHook)
            });
            PoolId poolId = key.toId();
            (uint256 amt0, uint256 amt1) = _getAmounts(t0, t1, WETH, FHE_USDC, INIT_WETH, INIT_FHE_USDC);
            try mixed.addLiquidity(poolId, amt0, amt1) {
                console.log("Pool C seeded");
            } catch Error(string memory reason) {
                console.log("Pool C seed failed:", reason);
            }
        }

        // Pool D: fheWETH/USDC
        {
            (address t0, address t1) = _sort(FHE_WETH, USDC);
            PoolKey memory key = PoolKey({
                currency0: Currency.wrap(t0),
                currency1: Currency.wrap(t1),
                fee: POOL_FEE,
                tickSpacing: TICK_SPACING,
                hooks: IHooks(v8MixedHook)
            });
            PoolId poolId = key.toId();
            (uint256 amt0, uint256 amt1) = _getAmounts(t0, t1, FHE_WETH, USDC, INIT_FHE_WETH, INIT_USDC);
            try mixed.addLiquidity(poolId, amt0, amt1) {
                console.log("Pool D seeded");
            } catch Error(string memory reason) {
                console.log("Pool D seed failed:", reason);
            }
        }

        // Pool E: WETH/fheWETH
        {
            (address t0, address t1) = _sort(WETH, FHE_WETH);
            PoolKey memory key = PoolKey({
                currency0: Currency.wrap(t0),
                currency1: Currency.wrap(t1),
                fee: POOL_FEE,
                tickSpacing: TICK_SPACING,
                hooks: IHooks(v8MixedHook)
            });
            PoolId poolId = key.toId();
            (uint256 amt0, uint256 amt1) = _getAmounts(t0, t1, WETH, FHE_WETH, INIT_WETH, INIT_FHE_WETH);
            try mixed.addLiquidity(poolId, amt0, amt1) {
                console.log("Pool E seeded");
            } catch Error(string memory reason) {
                console.log("Pool E seed failed:", reason);
            }
        }

        // Pool F: USDC/fheUSDC
        {
            (address t0, address t1) = _sort(USDC, FHE_USDC);
            PoolKey memory key = PoolKey({
                currency0: Currency.wrap(t0),
                currency1: Currency.wrap(t1),
                fee: POOL_FEE,
                tickSpacing: TICK_SPACING,
                hooks: IHooks(v8MixedHook)
            });
            PoolId poolId = key.toId();
            (uint256 amt0, uint256 amt1) = _getAmounts(t0, t1, USDC, FHE_USDC, INIT_USDC, INIT_FHE_USDC);
            try mixed.addLiquidity(poolId, amt0, amt1) {
                console.log("Pool F seeded");
            } catch Error(string memory reason) {
                console.log("Pool F seed failed:", reason);
            }
        }

        vm.stopBroadcast();

        console.log("");
        console.log("===========================================");
        console.log("  DONE");
        console.log("===========================================");
    }

    function _sort(address a, address b) internal pure returns (address, address) {
        return a < b ? (a, b) : (b, a);
    }

    function _getAmounts(
        address t0, address t1,
        address wantT0, address wantT1,
        uint256 amt0, uint256 amt1
    ) internal pure returns (uint256, uint256) {
        return t0 == wantT0 ? (amt0, amt1) : (amt1, amt0);
    }
}
