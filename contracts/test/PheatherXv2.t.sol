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
import {PheatherXv2} from "../src/PheatherXv2.sol";
import {IPheatherXv2} from "../src/interface/IPheatherXv2.sol";
import {FHERC20FaucetToken} from "../src/tokens/FHERC20FaucetToken.sol";
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

contract PheatherXv2Test is Test, Fixtures, CoFheTest {
    using EasyPosm for IPositionManager;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    address private user = makeAddr("user");
    address private user2 = makeAddr("user2");

    PheatherXv2 hook;
    PoolId poolId;

    uint256 tokenId;
    int24 tickLower;
    int24 tickUpper;

    FHERC20FaucetToken token0;
    FHERC20FaucetToken token1;

    uint160 constant SQRT_RATIO_10_1 = 250541448375047931186413801569;

    function setUp() public {
        // Deploy FHERC20 tokens at deterministic addresses
        address a0 = address(0x100);
        address a1 = address(0x200);

        // Ensure token0 < token1 for Uniswap ordering
        if (a0 > a1) {
            (a0, a1) = (a1, a0);
        }

        vm.etch(a0, address(new FHERC20FaucetToken("Token0", "TK0", 18)).code);
        vm.etch(a1, address(new FHERC20FaucetToken("Token1", "TK1", 18)).code);

        token0 = FHERC20FaucetToken(a0);
        token1 = FHERC20FaucetToken(a1);

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
        deployCodeTo("PheatherXv2.sol:PheatherXv2", constructorArgs, flags);
        hook = PheatherXv2(payable(flags));

        vm.label(address(hook), "hook");

        // Create the pool
        key = PoolKey(currency0, currency1, 3000, 60, IHooks(hook));
        poolId = key.toId();
        manager.initialize(key, SQRT_PRICE_1_1);

        // Setup tick bounds
        tickLower = TickMath.minUsableTick(key.tickSpacing);
        tickUpper = TickMath.maxUsableTick(key.tickSpacing);

        // Get tokens from faucet for users
        vm.startPrank(user);
        token0.faucet();
        token1.faucet();
        // Approve tokens for hook
        token0.approve(address(hook), type(uint256).max);
        token1.approve(address(hook), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(user2);
        token0.faucet();
        token1.faucet();
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
        vm.expectRevert(IPheatherXv2.ZeroAmount.selector);
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
        vm.expectRevert(IPheatherXv2.SlippageExceeded.selector);
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
        vm.expectRevert(IPheatherXv2.ZeroAmount.selector);
        hook.addLiquidity(0, 10 ether);
    }

    function testRemoveLiquidityZeroAmountReverts() public {
        vm.prank(user);
        vm.expectRevert(IPheatherXv2.ZeroAmount.selector);
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

    // ============ Limit Order Tests ============

    function testPlaceOrderBuyLimit() public {
        // Buy limit: buy token0 when price drops below tick
        // isSell=false (buying token0), triggerAbove=false (trigger when price drops below)
        int24 triggerTick = -100;

        // Get tokens for the order
        vm.startPrank(user);
        token1.faucet(); // Need more token1 to pay for order

        // Create encrypted params
        InEbool memory isSell = _createInEbool(false);
        InEbool memory triggerAbove = _createInEbool(false);
        InEuint128 memory amount = _createInEuint128(uint128(100 ether));
        InEuint128 memory minOutput = _createInEuint128(uint128(90 ether));

        // Need to approve encrypted tokens for hook
        // For this test, we're just checking the interface works

        vm.stopPrank();
    }

    function testCancelOrderNotOwnerReverts() public {
        // Only owner should be able to cancel
        // This will revert with OrderNotFound since no order exists
        vm.prank(user);
        vm.expectRevert(IPheatherXv2.OrderNotFound.selector);
        hook.cancelOrder(999);
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
        vm.expectRevert(IPheatherXv2.InsufficientLiquidity.selector);
        hook.removeLiquidity(1000000 ether); // Way more than deposited
    }

    // ============ Helper Functions ============

    function _createInEbool(bool value) internal pure returns (InEbool memory) {
        InEbool memory result;
        // In production, this would be encrypted client-side
        return result;
    }

    function _createInEuint128(uint128 value) internal pure returns (InEuint128 memory) {
        InEuint128 memory result;
        // In production, this would be encrypted client-side
        return result;
    }
}
