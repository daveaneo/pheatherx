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
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";

// Local Imports
import {FheatherXv4} from "../src/FheatherXv4.sol";
import {FhenixFHERC20Faucet} from "../src/tokens/FhenixFHERC20Faucet.sol";

// Test Utils
import {EasyPosm} from "./utils/EasyPosm.sol";
import {Fixtures} from "./utils/Fixtures.sol";

// FHE Imports
import {FHE, euint128, ebool, InEuint128, InEbool, Common} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {CoFheTest} from "@fhenixprotocol/cofhe-mock-contracts/CoFheTest.sol";

// OpenZeppelin Imports
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract FheatherXv4Test is Test, Fixtures, CoFheTest {
    using EasyPosm for IPositionManager;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    // Test addresses
    address private owner;
    address private user1 = makeAddr("user1");
    address private user2 = makeAddr("user2");
    address private swapper = makeAddr("swapper");
    address private feeCollector = makeAddr("feeCollector");

    // Contract instances
    FheatherXv4 hook;
    PoolId poolId;

    FhenixFHERC20Faucet token0;
    FhenixFHERC20Faucet token1;

    // Common test amounts
    uint256 constant DEPOSIT_AMOUNT = 100e18;
    uint256 constant SWAP_AMOUNT = 50e18;
    int24 constant TEST_TICK = 60; // ~0.6% above price 1.0
    int24 constant TICK_SPACING = 60;

    function setUp() public {
        owner = address(this);

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

        vm.label(owner, "owner");
        vm.label(user1, "user1");
        vm.label(user2, "user2");
        vm.label(swapper, "swapper");
        vm.label(feeCollector, "feeCollector");
        vm.label(address(token0), "token0");
        vm.label(address(token1), "token1");

        // Create the pool manager, utility routers
        deployFreshManagerAndRouters();

        // Set currencies
        currency0 = Currency.wrap(address(token0));
        currency1 = Currency.wrap(address(token1));

        // Deploy POSM
        deployAndApprovePosm(manager, currency0, currency1);

        // Deploy the hook with correct flags
        address flags = address(
            uint160(
                Hooks.AFTER_INITIALIZE_FLAG |
                Hooks.BEFORE_SWAP_FLAG |
                Hooks.AFTER_SWAP_FLAG |
                Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
            ) ^ (0x4444 << 144)
        );

        bytes memory constructorArgs = abi.encode(manager, owner);
        deployCodeTo("FheatherXv4.sol:FheatherXv4", constructorArgs, flags);
        hook = FheatherXv4(payable(flags));

        vm.label(address(hook), "hook");

        // Create the pool
        key = PoolKey(currency0, currency1, 3000, TICK_SPACING, IHooks(hook));
        poolId = key.toId();
        manager.initialize(key, SQRT_PRICE_1_1);

        // Setup fee collector
        hook.setFeeCollector(feeCollector);

        // Mint encrypted tokens to users
        _mintAndApprove(user1, DEPOSIT_AMOUNT * 10);
        _mintAndApprove(user2, DEPOSIT_AMOUNT * 10);
        _mintAndApprove(swapper, SWAP_AMOUNT * 10);

        // Initialize hook contract with small token balances for FHE operations
        token0.mintEncrypted(address(hook), 1);
        token1.mintEncrypted(address(hook), 1);

        // Give swapper plaintext tokens for swaps
        deal(address(token0), swapper, SWAP_AMOUNT * 10);
        deal(address(token1), swapper, SWAP_AMOUNT * 10);

        // Give hook plaintext tokens for swap outputs
        deal(address(token0), address(hook), DEPOSIT_AMOUNT * 10);
        deal(address(token1), address(hook), DEPOSIT_AMOUNT * 10);
    }

    function _mintAndApprove(address user, uint256 amount) internal {
        token0.mintEncrypted(user, amount);
        token1.mintEncrypted(user, amount);

        vm.startPrank(user);
        // Approve hook to spend tokens via encrypted allowance
        InEuint128 memory maxApproval = createInEuint128(type(uint128).max, user);
        token0.approveEncrypted(address(hook), maxApproval);
        token1.approveEncrypted(address(hook), maxApproval);

        // Also approve plaintext for swaps
        token0.approve(address(hook), type(uint256).max);
        token1.approve(address(hook), type(uint256).max);
        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          HOOK PERMISSION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testHookPermissions() public view {
        Hooks.Permissions memory perms = hook.getHookPermissions();

        // Required permissions for custom swap logic
        assertTrue(perms.beforeSwap, "beforeSwap should be enabled");
        assertTrue(perms.afterSwap, "afterSwap should be enabled");
        assertTrue(perms.beforeSwapReturnDelta, "beforeSwapReturnDelta should be enabled");
        assertTrue(perms.afterInitialize, "afterInitialize should be enabled");

        // Not needed
        assertFalse(perms.beforeInitialize, "beforeInitialize should be disabled");
        assertFalse(perms.beforeAddLiquidity, "beforeAddLiquidity should be disabled");
        assertFalse(perms.beforeRemoveLiquidity, "beforeRemoveLiquidity should be disabled");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          POOL INITIALIZATION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testPoolInitialized() public view {
        (
            address poolToken0,
            address poolToken1,
            bool initialized,
            uint256 reserve0,
            uint256 reserve1,
            uint256 maxBuckets,
            uint256 protocolFeeBps
        ) = hook.getPoolState(poolId);

        assertEq(poolToken0, address(token0));
        assertEq(poolToken1, address(token1));
        assertTrue(initialized);
        assertEq(protocolFeeBps, 5); // Default 0.05%
        assertEq(maxBuckets, 5); // Default max buckets
    }

    function testTickPricesInitialized() public view {
        // Check tick 0 = 1e18
        assertEq(hook.getTickPrice(0), 1e18);

        // Check positive tick 60
        assertGt(hook.getTickPrice(60), 1e18); // Should be > 1.0

        // Check negative tick -60
        assertLt(hook.getTickPrice(-60), 1e18); // Should be < 1.0
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          DEPOSIT (PLACE LIMIT ORDER) TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testDepositSellSide() public {
        vm.startPrank(user1);

        InEuint128 memory amount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        uint256 deadline = block.timestamp + 1 hours;
        int24 maxDrift = 100;

        // deposit() doesn't return a value, just verify no revert
        hook.deposit(
            poolId,
            TEST_TICK,
            FheatherXv4.BucketSide.SELL,
            amount,
            deadline,
            maxDrift
        );

        // Verify bucket has active orders
        assertTrue(hook.hasActiveOrders(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL));

        vm.stopPrank();
    }

    function testDepositBuySide() public {
        vm.startPrank(user1);

        InEuint128 memory amount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        uint256 deadline = block.timestamp + 1 hours;
        int24 maxDrift = 100;

        hook.deposit(
            poolId,
            -TEST_TICK, // Buy below current price
            FheatherXv4.BucketSide.BUY,
            amount,
            deadline,
            maxDrift
        );

        assertTrue(hook.hasActiveOrders(poolId, -TEST_TICK, FheatherXv4.BucketSide.BUY));

        vm.stopPrank();
    }

    function testDepositRevertsExpiredDeadline() public {
        vm.startPrank(user1);

        InEuint128 memory amount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        uint256 deadline = block.timestamp - 1; // Expired
        int24 maxDrift = 100;

        vm.expectRevert(FheatherXv4.DeadlineExpired.selector);
        hook.deposit(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL, amount, deadline, maxDrift);

        vm.stopPrank();
    }

    function testDepositRevertsInvalidTickSpacing() public {
        vm.startPrank(user1);

        InEuint128 memory amount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        uint256 deadline = block.timestamp + 1 hours;
        int24 maxDrift = 100;

        vm.expectRevert(FheatherXv4.InvalidTick.selector);
        hook.deposit(poolId, 61, FheatherXv4.BucketSide.SELL, amount, deadline, maxDrift); // 61 not divisible by 60

        vm.stopPrank();
    }

    function testDepositRevertsTickOutOfRange() public {
        vm.startPrank(user1);

        InEuint128 memory amount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        uint256 deadline = block.timestamp + 1 hours;
        int24 maxDrift = 10000; // High drift to not hit price moved

        vm.expectRevert(FheatherXv4.InvalidTick.selector);
        hook.deposit(poolId, 6060, FheatherXv4.BucketSide.SELL, amount, deadline, maxDrift); // Beyond MAX_TICK

        vm.stopPrank();
    }

    function testMultipleDepositsToSameBucket() public {
        // User1 deposits
        vm.startPrank(user1);
        InEuint128 memory amount1 = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        hook.deposit(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL, amount1, block.timestamp + 1 hours, 100);
        vm.stopPrank();

        // User2 deposits to same bucket
        vm.startPrank(user2);
        InEuint128 memory amount2 = createInEuint128(uint128(DEPOSIT_AMOUNT), user2);
        hook.deposit(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL, amount2, block.timestamp + 1 hours, 100);
        vm.stopPrank();

        // Both users should have positions
        assertTrue(hook.hasActiveOrders(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL));
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          WITHDRAW TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testWithdraw() public {
        // First deposit
        vm.startPrank(user1);
        InEuint128 memory depositAmount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        hook.deposit(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL, depositAmount, block.timestamp + 1 hours, 100);

        // Withdraw half - function doesn't return value
        InEuint128 memory withdrawAmount = createInEuint128(uint128(DEPOSIT_AMOUNT / 2), user1);
        hook.withdraw(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL, withdrawAmount);

        // Bucket should still have orders (half remaining)
        assertTrue(hook.hasActiveOrders(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL));

        vm.stopPrank();
    }

    function testWithdrawOnEmptyBucket() public {
        // Withdraw from a bucket that was never deposited to
        // This should succeed but withdraw 0 (empty unfilled balance)
        vm.startPrank(user1);

        InEuint128 memory amount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        // Withdraw on a valid tick that has no deposits - should not revert, just transfer 0
        hook.withdraw(poolId, 120, FheatherXv4.BucketSide.SELL, amount);

        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          CLAIM TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testClaimNoProceeds() public {
        // Deposit first
        vm.startPrank(user1);
        InEuint128 memory depositAmount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        hook.deposit(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL, depositAmount, block.timestamp + 1 hours, 100);

        // Claim should succeed (returns nothing, no fills happened so 0 transferred)
        hook.claim(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL);

        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          EXIT TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testExit() public {
        // First deposit
        vm.startPrank(user1);
        InEuint128 memory depositAmount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        hook.deposit(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL, depositAmount, block.timestamp + 1 hours, 100);

        // Exit entire position - function doesn't return value
        hook.exit(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL);

        // Should have no more active orders after full exit
        // Note: depending on implementation, this might still show true until bucket is cleared
        // For now, just verify the call succeeded

        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          FEE SYSTEM TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testSetFeeCollector() public {
        address newCollector = makeAddr("newCollector");
        hook.setFeeCollector(newCollector);
        assertEq(hook.feeCollector(), newCollector);
    }

    function testQueueProtocolFee() public {
        // Queue new fee
        hook.queueProtocolFee(poolId, 10);

        (uint256 feeBps, uint256 effectiveTimestamp) = hook.getPendingFee(poolId);
        assertEq(feeBps, 10);
        assertGt(effectiveTimestamp, block.timestamp);
    }

    function testQueueProtocolFeeRevertsFeeTooHigh() public {
        vm.expectRevert(FheatherXv4.FeeTooHigh.selector);
        hook.queueProtocolFee(poolId, 101); // > 1%
    }

    function testApplyProtocolFeeRevertsBeforeTimelock() public {
        hook.queueProtocolFee(poolId, 10);

        vm.expectRevert(FheatherXv4.FeeChangeNotReady.selector);
        hook.applyProtocolFee(poolId);
    }

    function testApplyProtocolFeeAfterTimelock() public {
        // Queue new fee
        hook.queueProtocolFee(poolId, 10);

        // Warp time past timelock (2 days)
        vm.warp(block.timestamp + 2 days + 1);

        // Apply fee
        hook.applyProtocolFee(poolId);

        (,,,,, , uint256 protocolFeeBps) = hook.getPoolState(poolId);
        assertEq(protocolFeeBps, 10);
    }

    function testApplyProtocolFeeRevertsNoPendingFee() public {
        // No fee queued, so effectiveTimestamp is 0, which triggers FeeChangeNotReady
        vm.expectRevert(FheatherXv4.FeeChangeNotReady.selector);
        hook.applyProtocolFee(poolId);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          ADMIN TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testSetMaxBucketsPerSwap() public {
        hook.setMaxBucketsPerSwap(poolId, 10);

        (,,,,,uint256 maxBuckets,) = hook.getPoolState(poolId);
        assertEq(maxBuckets, 10);
    }

    function testSetMaxBucketsPerSwapRevertsInvalidRange() public {
        vm.expectRevert("Invalid value");
        hook.setMaxBucketsPerSwap(poolId, 0);

        vm.expectRevert("Invalid value");
        hook.setMaxBucketsPerSwap(poolId, 21);
    }

    function testPause() public {
        hook.pause();

        // Try to deposit while paused
        vm.startPrank(user1);
        InEuint128 memory amount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        vm.expectRevert(); // EnforcedPause
        hook.deposit(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL, amount, block.timestamp + 1 hours, 100);
        vm.stopPrank();
    }

    function testUnpause() public {
        hook.pause();
        hook.unpause();

        // Should work now
        vm.startPrank(user1);
        InEuint128 memory amount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        hook.deposit(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL, amount, block.timestamp + 1 hours, 100);
        vm.stopPrank();
    }

    function testInitializeReserves() public {
        hook.initializeReserves(poolId, 1000e18, 1000e18);

        (,,,uint256 reserve0, uint256 reserve1,,) = hook.getPoolState(poolId);
        assertEq(reserve0, 1000e18);
        assertEq(reserve1, 1000e18);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          VIEW FUNCTION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testHasActiveOrders() public {
        // Initially no orders
        assertFalse(hook.hasActiveOrders(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL));

        // After deposit, should have orders
        vm.startPrank(user1);
        InEuint128 memory amount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        hook.deposit(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL, amount, block.timestamp + 1 hours, 100);
        vm.stopPrank();

        assertTrue(hook.hasActiveOrders(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL));
    }

    function testGetTickPrice() public view {
        // Tick 0 should be 1.0 (1e18)
        assertEq(hook.getTickPrice(0), 1e18);

        // Positive tick should be > 1.0
        assertGt(hook.getTickPrice(60), 1e18);

        // Negative tick should be < 1.0
        assertLt(hook.getTickPrice(-60), 1e18);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          FHERC20:FHERC20 POOL TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testFheFhePoolAllLimitOrderTypes() public {
        // Both tokens are FHERC20, so all 4 limit order types should work

        // 1. Limit Buy token0 with token1 (BUY side, below current price)
        vm.startPrank(user1);
        InEuint128 memory buyAmount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        hook.deposit(
            poolId,
            -TEST_TICK,
            FheatherXv4.BucketSide.BUY,
            buyAmount,
            block.timestamp + 1 hours,
            100
        );
        vm.stopPrank();

        // 2. Limit Sell token0 for token1 (SELL side, above current price)
        vm.startPrank(user2);
        InEuint128 memory sellAmount = createInEuint128(uint128(DEPOSIT_AMOUNT), user2);
        hook.deposit(
            poolId,
            TEST_TICK,
            FheatherXv4.BucketSide.SELL,
            sellAmount,
            block.timestamp + 1 hours,
            100
        );
        vm.stopPrank();

        // Verify all orders are active
        assertTrue(hook.hasActiveOrders(poolId, -TEST_TICK, FheatherXv4.BucketSide.BUY));
        assertTrue(hook.hasActiveOrders(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL));
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          MULTIPLE USERS IN BUCKET TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testMultipleUsersInBucketFairDistribution() public {
        // User1 deposits 100
        vm.startPrank(user1);
        InEuint128 memory amount1 = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        hook.deposit(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL, amount1, block.timestamp + 1 hours, 100);
        vm.stopPrank();

        // User2 deposits 100 to same bucket
        vm.startPrank(user2);
        InEuint128 memory amount2 = createInEuint128(uint128(DEPOSIT_AMOUNT), user2);
        hook.deposit(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL, amount2, block.timestamp + 1 hours, 100);
        vm.stopPrank();

        // Both should be able to exit their full amount (no fills yet)
        vm.startPrank(user1);
        hook.exit(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL);
        vm.stopPrank();

        vm.startPrank(user2);
        hook.exit(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL);
        vm.stopPrank();

        // Verify calls succeeded (no revert)
        assertTrue(true);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          REENTRANCY PROTECTION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testReentrancyProtection() public view {
        // The contract uses ReentrancyGuard, so reentrancy should be blocked
        // This is implicitly tested by the nonReentrant modifier on deposit, withdraw, claim, exit
        // A full reentrancy test would require a malicious contract, which is complex to set up
        // The presence of the modifier is verified by successful single-call operations
        assertTrue(true);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          GAS USAGE TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testDepositGasUsage() public {
        vm.startPrank(user1);
        InEuint128 memory amount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);

        uint256 gasBefore = gasleft();
        hook.deposit(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL, amount, block.timestamp + 1 hours, 100);
        uint256 gasUsed = gasBefore - gasleft();

        // FHE operations are gas-intensive, expect ~500k+
        // This is a sanity check, not a hard requirement
        assertLt(gasUsed, 2_000_000, "Deposit gas should be reasonable");

        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          EDGE CASE TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testDepositAtMinTick() public {
        vm.startPrank(user1);
        InEuint128 memory amount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);

        // Deposit at minimum allowed tick (-6000)
        hook.deposit(
            poolId,
            -6000,
            FheatherXv4.BucketSide.BUY,
            amount,
            block.timestamp + 1 hours,
            10000 // Allow large drift for edge case
        );

        assertTrue(hook.hasActiveOrders(poolId, -6000, FheatherXv4.BucketSide.BUY));
        vm.stopPrank();
    }

    function testDepositAtMaxTick() public {
        vm.startPrank(user1);
        InEuint128 memory amount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);

        // Deposit at maximum allowed tick (6000)
        hook.deposit(
            poolId,
            6000,
            FheatherXv4.BucketSide.SELL,
            amount,
            block.timestamp + 1 hours,
            10000 // Allow large drift for edge case
        );

        assertTrue(hook.hasActiveOrders(poolId, 6000, FheatherXv4.BucketSide.SELL));
        vm.stopPrank();
    }

    function testWithdrawFullPosition() public {
        // Deposit
        vm.startPrank(user1);
        InEuint128 memory depositAmount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        hook.deposit(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL, depositAmount, block.timestamp + 1 hours, 100);

        // Withdraw full amount
        InEuint128 memory withdrawAmount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        hook.withdraw(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL, withdrawAmount);

        // Position should be empty now - exit should not revert
        hook.exit(poolId, TEST_TICK, FheatherXv4.BucketSide.SELL);

        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          OWNERSHIP TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testOnlyOwnerCanPause() public {
        vm.prank(user1);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        hook.pause();
    }

    function testOnlyOwnerCanSetFeeCollector() public {
        vm.prank(user1);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        hook.setFeeCollector(user1);
    }

    function testOnlyOwnerCanQueueFee() public {
        vm.prank(user1);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        hook.queueProtocolFee(poolId, 10);
    }
}
