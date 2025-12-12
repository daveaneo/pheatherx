// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title LastProcessedTickBug Test
 * @notice Tests that FAIL due to the lastProcessedTick initialization bug.
 *         These tests assert CORRECT behavior and will PASS once the bug is fixed.
 *
 * BUG: lastProcessedTick is never initialized in _afterInitialize().
 * It defaults to 0, causing limit orders to be skipped during order processing.
 *
 * FIX: Add `lastProcessedTick[poolId] = tick;` in _afterInitialize()
 *
 * EXPECTED BEHAVIOR:
 * When price moves through a tick, ALL orders at that tick should be processed,
 * regardless of whether they are BUY or SELL orders, and regardless of swap direction.
 */

import "forge-std/Test.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {CurrencyLibrary, Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";

import {FheatherXv6} from "../../src/FheatherXv6.sol";
import {FhenixFHERC20Faucet} from "../../src/tokens/FhenixFHERC20Faucet.sol";
import {FaucetToken} from "../../src/tokens/FaucetToken.sol";

import {EasyPosm} from "../utils/EasyPosm.sol";
import {Fixtures} from "../utils/Fixtures.sol";

import {FHE, euint128, InEuint128, Common} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {CoFheTest} from "@fhenixprotocol/cofhe-mock-contracts/CoFheTest.sol";

