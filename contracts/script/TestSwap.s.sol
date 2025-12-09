// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPoolSwapTest {
    struct TestSettings {
        bool takeClaims;
        bool settleUsingBurn;
    }

    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    function swap(
        PoolKey calldata key,
        SwapParams calldata params,
        TestSettings calldata testSettings,
        bytes calldata hookData
    ) external payable returns (int256 delta);
}

contract TestSwap is Script {
    function run() external {
        address ROUTER = 0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe;
        address HOOK = 0xA96C75206aBeA9fAce7f30a8420F7998Edcc10C8;
        address WETH = 0xe9Df64F549Eb1d2778909F339B9Bd795d14cF32E;
        address USDC = 0xF7Ff2A5E74eaA6E0463358BB26780049d3D45C56;

        // Check balances and allowances
        uint256 wethBalance = IERC20(WETH).balanceOf(msg.sender);
        uint256 wethAllowance = IERC20(WETH).allowance(msg.sender, ROUTER);

        console.log("=== Pre-swap state ===");
        console.log("User address:", msg.sender);
        console.log("WETH balance:", wethBalance);
        console.log("WETH allowance to router:", wethAllowance);

        // Only proceed if we have balance
        if (wethBalance == 0) {
            console.log("No WETH balance, minting from faucet...");
            // Try calling faucet
            (bool success, ) = WETH.call(abi.encodeWithSignature("faucet()"));
            console.log("Faucet call success:", success);
            wethBalance = IERC20(WETH).balanceOf(msg.sender);
            console.log("New WETH balance:", wethBalance);
        }

        vm.startBroadcast();

        // Approve if needed
        if (wethAllowance < 1e18) {
            console.log("Approving WETH...");
            IERC20(WETH).approve(ROUTER, type(uint256).max);
        }

        // Create swap params
        IPoolSwapTest.PoolKey memory key = IPoolSwapTest.PoolKey({
            currency0: WETH,
            currency1: USDC,
            fee: 3000,
            tickSpacing: 60,
            hooks: HOOK
        });

        IPoolSwapTest.SwapParams memory params = IPoolSwapTest.SwapParams({
            zeroForOne: true,  // Sell WETH for USDC
            amountSpecified: -int256(0.001e18),  // 0.001 WETH (negative = exact input)
            sqrtPriceLimitX96: 4295128740  // MIN_SQRT_RATIO + 1
        });

        IPoolSwapTest.TestSettings memory testSettings = IPoolSwapTest.TestSettings({
            takeClaims: false,
            settleUsingBurn: false
        });

        bytes memory hookData = abi.encode(msg.sender);

        console.log("=== Executing swap ===");
        console.log("zeroForOne: true (WETH -> USDC)");
        console.log("amountSpecified: -0.001 WETH");

        try IPoolSwapTest(ROUTER).swap(key, params, testSettings, hookData) returns (int256 delta) {
            console.log("Swap succeeded! Delta:", delta);
        } catch Error(string memory reason) {
            console.log("Swap failed with reason:", reason);
        } catch (bytes memory lowLevelData) {
            console.log("Swap failed with low-level error");
            console.logBytes(lowLevelData);
        }

        vm.stopBroadcast();
    }
}
