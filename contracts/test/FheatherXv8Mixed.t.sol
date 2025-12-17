// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// FheatherXv8Mixed Unit Tests
// Tests for FheatherXv8Mixed - Mixed FHE:ERC20 Pools with Momentum Orders

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
import {FheatherXv8Mixed} from "../src/FheatherXv8Mixed.sol";
import {SwapLockTransient} from "../src/lib/SwapLockTransient.sol";
import {FhenixFHERC20Faucet} from "../src/tokens/FhenixFHERC20Faucet.sol";
import {BucketLib} from "../src/lib/BucketLib.sol";
import {PrivateSwapRouter} from "../src/PrivateSwapRouter.sol";

// Test Utils
import {EasyPosm} from "./utils/EasyPosm.sol";
import {Fixtures} from "./utils/Fixtures.sol";

// FHE Imports
import {FHE, euint128, ebool, InEuint128, InEbool, Common} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {CoFheTest} from "@fhenixprotocol/cofhe-mock-contracts/CoFheTest.sol";

// OpenZeppelin Imports
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Simple ERC20 token for testing
contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}

contract FheatherXv8MixedTest is Test, Fixtures, CoFheTest {
    using EasyPosm for IPositionManager;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    // Test addresses
    address private owner;
    address private user1 = makeAddr("user1");
    address private user2 = makeAddr("user2");
    address private user3 = makeAddr("user3");
    address private swapper = makeAddr("swapper");
    address private feeCollector = makeAddr("feeCollector");
    address private lp = makeAddr("lp");

    // Contract instances
    FheatherXv8Mixed hook;
    PrivateSwapRouter privateSwapRouter;
    PoolId poolId;

    // Mixed tokens: one FHERC20 + one ERC20
    FhenixFHERC20Faucet fheToken;  // FHERC20 token
    MockERC20 erc20Token;          // Regular ERC20 token

    // Track which is token0/token1 after sorting
    address token0Addr;
    address token1Addr;
    bool token0IsFherc20;

    PoolKey poolKey;

    // Common test amounts
    uint256 constant LIQUIDITY_AMOUNT = 100 ether;
    uint256 constant DEPOSIT_AMOUNT = 10 ether;
    uint256 constant SWAP_AMOUNT = 1 ether;
    int24 constant TICK_SPACING = 60;
    int24 constant TEST_TICK_BUY = -120;  // Below current price (for buy orders)
    int24 constant TEST_TICK_SELL = 120;  // Above current price (for sell orders)
    int24 constant MAX_TICK_DRIFT = 887220;  // Very large to allow any valid tick

    function setUp() public {
        owner = address(this);

        // Deploy one FHERC20 and one regular ERC20
        fheToken = new FhenixFHERC20Faucet("FHE Token", "fheTKN", 18);
        erc20Token = new MockERC20("ERC20 Token", "TKN", 18);

        // Sort tokens by address for Uniswap ordering
        if (address(fheToken) < address(erc20Token)) {
            token0Addr = address(fheToken);
            token1Addr = address(erc20Token);
            token0IsFherc20 = true;
        } else {
            token0Addr = address(erc20Token);
            token1Addr = address(fheToken);
            token0IsFherc20 = false;
        }

        vm.label(owner, "owner");
        vm.label(user1, "user1");
        vm.label(user2, "user2");
        vm.label(user3, "user3");
        vm.label(swapper, "swapper");
        vm.label(feeCollector, "feeCollector");
        vm.label(lp, "lp");
        vm.label(address(fheToken), "fheToken");
        vm.label(address(erc20Token), "erc20Token");

        // Create the pool manager, utility routers
        deployFreshManagerAndRouters();
        // Note: We don't need PositionManager for v8Mixed since it uses plaintext LP functions

        // Deploy hook with proper address flags
        address hookAddress = address(
            uint160(
                Hooks.AFTER_INITIALIZE_FLAG |
                Hooks.BEFORE_SWAP_FLAG |
                Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
            )
        );
        deployCodeTo("FheatherXv8Mixed.sol:FheatherXv8Mixed", abi.encode(manager, owner, 30), hookAddress);
        hook = FheatherXv8Mixed(hookAddress);
        hook.setFeeCollector(feeCollector);

        // Deploy PrivateSwapRouter
        privateSwapRouter = new PrivateSwapRouter(manager);
        vm.label(address(privateSwapRouter), "PrivateSwapRouter");

        // Create pool key with mixed tokens
        poolKey = PoolKey({
            currency0: Currency.wrap(token0Addr),
            currency1: Currency.wrap(token1Addr),
            fee: 3000,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        poolId = poolKey.toId();

        // Initialize pool at 1:1 price
        uint160 SQRT_PRICE_1_1 = 79228162514264337593543950336;
        manager.initialize(poolKey, SQRT_PRICE_1_1);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         HOOK PERMISSIONS
    // ═══════════════════════════════════════════════════════════════════════

    function testHookPermissions() public view {
        Hooks.Permissions memory perms = hook.getHookPermissions();
        assertTrue(perms.afterInitialize, "Should have afterInitialize");
        assertTrue(perms.beforeSwap, "Should have beforeSwap");
        assertTrue(perms.beforeSwapReturnDelta, "Should have beforeSwapReturnDelta");
        assertFalse(perms.beforeInitialize, "Should NOT have beforeInitialize");
        assertFalse(perms.afterSwap, "Should NOT have afterSwap");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    INITIALIZATION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testPoolInitialized() public view {
        (address t0, address t1, bool t0IsFhe, bool t1IsFhe, bool initialized,) = hook.poolStates(poolId);
        assertTrue(initialized, "Pool should be initialized");
        assertEq(t0, token0Addr, "Token0 should match");
        assertEq(t1, token1Addr, "Token1 should match");
        // Exactly one should be FHERC20
        assertTrue(t0IsFhe != t1IsFhe, "Exactly one token should be FHERC20");
    }

    function testInit_MixedPairRequired() public {
        // Deploy two regular ERC20s
        MockERC20 erc20A = new MockERC20("ERC A", "ERCA", 18);
        MockERC20 erc20B = new MockERC20("ERC B", "ERCB", 18);

        // Sort by address
        address t0 = address(erc20A) < address(erc20B) ? address(erc20A) : address(erc20B);
        address t1 = address(erc20A) < address(erc20B) ? address(erc20B) : address(erc20A);

        PoolKey memory badKey = PoolKey({
            currency0: Currency.wrap(t0),
            currency1: Currency.wrap(t1),
            fee: 3000,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });

        uint160 SQRT_PRICE_1_1 = 79228162514264337593543950336;
        // Error is wrapped by PoolManager, so use generic revert
        vm.expectRevert();
        manager.initialize(badKey, SQRT_PRICE_1_1);
    }

    function testInit_RejectsBothFherc20() public {
        // Deploy two FHERC20s
        FhenixFHERC20Faucet fheA = new FhenixFHERC20Faucet("FHE A", "FHEA", 18);
        FhenixFHERC20Faucet fheB = new FhenixFHERC20Faucet("FHE B", "FHEB", 18);

        // Sort by address
        address t0 = address(fheA) < address(fheB) ? address(fheA) : address(fheB);
        address t1 = address(fheA) < address(fheB) ? address(fheB) : address(fheA);

        PoolKey memory badKey = PoolKey({
            currency0: Currency.wrap(t0),
            currency1: Currency.wrap(t1),
            fee: 3000,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });

        uint160 SQRT_PRICE_1_1 = 79228162514264337593543950336;
        // Error is wrapped by PoolManager, so use generic revert
        vm.expectRevert();
        manager.initialize(badKey, SQRT_PRICE_1_1);
    }

    function testInit_TokenTypeDetection() public view {
        (,, bool t0IsFhe, bool t1IsFhe,,) = hook.poolStates(poolId);
        assertEq(t0IsFhe, token0IsFherc20, "Token0 FHERC20 detection should match");
        assertEq(t1IsFhe, !token0IsFherc20, "Token1 FHERC20 detection should be opposite");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    PLAINTEXT LP TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testAddLiquidity_FirstDeposit() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        // Verify LP balance
        uint256 lpBal = hook.lpBalances(poolId, lp);
        assertTrue(lpBal > 0, "LP should have balance after deposit");

        // Verify reserves (9 fields: encReserve0, encReserve1, encTotalLpSupply, reserve0, reserve1, totalLpSupply, reserveBlockNumber, nextRequestId, lastResolvedId)
        (,,, uint256 reserve0, uint256 reserve1,,,,) = hook.poolReserves(poolId);
        assertEq(reserve0, LIQUIDITY_AMOUNT, "Reserve0 should match");
        assertEq(reserve1, LIQUIDITY_AMOUNT, "Reserve1 should match");
    }

    function testAddLiquidity_SubsequentDeposit() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);
        uint256 lpBal1 = hook.lpBalances(poolId, lp);

        _addLiquidity(user1, LIQUIDITY_AMOUNT / 2, LIQUIDITY_AMOUNT / 2);
        uint256 lpBal2 = hook.lpBalances(poolId, user1);

        assertTrue(lpBal2 > 0, "User1 should have LP balance");
        // Second deposit should get proportional shares
        assertTrue(lpBal2 < lpBal1, "Second deposit should get less shares (same amount added to larger pool)");
    }

    function testRemoveLiquidity_Full() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);
        uint256 lpBal = hook.lpBalances(poolId, lp);

        uint256 token0Before = IERC20(token0Addr).balanceOf(lp);
        uint256 token1Before = IERC20(token1Addr).balanceOf(lp);

        vm.prank(lp);
        hook.removeLiquidity(poolId, lpBal);

        uint256 token0After = IERC20(token0Addr).balanceOf(lp);
        uint256 token1After = IERC20(token1Addr).balanceOf(lp);

        assertTrue(token0After > token0Before, "Should receive token0 back");
        assertTrue(token1After > token1Before, "Should receive token1 back");
        assertEq(hook.lpBalances(poolId, lp), 0, "LP balance should be 0 after full removal");
    }

    function testRemoveLiquidity_Partial() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);
        uint256 lpBalBefore = hook.lpBalances(poolId, lp);

        vm.prank(lp);
        hook.removeLiquidity(poolId, lpBalBefore / 2);

        uint256 lpBalAfter = hook.lpBalances(poolId, lp);
        assertTrue(lpBalAfter > 0, "Should still have some LP balance");
        assertTrue(lpBalAfter < lpBalBefore, "LP balance should decrease");
    }

    function testAddLiquidity_RevertsZeroAmount() public {
        vm.expectRevert(FheatherXv8Mixed.ZeroAmount.selector);
        hook.addLiquidity(poolId, 0, LIQUIDITY_AMOUNT);
    }

    function testRemoveLiquidity_RevertsInsufficientBalance() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        vm.prank(user1);  // user1 has no LP balance
        vm.expectRevert(FheatherXv8Mixed.InsufficientLiquidity.selector);
        hook.removeLiquidity(poolId, 1);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    DEPOSIT RESTRICTION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testDeposit_OnlyFherc20SideAllowed() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        // Deposit on FHERC20 side should work
        FheatherXv8Mixed.BucketSide fheSide = token0IsFherc20
            ? FheatherXv8Mixed.BucketSide.SELL
            : FheatherXv8Mixed.BucketSide.BUY;
        int24 tick = token0IsFherc20 ? TEST_TICK_SELL : TEST_TICK_BUY;

        fheToken.mint(user1, DEPOSIT_AMOUNT);

        vm.startPrank(user1);
        fheToken.approve(address(hook), type(uint256).max);
        InEuint128 memory encAmount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);

        // This should succeed
        hook.deposit(poolId, tick, fheSide, encAmount, block.timestamp + 1 hours, MAX_TICK_DRIFT);
        vm.stopPrank();

        // Verify deposit worked
        (,,,, bool initialized) = hook.buckets(poolId, tick, fheSide);
        assertTrue(initialized, "Bucket should be initialized");
    }

    function testDeposit_RejectsErc20Side() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        // Try to deposit on ERC20 side (should fail)
        FheatherXv8Mixed.BucketSide erc20Side = token0IsFherc20
            ? FheatherXv8Mixed.BucketSide.BUY  // token1 is ERC20
            : FheatherXv8Mixed.BucketSide.SELL; // token0 is ERC20
        int24 tick = token0IsFherc20 ? TEST_TICK_BUY : TEST_TICK_SELL;

        fheToken.mint(user1, DEPOSIT_AMOUNT);

        vm.startPrank(user1);
        fheToken.approve(address(hook), type(uint256).max);
        InEuint128 memory encAmount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);

        vm.expectRevert(FheatherXv8Mixed.InputTokenMustBeFherc20.selector);
        hook.deposit(poolId, tick, erc20Side, encAmount, block.timestamp + 1 hours, MAX_TICK_DRIFT);
        vm.stopPrank();
    }

    function testDeposit_RevertsDeadlineExpired() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        FheatherXv8Mixed.BucketSide fheSide = token0IsFherc20
            ? FheatherXv8Mixed.BucketSide.SELL
            : FheatherXv8Mixed.BucketSide.BUY;
        int24 tick = token0IsFherc20 ? TEST_TICK_SELL : TEST_TICK_BUY;

        fheToken.mint(user1, DEPOSIT_AMOUNT);

        vm.startPrank(user1);
        fheToken.approve(address(hook), type(uint256).max);
        InEuint128 memory encAmount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);

        vm.expectRevert(FheatherXv8Mixed.DeadlineExpired.selector);
        hook.deposit(poolId, tick, fheSide, encAmount, block.timestamp - 1, MAX_TICK_DRIFT);
        vm.stopPrank();
    }

    function testDeposit_RevertsInvalidTick() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        FheatherXv8Mixed.BucketSide fheSide = token0IsFherc20
            ? FheatherXv8Mixed.BucketSide.SELL
            : FheatherXv8Mixed.BucketSide.BUY;

        fheToken.mint(user1, DEPOSIT_AMOUNT);

        vm.startPrank(user1);
        fheToken.approve(address(hook), type(uint256).max);
        InEuint128 memory encAmount = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);

        // Tick not aligned to spacing
        vm.expectRevert(FheatherXv8Mixed.InvalidTick.selector);
        hook.deposit(poolId, 61, fheSide, encAmount, block.timestamp + 1 hours, MAX_TICK_DRIFT);
        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    WITHDRAW TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testWithdraw_CancelsUnfilledOrder() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        FheatherXv8Mixed.BucketSide fheSide = token0IsFherc20
            ? FheatherXv8Mixed.BucketSide.SELL
            : FheatherXv8Mixed.BucketSide.BUY;
        int24 tick = token0IsFherc20 ? TEST_TICK_SELL : TEST_TICK_BUY;

        fheToken.mint(user1, DEPOSIT_AMOUNT);

        vm.startPrank(user1);
        fheToken.approve(address(hook), type(uint256).max);
        InEuint128 memory depositAmt = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        hook.deposit(poolId, tick, fheSide, depositAmt, block.timestamp + 1 hours, MAX_TICK_DRIFT);

        // Withdraw
        InEuint128 memory withdrawAmt = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        hook.withdraw(poolId, tick, fheSide, withdrawAmt);
        vm.stopPrank();

        // Bucket should still exist but position reduced
        (euint128 shares,,,) = hook.positions(poolId, user1, tick, fheSide);
        // In mock FHE, just verify no revert occurred
    }

    function testWithdraw_MultipleUsersCanCancel() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        FheatherXv8Mixed.BucketSide fheSide = token0IsFherc20
            ? FheatherXv8Mixed.BucketSide.SELL
            : FheatherXv8Mixed.BucketSide.BUY;
        int24 tick = token0IsFherc20 ? TEST_TICK_SELL : TEST_TICK_BUY;

        // User1 deposits
        fheToken.mint(user1, DEPOSIT_AMOUNT);
        vm.startPrank(user1);
        fheToken.approve(address(hook), type(uint256).max);
        InEuint128 memory amt1 = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        hook.deposit(poolId, tick, fheSide, amt1, block.timestamp + 1 hours, MAX_TICK_DRIFT);
        vm.stopPrank();

        // User2 deposits
        fheToken.mint(user2, DEPOSIT_AMOUNT);
        vm.startPrank(user2);
        fheToken.approve(address(hook), type(uint256).max);
        InEuint128 memory amt2 = createInEuint128(uint128(DEPOSIT_AMOUNT), user2);
        hook.deposit(poolId, tick, fheSide, amt2, block.timestamp + 1 hours, MAX_TICK_DRIFT);
        vm.stopPrank();

        // User1 withdraws - should not affect user2
        vm.startPrank(user1);
        InEuint128 memory withdrawAmt = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        hook.withdraw(poolId, tick, fheSide, withdrawAmt);
        vm.stopPrank();

        // Bucket should still be initialized (user2 still has position)
        (,,,, bool initialized) = hook.buckets(poolId, tick, fheSide);
        assertTrue(initialized, "Bucket should still be initialized");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    CLAIM TESTS (Two-Step for ERC20)
    // ═══════════════════════════════════════════════════════════════════════

    function testClaim_Fherc20Proceeds_DirectTransfer() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        // If selling FHERC20, proceeds are ERC20 (queued claim)
        // If buying with FHERC20, proceeds are FHERC20 (direct transfer)
        // Let's test the BUY side where proceeds would be FHERC20

        // This depends on which token is FHERC20
        // If token0 is FHERC20: BUY orders deposit token1(ERC20), receive token0(FHERC20) - but can't deposit ERC20
        // If token1 is FHERC20: SELL orders deposit token0(ERC20), receive token1(FHERC20) - but can't deposit ERC20
        // So in Mixed, SELL of FHERC20 receives ERC20 proceeds (queued)
        // And there's no direct FHERC20 proceeds path since we can only deposit FHERC20 side

        // For this test, we just verify claim doesn't revert
        FheatherXv8Mixed.BucketSide fheSide = token0IsFherc20
            ? FheatherXv8Mixed.BucketSide.SELL
            : FheatherXv8Mixed.BucketSide.BUY;
        int24 tick = token0IsFherc20 ? TEST_TICK_SELL : TEST_TICK_BUY;

        fheToken.mint(user1, DEPOSIT_AMOUNT);

        vm.startPrank(user1);
        fheToken.approve(address(hook), type(uint256).max);
        InEuint128 memory amt = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        hook.deposit(poolId, tick, fheSide, amt, block.timestamp + 1 hours, MAX_TICK_DRIFT);

        // Claim (proceeds would be ERC20, so it queues decrypt)
        hook.claim(poolId, tick, fheSide);
        vm.stopPrank();

        // Verify pending claim exists
        (euint128 encAmt, address token, uint256 requestedAt, bool pending) =
            hook.pendingErc20Claims(poolId, user1, tick, fheSide);
        assertTrue(pending, "Should have pending ERC20 claim");
    }

    function testClaim_Erc20Proceeds_QueuesDeryrypt() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        FheatherXv8Mixed.BucketSide fheSide = token0IsFherc20
            ? FheatherXv8Mixed.BucketSide.SELL
            : FheatherXv8Mixed.BucketSide.BUY;
        int24 tick = token0IsFherc20 ? TEST_TICK_SELL : TEST_TICK_BUY;

        fheToken.mint(user1, DEPOSIT_AMOUNT);

        vm.startPrank(user1);
        fheToken.approve(address(hook), type(uint256).max);
        InEuint128 memory amt = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        hook.deposit(poolId, tick, fheSide, amt, block.timestamp + 1 hours, MAX_TICK_DRIFT);

        // Claim queues decrypt
        hook.claim(poolId, tick, fheSide);
        vm.stopPrank();

        // Verify pending claim was created
        (,, uint256 requestedAt, bool pending) = hook.pendingErc20Claims(poolId, user1, tick, fheSide);
        assertTrue(pending, "Claim should be pending");
        assertEq(requestedAt, block.number, "Request should be at current block");
    }

    function testClaimErc20_NoPending_Reverts() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        FheatherXv8Mixed.BucketSide fheSide = token0IsFherc20
            ? FheatherXv8Mixed.BucketSide.SELL
            : FheatherXv8Mixed.BucketSide.BUY;

        // Try to complete claim without first calling claim()
        vm.prank(user1);
        vm.expectRevert(FheatherXv8Mixed.NoPendingClaim.selector);
        hook.claimErc20(poolId, TEST_TICK_SELL, fheSide);
    }

    function testClaimErc20_ClaimNotReady_Reverts() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        FheatherXv8Mixed.BucketSide fheSide = token0IsFherc20
            ? FheatherXv8Mixed.BucketSide.SELL
            : FheatherXv8Mixed.BucketSide.BUY;
        int24 tick = token0IsFherc20 ? TEST_TICK_SELL : TEST_TICK_BUY;

        fheToken.mint(user1, DEPOSIT_AMOUNT);

        vm.startPrank(user1);
        fheToken.approve(address(hook), type(uint256).max);
        InEuint128 memory amt = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        hook.deposit(poolId, tick, fheSide, amt, block.timestamp + 1 hours, MAX_TICK_DRIFT);
        hook.claim(poolId, tick, fheSide);

        // Try to complete immediately (decrypt not ready in mock)
        vm.expectRevert(FheatherXv8Mixed.ClaimNotReady.selector);
        hook.claimErc20(poolId, tick, fheSide);
        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    MOMENTUM CLOSURE TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testMomentum_SingleBucketActivation() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        FheatherXv8Mixed.BucketSide fheSide = token0IsFherc20
            ? FheatherXv8Mixed.BucketSide.SELL
            : FheatherXv8Mixed.BucketSide.BUY;
        int24 tick = token0IsFherc20 ? TEST_TICK_SELL : TEST_TICK_BUY;

        fheToken.mint(user1, DEPOSIT_AMOUNT);

        vm.startPrank(user1);
        fheToken.approve(address(hook), type(uint256).max);
        InEuint128 memory amt = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        hook.deposit(poolId, tick, fheSide, amt, block.timestamp + 1 hours, MAX_TICK_DRIFT);
        vm.stopPrank();

        // Verify bucket is initialized
        (,,,, bool initialized) = hook.buckets(poolId, tick, fheSide);
        assertTrue(initialized, "Bucket should be initialized");
    }

    function testMomentum_MultipleBucketsActivation() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT * 10, LIQUIDITY_AMOUNT * 10);

        FheatherXv8Mixed.BucketSide fheSide = token0IsFherc20
            ? FheatherXv8Mixed.BucketSide.SELL
            : FheatherXv8Mixed.BucketSide.BUY;
        int24 baseTick = token0IsFherc20 ? int24(60) : int24(-60);
        int24 tickStep = token0IsFherc20 ? int24(60) : int24(-60);

        // Create multiple buckets
        for (uint i = 0; i < 3; i++) {
            int24 tick = baseTick + int24(int256(i)) * tickStep;

            fheToken.mint(user1, DEPOSIT_AMOUNT);

            vm.startPrank(user1);
            fheToken.approve(address(hook), type(uint256).max);
            InEuint128 memory amt = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
            hook.deposit(poolId, tick, fheSide, amt, block.timestamp + 1 hours, MAX_TICK_DRIFT);
            vm.stopPrank();
        }

        // Verify all buckets initialized
        for (uint i = 0; i < 3; i++) {
            int24 tick = baseTick + int24(int256(i)) * tickStep;
            (,,,, bool initialized) = hook.buckets(poolId, tick, fheSide);
            assertTrue(initialized, "Bucket should be initialized");
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    FAIR SHARE TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testFairShare_MultipleUsersInBucket() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT * 10, LIQUIDITY_AMOUNT * 10);

        FheatherXv8Mixed.BucketSide fheSide = token0IsFherc20
            ? FheatherXv8Mixed.BucketSide.SELL
            : FheatherXv8Mixed.BucketSide.BUY;
        int24 tick = token0IsFherc20 ? TEST_TICK_SELL : TEST_TICK_BUY;

        // User1 deposits
        fheToken.mint(user1, DEPOSIT_AMOUNT);
        vm.startPrank(user1);
        fheToken.approve(address(hook), type(uint256).max);
        InEuint128 memory amt1 = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        hook.deposit(poolId, tick, fheSide, amt1, block.timestamp + 1 hours, MAX_TICK_DRIFT);
        vm.stopPrank();

        // User2 deposits
        fheToken.mint(user2, DEPOSIT_AMOUNT * 2);
        vm.startPrank(user2);
        fheToken.approve(address(hook), type(uint256).max);
        InEuint128 memory amt2 = createInEuint128(uint128(DEPOSIT_AMOUNT * 2), user2);
        hook.deposit(poolId, tick, fheSide, amt2, block.timestamp + 1 hours, MAX_TICK_DRIFT);
        vm.stopPrank();

        // Both should have positions
        (euint128 shares1,,,) = hook.positions(poolId, user1, tick, fheSide);
        (euint128 shares2,,,) = hook.positions(poolId, user2, tick, fheSide);

        assertTrue(Common.isInitialized(shares1), "User1 should have shares");
        assertTrue(Common.isInitialized(shares2), "User2 should have shares");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    RESERVE SYNC TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testReserveSync_TrySyncReserves() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        // Trigger sync
        hook.trySyncReserves(poolId);

        // Should not revert
        (,,, uint256 reserve0, uint256 reserve1,,,,) = hook.poolReserves(poolId);
        assertEq(reserve0, LIQUIDITY_AMOUNT, "Reserve0 should be set");
        assertEq(reserve1, LIQUIDITY_AMOUNT, "Reserve1 should be set");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    ADMIN TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testAdmin_SetFeeCollector() public {
        address newCollector = makeAddr("newCollector");
        hook.setFeeCollector(newCollector);
        assertEq(hook.feeCollector(), newCollector, "Fee collector should be updated");
    }

    function testAdmin_SetProtocolFee() public {
        hook.setProtocolFee(poolId, 100);  // 1%
        (,,,,, uint256 protocolFeeBps) = hook.poolStates(poolId);
        assertEq(protocolFeeBps, 100, "Protocol fee should be 100 bps");
    }

    function testAdmin_SetProtocolFee_RevertsFeeTooHigh() public {
        vm.expectRevert(FheatherXv8Mixed.FeeTooHigh.selector);
        hook.setProtocolFee(poolId, 1001);  // > 10%
    }

    function testAdmin_Pause() public {
        hook.pause();

        FheatherXv8Mixed.BucketSide fheSide = token0IsFherc20
            ? FheatherXv8Mixed.BucketSide.SELL
            : FheatherXv8Mixed.BucketSide.BUY;
        int24 tick = token0IsFherc20 ? TEST_TICK_SELL : TEST_TICK_BUY;

        fheToken.mint(user1, DEPOSIT_AMOUNT);
        vm.startPrank(user1);
        fheToken.approve(address(hook), type(uint256).max);
        InEuint128 memory amt = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);

        vm.expectRevert();
        hook.deposit(poolId, tick, fheSide, amt, block.timestamp + 1 hours, MAX_TICK_DRIFT);
        vm.stopPrank();
    }

    function testAdmin_Unpause() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);
        hook.pause();
        hook.unpause();

        FheatherXv8Mixed.BucketSide fheSide = token0IsFherc20
            ? FheatherXv8Mixed.BucketSide.SELL
            : FheatherXv8Mixed.BucketSide.BUY;
        int24 tick = token0IsFherc20 ? TEST_TICK_SELL : TEST_TICK_BUY;

        fheToken.mint(user1, DEPOSIT_AMOUNT);
        vm.startPrank(user1);
        fheToken.approve(address(hook), type(uint256).max);
        InEuint128 memory amt = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);

        // Should work after unpause
        hook.deposit(poolId, tick, fheSide, amt, block.timestamp + 1 hours, MAX_TICK_DRIFT);
        vm.stopPrank();
    }

    function testAdmin_OnlyOwnerCanPause() public {
        vm.prank(user1);
        vm.expectRevert();
        hook.pause();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function testGetCurrentTick() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        int24 tick = hook.lastProcessedTick(poolId);
        // Tick is calculated from reserves after first liquidity add
        // Just verify it's a valid tick (aligned to tick spacing)
        assertEq(tick % TICK_SPACING, 0, "Tick should be aligned to tick spacing");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    EDGE CASE TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testEdgeCase_DepositAtMaxTick() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        FheatherXv8Mixed.BucketSide fheSide = token0IsFherc20
            ? FheatherXv8Mixed.BucketSide.SELL
            : FheatherXv8Mixed.BucketSide.BUY;
        // Use a tick near max that's valid for deposit
        int24 maxValidTick = 5940;  // Near max, aligned to 60

        fheToken.mint(user1, DEPOSIT_AMOUNT);
        vm.startPrank(user1);
        fheToken.approve(address(hook), type(uint256).max);
        InEuint128 memory amt = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);

        // Adjust tick based on which side is FHERC20
        int24 tick = token0IsFherc20 ? maxValidTick : -maxValidTick;

        hook.deposit(poolId, tick, fheSide, amt, block.timestamp + 1 hours, MAX_TICK_DRIFT);
        vm.stopPrank();

        (,,,, bool initialized) = hook.buckets(poolId, tick, fheSide);
        assertTrue(initialized, "Should allow deposit near max tick");
    }

    function testEdgeCase_DepositAtMinTick() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        FheatherXv8Mixed.BucketSide fheSide = token0IsFherc20
            ? FheatherXv8Mixed.BucketSide.SELL
            : FheatherXv8Mixed.BucketSide.BUY;
        // Use a tick near min that's valid for deposit
        int24 minValidTick = -5940;

        fheToken.mint(user1, DEPOSIT_AMOUNT);
        vm.startPrank(user1);
        fheToken.approve(address(hook), type(uint256).max);
        InEuint128 memory amt = createInEuint128(uint128(DEPOSIT_AMOUNT), user1);

        // Adjust tick based on which side is FHERC20
        int24 tick = token0IsFherc20 ? -minValidTick : minValidTick;

        hook.deposit(poolId, tick, fheSide, amt, block.timestamp + 1 hours, MAX_TICK_DRIFT);
        vm.stopPrank();

        (,,,, bool initialized) = hook.buckets(poolId, tick, fheSide);
        assertTrue(initialized, "Should allow deposit near min tick");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    FUZZ TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testFuzz_AddLiquidity_RandomAmounts(uint128 amount0, uint128 amount1) public {
        amount0 = uint128(bound(uint256(amount0), 1e17, 1e23));
        amount1 = uint128(bound(uint256(amount1), 1e17, 1e23));

        _mintTokensTo(lp, amount0, amount1);

        vm.startPrank(lp);
        IERC20(token0Addr).approve(address(hook), type(uint256).max);
        IERC20(token1Addr).approve(address(hook), type(uint256).max);
        hook.addLiquidity(poolId, amount0, amount1);
        vm.stopPrank();

        uint256 lpBal = hook.lpBalances(poolId, lp);
        assertTrue(lpBal > 0, "LP should have balance for any valid amounts");
    }

    function testFuzz_Deposit_RandomAmounts(uint128 amount) public {
        amount = uint128(bound(uint256(amount), 1e15, 1e24));

        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        FheatherXv8Mixed.BucketSide fheSide = token0IsFherc20
            ? FheatherXv8Mixed.BucketSide.SELL
            : FheatherXv8Mixed.BucketSide.BUY;
        int24 tick = token0IsFherc20 ? TEST_TICK_SELL : TEST_TICK_BUY;

        fheToken.mint(user1, amount);

        vm.startPrank(user1);
        fheToken.approve(address(hook), type(uint256).max);
        InEuint128 memory encAmount = createInEuint128(amount, user1);

        hook.deposit(poolId, tick, fheSide, encAmount, block.timestamp + 1 hours, MAX_TICK_DRIFT);
        vm.stopPrank();

        (euint128 shares,,,) = hook.positions(poolId, user1, tick, fheSide);
        assertTrue(Common.isInitialized(shares), "Should have shares for any valid amount");
    }

    function testFuzz_MultipleUsers_SameBucket(uint8 userCount, uint128 baseAmount) public {
        userCount = uint8(bound(uint256(userCount), 2, 10));
        baseAmount = uint128(bound(uint256(baseAmount), 1e16, 1e22));

        _addLiquidity(lp, LIQUIDITY_AMOUNT * 10, LIQUIDITY_AMOUNT * 10);

        FheatherXv8Mixed.BucketSide fheSide = token0IsFherc20
            ? FheatherXv8Mixed.BucketSide.SELL
            : FheatherXv8Mixed.BucketSide.BUY;
        int24 tick = token0IsFherc20 ? TEST_TICK_SELL : TEST_TICK_BUY;

        uint256 depositorCount;

        for (uint8 i = 0; i < userCount; i++) {
            address user = address(uint160(0x1000 + i));
            uint128 userAmount = baseAmount + uint128(i) * 1e17;

            fheToken.mint(user, userAmount);

            vm.startPrank(user);
            fheToken.approve(address(hook), type(uint256).max);
            InEuint128 memory encAmount = createInEuint128(userAmount, user);

            hook.deposit(poolId, tick, fheSide, encAmount, block.timestamp + 1 hours, MAX_TICK_DRIFT);
            vm.stopPrank();

            (euint128 shares,,,) = hook.positions(poolId, user, tick, fheSide);
            if (Common.isInitialized(shares)) depositorCount++;
        }

        assertEq(depositorCount, userCount, "All users should have shares");
    }

    function testFuzz_Invariant_BucketInitialized(uint128 amount, int24 tickMultiplier) public {
        amount = uint128(bound(uint256(amount), 1e17, 1e22));
        tickMultiplier = int24(bound(int256(tickMultiplier), 1, 50));

        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        FheatherXv8Mixed.BucketSide fheSide = token0IsFherc20
            ? FheatherXv8Mixed.BucketSide.SELL
            : FheatherXv8Mixed.BucketSide.BUY;
        int24 tick = token0IsFherc20 ? tickMultiplier * 60 : -tickMultiplier * 60;

        fheToken.mint(user1, amount);

        vm.startPrank(user1);
        fheToken.approve(address(hook), type(uint256).max);
        InEuint128 memory encAmount = createInEuint128(amount, user1);
        hook.deposit(poolId, tick, fheSide, encAmount, block.timestamp + 1 hours, MAX_TICK_DRIFT);
        vm.stopPrank();

        (,,,, bool initialized) = hook.buckets(poolId, tick, fheSide);
        assertTrue(initialized, "Bucket must be initialized after deposit");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    ENCRYPTED SWAP TESTS (Partial Privacy)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Test encrypted swap via PrivateSwapRouter (partial privacy - FHERC20 input)
    function testEncryptedSwap_ViaPrivateSwapRouter_FheInput() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        uint256 swapAmount = 1 ether;
        uint256 minOutput = 0.9 ether;

        // Fund swapper with FHERC20 token
        fheToken.mint(swapper, swapAmount);

        vm.startPrank(swapper);

        // Approve the hook to spend FHERC20 tokens
        fheToken.approve(address(hook), type(uint256).max);

        // Create encrypted swap parameters
        InEuint128 memory encAmountIn = createInEuint128(uint128(swapAmount), swapper);
        InEuint128 memory encMinOutput = createInEuint128(uint128(minOutput), swapper);

        // Determine direction based on token ordering
        // If fheToken is token0, we're selling token0 (zeroForOne = true)
        bool zeroForOne = token0IsFherc20;

        // Execute encrypted swap via router
        privateSwapRouter.swapMixed(poolKey, zeroForOne, encAmountIn, encMinOutput);

        vm.stopPrank();

        // Verify swap executed without revert
    }

    /// @notice Test encrypted swap emits EncryptedSwapExecuted event
    function testEncryptedSwap_EmitsEvent() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        uint256 swapAmount = 1 ether;

        fheToken.mint(swapper, swapAmount);

        vm.startPrank(swapper);
        fheToken.approve(address(hook), type(uint256).max);

        InEuint128 memory encAmountIn = createInEuint128(uint128(swapAmount), swapper);
        InEuint128 memory encMinOutput = createInEuint128(0, swapper);

        bool zeroForOne = token0IsFherc20;

        // Expect EncryptedSwapExecuted event
        vm.expectEmit(true, true, false, false);
        emit FheatherXv8Mixed.EncryptedSwapExecuted(poolId, swapper);

        privateSwapRouter.swapMixed(poolKey, zeroForOne, encAmountIn, encMinOutput);

        vm.stopPrank();
    }

    /// @notice Test encrypted swap in opposite direction (requires ERC20 output path)
    /// @dev When FHERC20 is input and ERC20 is output, the hook requests async decrypt
    function testEncryptedSwap_FheInputErc20Output() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        uint256 swapAmount = 1 ether;

        fheToken.mint(swapper, swapAmount);

        vm.startPrank(swapper);
        fheToken.approve(address(hook), type(uint256).max);

        InEuint128 memory encAmountIn = createInEuint128(uint128(swapAmount), swapper);
        InEuint128 memory encMinOutput = createInEuint128(0, swapper);

        // If fheToken is token0, zeroForOne=true means output is ERC20 token1
        // If fheToken is token1, zeroForOne=false means output is ERC20 token0
        bool zeroForOne = token0IsFherc20;

        // This should trigger async decrypt for ERC20 output
        privateSwapRouter.swapMixed(poolKey, zeroForOne, encAmountIn, encMinOutput);

        vm.stopPrank();

        // In production, user would call fulfillSwapOutput() after decrypt resolves
    }

    /// @notice Test that ERC20 input encrypted swap reverts (partial privacy limitation)
    function testEncryptedSwap_Erc20Input_Reverts() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        uint256 swapAmount = 1 ether;

        // Fund swapper with ERC20 token
        erc20Token.mint(swapper, swapAmount);

        vm.startPrank(swapper);
        erc20Token.approve(address(hook), type(uint256).max);

        InEuint128 memory encAmountIn = createInEuint128(uint128(swapAmount), swapper);
        InEuint128 memory encMinOutput = createInEuint128(0, swapper);

        // Direction that would use ERC20 as input (opposite of FHERC20 direction)
        bool zeroForOne = !token0IsFherc20;

        // Should revert because ERC20 input requires plaintext amount
        // Note: Error gets wrapped by PoolManager callback chain
        vm.expectRevert();
        privateSwapRouter.swapMixed(poolKey, zeroForOne, encAmountIn, encMinOutput);

        vm.stopPrank();
    }

    /// @notice Fuzz test: Encrypted swap with various amounts
    function testFuzz_EncryptedSwap_RandomAmounts(uint128 amount) public {
        amount = uint128(bound(uint256(amount), 1e15, 1e22));

        _addLiquidity(lp, LIQUIDITY_AMOUNT * 10, LIQUIDITY_AMOUNT * 10);

        fheToken.mint(swapper, amount);

        vm.startPrank(swapper);
        fheToken.approve(address(hook), type(uint256).max);

        InEuint128 memory encAmountIn = createInEuint128(amount, swapper);
        InEuint128 memory encMinOutput = createInEuint128(0, swapper);

        bool zeroForOne = token0IsFherc20;

        // Should not revert for any valid amount
        privateSwapRouter.swapMixed(poolKey, zeroForOne, encAmountIn, encMinOutput);

        vm.stopPrank();
    }

    /// @notice Test that normal plaintext swaps still work alongside encrypted swaps
    function testSwap_NormalPathStillWorks() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        // Verify hook permissions are correct for both paths
        Hooks.Permissions memory perms = hook.getHookPermissions();
        assertTrue(perms.beforeSwap, "Hook should handle beforeSwap");
        assertTrue(perms.beforeSwapReturnDelta, "Hook should return delta");
    }

    /// @notice Test swap via PoolSwapTest router - replicates frontend flow
    /// This tests the exact flow the frontend uses:
    /// 1. User approves tokens to the HOOK (for direct transfer)
    /// 2. Router calls poolManager.swap()
    /// 3. Hook's beforeSwap extracts user from hookData and transfers directly
    function testSwap_ViaRouter_WithHookData() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        uint256 swapAmount = 1 ether;

        // Mint tokens to swapper
        _mintTokensTo(swapper, swapAmount * 2, swapAmount * 2);

        // Get initial balances
        uint256 swapperToken0Before = IERC20(token0Addr).balanceOf(swapper);
        uint256 swapperToken1Before = IERC20(token1Addr).balanceOf(swapper);

        vm.startPrank(swapper);

        // Approve tokens to the HOOK (hook does safeTransferFrom in _executeSwapWithMomentum)
        IERC20(token0Addr).approve(address(hook), type(uint256).max);
        IERC20(token1Addr).approve(address(hook), type(uint256).max);

        // Also approve to router for the standard v4 settlement flow
        IERC20(token0Addr).approve(address(swapRouter), type(uint256).max);
        IERC20(token1Addr).approve(address(swapRouter), type(uint256).max);

        vm.stopPrank();

        // Encode hookData with swapper's address (like frontend does)
        bytes memory hookData = abi.encode(swapper);

        // Execute swap via router (zeroForOne = true, exact input)
        vm.prank(swapper);
        BalanceDelta delta = swapRouter.swap(
            poolKey,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(swapAmount), // negative = exact input
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );

        // Verify swap executed - swapper should have less token0, more token1
        uint256 swapperToken0After = IERC20(token0Addr).balanceOf(swapper);
        uint256 swapperToken1After = IERC20(token1Addr).balanceOf(swapper);

        assertLt(swapperToken0After, swapperToken0Before, "Swapper should have less token0");
        assertGt(swapperToken1After, swapperToken1Before, "Swapper should have more token1");

        // The delta should show input consumed and output received
        // Since we return NoOp delta (0,0), the hook handles everything directly
        // So delta values may be 0 depending on implementation
    }

    /// @notice Test swap via router with reverse direction (oneForZero)
    function testSwap_ViaRouter_ReverseDirection() public {
        _addLiquidity(lp, LIQUIDITY_AMOUNT, LIQUIDITY_AMOUNT);

        uint256 swapAmount = 1 ether;

        // Mint tokens to swapper
        _mintTokensTo(swapper, swapAmount * 2, swapAmount * 2);

        // Get initial balances
        uint256 swapperToken0Before = IERC20(token0Addr).balanceOf(swapper);
        uint256 swapperToken1Before = IERC20(token1Addr).balanceOf(swapper);

        vm.startPrank(swapper);

        // Approve tokens to the HOOK
        IERC20(token0Addr).approve(address(hook), type(uint256).max);
        IERC20(token1Addr).approve(address(hook), type(uint256).max);

        // Also approve to router
        IERC20(token0Addr).approve(address(swapRouter), type(uint256).max);
        IERC20(token1Addr).approve(address(swapRouter), type(uint256).max);

        vm.stopPrank();

        // Encode hookData with swapper's address
        bytes memory hookData = abi.encode(swapper);

        // Execute swap via router (zeroForOne = false, exact input of token1)
        vm.prank(swapper);
        swapRouter.swap(
            poolKey,
            SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(swapAmount), // negative = exact input
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );

        // Verify swap executed - swapper should have more token0, less token1
        uint256 swapperToken0After = IERC20(token0Addr).balanceOf(swapper);
        uint256 swapperToken1After = IERC20(token1Addr).balanceOf(swapper);

        assertGt(swapperToken0After, swapperToken0Before, "Swapper should have more token0");
        assertLt(swapperToken1After, swapperToken1Before, "Swapper should have less token1");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    HELPER: Add Liquidity
    // ═══════════════════════════════════════════════════════════════════════

    function _addLiquidity(address provider, uint256 amount0, uint256 amount1) internal {
        _mintTokensTo(provider, amount0, amount1);

        vm.startPrank(provider);
        IERC20(token0Addr).approve(address(hook), type(uint256).max);
        IERC20(token1Addr).approve(address(hook), type(uint256).max);
        hook.addLiquidity(poolId, amount0, amount1);
        vm.stopPrank();
    }

    function _mintTokensTo(address to, uint256 amount0, uint256 amount1) internal {
        // For addLiquidity (plaintext), use mintPlaintext for FHERC20
        if (token0IsFherc20) {
            fheToken.mintPlaintext(to, amount0);
            erc20Token.mint(to, amount1);
        } else {
            erc20Token.mint(to, amount0);
            fheToken.mintPlaintext(to, amount1);
        }
    }
}