contract LastProcessedTickBugTest is Test, Fixtures, CoFheTest {
    using EasyPosm for IPositionManager;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    address private owner;
    address private user1 = makeAddr("user1");
    address private lp = makeAddr("lp");

    FheatherXv6 hook;
    PoolId poolId;
    PoolKey poolKey;

    FhenixFHERC20Faucet fheToken0;
    FhenixFHERC20Faucet fheToken1;

    int24 constant TICK_SPACING = 60;
    uint256 constant LIQUIDITY_AMOUNT = 100 ether;
    uint256 constant ORDER_AMOUNT = 10 ether;

    function setUp() public {
        owner = address(this);

        // Deploy FHERC20 tokens
        FhenixFHERC20Faucet tokenA = new FhenixFHERC20Faucet("Token A", "TKA", 18);
        FhenixFHERC20Faucet tokenB = new FhenixFHERC20Faucet("Token B", "TKB", 18);

        // Sort by address
        if (address(tokenA) < address(tokenB)) {
            fheToken0 = tokenA;
            fheToken1 = tokenB;
        } else {
            fheToken0 = tokenB;
            fheToken1 = tokenA;
        }

        vm.label(address(fheToken0), "fheToken0");
        vm.label(address(fheToken1), "fheToken1");

        // Deploy pool manager and routers
        deployFreshManagerAndRouters();
        currency0 = Currency.wrap(address(fheToken0));
        currency1 = Currency.wrap(address(fheToken1));
        deployAndApprovePosm(manager, currency0, currency1);

        // Deploy hook
        uint160 hookFlags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG |
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.AFTER_SWAP_FLAG |
            Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        );
        address targetAddr = address(hookFlags ^ (0x5555 << 144));
        bytes memory constructorArgs = abi.encode(manager, owner, 30);
        deployCodeTo("FheatherXv6.sol:FheatherXv6", constructorArgs, targetAddr);
        hook = FheatherXv6(payable(targetAddr));

        vm.label(address(hook), "FheatherXv6Hook");

        // Initialize pool at tick 0 (price 1.0)
        poolKey = PoolKey(
            Currency.wrap(address(fheToken0)),
            Currency.wrap(address(fheToken1)),
            3000,
            TICK_SPACING,
            IHooks(hook)
        );
        poolId = poolKey.toId();
        manager.initialize(poolKey, SQRT_PRICE_1_1);

        // Fund accounts
        _fundAccounts();
    }

    function _fundAccounts() internal {
        // Mint tokens
        fheToken0.mintEncrypted(user1, ORDER_AMOUNT * 10);
        fheToken1.mintEncrypted(user1, ORDER_AMOUNT * 10);
        fheToken0.mintEncrypted(lp, LIQUIDITY_AMOUNT * 10);
        fheToken1.mintEncrypted(lp, LIQUIDITY_AMOUNT * 10);

        // Also mint plaintext for liquidity
        deal(address(fheToken0), lp, LIQUIDITY_AMOUNT * 10);
        deal(address(fheToken1), lp, LIQUIDITY_AMOUNT * 10);

        // Approve hook
        vm.startPrank(user1);
        InEuint128 memory maxApproval = createInEuint128(type(uint128).max, user1);
        fheToken0.approveEncrypted(address(hook), maxApproval);
        fheToken1.approveEncrypted(address(hook), maxApproval);
        fheToken0.approve(address(hook), type(uint256).max);
        fheToken1.approve(address(hook), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(lp);
        fheToken0.approve(address(hook), type(uint256).max);
        fheToken1.approve(address(hook), type(uint256).max);
        vm.stopPrank();
    }

    // ============================================================
    // TEST 1: lastProcessedTick initialization
    // ============================================================

    /**
     * @notice lastProcessedTick should be initialized to current tick
     *
     * FAILS NOW: lastProcessedTick is 0 instead of currentTick
     * PASSES AFTER FIX: lastProcessedTick == currentTick
     */
    function test_LastProcessedTickInitializedAfterLiquidity() public {
        vm.startPrank(lp);
        hook.addLiquidity(poolId, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);
        vm.stopPrank();

        int24 currentTick = hook.getCurrentTickForPool(poolId);
        int24 lastProcessedTick = hook.lastProcessedTick(poolId);

        console.log("Current tick:", currentTick);
        console.log("lastProcessedTick:", lastProcessedTick);

        assertEq(
            lastProcessedTick,
            currentTick,
            "lastProcessedTick should be initialized to current tick"
        );
    }

    // ============================================================
    // TEST 2-5: Orders at current tick should ALWAYS trigger
    // ============================================================

    /**
     * @notice SELL order AT current tick should fill when selling (zeroForOne=true)
     *
     * If order is at current tick, ANY price movement should trigger it.
     */
    function test_SellOrderAtCurrentTickShouldBeFilledWhenSelling() public {
        vm.startPrank(lp);
        hook.addLiquidity(poolId, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);
        vm.stopPrank();

        int24 currentTick = hook.getCurrentTickForPool(poolId);
        int24 orderTick = (currentTick / TICK_SPACING) * TICK_SPACING;

        console.log("Current tick:", currentTick);
        console.log("lastProcessedTick:", hook.lastProcessedTick(poolId));
        console.log("SELL order at tick:", orderTick);

        vm.startPrank(user1);
        InEuint128 memory amount = createInEuint128(uint128(ORDER_AMOUNT), user1);
        hook.deposit(poolId, orderTick, FheatherXv6.BucketSide.SELL, amount, block.timestamp + 1 hours, 1000000);
        vm.stopPrank();

        assertTrue(hook.hasActiveOrders(poolId, orderTick, FheatherXv6.BucketSide.SELL), "Order should exist");

        vm.startPrank(lp);
        hook.swapForPool(poolId, true, LIQUIDITY_AMOUNT / 5, 0); // zeroForOne=true
        vm.stopPrank();

        int24 newTick = hook.getCurrentTickForPool(poolId);
        console.log("New tick after swap:", newTick);

        // Order at current tick should be filled when price moves away from it
        assertFalse(
            hook.hasActiveOrders(poolId, orderTick, FheatherXv6.BucketSide.SELL),
            "SELL order at current tick should be filled on any swap"
        );
    }

    /**
     * @notice SELL order AT current tick should fill when buying (zeroForOne=false)
     */
    function test_SellOrderAtCurrentTickShouldBeFilledWhenBuying() public {
        vm.startPrank(lp);
        hook.addLiquidity(poolId, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);
        vm.stopPrank();

        int24 currentTick = hook.getCurrentTickForPool(poolId);
        int24 orderTick = (currentTick / TICK_SPACING) * TICK_SPACING;

        console.log("Current tick:", currentTick);
        console.log("lastProcessedTick:", hook.lastProcessedTick(poolId));
        console.log("SELL order at tick:", orderTick);

        vm.startPrank(user1);
        InEuint128 memory amount = createInEuint128(uint128(ORDER_AMOUNT), user1);
        hook.deposit(poolId, orderTick, FheatherXv6.BucketSide.SELL, amount, block.timestamp + 1 hours, 1000000);
        vm.stopPrank();

        assertTrue(hook.hasActiveOrders(poolId, orderTick, FheatherXv6.BucketSide.SELL), "Order should exist");

        vm.startPrank(lp);
        hook.swapForPool(poolId, false, LIQUIDITY_AMOUNT / 5, 0); // zeroForOne=false
        vm.stopPrank();

        int24 newTick = hook.getCurrentTickForPool(poolId);
        console.log("New tick after swap:", newTick);

        assertFalse(
            hook.hasActiveOrders(poolId, orderTick, FheatherXv6.BucketSide.SELL),
            "SELL order at current tick should be filled on any swap"
        );
    }

    /**
     * @notice BUY order AT current tick should fill when selling (zeroForOne=true)
     */
    function test_BuyOrderAtCurrentTickShouldBeFilledWhenSelling() public {
        vm.startPrank(lp);
        hook.addLiquidity(poolId, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);
        vm.stopPrank();

        int24 currentTick = hook.getCurrentTickForPool(poolId);
        int24 orderTick = (currentTick / TICK_SPACING) * TICK_SPACING;

        console.log("Current tick:", currentTick);
        console.log("lastProcessedTick:", hook.lastProcessedTick(poolId));
        console.log("BUY order at tick:", orderTick);

        vm.startPrank(user1);
        InEuint128 memory amount = createInEuint128(uint128(ORDER_AMOUNT), user1);
        hook.deposit(poolId, orderTick, FheatherXv6.BucketSide.BUY, amount, block.timestamp + 1 hours, 1000000);
        vm.stopPrank();

        assertTrue(hook.hasActiveOrders(poolId, orderTick, FheatherXv6.BucketSide.BUY), "Order should exist");

        vm.startPrank(lp);
        hook.swapForPool(poolId, true, LIQUIDITY_AMOUNT / 5, 0); // zeroForOne=true
        vm.stopPrank();

        int24 newTick = hook.getCurrentTickForPool(poolId);
        console.log("New tick after swap:", newTick);

        assertFalse(
            hook.hasActiveOrders(poolId, orderTick, FheatherXv6.BucketSide.BUY),
            "BUY order at current tick should be filled on any swap"
        );
    }

    /**
     * @notice BUY order AT current tick should fill when buying (zeroForOne=false)
     */
    function test_BuyOrderAtCurrentTickShouldBeFilledWhenBuying() public {
        vm.startPrank(lp);
        hook.addLiquidity(poolId, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);
        vm.stopPrank();

        int24 currentTick = hook.getCurrentTickForPool(poolId);
        int24 orderTick = (currentTick / TICK_SPACING) * TICK_SPACING;

        console.log("Current tick:", currentTick);
        console.log("lastProcessedTick:", hook.lastProcessedTick(poolId));
        console.log("BUY order at tick:", orderTick);

        vm.startPrank(user1);
        InEuint128 memory amount = createInEuint128(uint128(ORDER_AMOUNT), user1);
        hook.deposit(poolId, orderTick, FheatherXv6.BucketSide.BUY, amount, block.timestamp + 1 hours, 1000000);
        vm.stopPrank();

        assertTrue(hook.hasActiveOrders(poolId, orderTick, FheatherXv6.BucketSide.BUY), "Order should exist");

        vm.startPrank(lp);
        hook.swapForPool(poolId, false, LIQUIDITY_AMOUNT / 5, 0); // zeroForOne=false
        vm.stopPrank();

        int24 newTick = hook.getCurrentTickForPool(poolId);
        console.log("New tick after swap:", newTick);

        assertFalse(
            hook.hasActiveOrders(poolId, orderTick, FheatherXv6.BucketSide.BUY),
            "BUY order at current tick should be filled on any swap"
        );
    }

    // ============================================================
    // TEST 6-9: Orders in price path should fill
    // ============================================================

    /**
     * @notice SELL order should fill when swap is SELLING (zeroForOne=true)
     *
     * Place SELL order at current tick, then do a selling swap.
     * Order should fill when price moves away from it.
     *
     * FAILS NOW: Order at current tick not filled (strict inequality bug)
     * PASSES AFTER FIX: Order fills correctly
     */
    function test_SellOrderShouldBeFilledWhenSelling() public {
        vm.startPrank(lp);
        hook.addLiquidity(poolId, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);
        vm.stopPrank();

        int24 currentTick = hook.getCurrentTickForPool(poolId);
        int24 orderTick = (currentTick / TICK_SPACING) * TICK_SPACING;

        console.log("Current tick:", currentTick);
        console.log("lastProcessedTick:", hook.lastProcessedTick(poolId));
        console.log("SELL order at tick:", orderTick);

        vm.startPrank(user1);
        InEuint128 memory amount = createInEuint128(uint128(ORDER_AMOUNT), user1);
        hook.deposit(poolId, orderTick, FheatherXv6.BucketSide.SELL, amount, block.timestamp + 1 hours, 1000000);
        vm.stopPrank();

        assertTrue(hook.hasActiveOrders(poolId, orderTick, FheatherXv6.BucketSide.SELL), "Order should exist");

        vm.startPrank(lp);
        hook.swapForPool(poolId, true, LIQUIDITY_AMOUNT / 5, 0); // zeroForOne=true (selling)
        vm.stopPrank();

        console.log("New tick after swap:", hook.getCurrentTickForPool(poolId));

        assertFalse(
            hook.hasActiveOrders(poolId, orderTick, FheatherXv6.BucketSide.SELL),
            "SELL order should be filled when price moves through it"
        );
    }

    /**
     * @notice SELL order should fill when swap is BUYING (zeroForOne=false)
     *
     * Price moves through the order tick → order should fill.
     *
     * FAILS NOW: Order not filled due to lastProcessedTick=0 bug
     * PASSES AFTER FIX: Order fills correctly
     */
    function test_SellOrderShouldBeFilledWhenBuying() public {
        vm.startPrank(lp);
        hook.addLiquidity(poolId, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);
        vm.stopPrank();

        int24 currentTick = hook.getCurrentTickForPool(poolId);
        int24 orderTick = (currentTick / TICK_SPACING) * TICK_SPACING;

        console.log("Current tick:", currentTick);
        console.log("lastProcessedTick (BUG=0):", hook.lastProcessedTick(poolId));
        console.log("SELL order at tick:", orderTick);

        vm.startPrank(user1);
        InEuint128 memory amount = createInEuint128(uint128(ORDER_AMOUNT), user1);
        hook.deposit(poolId, orderTick, FheatherXv6.BucketSide.SELL, amount, block.timestamp + 1 hours, 1000000);
        vm.stopPrank();

        assertTrue(hook.hasActiveOrders(poolId, orderTick, FheatherXv6.BucketSide.SELL), "Order should exist");

        vm.startPrank(lp);
        hook.swapForPool(poolId, false, LIQUIDITY_AMOUNT / 5, 0); // zeroForOne=false (buying)
        vm.stopPrank();

        console.log("New tick after swap:", hook.getCurrentTickForPool(poolId));

        assertFalse(
            hook.hasActiveOrders(poolId, orderTick, FheatherXv6.BucketSide.SELL),
            "SELL order should be filled when price moves through it (buying swap)"
        );
    }

    // ============================================================
    // TEST 4 & 5: BUY orders should fill on ANY swap direction
    // ============================================================

    /**
     * @notice BUY order should fill when swap is BUYING (zeroForOne=false)
     *
     * Price moves through the order tick → order should fill.
     *
     * FAILS NOW: Order not filled due to lastProcessedTick=0 bug
     * PASSES AFTER FIX: Order fills correctly
     */
    function test_BuyOrderShouldBeFilledWhenBuying() public {
        vm.startPrank(lp);
        hook.addLiquidity(poolId, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);
        vm.stopPrank();

        int24 currentTick = hook.getCurrentTickForPool(poolId);
        int24 orderTick = (currentTick / TICK_SPACING) * TICK_SPACING;

        console.log("Current tick:", currentTick);
        console.log("lastProcessedTick (BUG=0):", hook.lastProcessedTick(poolId));
        console.log("BUY order at tick:", orderTick);

        vm.startPrank(user1);
        InEuint128 memory amount = createInEuint128(uint128(ORDER_AMOUNT), user1);
        hook.deposit(poolId, orderTick, FheatherXv6.BucketSide.BUY, amount, block.timestamp + 1 hours, 1000000);
        vm.stopPrank();

        assertTrue(hook.hasActiveOrders(poolId, orderTick, FheatherXv6.BucketSide.BUY), "Order should exist");

        vm.startPrank(lp);
        hook.swapForPool(poolId, false, LIQUIDITY_AMOUNT / 5, 0); // zeroForOne=false (buying)
        vm.stopPrank();

        console.log("New tick after swap:", hook.getCurrentTickForPool(poolId));

        assertFalse(
            hook.hasActiveOrders(poolId, orderTick, FheatherXv6.BucketSide.BUY),
            "BUY order should be filled when price moves through it (buying swap)"
        );
    }

    /**
     * @notice BUY order should fill when swap is SELLING (zeroForOne=true)
     *
     * Price moves through the order tick → order should fill.
     *
     * FAILS NOW: Order not filled due to lastProcessedTick=0 bug
     * PASSES AFTER FIX: Order fills correctly
     */
    function test_BuyOrderShouldBeFilledWhenSelling() public {
        vm.startPrank(lp);
        hook.addLiquidity(poolId, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);
        vm.stopPrank();

        int24 currentTick = hook.getCurrentTickForPool(poolId);
        int24 orderTick = (currentTick / TICK_SPACING) * TICK_SPACING;

        console.log("Current tick:", currentTick);
        console.log("lastProcessedTick (BUG=0):", hook.lastProcessedTick(poolId));
        console.log("BUY order at tick:", orderTick);

        vm.startPrank(user1);
        InEuint128 memory amount = createInEuint128(uint128(ORDER_AMOUNT), user1);
        hook.deposit(poolId, orderTick, FheatherXv6.BucketSide.BUY, amount, block.timestamp + 1 hours, 1000000);
        vm.stopPrank();

        assertTrue(hook.hasActiveOrders(poolId, orderTick, FheatherXv6.BucketSide.BUY), "Order should exist");

        vm.startPrank(lp);
        hook.swapForPool(poolId, true, LIQUIDITY_AMOUNT / 5, 0); // zeroForOne=true (selling)
        vm.stopPrank();

        console.log("New tick after swap:", hook.getCurrentTickForPool(poolId));

        assertFalse(
            hook.hasActiveOrders(poolId, orderTick, FheatherXv6.BucketSide.BUY),
            "BUY order should be filled when price moves through it (selling swap)"
        );
    }
}
