// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {FheatherXv8Mixed} from "../src/FheatherXv8Mixed.sol";

/// @title SmokeTestV8
/// @notice Quick smoke test of v8 deployment
/// @dev Run with: source .env && forge script script/SmokeTestV8.s.sol:SmokeTestV8 --rpc-url $ETH_SEPOLIA_RPC -vvv
contract SmokeTestV8 is Script {
    using PoolIdLibrary for PoolKey;

    // ============ v8 Deployment Addresses ============
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant V8_FHE_HOOK = 0x15a1d97B331A343927d949b82376C7Dec9839088;
    address constant V8_MIXED_HOOK = 0x86845D4a86062B2Ed935CE7Ef859C5A8a68E1088;

    // Tokens
    address constant WETH = 0xe9Df64F549Eb1d2778909F339B9Bd795d14cF32E;
    address constant USDC = 0xF7Ff2A5E74eaA6E0463358BB26780049d3D45C56;
    address constant FHE_WETH = 0xa22df71352FbE7f78e9fC6aFFA78a3A1dF57b80e;
    address constant FHE_USDC = 0xCa72923536c48704858C9207D2496010498b77c4;

    // Pool config
    uint24 constant POOL_FEE = 3000;
    int24 constant TICK_SPACING = 60;

    function run() external view {
        console.log("===========================================");
        console.log("  FheatherX v8 Smoke Test");
        console.log("  Ethereum Sepolia");
        console.log("===========================================");
        console.log("");

        // ============ Check Hooks Deployed ============
        console.log("--- Checking Hook Deployments ---");

        uint256 v8FheCode = V8_FHE_HOOK.code.length;
        uint256 v8MixedCode = V8_MIXED_HOOK.code.length;

        console.log("v8FHE Hook:", V8_FHE_HOOK);
        console.log("  Code size:", v8FheCode, v8FheCode > 0 ? "OK" : "MISSING!");

        console.log("v8Mixed Hook:", V8_MIXED_HOOK);
        console.log("  Code size:", v8MixedCode, v8MixedCode > 0 ? "OK" : "MISSING!");

        require(v8FheCode > 0, "v8FHE hook not deployed");
        require(v8MixedCode > 0, "v8Mixed hook not deployed");
        console.log("");

        // ============ Check Pool Initialization ============
        console.log("--- Checking Pool States ---");

        IPoolManager pm = IPoolManager(POOL_MANAGER);

        // Pool A: WETH/USDC (Native - no hook)
        _checkPool(pm, "A (WETH/USDC)", WETH, USDC, address(0));

        // Pool B: fheWETH/fheUSDC (v8FHE)
        _checkPool(pm, "B (fheWETH/fheUSDC)", FHE_WETH, FHE_USDC, V8_FHE_HOOK);

        // Pool C: WETH/fheUSDC (v8Mixed)
        _checkPool(pm, "C (WETH/fheUSDC)", WETH, FHE_USDC, V8_MIXED_HOOK);

        // Pool D: fheWETH/USDC (v8Mixed)
        _checkPool(pm, "D (fheWETH/USDC)", FHE_WETH, USDC, V8_MIXED_HOOK);

        // Pool E: WETH/fheWETH (v8Mixed)
        _checkPool(pm, "E (WETH/fheWETH)", WETH, FHE_WETH, V8_MIXED_HOOK);

        // Pool F: USDC/fheUSDC (v8Mixed)
        _checkPool(pm, "F (USDC/fheUSDC)", USDC, FHE_USDC, V8_MIXED_HOOK);

        console.log("");

        // ============ Check Token Balances ============
        console.log("--- Checking v8Mixed Hook Reserves ---");

        FheatherXv8Mixed mixed = FheatherXv8Mixed(payable(V8_MIXED_HOOK));

        // Check Pool C reserves
        _checkMixedReserves(mixed, "C", WETH, FHE_USDC);

        // Check Pool D reserves
        _checkMixedReserves(mixed, "D", FHE_WETH, USDC);

        // Check Pool E reserves
        _checkMixedReserves(mixed, "E", WETH, FHE_WETH);

        // Check Pool F reserves
        _checkMixedReserves(mixed, "F", USDC, FHE_USDC);

        console.log("");
        console.log("===========================================");
        console.log("  SMOKE TEST PASSED");
        console.log("===========================================");
    }

    function _sortTokens(address a, address b) internal pure returns (address, address) {
        return a < b ? (a, b) : (b, a);
    }

    function _checkPool(
        IPoolManager,
        string memory name,
        address tokenA,
        address tokenB,
        address hook
    ) internal view {
        (address token0, address token1) = _sortTokens(tokenA, tokenB);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });

        PoolId poolId = key.toId();

        console.log("Pool", name);
        console.log("  PoolId:", vm.toString(PoolId.unwrap(poolId)));
        console.log("  Hook:", hook);
    }

    function _checkMixedReserves(
        FheatherXv8Mixed mixed,
        string memory poolName,
        address tokenA,
        address tokenB
    ) internal view {
        (address token0, address token1) = _sortTokens(tokenA, tokenB);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(mixed))
        });

        PoolId poolId = key.toId();

        (uint256 reserve0, uint256 reserve1) = mixed.getReserves(poolId);
        console.log("Pool", poolName, "reserves:");
        console.log("  Reserve0:", reserve0);
        console.log("  Reserve1:", reserve1);
    }
}
