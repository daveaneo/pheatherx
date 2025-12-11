// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Foundry Imports
import "forge-std/Test.sol";

// Uniswap Imports
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {CurrencyLibrary, Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";

// Local Imports
import {FheatherXv2} from "../src/FheatherXv2.sol";
import {IFheatherXv2} from "../src/interface/IFheatherXv2.sol";
import {FhenixFHERC20Faucet} from "../src/tokens/FhenixFHERC20Faucet.sol";
import {TickBitmap} from "../src/lib/TickBitmap.sol";
import {DirectionLock} from "../src/lib/DirectionLock.sol";

// Test Utils
import {EasyPosm} from "./utils/EasyPosm.sol";
import {Fixtures} from "./utils/Fixtures.sol";
import {SortTokens} from "./utils/SortTokens.sol";

// FHE Imports
import {FHE, euint128, ebool, InEuint128, InEbool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {CoFheTest} from "@fhenixprotocol/cofhe-mock-contracts/CoFheTest.sol";

// OpenZeppelin Imports
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract FheatherXv2Test is Test, Fixtures, CoFheTest {
    using EasyPosm for IPositionManager;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    address private user = makeAddr("user");
    address private user2 = makeAddr("user2");

    FheatherXv2 hook;
    PoolId poolId;

    uint256 tokenId;
    int24 tickLower;
    int24 tickUpper;

    FhenixFHERC20Faucet token0;
    FhenixFHERC20Faucet token1;

    uint160 constant SQRT_RATIO_10_1 = 250541448375047931186413801569;

    function setUp() public {
        // Deploy FHERC20 tokens properly
        FhenixFHERC20Faucet tokenA = new FhenixFHERC20Faucet("Token0", "TK0", 18);
        FhenixFHERC20Faucet tokenB = new FhenixFHERC20Faucet("Token1", "TK1", 18);

        // Ensure token0 < token1 for Uniswap ordering
        if (address(tokenA) < address(tokenB)) {
            token0 = tokenA;
            token1 = tokenB;
        } else {
            token0 = tokenB;
            token1 = tokenA;
        }

        vm.label(user, "user");
        vm.label(user2, "user2");
        vm.label(address(this), "test");
        vm.label(address(token0), "token0");
        vm.label(address(token1), "token1");

        // Create the pool manager, utility routers
        deployFreshManagerAndRouters();

        // Give ETH to users for protocol fees
        vm.deal(user, 100 ether);
        vm.deal(user2, 100 ether);

        // Set currencies
        currency0 = Currency.wrap(address(token0));
        currency1 = Currency.wrap(address(token1));

        // Deploy POSM
        deployAndApprovePosm(manager, currency0, currency1);

        // Deploy the hook to an address with the correct flags
        address flags = address(
            uint160(
                Hooks.BEFORE_ADD_LIQUIDITY_FLAG |
                Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG |
                Hooks.BEFORE_SWAP_FLAG |
                Hooks.AFTER_SWAP_FLAG |
                Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
            ) ^ (0x4444 << 144) // Namespace the hook to avoid collisions
        );

        bytes memory constructorArgs = abi.encode(
            manager,
            address(token0),
            address(token1),
            30 // 0.3% swap fee
        );
        deployCodeTo("FheatherXv2.sol:FheatherXv2", constructorArgs, flags);
        hook = FheatherXv2(payable(flags));

        vm.label(address(hook), "hook");

        // Create the pool
        key = PoolKey(currency0, currency1, 3000, 60, IHooks(hook));
        poolId = key.toId();
        manager.initialize(key, SQRT_PRICE_1_1);

        // Setup tick bounds
        tickLower = TickMath.minUsableTick(key.tickSpacing);
        tickUpper = TickMath.maxUsableTick(key.tickSpacing);

        // Use deal to give users plaintext ERC20 tokens for testing
        // (The faucet mints to encrypted balance, but we need plaintext for many tests)
        deal(address(token0), user, 1000 ether);
        deal(address(token1), user, 1000 ether);
        deal(address(token0), user2, 1000 ether);
        deal(address(token1), user2, 1000 ether);

        // Also mint encrypted tokens to users for encrypted tests
        // (owner is this test contract since we deployed the tokens)
        token0.mintEncrypted(user, 500 ether);
        token1.mintEncrypted(user, 500 ether);
        token0.mintEncrypted(user2, 500 ether);
        token1.mintEncrypted(user2, 500 ether);

        // Approve tokens for hook (both plaintext and encrypted)
        vm.startPrank(user);
        token0.approve(address(hook), type(uint256).max);
        token1.approve(address(hook), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(user2);
        token0.approve(address(hook), type(uint256).max);
        token1.approve(address(hook), type(uint256).max);
        vm.stopPrank();
    }

    // ============ Swap Tests (Plaintext Path) ============

    function testSwapZeroForOne() public {
        // First add liquidity
        vm.startPrank(user);
        hook.addLiquidity(50 ether, 50 ether);
        vm.stopPrank();

        // Now swap
        uint256 amountIn = 1 ether;
        uint256 minAmountOut = 0.9 ether;

        uint256 token0Before = token0.balanceOf(user);
        uint256 token1Before = token1.balanceOf(user);

        vm.prank(user);
        uint256 amountOut = hook.swap(true, amountIn, minAmountOut);

        uint256 token0After = token0.balanceOf(user);
        uint256 token1After = token1.balanceOf(user);

        assertEq(token0Before - token0After, amountIn, "Should spend input amount");
        assertEq(token1After - token1Before, amountOut, "Should receive output amount");
        assertGe(amountOut, minAmountOut, "Output should meet min requirement");
    }

    function testSwapOneForZero() public {
        // First add liquidity
        vm.startPrank(user);
        hook.addLiquidity(50 ether, 50 ether);
        vm.stopPrank();

        // Now swap
        uint256 amountIn = 1 ether;
        uint256 minAmountOut = 0.9 ether;

        uint256 token0Before = token0.balanceOf(user);
        uint256 token1Before = token1.balanceOf(user);

        vm.prank(user);
        uint256 amountOut = hook.swap(false, amountIn, minAmountOut);

        uint256 token0After = token0.balanceOf(user);
        uint256 token1After = token1.balanceOf(user);

        assertEq(token1Before - token1After, amountIn, "Should spend input amount");
        assertEq(token0After - token0Before, amountOut, "Should receive output amount");
        assertGe(amountOut, minAmountOut, "Output should meet min requirement");
    }

    function testSwapZeroAmountReverts() public {
        vm.prank(user);
        vm.expectRevert(IFheatherXv2.ZeroAmount.selector);
        hook.swap(true, 0, 0);
    }

    function testSwapSlippageExceeded() public {
        // First add liquidity
        vm.startPrank(user);
        hook.addLiquidity(50 ether, 50 ether);
        vm.stopPrank();

        uint256 amountIn = 1 ether;
        uint256 minAmountOut = 100 ether; // Impossibly high

        vm.prank(user);
        vm.expectRevert(IFheatherXv2.SlippageExceeded.selector);
        hook.swap(true, amountIn, minAmountOut);
    }

    // ============ Liquidity Tests ============

    function testAddLiquidity() public {
        uint256 amount0 = 10 ether;
        uint256 amount1 = 10 ether;

        uint256 token0Before = token0.balanceOf(user);
        uint256 token1Before = token1.balanceOf(user);

        vm.prank(user);
        uint256 lpAmount = hook.addLiquidity(amount0, amount1);

        uint256 token0After = token0.balanceOf(user);
        uint256 token1After = token1.balanceOf(user);

        assertEq(token0Before - token0After, amount0, "Should spend token0");
        assertEq(token1Before - token1After, amount1, "Should spend token1");
        assertGt(lpAmount, 0, "Should receive LP tokens");
    }

    function testRemoveLiquidity() public {
        // First add liquidity
        vm.startPrank(user);
        uint256 lpAmount = hook.addLiquidity(10 ether, 10 ether);

        uint256 token0Before = token0.balanceOf(user);
        uint256 token1Before = token1.balanceOf(user);

        (uint256 amount0, uint256 amount1) = hook.removeLiquidity(lpAmount);
        vm.stopPrank();

        uint256 token0After = token0.balanceOf(user);
        uint256 token1After = token1.balanceOf(user);

        assertEq(token0After - token0Before, amount0, "Should receive token0");
        assertEq(token1After - token1Before, amount1, "Should receive token1");
    }

    function testAddLiquidityZeroAmountReverts() public {
        vm.prank(user);
        vm.expectRevert(IFheatherXv2.ZeroAmount.selector);
        hook.addLiquidity(0, 10 ether);
    }

    function testRemoveLiquidityZeroAmountReverts() public {
        vm.prank(user);
        vm.expectRevert(IFheatherXv2.ZeroAmount.selector);
        hook.removeLiquidity(0);
    }

    // ============ Reserve Tests ============

    function testGetReserves() public {
        vm.prank(user);
        hook.addLiquidity(10 ether, 20 ether);

        (uint256 r0, uint256 r1) = hook.getReserves();
        assertEq(r0, 10 ether, "Reserve0 should match");
        assertEq(r1, 20 ether, "Reserve1 should match");
    }

    function testForceSyncReserves() public {
        vm.prank(user);
        hook.addLiquidity(10 ether, 10 ether);

        // Force sync should not revert
        hook.forceSyncReserves();
    }

    function testEstimateOutput() public {
        vm.prank(user);
        hook.addLiquidity(50 ether, 50 ether);

        uint256 estimate = hook.estimateOutput(true, 1 ether);
        assertGt(estimate, 0, "Estimate should be positive");
        assertLt(estimate, 1 ether, "Estimate should be less than input (fee)");
    }

    // ============ View Function Tests ============

    function testGetActiveOrders() public {
        uint256[] memory orders = hook.getActiveOrders(user);
        assertEq(orders.length, 0, "Should have no orders initially");
    }

    function testGetOrderCount() public {
        uint256 count = hook.getOrderCount(user);
        assertEq(count, 0, "Should have 0 orders initially");
    }

    function testHasOrdersAtTick() public {
        assertFalse(hook.hasOrdersAtTick(100), "Should have no orders at tick 100");
    }

    // ============ Admin Tests ============

    function testWithdrawProtocolFees() public {
        // Send some ETH to hook as fees
        vm.deal(address(hook), 1 ether);

        address payable recipient = payable(makeAddr("recipient"));
        uint256 balanceBefore = recipient.balance;

        // Owner (test contract) can withdraw
        hook.withdrawProtocolFees(recipient);

        assertEq(recipient.balance - balanceBefore, 1 ether, "Should receive fees");
    }

    function testWithdrawProtocolFeesOnlyOwner() public {
        vm.deal(address(hook), 1 ether);

        vm.prank(user);
        vm.expectRevert("Only owner");
        hook.withdrawProtocolFees(payable(user));
    }

    // ============ Swap + Order Integration ============

    function testSwapTriggersOrderCheck() public {
        // Add liquidity
        vm.startPrank(user);
        hook.addLiquidity(50 ether, 50 ether);

        // Swap should internally check for triggered orders
        // Even without orders, this should work
        hook.swap(true, 1 ether, 0);
        vm.stopPrank();
    }

    // ============ Multiple Swaps ============

    function testMultipleSwaps() public {
        vm.startPrank(user);
        hook.addLiquidity(50 ether, 50 ether);

        // Multiple swaps should work
        hook.swap(true, 1 ether, 0);
        hook.swap(false, 0.5 ether, 0);
        hook.swap(true, 0.25 ether, 0);
        vm.stopPrank();
    }

    // ============ Reserve Updates After Swap ============

    function testReservesUpdateAfterSwap() public {
        vm.startPrank(user);
        hook.addLiquidity(50 ether, 50 ether);

        (uint256 r0Before, uint256 r1Before) = hook.getReserves();

        hook.swap(true, 1 ether, 0);

        (uint256 r0After, uint256 r1After) = hook.getReserves();
        vm.stopPrank();

        // zeroForOne: reserve0 increases, reserve1 decreases
        assertGt(r0After, r0Before, "Reserve0 should increase");
        assertLt(r1After, r1Before, "Reserve1 should decrease");
    }

    // ============ LP Token Tests ============

    function testLPBalanceTracking() public {
        vm.startPrank(user);
        uint256 lp1 = hook.addLiquidity(10 ether, 10 ether);
        uint256 lp2 = hook.addLiquidity(5 ether, 5 ether);
        vm.stopPrank();

        // Total should be sum
        assertGt(lp1 + lp2, 0, "Should have LP tokens");
    }

    function testRemoveLiquidityInsufficientBalance() public {
        vm.startPrank(user);
        hook.addLiquidity(10 ether, 10 ether);
        vm.stopPrank();

        vm.prank(user);
        vm.expectRevert(IFheatherXv2.InsufficientLiquidity.selector);
        hook.removeLiquidity(1000000 ether); // Way more than deposited
    }

    // ============ Encrypted Swap Tests ============

    function testSwapEncryptedZeroForOne() public {
        // First add liquidity
        vm.startPrank(user);
        hook.addLiquidity(50 ether, 50 ether);
        vm.stopPrank();

        // Get encrypted tokens for user
        vm.startPrank(user);
        // User already has tokens from faucet, approve encrypted allowance
        InEuint128 memory allowance0 = createInEuint128(uint128(10 ether), user);
        token0.approveEncrypted(address(hook), allowance0);

        // Create encrypted swap params
        InEbool memory direction = createInEbool(true, user); // zeroForOne = true
        InEuint128 memory amountIn = createInEuint128(uint128(1 ether), user);
        InEuint128 memory minOutput = createInEuint128(uint128(0.5 ether), user);

        // Execute encrypted swap
        euint128 amountOut = hook.swapEncrypted(direction, amountIn, minOutput);

        // Verify output is non-zero using mock storage
        uint256 outValue = mockStorage(euint128.unwrap(amountOut));
        assertGt(outValue, 0, "Output should be positive");
        vm.stopPrank();
    }

    function testSwapEncryptedOneForZero() public {
        // First add liquidity
        vm.startPrank(user);
        hook.addLiquidity(50 ether, 50 ether);
        vm.stopPrank();

        vm.startPrank(user);
        // Approve encrypted allowance for token1
        InEuint128 memory allowance1 = createInEuint128(uint128(10 ether), user);
        token1.approveEncrypted(address(hook), allowance1);

        // Create encrypted swap params
        InEbool memory direction = createInEbool(false, user); // zeroForOne = false
        InEuint128 memory amountIn = createInEuint128(uint128(1 ether), user);
        InEuint128 memory minOutput = createInEuint128(uint128(0.5 ether), user);

        // Execute encrypted swap
        euint128 amountOut = hook.swapEncrypted(direction, amountIn, minOutput);

        // Verify output is non-zero
        uint256 outValue = mockStorage(euint128.unwrap(amountOut));
        assertGt(outValue, 0, "Output should be positive");
        vm.stopPrank();
    }

    function testSwapEncryptedSlippageFails() public {
        // First add liquidity
        vm.startPrank(user);
        hook.addLiquidity(50 ether, 50 ether);
        vm.stopPrank();

        vm.startPrank(user);
        InEuint128 memory allowance0 = createInEuint128(uint128(10 ether), user);
        token0.approveEncrypted(address(hook), allowance0);

        // Create encrypted swap with impossible slippage requirement
        InEbool memory direction = createInEbool(true, user);
        InEuint128 memory amountIn = createInEuint128(uint128(1 ether), user);
        InEuint128 memory minOutput = createInEuint128(uint128(100 ether), user); // Impossible

        // Execute - should return 0 output due to slippage (not revert, for privacy)
        euint128 amountOut = hook.swapEncrypted(direction, amountIn, minOutput);

        // Verify output is zero (slippage protection triggered)
        uint256 outValue = mockStorage(euint128.unwrap(amountOut));
        assertEq(outValue, 0, "Output should be zero due to slippage");
        vm.stopPrank();
    }

    // ============ Limit Order Placement Tests (All 4 Types) ============

    function testPlaceOrderBuyLimitActual() public {
        // Buy Limit: isSell=false, triggerAbove=false
        // Buy token0 when price drops below tick
        _setupLiquidityAndApprovals();

        vm.startPrank(user);
        int24 triggerTick = -100;

        InEbool memory isSell = createInEbool(false, user);
        InEbool memory triggerAbove = createInEbool(false, user);
        InEuint128 memory amount = createInEuint128(uint128(1 ether), user);
        InEuint128 memory minOutput = createInEuint128(uint128(0.9 ether), user);

        uint256 orderId = hook.placeOrder{value: 0.001 ether}(
            triggerTick,
            isSell,
            triggerAbove,
            amount,
            minOutput
        );

        assertGt(orderId, 0, "Order ID should be positive");
        assertTrue(hook.hasOrdersAtTick(triggerTick), "Tick should have orders");
        assertEq(hook.getOrderCount(user), 1, "User should have 1 order");
        vm.stopPrank();
    }

    function testPlaceOrderBuyStop() public {
        // Buy Stop: isSell=false, triggerAbove=true
        // Buy token0 when price rises above tick (breakout)
        _setupLiquidityAndApprovals();

        vm.startPrank(user);
        int24 triggerTick = 100;

        InEbool memory isSell = createInEbool(false, user);
        InEbool memory triggerAbove = createInEbool(true, user);
        InEuint128 memory amount = createInEuint128(uint128(1 ether), user);
        InEuint128 memory minOutput = createInEuint128(uint128(0.9 ether), user);

        uint256 orderId = hook.placeOrder{value: 0.001 ether}(
            triggerTick,
            isSell,
            triggerAbove,
            amount,
            minOutput
        );

        assertGt(orderId, 0, "Order ID should be positive");
        assertTrue(hook.hasOrdersAtTick(triggerTick), "Tick should have orders");
        vm.stopPrank();
    }

    function testPlaceOrderSellLimit() public {
        // Sell Limit: isSell=true, triggerAbove=true
        // Sell token0 when price rises above tick (take profit)
        _setupLiquidityAndApprovals();

        vm.startPrank(user);
        int24 triggerTick = 100;

        InEbool memory isSell = createInEbool(true, user);
        InEbool memory triggerAbove = createInEbool(true, user);
        InEuint128 memory amount = createInEuint128(uint128(1 ether), user);
        InEuint128 memory minOutput = createInEuint128(uint128(0.9 ether), user);

        uint256 orderId = hook.placeOrder{value: 0.001 ether}(
            triggerTick,
            isSell,
            triggerAbove,
            amount,
            minOutput
        );

        assertGt(orderId, 0, "Order ID should be positive");
        assertTrue(hook.hasOrdersAtTick(triggerTick), "Tick should have orders");
        vm.stopPrank();
    }

    function testPlaceOrderSellStop() public {
        // Sell Stop: isSell=true, triggerAbove=false
        // Sell token0 when price drops below tick (stop loss)
        _setupLiquidityAndApprovals();

        vm.startPrank(user);
        int24 triggerTick = -100;

        InEbool memory isSell = createInEbool(true, user);
        InEbool memory triggerAbove = createInEbool(false, user);
        InEuint128 memory amount = createInEuint128(uint128(1 ether), user);
        InEuint128 memory minOutput = createInEuint128(uint128(0.9 ether), user);

        uint256 orderId = hook.placeOrder{value: 0.001 ether}(
            triggerTick,
            isSell,
            triggerAbove,
            amount,
            minOutput
        );

        assertGt(orderId, 0, "Order ID should be positive");
        assertTrue(hook.hasOrdersAtTick(triggerTick), "Tick should have orders");
        vm.stopPrank();
    }

    function testPlaceOrderInsufficientFee() public {
        _setupLiquidityAndApprovals();

        vm.startPrank(user);
        InEbool memory isSell = createInEbool(false, user);
        InEbool memory triggerAbove = createInEbool(false, user);
        InEuint128 memory amount = createInEuint128(uint128(1 ether), user);
        InEuint128 memory minOutput = createInEuint128(uint128(0.9 ether), user);

        vm.expectRevert(IFheatherXv2.InsufficientFee.selector);
        hook.placeOrder{value: 0}( // No fee
            -100,
            isSell,
            triggerAbove,
            amount,
            minOutput
        );
        vm.stopPrank();
    }

    // ============ Limit Order Cancellation Tests ============

    function testCancelOrderSuccess() public {
        _setupLiquidityAndApprovals();

        vm.startPrank(user);
        // Place order
        InEbool memory isSell = createInEbool(false, user);
        InEbool memory triggerAbove = createInEbool(false, user);
        InEuint128 memory amount = createInEuint128(uint128(1 ether), user);
        InEuint128 memory minOutput = createInEuint128(uint128(0.9 ether), user);

        uint256 orderId = hook.placeOrder{value: 0.001 ether}(
            -100,
            isSell,
            triggerAbove,
            amount,
            minOutput
        );

        assertEq(hook.getOrderCount(user), 1, "Should have 1 order");

        // Cancel order
        hook.cancelOrder(orderId);

        assertEq(hook.getOrderCount(user), 0, "Should have 0 orders after cancel");
        assertFalse(hook.hasOrdersAtTick(-100), "Tick should have no orders");
        vm.stopPrank();
    }

    function testCancelOrderNotOwner() public {
        _setupLiquidityAndApprovals();

        vm.startPrank(user);
        InEbool memory isSell = createInEbool(false, user);
        InEbool memory triggerAbove = createInEbool(false, user);
        InEuint128 memory amount = createInEuint128(uint128(1 ether), user);
        InEuint128 memory minOutput = createInEuint128(uint128(0.9 ether), user);

        uint256 orderId = hook.placeOrder{value: 0.001 ether}(
            -100,
            isSell,
            triggerAbove,
            amount,
            minOutput
        );
        vm.stopPrank();

        // Try to cancel as different user
        vm.prank(user2);
        vm.expectRevert(IFheatherXv2.NotOrderOwner.selector);
        hook.cancelOrder(orderId);
    }

    function testCancelOrderTwiceReverts() public {
        _setupLiquidityAndApprovals();

        vm.startPrank(user);
        InEbool memory isSell = createInEbool(false, user);
        InEbool memory triggerAbove = createInEbool(false, user);
        InEuint128 memory amount = createInEuint128(uint128(1 ether), user);
        InEuint128 memory minOutput = createInEuint128(uint128(0.9 ether), user);

        uint256 orderId = hook.placeOrder{value: 0.001 ether}(
            -100,
            isSell,
            triggerAbove,
            amount,
            minOutput
        );

        // First cancel succeeds
        hook.cancelOrder(orderId);

        // Second cancel fails
        vm.expectRevert(IFheatherXv2.OrderNotActive.selector);
        hook.cancelOrder(orderId);
        vm.stopPrank();
    }

    // ============ Multiple Orders at Same Tick Tests ============

    function testMultipleOrdersSameTick() public {
        _setupLiquidityAndApprovals();
        _setupUser2Approvals();

        int24 tick = 100;

        // User 1 places order
        vm.startPrank(user);
        InEbool memory isSell1 = createInEbool(true, user);
        InEbool memory triggerAbove1 = createInEbool(true, user);
        InEuint128 memory amount1 = createInEuint128(uint128(1 ether), user);
        InEuint128 memory minOutput1 = createInEuint128(uint128(0.9 ether), user);

        uint256 orderId1 = hook.placeOrder{value: 0.001 ether}(
            tick,
            isSell1,
            triggerAbove1,
            amount1,
            minOutput1
        );
        vm.stopPrank();

        // User 2 places order at same tick
        vm.startPrank(user2);
        InEbool memory isSell2 = createInEbool(false, user2);
        InEbool memory triggerAbove2 = createInEbool(true, user2);
        InEuint128 memory amount2 = createInEuint128(uint128(2 ether), user2);
        InEuint128 memory minOutput2 = createInEuint128(uint128(1.8 ether), user2);

        uint256 orderId2 = hook.placeOrder{value: 0.001 ether}(
            tick,
            isSell2,
            triggerAbove2,
            amount2,
            minOutput2
        );
        vm.stopPrank();

        assertTrue(hook.hasOrdersAtTick(tick), "Tick should have orders");
        assertEq(hook.getOrderCount(user), 1, "User1 should have 1 order");
        assertEq(hook.getOrderCount(user2), 1, "User2 should have 1 order");
        assertTrue(orderId2 > orderId1, "Order IDs should be sequential");
    }

    function testMultipleOrdersNearbyTicks() public {
        _setupLiquidityAndApprovals();

        vm.startPrank(user);

        // Place orders at nearby ticks
        int24[] memory ticks = new int24[](5);
        ticks[0] = -120;
        ticks[1] = -60;
        ticks[2] = 0;
        ticks[3] = 60;
        ticks[4] = 120;

        for (uint256 i = 0; i < ticks.length; i++) {
            InEbool memory isSell = createInEbool(i % 2 == 0, user);
            InEbool memory triggerAbove = createInEbool(ticks[i] > 0, user);
            InEuint128 memory amount = createInEuint128(uint128(1 ether), user);
            InEuint128 memory minOutput = createInEuint128(uint128(0.9 ether), user);

            hook.placeOrder{value: 0.001 ether}(
                ticks[i],
                isSell,
                triggerAbove,
                amount,
                minOutput
            );
        }

        assertEq(hook.getOrderCount(user), 5, "User should have 5 orders");

        for (uint256 i = 0; i < ticks.length; i++) {
            assertTrue(hook.hasOrdersAtTick(ticks[i]), "Each tick should have orders");
        }
        vm.stopPrank();
    }

    function testAllFourOrderTypesAtSameTick() public {
        _setupLiquidityAndApprovals();

        vm.startPrank(user);
        int24 tick = 60;

        // Buy Limit (isSell=false, triggerAbove=false)
        {
            InEbool memory isSell = createInEbool(false, user);
            InEbool memory triggerAbove = createInEbool(false, user);
            InEuint128 memory amount = createInEuint128(uint128(1 ether), user);
            InEuint128 memory minOutput = createInEuint128(uint128(0.9 ether), user);
            hook.placeOrder{value: 0.001 ether}(tick, isSell, triggerAbove, amount, minOutput);
        }

        // Buy Stop (isSell=false, triggerAbove=true)
        {
            InEbool memory isSell = createInEbool(false, user);
            InEbool memory triggerAbove = createInEbool(true, user);
            InEuint128 memory amount = createInEuint128(uint128(1 ether), user);
            InEuint128 memory minOutput = createInEuint128(uint128(0.9 ether), user);
            hook.placeOrder{value: 0.001 ether}(tick, isSell, triggerAbove, amount, minOutput);
        }

        // Sell Limit (isSell=true, triggerAbove=true)
        {
            InEbool memory isSell = createInEbool(true, user);
            InEbool memory triggerAbove = createInEbool(true, user);
            InEuint128 memory amount = createInEuint128(uint128(1 ether), user);
            InEuint128 memory minOutput = createInEuint128(uint128(0.9 ether), user);
            hook.placeOrder{value: 0.001 ether}(tick, isSell, triggerAbove, amount, minOutput);
        }

        // Sell Stop (isSell=true, triggerAbove=false)
        {
            InEbool memory isSell = createInEbool(true, user);
            InEbool memory triggerAbove = createInEbool(false, user);
            InEuint128 memory amount = createInEuint128(uint128(1 ether), user);
            InEuint128 memory minOutput = createInEuint128(uint128(0.9 ether), user);
            hook.placeOrder{value: 0.001 ether}(tick, isSell, triggerAbove, amount, minOutput);
        }

        assertEq(hook.getOrderCount(user), 4, "User should have 4 orders");
        assertTrue(hook.hasOrdersAtTick(tick), "Tick should have orders");
        vm.stopPrank();
    }

    // ============ Order Execution Tests ============

    function testOrderTriggeredBySwap() public {
        _setupLiquidityAndApprovals();

        // Place a sell stop at current tick - should trigger on price drop
        vm.startPrank(user);

        // Get current tick
        (uint256 r0, uint256 r1) = hook.getReserves();

        // Place sell stop below current price
        int24 triggerTick = -60; // Below starting tick of 0

        InEbool memory isSell = createInEbool(true, user);
        InEbool memory triggerAbove = createInEbool(false, user); // Trigger when price drops
        InEuint128 memory amount = createInEuint128(uint128(0.5 ether), user);
        InEuint128 memory minOutput = createInEuint128(uint128(0.1 ether), user);

        uint256 orderId = hook.placeOrder{value: 0.001 ether}(
            triggerTick,
            isSell,
            triggerAbove,
            amount,
            minOutput
        );

        assertTrue(hook.hasOrdersAtTick(triggerTick), "Tick should have orders before swap");
        vm.stopPrank();

        // Execute large swap to move price down (sell token0 → price of token0 drops)
        vm.startPrank(user2);
        hook.swap(true, 20 ether, 0); // Large swap to move tick
        vm.stopPrank();

        // Order should be triggered and filled (or attempted)
        // The tick bitmap might be cleared if order was filled
    }

    function testMultipleOrdersExecuteOnTickCross() public {
        _setupLiquidityAndApprovals();
        _setupUser2Approvals();

        int24 tick = -60;

        // User 1 places sell stop
        vm.startPrank(user);
        {
            InEbool memory isSell = createInEbool(true, user);
            InEbool memory triggerAbove = createInEbool(false, user);
            InEuint128 memory amount = createInEuint128(uint128(0.5 ether), user);
            InEuint128 memory minOutput = createInEuint128(uint128(0.1 ether), user);
            hook.placeOrder{value: 0.001 ether}(tick, isSell, triggerAbove, amount, minOutput);
        }
        vm.stopPrank();

        // User 2 places buy limit at same tick
        vm.startPrank(user2);
        {
            InEbool memory isSell = createInEbool(false, user2);
            InEbool memory triggerAbove = createInEbool(false, user2);
            InEuint128 memory amount = createInEuint128(uint128(0.5 ether), user2);
            InEuint128 memory minOutput = createInEuint128(uint128(0.1 ether), user2);
            hook.placeOrder{value: 0.001 ether}(tick, isSell, triggerAbove, amount, minOutput);
        }

        // Execute swap to cross the tick
        hook.swap(true, 20 ether, 0);
        vm.stopPrank();

        // Both orders should have been processed
    }

    // ============ Encrypted Liquidity Tests ============

    function testAddLiquidityEncrypted() public {
        vm.startPrank(user);

        // Approve encrypted amounts for hook
        InEuint128 memory allowance0 = createInEuint128(uint128(20 ether), user);
        InEuint128 memory allowance1 = createInEuint128(uint128(20 ether), user);
        token0.approveEncrypted(address(hook), allowance0);
        token1.approveEncrypted(address(hook), allowance1);

        // Add encrypted liquidity
        InEuint128 memory amount0 = createInEuint128(uint128(10 ether), user);
        InEuint128 memory amount1 = createInEuint128(uint128(10 ether), user);

        euint128 lpAmount = hook.addLiquidityEncrypted(amount0, amount1);

        // Verify LP amount is non-zero
        uint256 lpValue = mockStorage(euint128.unwrap(lpAmount));
        assertGt(lpValue, 0, "LP amount should be positive");
        vm.stopPrank();
    }

    function testRemoveLiquidityEncrypted() public {
        // First add encrypted liquidity
        vm.startPrank(user);

        InEuint128 memory allowance0 = createInEuint128(uint128(20 ether), user);
        InEuint128 memory allowance1 = createInEuint128(uint128(20 ether), user);
        token0.approveEncrypted(address(hook), allowance0);
        token1.approveEncrypted(address(hook), allowance1);

        InEuint128 memory amount0 = createInEuint128(uint128(10 ether), user);
        InEuint128 memory amount1 = createInEuint128(uint128(10 ether), user);
        euint128 lpAmount = hook.addLiquidityEncrypted(amount0, amount1);

        // Now remove liquidity
        InEuint128 memory lpToRemove = createInEuint128(uint128(5 ether), user);
        (euint128 out0, euint128 out1) = hook.removeLiquidityEncrypted(lpToRemove);

        // Verify outputs
        uint256 out0Value = mockStorage(euint128.unwrap(out0));
        uint256 out1Value = mockStorage(euint128.unwrap(out1));
        assertGt(out0Value, 0, "Output0 should be positive");
        assertGt(out1Value, 0, "Output1 should be positive");
        vm.stopPrank();
    }

    // ============ Edge Cases ============

    function testSwapNoLiquidityReverts() public {
        // No liquidity added
        vm.prank(user);
        vm.expectRevert(IFheatherXv2.InsufficientLiquidity.selector);
        hook.swap(true, 1 ether, 0);
    }

    function testEstimateOutputNoLiquidityReverts() public {
        vm.expectRevert(IFheatherXv2.InsufficientLiquidity.selector);
        hook.estimateOutput(true, 1 ether);
    }

    function testConsecutiveSwapsUpdateReserves() public {
        vm.startPrank(user);
        hook.addLiquidity(50 ether, 50 ether);

        (uint256 r0_1, uint256 r1_1) = hook.getReserves();

        hook.swap(true, 5 ether, 0);
        (uint256 r0_2, uint256 r1_2) = hook.getReserves();

        hook.swap(false, 2 ether, 0);
        (uint256 r0_3, uint256 r1_3) = hook.getReserves();

        // Verify reserves changed appropriately
        assertGt(r0_2, r0_1, "Reserve0 should increase after zeroForOne");
        assertLt(r1_2, r1_1, "Reserve1 should decrease after zeroForOne");
        assertLt(r0_3, r0_2, "Reserve0 should decrease after oneForZero");
        assertGt(r1_3, r1_2, "Reserve1 should increase after oneForZero");
        vm.stopPrank();
    }

    function testGetActiveOrdersReturnsCorrectOrders() public {
        _setupLiquidityAndApprovals();

        vm.startPrank(user);

        // Place 3 orders
        uint256[] memory orderIds = new uint256[](3);
        for (uint256 i = 0; i < 3; i++) {
            InEbool memory isSell = createInEbool(false, user);
            InEbool memory triggerAbove = createInEbool(false, user);
            InEuint128 memory amount = createInEuint128(uint128(1 ether), user);
            InEuint128 memory minOutput = createInEuint128(uint128(0.9 ether), user);

            orderIds[i] = hook.placeOrder{value: 0.001 ether}(
                int24(int256(-60 * int256(i + 1))),
                isSell,
                triggerAbove,
                amount,
                minOutput
            );
        }

        // Cancel middle order
        hook.cancelOrder(orderIds[1]);

        // Get active orders
        uint256[] memory activeOrders = hook.getActiveOrders(user);
        assertEq(activeOrders.length, 2, "Should have 2 active orders");
        vm.stopPrank();
    }

    // ============ Helper Functions ============

    function _setupLiquidityAndApprovals() internal {
        vm.startPrank(user);
        hook.addLiquidity(50 ether, 50 ether);

        // Approve encrypted tokens for placing orders
        InEuint128 memory allowance0 = createInEuint128(uint128(100 ether), user);
        InEuint128 memory allowance1 = createInEuint128(uint128(100 ether), user);
        token0.approveEncrypted(address(hook), allowance0);
        token1.approveEncrypted(address(hook), allowance1);
        vm.stopPrank();
    }

    function _setupUser2Approvals() internal {
        vm.startPrank(user2);
        // Approve plaintext
        token0.approve(address(hook), type(uint256).max);
        token1.approve(address(hook), type(uint256).max);

        // Approve encrypted tokens
        InEuint128 memory allowance0 = createInEuint128(uint128(100 ether), user2);
        InEuint128 memory allowance1 = createInEuint128(uint128(100 ether), user2);
        token0.approveEncrypted(address(hook), allowance0);
        token1.approveEncrypted(address(hook), allowance1);
        vm.stopPrank();
    }
}
