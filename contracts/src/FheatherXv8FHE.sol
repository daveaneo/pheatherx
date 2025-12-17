// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FHE, euint128, ebool, InEuint128, InEbool, Common} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IFHERC20} from "./interface/IFHERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SwapLockTransient} from "./lib/SwapLockTransient.sol";
import {TickBitmapLib} from "./lib/TickBitmapLib.sol";
import {FheatherMath} from "./lib/FheatherMath.sol";
import {BucketLib} from "./lib/BucketLib.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

/// @title FheatherX v8 FHE - Full Privacy Pools (FHERC20:FHERC20 Only)
/// @author FheatherX Team
/// @notice Uniswap v4 Hook implementing encrypted AMM with momentum-triggered limit orders
/// @dev This contract handles pools where BOTH tokens are FHERC20 (fully encrypted).
///
/// ## Architecture Overview
/// The contract implements a hybrid AMM + limit order system:
/// - **Encrypted AMM**: Constant product (x*y=k) with FHE arithmetic on encrypted reserves
/// - **Momentum Orders**: Limit orders that auto-execute when price moves through their tick
/// - **Virtual Slicing**: Pro-rata output allocation to simultaneously triggered orders
///
/// ## Key Design Decisions
///
/// ### 1. Pro-Rata Allocation (vs Priority Slicing)
/// When multiple momentum orders trigger simultaneously, all participants receive the
/// same average execution price (pro-rata). This differs from priority-based systems
/// where earlier triggers get better prices.
///
/// **Rationale**: Pro-rata is simpler, more gas-efficient, and avoids complex FHE
/// prefix-sum operations. It also provides fair treatment to all participants in
/// the same price band.
///
/// ### 2. Tick Price Execution (vs AMM Spot Price)
/// Limit orders execute at their bucket's designated tick price, not the dynamic
/// AMM spot price at execution time.
///
/// **Rationale**: Tick price provides predictable execution for makers. The tick
/// represents the price at which they agreed to trade. Using AMM spot price could
/// result in execution at prices worse than the limit, which violates user expectations.
///
/// ### 3. Iterative Momentum Closure (vs Binary Search)
/// The momentum closure algorithm uses iterative expansion rather than binary search.
/// This avoids the "phantom fixed point" problem where binary search can find
/// mathematically valid but physically unreachable price states on step functions.
///
/// ### 4. Reserve-Based Slippage Cap (~50% max)
/// Momentum buckets with liquidity exceeding the output reserve are skipped.
/// This caps slippage at ~50% (when bucket = 100% of reserve, AMM math yields ~50% output).
///
/// ## Swap Pipeline
/// 1. Match opposing limit orders (direct peer-to-peer, no AMM)
/// 2. Find momentum closure (which same-side orders trigger)
/// 3. Sum activated momentum buckets (with liquidity cap)
/// 4. Execute single AMM swap with total input
/// 5. Allocate output to momentum buckets via virtual slicing
/// 6. Transfer output to user
///
/// ## Privacy Model
/// - All balances and order amounts are encrypted (euint128)
/// - Reserve values are periodically synced to plaintext cache for gas optimization
/// - Tick bitmap is public (reveals which price levels have orders, not amounts)
///
contract FheatherXv8FHE is BaseHook, Pausable, Ownable {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using TickBitmapLib for mapping(int16 => uint256);

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Precision multiplier for fixed-point arithmetic (18 decimals)
    uint256 public constant PRECISION = 1e18;

    /// @notice Tick spacing for price buckets (each tick = ~0.6% price change)
    int24 public constant TICK_SPACING = 60;

    /// @notice Minimum allowed tick value
    int24 public constant MIN_TICK = TickMath.MIN_TICK;

    /// @notice Maximum allowed tick value
    int24 public constant MAX_TICK = TickMath.MAX_TICK;

    /// @dev Maximum tick movement per swap (limits price impact)
    int24 internal constant MAX_TICK_MOVE = 600;

    /// @dev Maximum momentum buckets that can activate in a single swap
    uint8 internal constant MAX_MOMENTUM_BUCKETS = 5;

    /// @dev Iterations for binary search in reserve sync harvesting
    uint8 internal constant BINARY_SEARCH_ITERATIONS = 12;

    /// @dev Magic byte prefix for encrypted swap hookData
    /// @notice When hookData starts with this byte, the swap params are encrypted
    bytes1 internal constant ENCRYPTED_SWAP_MAGIC = 0x01;

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Thrown when amount parameter is zero
    error ZeroAmount();

    /// @notice Thrown when operating on a pool that hasn't been initialized
    error PoolNotInitialized();

    /// @notice Thrown when swap output is less than minimum expected
    error SlippageExceeded();

    /// @notice Thrown when trying to remove more liquidity than available
    error InsufficientLiquidity();

    /// @notice Thrown when tick is out of range or not aligned to TICK_SPACING
    error InvalidTick();

    /// @notice Thrown when transaction deadline has passed
    error DeadlineExpired();

    /// @notice Thrown when current price has moved beyond maxTickDrift from order tick
    error PriceMoved();

    /// @notice Thrown when protocol fee exceeds maximum (100 bps = 1%)
    error FeeTooHigh();

    /// @notice Thrown when pool tokens are not both FHERC20 (use v8Mixed for mixed pairs)
    error NotFherc20Pair();

    // ═══════════════════════════════════════════════════════════════════════
    //                               TYPES
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Side of a limit order bucket
    /// @dev BUY orders want to buy token0 (sell token1), SELL orders want to sell token0 (buy token1)
    enum BucketSide { BUY, SELL }

    /// @notice Core pool configuration and state
    /// @param token0 Address of the first token (FHERC20)
    /// @param token1 Address of the second token (FHERC20)
    /// @param initialized Whether the pool has been initialized
    /// @param protocolFeeBps Protocol fee in basis points (max 100 = 1%)
    struct PoolState {
        address token0;
        address token1;
        bool initialized;
        uint256 protocolFeeBps;
    }

    /// @notice Pool reserves and LP tracking
    /// @dev Maintains both encrypted (source of truth) and plaintext (cache) reserves
    /// @param encReserve0 Encrypted reserve of token0
    /// @param encReserve1 Encrypted reserve of token1
    /// @param encTotalLpSupply Encrypted total LP token supply
    /// @param reserve0 Plaintext cache of reserve0 (updated via async decrypt)
    /// @param reserve1 Plaintext cache of reserve1 (updated via async decrypt)
    /// @param reserveBlockNumber Block when plaintext cache was last updated
    /// @param nextRequestId Next decrypt request ID to use
    /// @param lastResolvedId Most recent successfully resolved decrypt request
    struct PoolReserves {
        euint128 encReserve0;
        euint128 encReserve1;
        euint128 encTotalLpSupply;
        uint256 reserve0;
        uint256 reserve1;
        uint256 reserveBlockNumber;
        uint256 nextRequestId;
        uint256 lastResolvedId;
    }

    /// @notice Pending async decrypt request for reserve sync
    /// @param reserve0 Encrypted reserve0 at time of request
    /// @param reserve1 Encrypted reserve1 at time of request
    /// @param blockNumber Block when request was made
    struct PendingDecrypt {
        euint128 reserve0;
        euint128 reserve1;
        uint256 blockNumber;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                               STATE
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Encrypted constant: 0
    euint128 internal immutable ENC_ZERO;
    /// @dev Encrypted constant: 1e18 (PRECISION)
    euint128 internal immutable ENC_PRECISION;
    /// @dev Encrypted constant: 1
    euint128 internal immutable ENC_ONE;
    /// @dev Encrypted swap fee in basis points
    euint128 internal immutable ENC_SWAP_FEE_BPS;
    /// @dev Encrypted constant: 10000 (for basis point calculations)
    euint128 internal immutable ENC_TEN_THOUSAND;

    /// @notice Pool configuration by pool ID
    mapping(PoolId => PoolState) public poolStates;

    /// @notice Pool reserves and LP data by pool ID
    mapping(PoolId => PoolReserves) public poolReserves;

    /// @notice Pending decrypt requests by pool ID and request ID
    mapping(PoolId => mapping(uint256 => PendingDecrypt)) public pendingDecrypts;

    /// @notice Encrypted LP token balances by pool and user
    mapping(PoolId => mapping(address => euint128)) public encLpBalances;

    /// @notice Limit order buckets by pool, tick, and side
    mapping(PoolId => mapping(int24 => mapping(BucketSide => BucketLib.Bucket))) public buckets;

    /// @notice User positions in limit order buckets
    mapping(PoolId => mapping(address => mapping(int24 => mapping(BucketSide => BucketLib.UserPosition)))) public positions;

    /// @dev Bitmap tracking which ticks have BUY orders
    mapping(PoolId => mapping(int16 => uint256)) internal buyBitmaps;

    /// @dev Bitmap tracking which ticks have SELL orders
    mapping(PoolId => mapping(int16 => uint256)) internal sellBitmaps;

    /// @notice Last processed tick per pool (used for momentum calculations)
    mapping(PoolId => int24) public lastProcessedTick;

    /// @notice Address that receives protocol fees
    address public feeCollector;

    /// @notice Swap fee in basis points (e.g., 30 = 0.3%)
    uint256 public swapFeeBps;

    // ═══════════════════════════════════════════════════════════════════════
    //                               EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Emitted when a new pool is initialized
    /// @param poolId The unique identifier of the pool
    /// @param token0 Address of token0 (FHERC20)
    /// @param token1 Address of token1 (FHERC20)
    event PoolInitialized(PoolId indexed poolId, address token0, address token1);

    /// @notice Emitted when an encrypted swap is executed (direction hidden)
    /// @param poolId The pool where the swap occurred
    /// @param user The address that initiated the swap
    event EncryptedSwapExecuted(PoolId indexed poolId, address indexed user);

    /// @notice Emitted when a user deposits into a limit order bucket
    /// @param poolId The pool ID
    /// @param user The depositor's address
    /// @param tick The price tick of the order
    /// @param side BUY or SELL
    event Deposit(PoolId indexed poolId, address indexed user, int24 tick, BucketSide side);

    /// @notice Emitted when a user withdraws unfilled liquidity from a bucket
    /// @param poolId The pool ID
    /// @param user The withdrawer's address
    /// @param tick The price tick of the order
    /// @param side BUY or SELL
    event Withdraw(PoolId indexed poolId, address indexed user, int24 tick, BucketSide side);

    /// @notice Emitted when a user claims proceeds from filled orders
    /// @param poolId The pool ID
    /// @param user The claimer's address
    /// @param tick The price tick of the order
    /// @param side BUY or SELL
    event Claim(PoolId indexed poolId, address indexed user, int24 tick, BucketSide side);

    /// @notice Emitted when liquidity is added to the AMM
    /// @param poolId The pool ID
    /// @param user The liquidity provider's address
    event LiquidityAdded(PoolId indexed poolId, address indexed user);

    /// @notice Emitted when liquidity is removed from the AMM
    /// @param poolId The pool ID
    /// @param user The liquidity provider's address
    event LiquidityRemoved(PoolId indexed poolId, address indexed user);

    /// @notice Emitted when an async decrypt is requested for reserve sync
    /// @param poolId The pool ID
    /// @param requestId The unique request identifier
    /// @param blockNumber Block when request was made
    event ReserveSyncRequested(PoolId indexed poolId, uint256 indexed requestId, uint256 blockNumber);

    /// @notice Emitted when reserves are synced from a resolved decrypt
    /// @param poolId The pool ID
    /// @param reserve0 New plaintext reserve0 value
    /// @param reserve1 New plaintext reserve1 value
    /// @param requestId The request ID that was resolved
    event ReservesSynced(PoolId indexed poolId, uint256 reserve0, uint256 reserve1, uint256 indexed requestId);

    // ═══════════════════════════════════════════════════════════════════════
    //                           CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Initialize the FheatherX v8 FHE hook
    /// @param _poolManager The Uniswap v4 PoolManager contract
    /// @param _owner Address that will own this contract (can pause, set fees)
    /// @param _swapFeeBps Swap fee in basis points (e.g., 30 = 0.3%)
    constructor(
        IPoolManager _poolManager,
        address _owner,
        uint256 _swapFeeBps
    ) BaseHook(_poolManager) Ownable(_owner) {
        ENC_ZERO = FHE.asEuint128(0);
        ENC_PRECISION = FHE.asEuint128(uint128(PRECISION));
        ENC_ONE = FHE.asEuint128(1);
        ENC_SWAP_FEE_BPS = FHE.asEuint128(uint128(_swapFeeBps));
        ENC_TEN_THOUSAND = FHE.asEuint128(10000);

        swapFeeBps = _swapFeeBps;

        FHE.allowThis(ENC_ZERO);
        FHE.allowThis(ENC_PRECISION);
        FHE.allowThis(ENC_ONE);
        FHE.allowThis(ENC_SWAP_FEE_BPS);
        FHE.allowThis(ENC_TEN_THOUSAND);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         HOOK PERMISSIONS
    // ═══════════════════════════════════════════════════════════════════════

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          HOOK CALLBACKS
    // ═══════════════════════════════════════════════════════════════════════

    function _afterInitialize(
        address,
        PoolKey calldata key,
        uint160,
        int24 tick
    ) internal override returns (bytes4) {
        PoolId poolId = key.toId();
        lastProcessedTick[poolId] = tick;

        address token0Addr = Currency.unwrap(key.currency0);
        address token1Addr = Currency.unwrap(key.currency1);

        // Verify both tokens are FHERC20
        if (!_isFherc20(token0Addr) || !_isFherc20(token1Addr)) {
            revert NotFherc20Pair();
        }

        poolStates[poolId] = PoolState({
            token0: token0Addr,
            token1: token1Addr,
            initialized: true,
            protocolFeeBps: 5
        });

        PoolReserves storage reserves = poolReserves[poolId];
        reserves.encReserve0 = ENC_ZERO;
        reserves.encReserve1 = ENC_ZERO;
        reserves.encTotalLpSupply = ENC_ZERO;

        FHE.allowThis(reserves.encReserve0);
        FHE.allowThis(reserves.encReserve1);
        FHE.allowThis(reserves.encTotalLpSupply);

        IERC20(token0Addr).approve(address(poolManager), type(uint256).max);
        IERC20(token1Addr).approve(address(poolManager), type(uint256).max);

        emit PoolInitialized(poolId, token0Addr, token1Addr);
        return this.afterInitialize.selector;
    }

    function _beforeSwap(
        address, // sender - unused
        PoolKey calldata key,
        SwapParams calldata, // params - unused (direction/amount in hookData)
        bytes calldata hookData
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        PoolId poolId = key.toId();
        if (!poolStates[poolId].initialized) {
            return (this.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        }

        SwapLockTransient.enforceOnce(poolId);

        // SINGLE encrypted swap path - all swaps use this unified flow
        // Direction, amounts, and order matching are all handled with full FHE privacy
        if (hookData.length > 0 && hookData[0] == ENCRYPTED_SWAP_MAGIC) {
            _executeEncryptedSwap(poolId, hookData);
            return (this.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        }

        // No valid swap path - return NoOp
        return (this.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    MOMENTUM CLOSURE (Iterative Expansion)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Find momentum closure using iterative expansion
    /// @dev Replaces binary search to avoid phantom fixed point problem.
    ///      Uses fixed estimate (1e18 per bucket) for PREDICTION, but execution
    ///      uses actual encrypted sums. This preserves privacy while avoiding
    ///      the phantom fixed point issue where binary search finds unreachable states.
    function _findMomentumClosure(
        PoolId poolId,
        bool zeroForOne,
        uint256 userRemainderPlaintext,
        int24 startTick
    ) internal view returns (int24 finalTick, uint8 activatedCount) {
        PoolReserves storage reserves = poolReserves[poolId];

        finalTick = startTick;

        // Iterative expansion - follow the actual cascade path
        for (uint8 i = 0; i < MAX_MOMENTUM_BUCKETS + 2; i++) {
            int24 nextTick = _iterateOnce(poolId, zeroForOne, userRemainderPlaintext, startTick, finalTick, reserves);

            // Check convergence (fixed point reached when tick stops moving)
            if (zeroForOne ? nextTick >= finalTick : nextTick <= finalTick) break;

            finalTick = nextTick;
        }

        // Final count of activated buckets
        activatedCount = _countMomentumBuckets(poolId, startTick, finalTick, zeroForOne);
    }

    /// @notice Single iteration of momentum closure calculation
    function _iterateOnce(
        PoolId poolId,
        bool zeroForOne,
        uint256 userInput,
        int24 startTick,
        int24 currentTick,
        PoolReserves storage reserves
    ) internal view returns (int24 nextTick) {
        uint8 bucketCount = _countMomentumBuckets(poolId, startTick, currentTick, zeroForOne);
        uint256 totalInput = userInput + uint256(bucketCount) * 1e18;

        nextTick = _tickAfterSwapPlaintext(reserves.reserve0, reserves.reserve1, totalInput, zeroForOne);

        // Enforce MAX_TICK_MOVE limit
        if (zeroForOne) {
            if (startTick - nextTick > MAX_TICK_MOVE) nextTick = startTick - MAX_TICK_MOVE;
        } else {
            if (nextTick - startTick > MAX_TICK_MOVE) nextTick = startTick + MAX_TICK_MOVE;
        }
    }

    /// @notice Count momentum buckets between two ticks
    function _countMomentumBuckets(
        PoolId poolId,
        int24 fromTick,
        int24 toTick,
        bool zeroForOne
    ) internal view returns (uint8 count) {
        BucketSide side = zeroForOne ? BucketSide.SELL : BucketSide.BUY;
        mapping(int16 => uint256) storage bitmap = side == BucketSide.SELL
            ? sellBitmaps[poolId] : buyBitmaps[poolId];

        int24 current = fromTick;
        while (count < MAX_MOMENTUM_BUCKETS) {
            (int24 nextTick, bool found) = TickBitmapLib.findNextInitializedTick(
                bitmap, current, TICK_SPACING, zeroForOne, 2
            );
            if (!found) break;
            if (zeroForOne && nextTick < toTick) break;
            if (!zeroForOne && nextTick > toTick) break;
            count++;
            current = zeroForOne ? nextTick - TICK_SPACING : nextTick + TICK_SPACING;
        }
    }

    /// @notice Calculate the resulting tick after a swap with given input
    function _tickAfterSwapPlaintext(
        uint256 reserve0,
        uint256 reserve1,
        uint256 amountIn,
        bool zeroForOne
    ) internal pure returns (int24) {
        if (reserve0 == 0 || reserve1 == 0) return 0;

        if (zeroForOne) {
            uint256 newR0 = reserve0 + amountIn;
            return FheatherMath.getCurrentTick(newR0, (reserve0 * reserve1) / newR0, TICK_SPACING);
        } else {
            uint256 newR1 = reserve1 + amountIn;
            return FheatherMath.getCurrentTick((reserve0 * reserve1) / newR1, newR1, TICK_SPACING);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    ENCRYPTED AMM MATH
    // ═══════════════════════════════════════════════════════════════════════

    function _executeSwapMath(
        PoolId poolId,
        ebool direction,
        euint128 amountIn
    ) internal returns (euint128 amountOut) {
        PoolReserves storage r = poolReserves[poolId];

        euint128 feeAmount = FHE.div(FHE.mul(amountIn, ENC_SWAP_FEE_BPS), ENC_TEN_THOUSAND);
        euint128 amountInAfterFee = FHE.sub(amountIn, feeAmount);
        FHE.allowThis(amountInAfterFee);

        euint128 reserveIn = FHE.select(direction, r.encReserve0, r.encReserve1);
        euint128 reserveOut = FHE.select(direction, r.encReserve1, r.encReserve0);

        euint128 numerator = FHE.mul(amountInAfterFee, reserveOut);
        euint128 denominator = FHE.add(reserveIn, amountInAfterFee);

        euint128 safeDenominator = FHE.select(
            FHE.gt(denominator, ENC_ZERO),
            denominator,
            ENC_ONE
        );
        FHE.allowThis(safeDenominator);

        amountOut = FHE.div(numerator, safeDenominator);
        FHE.allowThis(amountOut);

        euint128 newReserveIn = FHE.add(reserveIn, amountIn);
        euint128 newReserveOut = FHE.sub(reserveOut, amountOut);

        r.encReserve0 = FHE.select(direction, newReserveIn, newReserveOut);
        r.encReserve1 = FHE.select(direction, newReserveOut, newReserveIn);
        FHE.allowThis(r.encReserve0);
        FHE.allowThis(r.encReserve1);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    ENCRYPTED SWAP (Full Privacy)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Execute a fully encrypted swap with complete order matching
    /// @dev The ONLY swap path for v8FHE. Full privacy with full functionality.
    ///      hookData format: [0x01 (magic)] [sender] [directionHandle] [amountInHandle] [minOutputHandle]
    ///
    ///      Pipeline:
    ///      1. Match MAKER orders (opposing side) - direct peer-to-peer fills
    ///      2. Find TAKER orders (same side) - momentum orders that trigger
    ///      3. ONE AMM call with total input (user remainder + taker liquidity)
    ///      4. Distribute output: user gets their share, takers get proceeds
    ///
    ///      All operations use FHE.select to evaluate both sides, only affecting the correct one.
    ///      Direction, amounts, and order fills are all encrypted - zero information leakage.
    ///
    /// @param poolId The pool to swap in
    /// @param hookData Encoded encrypted swap parameters
    function _executeEncryptedSwap(PoolId poolId, bytes calldata hookData) internal {
        // Harvest any pending reserve decrypts first
        _harvestResolvedDecrypts(poolId);

        PoolState storage state = poolStates[poolId];
        PoolReserves storage reserves = poolReserves[poolId];

        // Decode hookData
        (
            address sender,
            uint256 directionHandle,
            uint256 amountInHandle,
            uint256 minOutputHandle
        ) = abi.decode(hookData[1:], (address, uint256, uint256, uint256));

        // Wrap handles to FHE types
        ebool direction = ebool.wrap(directionHandle);
        euint128 amountIn = euint128.wrap(amountInHandle);
        euint128 minOutput = euint128.wrap(minOutputHandle);
        FHE.allowThis(direction);
        FHE.allowThis(amountIn);
        FHE.allowThis(minOutput);

        address token0 = state.token0;
        address token1 = state.token1;

        // ═══════════════════════════════════════════════════════════════════
        // STEP 0: Transfer input tokens (conditional on encrypted direction)
        // ═══════════════════════════════════════════════════════════════════
        euint128 token0InputAmount = FHE.select(direction, amountIn, ENC_ZERO);
        euint128 token1InputAmount = FHE.select(direction, ENC_ZERO, amountIn);
        FHE.allowThis(token0InputAmount);
        FHE.allowThis(token1InputAmount);
        FHE.allow(token0InputAmount, token0);
        FHE.allow(token1InputAmount, token1);

        IFHERC20(token0)._transferFromEncrypted(sender, address(this), token0InputAmount);
        IFHERC20(token1)._transferFromEncrypted(sender, address(this), token1InputAmount);

        int24 startTick = lastProcessedTick[poolId];

        // ═══════════════════════════════════════════════════════════════════
        // STEP 1: Match MAKER orders (opposing limit orders)
        // Run matching on BOTH sides, use FHE.select to pick correct results
        // ═══════════════════════════════════════════════════════════════════
        (euint128 remainderIfZeroForOne, euint128 makerOutputIfZeroForOne) =
            _matchMakerOrdersEncrypted(poolId, true, amountIn, startTick, direction);
        (euint128 remainderIfOneForZero, euint128 makerOutputIfOneForZero) =
            _matchMakerOrdersEncrypted(poolId, false, amountIn, startTick, direction);

        euint128 userRemainder = FHE.select(direction, remainderIfZeroForOne, remainderIfOneForZero);
        euint128 outputFromMakers = FHE.select(direction, makerOutputIfZeroForOne, makerOutputIfOneForZero);
        FHE.allowThis(userRemainder);
        FHE.allowThis(outputFromMakers);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 2: Find TAKER orders (momentum orders on same side)
        // Use plaintext reserves for closure finding, encrypted for actual sums
        // ═══════════════════════════════════════════════════════════════════
        // Find momentum closure for both directions using reserve estimates
        uint256 estimateForZeroForOne = reserves.reserve0 / 5;
        uint256 estimateForOneForZero = reserves.reserve1 / 5;

        (int24 finalTickZFO, uint8 countZFO) = _findMomentumClosure(poolId, true, estimateForZeroForOne, startTick);
        (int24 finalTickOFZ, uint8 countOFZ) = _findMomentumClosure(poolId, false, estimateForOneForZero, startTick);

        // Sum taker liquidity for both directions
        euint128 takerSumZFO = (countZFO > 0) ? _sumTakerBucketsEncrypted(poolId, true, startTick, finalTickZFO, direction) : ENC_ZERO;
        euint128 takerSumOFZ = (countOFZ > 0) ? _sumTakerBucketsEncrypted(poolId, false, startTick, finalTickOFZ, direction) : ENC_ZERO;
        FHE.allowThis(takerSumZFO);
        FHE.allowThis(takerSumOFZ);

        euint128 takerSum = FHE.select(direction, takerSumZFO, takerSumOFZ);
        FHE.allowThis(takerSum);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 3: ONE AMM call with total input
        // ═══════════════════════════════════════════════════════════════════
        euint128 totalAmmInput = FHE.add(userRemainder, takerSum);
        FHE.allowThis(totalAmmInput);

        euint128 totalAmmOutput = _executeSwapMath(poolId, direction, totalAmmInput);
        FHE.allowThis(totalAmmOutput);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 4: Distribute output to taker orders (virtual slicing)
        // ═══════════════════════════════════════════════════════════════════
        if (countZFO > 0) {
            _allocateTakerOutputEncrypted(poolId, true, startTick, finalTickZFO, takerSumZFO, totalAmmOutput, direction);
        }
        if (countOFZ > 0) {
            _allocateTakerOutputEncrypted(poolId, false, startTick, finalTickOFZ, takerSumOFZ, totalAmmOutput, direction);
        }

        // NOTE: lastProcessedTick is NOT updated here to preserve full privacy.
        // The tick is used for momentum closure calculation which uses plaintext reserves.
        // Reserves are synced via _requestReserveSync, so momentum closure still works.
        // TODO: For optimal momentum ordering across multiple encrypted swaps,
        // consider tracking tick state per-direction or deriving from reserves.

        // ═══════════════════════════════════════════════════════════════════
        // STEP 5: Calculate user's final output
        // ═══════════════════════════════════════════════════════════════════
        // User output = maker fills + their share of AMM output
        // userAmmShare = (userRemainder / totalAmmInput) * totalAmmOutput
        // When no takers: totalAmmInput = userRemainder, so userAmmShare = totalAmmOutput (100%)
        // When takers exist: pro-rata split based on input contribution
        euint128 userAmmShare;
        ebool hasAmmInput = FHE.gt(totalAmmInput, ENC_ZERO);
        euint128 safeTotalInput = FHE.select(hasAmmInput, totalAmmInput, ENC_ONE);
        FHE.allowThis(safeTotalInput);

        // userAmmShare = (userRemainder / totalAmmInput) * totalAmmOutput
        euint128 userShareNumerator = FHE.mul(userRemainder, totalAmmOutput);
        FHE.allowThis(userShareNumerator);
        userAmmShare = FHE.div(userShareNumerator, safeTotalInput);
        FHE.allowThis(userAmmShare);

        euint128 userTotalOutput = FHE.add(outputFromMakers, userAmmShare);
        FHE.allowThis(userTotalOutput);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 5b: Apply protocol fee (encrypted)
        // ═══════════════════════════════════════════════════════════════════
        uint256 feeBps = poolStates[poolId].protocolFeeBps;
        euint128 encFeeBps = FHE.asEuint128(uint128(feeBps));
        FHE.allowThis(encFeeBps);

        // fee = userTotalOutput * feeBps / 10000
        euint128 feeNumerator = FHE.mul(userTotalOutput, encFeeBps);
        FHE.allowThis(feeNumerator);
        euint128 fee = FHE.div(feeNumerator, ENC_TEN_THOUSAND);
        FHE.allowThis(fee);

        // outputAfterFee = userTotalOutput - fee
        euint128 outputAfterFee = FHE.sub(userTotalOutput, fee);
        FHE.allowThis(outputAfterFee);

        // Slippage check (on output AFTER fee)
        ebool slippageOk = FHE.gte(outputAfterFee, minOutput);
        euint128 finalOutput = FHE.select(slippageOk, outputAfterFee, ENC_ZERO);
        euint128 finalFee = FHE.select(slippageOk, fee, ENC_ZERO);
        FHE.allowThis(finalOutput);
        FHE.allowThis(finalFee);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 6: Transfer output to user and fee to collector
        // ═══════════════════════════════════════════════════════════════════
        euint128 token0OutputAmount = FHE.select(direction, ENC_ZERO, finalOutput);
        euint128 token1OutputAmount = FHE.select(direction, finalOutput, ENC_ZERO);
        FHE.allowThis(token0OutputAmount);
        FHE.allowThis(token1OutputAmount);
        FHE.allow(token0OutputAmount, token0);
        FHE.allow(token1OutputAmount, token1);

        IFHERC20(token0)._transferEncrypted(sender, token0OutputAmount);
        IFHERC20(token1)._transferEncrypted(sender, token1OutputAmount);

        // Transfer fee to collector (if set)
        if (feeCollector != address(0)) {
            euint128 token0FeeAmount = FHE.select(direction, ENC_ZERO, finalFee);
            euint128 token1FeeAmount = FHE.select(direction, finalFee, ENC_ZERO);
            FHE.allowThis(token0FeeAmount);
            FHE.allowThis(token1FeeAmount);
            FHE.allow(token0FeeAmount, token0);
            FHE.allow(token1FeeAmount, token1);

            IFHERC20(token0)._transferEncrypted(feeCollector, token0FeeAmount);
            IFHERC20(token1)._transferEncrypted(feeCollector, token1FeeAmount);
        }

        // Sync reserves
        _requestReserveSync(poolId);

        emit EncryptedSwapExecuted(poolId, sender);
    }

    /// @notice Match maker orders with encrypted direction
    /// @dev Evaluates fills but only applies them if direction matches
    function _matchMakerOrdersEncrypted(
        PoolId poolId,
        bool evalZeroForOne,
        euint128 userInput,
        int24 startTick,
        ebool actualDirection
    ) internal returns (euint128 remainder, euint128 userOutput) {
        // Makers for zeroForOne swaps are on the BUY side (they want to buy token0)
        // Makers for oneForZero swaps are on the SELL side (they want to sell token0)
        BucketSide makerSide = evalZeroForOne ? BucketSide.BUY : BucketSide.SELL;
        mapping(int16 => uint256) storage bitmap = makerSide == BucketSide.BUY
            ? buyBitmaps[poolId] : sellBitmaps[poolId];

        remainder = userInput;
        userOutput = ENC_ZERO;

        // Should we actually apply changes? Only if evalZeroForOne matches actualDirection
        ebool shouldApply = evalZeroForOne ? actualDirection : FHE.not(actualDirection);
        FHE.allowThis(shouldApply);

        int24 current = startTick;
        for (uint8 i = 0; i < MAX_MOMENTUM_BUCKETS; i++) {
            (int24 nextTick, bool found) = TickBitmapLib.findNextInitializedTick(
                bitmap, current, TICK_SPACING, evalZeroForOne, 2
            );
            if (!found) break;

            BucketLib.Bucket storage bucket = buckets[poolId][nextTick][makerSide];
            if (!bucket.initialized || !Common.isInitialized(bucket.liquidity)) {
                current = evalZeroForOne ? nextTick - TICK_SPACING : nextTick + TICK_SPACING;
                continue;
            }

            // Calculate fill amounts
            euint128 encTickPrice = FHE.asEuint128(uint128(FheatherMath.calculateTickPrice(nextTick)));
            FHE.allowThis(encTickPrice);

            // Capacity in user's input units
            euint128 capacity = evalZeroForOne
                ? FHE.div(FHE.mul(bucket.liquidity, ENC_PRECISION), encTickPrice)
                : FHE.div(FHE.mul(bucket.liquidity, encTickPrice), ENC_PRECISION);
            FHE.allowThis(capacity);

            euint128 fill = FHE.select(FHE.gt(remainder, capacity), capacity, remainder);
            FHE.allowThis(fill);

            euint128 outputFromBucket = evalZeroForOne
                ? FHE.div(FHE.mul(fill, encTickPrice), ENC_PRECISION)
                : FHE.div(FHE.mul(fill, ENC_PRECISION), encTickPrice);
            FHE.allowThis(outputFromBucket);

            // Conditionally apply: only if this evaluation direction matches actual direction
            euint128 actualFill = FHE.select(shouldApply, fill, ENC_ZERO);
            euint128 actualOutput = FHE.select(shouldApply, outputFromBucket, ENC_ZERO);
            FHE.allowThis(actualFill);
            FHE.allowThis(actualOutput);

            // Update bucket state (conditional - subtracts 0 if wrong direction)
            euint128 liquidityReduction = FHE.select(shouldApply, outputFromBucket, ENC_ZERO);
            FHE.allowThis(liquidityReduction);
            bucket.liquidity = FHE.sub(bucket.liquidity, liquidityReduction);
            FHE.allowThis(bucket.liquidity);

            // Update proceeds accumulator (conditional)
            BucketLib.updateOnFillConditional(bucket, liquidityReduction, actualFill, ENC_ZERO, ENC_ONE, ENC_PRECISION, shouldApply);

            // Update running totals
            remainder = FHE.sub(remainder, actualFill);
            userOutput = FHE.add(userOutput, actualOutput);
            FHE.allowThis(remainder);
            FHE.allowThis(userOutput);

            current = evalZeroForOne ? nextTick - TICK_SPACING : nextTick + TICK_SPACING;
        }
    }

    /// @notice Sum taker bucket liquidity with encrypted direction
    function _sumTakerBucketsEncrypted(
        PoolId poolId,
        bool evalZeroForOne,
        int24 fromTick,
        int24 toTick,
        ebool actualDirection
    ) internal returns (euint128 totalLiquidity) {
        // Takers for zeroForOne are SELL orders (selling token0 as price drops)
        // Takers for oneForZero are BUY orders (buying token0 as price rises)
        BucketSide takerSide = evalZeroForOne ? BucketSide.SELL : BucketSide.BUY;
        mapping(int16 => uint256) storage bitmap = takerSide == BucketSide.SELL
            ? sellBitmaps[poolId] : buyBitmaps[poolId];

        PoolReserves storage reserves = poolReserves[poolId];
        euint128 encReserveLimit = evalZeroForOne ? reserves.encReserve1 : reserves.encReserve0;

        // Only sum if this evaluation matches actual direction
        ebool shouldSum = evalZeroForOne ? actualDirection : FHE.not(actualDirection);
        FHE.allowThis(shouldSum);

        totalLiquidity = ENC_ZERO;
        int24 current = fromTick;
        uint8 count = 0;

        while (count < MAX_MOMENTUM_BUCKETS) {
            (int24 nextTick, bool found) = TickBitmapLib.findNextInitializedTick(
                bitmap, current, TICK_SPACING, evalZeroForOne, 2
            );
            if (!found) break;
            if (evalZeroForOne && nextTick < toTick) break;
            if (!evalZeroForOne && nextTick > toTick) break;

            BucketLib.Bucket storage bucket = buckets[poolId][nextTick][takerSide];
            if (bucket.initialized && Common.isInitialized(bucket.liquidity)) {
                // Cap oversized buckets
                ebool isOversized = FHE.gt(bucket.liquidity, encReserveLimit);
                euint128 cappedLiquidity = FHE.select(isOversized, ENC_ZERO, bucket.liquidity);
                FHE.allowThis(cappedLiquidity);

                // Only add if direction matches
                euint128 conditionalLiquidity = FHE.select(shouldSum, cappedLiquidity, ENC_ZERO);
                FHE.allowThis(conditionalLiquidity);

                totalLiquidity = FHE.add(totalLiquidity, conditionalLiquidity);
                FHE.allowThis(totalLiquidity);
                count++;
            }
            current = evalZeroForOne ? nextTick - TICK_SPACING : nextTick + TICK_SPACING;
        }
    }

    /// @notice Allocate AMM output to taker buckets with encrypted direction
    /// @dev MUST use same capping logic as _sumTakerBucketsEncrypted to ensure correct proportions
    function _allocateTakerOutputEncrypted(
        PoolId poolId,
        bool evalZeroForOne,
        int24 fromTick,
        int24 toTick,
        euint128 totalTakerInput,
        euint128 totalOutput,
        ebool actualDirection
    ) internal {
        BucketSide takerSide = evalZeroForOne ? BucketSide.SELL : BucketSide.BUY;
        mapping(int16 => uint256) storage bitmap = takerSide == BucketSide.SELL
            ? sellBitmaps[poolId] : buyBitmaps[poolId];

        // Get reserve limit for capping (same as in _sumTakerBucketsEncrypted)
        PoolReserves storage reserves = poolReserves[poolId];
        euint128 encReserveLimit = evalZeroForOne ? reserves.encReserve1 : reserves.encReserve0;

        // Only allocate if this evaluation matches actual direction
        ebool shouldAllocate = evalZeroForOne ? actualDirection : FHE.not(actualDirection);
        FHE.allowThis(shouldAllocate);

        ebool hasInput = FHE.gt(totalTakerInput, ENC_ZERO);
        euint128 safeDenom = FHE.select(hasInput, totalTakerInput, ENC_ONE);
        FHE.allowThis(safeDenom);

        int24 current = fromTick;
        uint8 count = 0;

        while (count < MAX_MOMENTUM_BUCKETS) {
            (int24 nextTick, bool found) = TickBitmapLib.findNextInitializedTick(
                bitmap, current, TICK_SPACING, evalZeroForOne, 2
            );
            if (!found) break;
            if (evalZeroForOne && nextTick < toTick) break;
            if (!evalZeroForOne && nextTick > toTick) break;

            BucketLib.Bucket storage bucket = buckets[poolId][nextTick][takerSide];
            if (bucket.initialized && Common.isInitialized(bucket.liquidity)) {
                // Apply same capping as _sumTakerBucketsEncrypted
                ebool isOversized = FHE.gt(bucket.liquidity, encReserveLimit);
                euint128 cappedLiquidity = FHE.select(isOversized, ENC_ZERO, bucket.liquidity);
                FHE.allowThis(cappedLiquidity);

                // Calculate this bucket's share of output using CAPPED liquidity
                euint128 bucketOutput = FHE.div(
                    FHE.mul(cappedLiquidity, totalOutput),
                    safeDenom
                );
                FHE.allowThis(bucketOutput);

                // Conditional allocation
                euint128 actualBucketOutput = FHE.select(shouldAllocate, bucketOutput, ENC_ZERO);
                euint128 actualLiquidityUsed = FHE.select(shouldAllocate, cappedLiquidity, ENC_ZERO);
                FHE.allowThis(actualBucketOutput);
                FHE.allowThis(actualLiquidityUsed);

                // Update proceeds accumulator (conditional)
                BucketLib.updateOnFillConditional(bucket, actualLiquidityUsed, actualBucketOutput, ENC_ZERO, ENC_ONE, ENC_PRECISION, shouldAllocate);

                // Zero out liquidity only for CAPPED amount (conditional)
                // If oversized, bucket keeps its liquidity (it wasn't used)
                euint128 liquidityAfterUse = FHE.sub(bucket.liquidity, actualLiquidityUsed);
                FHE.allowThis(liquidityAfterUse);
                euint128 newLiquidity = FHE.select(shouldAllocate, liquidityAfterUse, bucket.liquidity);
                bucket.liquidity = newLiquidity;
                FHE.allowThis(bucket.liquidity);

                count++;
            }
            current = evalZeroForOne ? nextTick - TICK_SPACING : nextTick + TICK_SPACING;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    LIMIT ORDER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Deposit tokens into a limit order bucket
    /// @dev Creates a limit order that will execute when price reaches the specified tick.
    ///      For SELL orders, you're selling token0 at the tick price.
    ///      For BUY orders, you're buying token0 (selling token1) at the tick price.
    ///      The order executes at the bucket's tick price, not the AMM spot price.
    /// @param poolId The pool to place the order in
    /// @param tick The price tick for the order (must be aligned to TICK_SPACING)
    /// @param side BUY or SELL
    /// @param encryptedAmount Encrypted amount of tokens to deposit
    /// @param deadline Transaction deadline (reverts if block.timestamp > deadline)
    /// @param maxTickDrift Maximum allowed difference between current tick and order tick
    function deposit(
        PoolId poolId,
        int24 tick,
        BucketSide side,
        InEuint128 calldata encryptedAmount,
        uint256 deadline,
        int24 maxTickDrift
    ) external whenNotPaused {
        if (block.timestamp > deadline) revert DeadlineExpired();

        PoolState storage state = poolStates[poolId];
        if (!state.initialized) revert PoolNotInitialized();
        if (tick < MIN_TICK || tick > MAX_TICK || tick % TICK_SPACING != 0) revert InvalidTick();

        PoolReserves storage reserves = poolReserves[poolId];
        int24 currentTick = FheatherMath.getCurrentTick(reserves.reserve0, reserves.reserve1, TICK_SPACING);
        if (FheatherMath.abs(currentTick - tick) > maxTickDrift) revert PriceMoved();

        euint128 amount = FHE.asEuint128(encryptedAmount);
        FHE.allowThis(amount);

        BucketLib.Bucket storage bucket = buckets[poolId][tick][side];
        if (!bucket.initialized) {
            BucketLib.initialize(bucket, ENC_ZERO);
        }

        BucketLib.UserPosition storage position = positions[poolId][msg.sender][tick][side];

        if (Common.isInitialized(position.shares)) {
            BucketLib.autoClaim(position, bucket, ENC_PRECISION);
        }

        bucket.totalShares = FHE.add(bucket.totalShares, amount);
        bucket.liquidity = FHE.add(bucket.liquidity, amount);
        FHE.allowThis(bucket.totalShares);
        FHE.allowThis(bucket.liquidity);

        if (Common.isInitialized(position.shares)) {
            position.shares = FHE.add(position.shares, amount);
        } else {
            position.shares = amount;
        }
        position.proceedsPerShareSnapshot = bucket.proceedsPerShare;
        position.filledPerShareSnapshot = bucket.filledPerShare;

        FHE.allowThis(position.shares);
        FHE.allow(position.shares, msg.sender);
        FHE.allowThis(position.proceedsPerShareSnapshot);
        FHE.allowThis(position.filledPerShareSnapshot);

        // Update bitmap
        mapping(int16 => uint256) storage bitmap = side == BucketSide.BUY
            ? buyBitmaps[poolId] : sellBitmaps[poolId];
        TickBitmapLib.setBit(bitmap, tick, TICK_SPACING);

        // Transfer FHERC20 tokens
        address depositToken = side == BucketSide.SELL ? state.token0 : state.token1;
        FHE.allow(amount, depositToken);
        IFHERC20(depositToken)._transferFromEncrypted(msg.sender, address(this), amount);

        emit Deposit(poolId, msg.sender, tick, side);
    }

    /// @notice Withdraw unfilled liquidity from a limit order bucket
    /// @dev Only unfilled portions of orders can be withdrawn. Filled portions must be claimed.
    ///      The actual withdrawal amount is min(requested, unfilled).
    /// @param poolId The pool to withdraw from
    /// @param tick The price tick of the order
    /// @param side BUY or SELL
    /// @param encryptedAmount Encrypted amount to withdraw (capped at unfilled amount)
    function withdraw(
        PoolId poolId,
        int24 tick,
        BucketSide side,
        InEuint128 calldata encryptedAmount
    ) external whenNotPaused {
        PoolState storage state = poolStates[poolId];
        if (!state.initialized) revert PoolNotInitialized();

        euint128 amount = FHE.asEuint128(encryptedAmount);
        BucketLib.Bucket storage bucket = buckets[poolId][tick][side];
        BucketLib.UserPosition storage position = positions[poolId][msg.sender][tick][side];

        euint128 unfilledShares = BucketLib.calculateUnfilled(position, bucket, ENC_ZERO, ENC_PRECISION);
        euint128 withdrawAmount = FHE.select(FHE.lt(amount, unfilledShares), amount, unfilledShares);
        FHE.allowThis(withdrawAmount);

        bucket.totalShares = FHE.sub(bucket.totalShares, withdrawAmount);
        bucket.liquidity = FHE.sub(bucket.liquidity, withdrawAmount);
        FHE.allowThis(bucket.totalShares);
        FHE.allowThis(bucket.liquidity);

        position.shares = FHE.sub(position.shares, withdrawAmount);
        FHE.allowThis(position.shares);
        FHE.allow(position.shares, msg.sender);

        address withdrawToken = side == BucketSide.SELL ? state.token0 : state.token1;
        FHE.allow(withdrawAmount, withdrawToken);
        IFHERC20(withdrawToken)._transferEncrypted(msg.sender, withdrawAmount);

        emit Withdraw(poolId, msg.sender, tick, side);
    }

    /// @notice Claim proceeds from filled limit orders
    /// @dev Proceeds are the tokens received when your order was filled.
    ///      For SELL orders, proceeds are token1. For BUY orders, proceeds are token0.
    ///      Claims both realized proceeds (from auto-claim on deposit) and current unrealized.
    /// @param poolId The pool to claim from
    /// @param tick The price tick of the order
    /// @param side BUY or SELL
    function claim(PoolId poolId, int24 tick, BucketSide side) external whenNotPaused {
        PoolState storage state = poolStates[poolId];
        if (!state.initialized) revert PoolNotInitialized();

        BucketLib.Bucket storage bucket = buckets[poolId][tick][side];
        BucketLib.UserPosition storage position = positions[poolId][msg.sender][tick][side];

        euint128 currentProceeds = BucketLib.calculateProceeds(position, bucket, ENC_ZERO, ENC_PRECISION);
        euint128 totalProceeds = Common.isInitialized(position.realizedProceeds)
            ? FHE.add(currentProceeds, position.realizedProceeds)
            : currentProceeds;
        FHE.allowThis(totalProceeds);

        position.proceedsPerShareSnapshot = bucket.proceedsPerShare;
        position.realizedProceeds = ENC_ZERO;
        FHE.allowThis(position.realizedProceeds);
        FHE.allowThis(position.proceedsPerShareSnapshot);

        address proceedsToken = side == BucketSide.SELL ? state.token1 : state.token0;
        FHE.allow(totalProceeds, proceedsToken);
        IFHERC20(proceedsToken)._transferEncrypted(msg.sender, totalProceeds);

        emit Claim(poolId, msg.sender, tick, side);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    LP FUNCTIONS (Encrypted Only)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Add liquidity to the encrypted AMM
    /// @dev Liquidity is provided in encrypted amounts. LP tokens are also encrypted.
    ///      First deposit uses geometric mean, subsequent deposits use proportional calculation.
    ///      Both amounts are fully consumed (no refunds for imbalanced deposits).
    /// @param poolId The pool to add liquidity to
    /// @param amount0 Encrypted amount of token0 to deposit
    /// @param amount1 Encrypted amount of token1 to deposit
    /// @return lpAmount Encrypted LP tokens minted to the caller
    function addLiquidity(
        PoolId poolId,
        InEuint128 calldata amount0,
        InEuint128 calldata amount1
    ) external whenNotPaused returns (euint128 lpAmount) {
        PoolState storage state = poolStates[poolId];
        if (!state.initialized) revert PoolNotInitialized();

        euint128 amt0 = FHE.asEuint128(amount0);
        euint128 amt1 = FHE.asEuint128(amount1);
        FHE.allowThis(amt0);
        FHE.allowThis(amt1);

        // Transfer tokens
        FHE.allow(amt0, state.token0);
        FHE.allow(amt1, state.token1);
        IFHERC20(state.token0)._transferFromEncrypted(msg.sender, address(this), amt0);
        IFHERC20(state.token1)._transferFromEncrypted(msg.sender, address(this), amt1);

        PoolReserves storage reserves = poolReserves[poolId];

        // Calculate LP tokens
        ebool isFirstDeposit = FHE.eq(reserves.encTotalLpSupply, ENC_ZERO);
        ebool amt0Smaller = FHE.lt(amt0, amt1);
        euint128 minAmt = FHE.select(amt0Smaller, amt0, amt1);
        euint128 firstDepositLp = FHE.mul(minAmt, FHE.asEuint128(2));
        FHE.allowThis(firstDepositLp);

        euint128 safeRes0 = FHE.select(FHE.gt(reserves.encReserve0, ENC_ZERO), reserves.encReserve0, ENC_ONE);
        euint128 safeRes1 = FHE.select(FHE.gt(reserves.encReserve1, ENC_ZERO), reserves.encReserve1, ENC_ONE);
        FHE.allowThis(safeRes0);
        FHE.allowThis(safeRes1);

        euint128 lpFromAmt0 = FHE.div(FHE.mul(amt0, reserves.encTotalLpSupply), safeRes0);
        euint128 lpFromAmt1 = FHE.div(FHE.mul(amt1, reserves.encTotalLpSupply), safeRes1);
        euint128 subsequentLp = FHE.select(FHE.lt(lpFromAmt0, lpFromAmt1), lpFromAmt0, lpFromAmt1);
        FHE.allowThis(subsequentLp);

        lpAmount = FHE.select(isFirstDeposit, firstDepositLp, subsequentLp);
        FHE.allowThis(lpAmount);

        // Update reserves
        reserves.encReserve0 = FHE.add(reserves.encReserve0, amt0);
        reserves.encReserve1 = FHE.add(reserves.encReserve1, amt1);
        reserves.encTotalLpSupply = FHE.add(reserves.encTotalLpSupply, lpAmount);
        FHE.allowThis(reserves.encReserve0);
        FHE.allowThis(reserves.encReserve1);
        FHE.allowThis(reserves.encTotalLpSupply);

        // Update user balance
        euint128 currentBalance = encLpBalances[poolId][msg.sender];
        encLpBalances[poolId][msg.sender] = Common.isInitialized(currentBalance)
            ? FHE.add(currentBalance, lpAmount)
            : lpAmount;
        FHE.allowThis(encLpBalances[poolId][msg.sender]);
        FHE.allow(encLpBalances[poolId][msg.sender], msg.sender);

        _requestReserveSync(poolId);
        emit LiquidityAdded(poolId, msg.sender);
    }

    /// @notice Remove liquidity from the encrypted AMM
    /// @dev Burns LP tokens and returns proportional share of both tokens.
    ///      If requested amount exceeds balance, uses full balance instead.
    /// @param poolId The pool to remove liquidity from
    /// @param lpAmount Encrypted LP tokens to burn
    /// @return amount0 Encrypted amount of token0 returned
    /// @return amount1 Encrypted amount of token1 returned
    function removeLiquidity(
        PoolId poolId,
        InEuint128 calldata lpAmount
    ) external returns (euint128 amount0, euint128 amount1) {
        PoolState storage state = poolStates[poolId];
        PoolReserves storage reserves = poolReserves[poolId];

        euint128 requestedLp = FHE.asEuint128(lpAmount);
        FHE.allowThis(requestedLp);

        euint128 userBalance = encLpBalances[poolId][msg.sender];
        if (!Common.isInitialized(userBalance)) {
            return (ENC_ZERO, ENC_ZERO);
        }

        ebool exceedsBalance = FHE.gt(requestedLp, userBalance);
        euint128 lp = FHE.select(exceedsBalance, userBalance, requestedLp);
        FHE.allowThis(lp);

        euint128 safeTotalLp = FHE.select(
            FHE.gt(reserves.encTotalLpSupply, ENC_ZERO),
            reserves.encTotalLpSupply,
            ENC_ONE
        );
        FHE.allowThis(safeTotalLp);

        amount0 = FHE.div(FHE.mul(lp, reserves.encReserve0), safeTotalLp);
        amount1 = FHE.div(FHE.mul(lp, reserves.encReserve1), safeTotalLp);
        FHE.allowThis(amount0);
        FHE.allowThis(amount1);

        reserves.encTotalLpSupply = FHE.sub(reserves.encTotalLpSupply, lp);
        encLpBalances[poolId][msg.sender] = FHE.sub(userBalance, lp);
        reserves.encReserve0 = FHE.sub(reserves.encReserve0, amount0);
        reserves.encReserve1 = FHE.sub(reserves.encReserve1, amount1);

        FHE.allowThis(reserves.encTotalLpSupply);
        FHE.allowThis(encLpBalances[poolId][msg.sender]);
        FHE.allow(encLpBalances[poolId][msg.sender], msg.sender);
        FHE.allowThis(reserves.encReserve0);
        FHE.allowThis(reserves.encReserve1);

        FHE.allow(amount0, state.token0);
        FHE.allow(amount1, state.token1);
        IFHERC20(state.token0)._transferEncrypted(msg.sender, amount0);
        IFHERC20(state.token1)._transferEncrypted(msg.sender, amount1);

        _requestReserveSync(poolId);
        emit LiquidityRemoved(poolId, msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                      RESERVE SYNC (Binary Search)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Request a new reserve sync with binary search to harvest resolved requests
    /// @dev Uses counter + mapping pattern to avoid losing pending handles during high traffic
    function _requestReserveSync(PoolId poolId) internal {
        _harvestResolvedDecrypts(poolId);

        PoolReserves storage r = poolReserves[poolId];
        uint256 newId = r.nextRequestId;
        r.nextRequestId = newId + 1;
        pendingDecrypts[poolId][newId] = PendingDecrypt({
            reserve0: r.encReserve0,
            reserve1: r.encReserve1,
            blockNumber: block.number
        });
        FHE.decrypt(r.encReserve0);
        FHE.decrypt(r.encReserve1);

        emit ReserveSyncRequested(poolId, newId, block.number);
    }

    /// @notice Attempt to sync plaintext reserves from resolved decrypts
    /// @dev Can be called by anyone to update the plaintext reserve cache.
    ///      Useful when reserves are stale and no swaps are occurring.
    /// @param poolId The pool to sync
    function trySyncReserves(PoolId poolId) external {
        _harvestResolvedDecrypts(poolId);
    }

    /// @notice Binary search to find newest resolved pending decrypt
    function _findNewestResolvedDecrypt(PoolId poolId) internal view returns (
        uint256 newestId,
        uint256 val0,
        uint256 val1
    ) {
        PoolReserves storage r = poolReserves[poolId];
        uint256 lo = r.lastResolvedId;
        uint256 hi = r.nextRequestId > 0 ? r.nextRequestId - 1 : 0;
        val0 = r.reserve0;
        val1 = r.reserve1;
        newestId = lo;

        if (lo > hi) return (newestId, val0, val1);

        while (lo <= hi) {
            uint256 mid = lo + (hi - lo + 1) / 2;
            PendingDecrypt storage p = pendingDecrypts[poolId][mid];

            if (!Common.isInitialized(p.reserve0)) {
                if (mid == 0) break;
                hi = mid - 1;
                continue;
            }

            (uint256 v0, bool ready0) = FHE.getDecryptResultSafe(p.reserve0);
            (uint256 v1, bool ready1) = FHE.getDecryptResultSafe(p.reserve1);

            if (ready0 && ready1) {
                val0 = v0;
                val1 = v1;
                newestId = mid;
                if (mid == hi) break;
                lo = mid + 1;
            } else {
                if (mid == 0) break;
                hi = mid - 1;
            }
        }
    }

    /// @notice Apply newest resolved decrypt to storage
    function _harvestResolvedDecrypts(PoolId poolId) internal {
        (uint256 newestId, uint256 val0, uint256 val1) = _findNewestResolvedDecrypt(poolId);
        PoolReserves storage r = poolReserves[poolId];

        if (newestId > r.lastResolvedId) {
            r.reserve0 = val0;
            r.reserve1 = val1;
            r.reserveBlockNumber = pendingDecrypts[poolId][newestId].blockNumber;
            r.lastResolvedId = newestId;
            emit ReservesSynced(poolId, val0, val1, newestId);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Get the current plaintext reserves for a pool
    /// @dev Automatically checks for resolved async decrypts via binary search
    /// @param poolId The pool to query
    /// @return reserve0 Current reserve of token0 (includes resolved pending decrypts)
    /// @return reserve1 Current reserve of token1 (includes resolved pending decrypts)
    function getReserves(PoolId poolId) external view returns (uint256, uint256) {
        (, uint256 val0, uint256 val1) = _findNewestResolvedDecrypt(poolId);
        return (val0, val1);
    }

    /// @notice Get the current price tick based on reserves
    /// @dev Automatically checks for resolved async decrypts
    /// @param poolId The pool to query
    /// @return The current tick (price = 1.006^tick)
    function getCurrentTick(PoolId poolId) external view returns (int24) {
        (, uint256 val0, uint256 val1) = _findNewestResolvedDecrypt(poolId);
        return FheatherMath.getCurrentTick(val0, val1, TICK_SPACING);
    }

    /// @notice Get a quote for a swap (estimated output based on current reserves)
    /// @dev Automatically checks for resolved async decrypts
    /// @param poolId The pool to query
    /// @param zeroForOne True if swapping token0 for token1
    /// @param amountIn Amount of input tokens
    /// @return Estimated output amount (actual may differ due to price movement)
    function getQuote(PoolId poolId, bool zeroForOne, uint256 amountIn) external view returns (uint256) {
        (, uint256 val0, uint256 val1) = _findNewestResolvedDecrypt(poolId);
        uint256 reserveIn = zeroForOne ? val0 : val1;
        uint256 reserveOut = zeroForOne ? val1 : val0;
        return FheatherMath.estimateOutput(reserveIn, reserveOut, amountIn, swapFeeBps);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Pause all user-facing operations (emergency only)
    function pause() external onlyOwner { _pause(); }

    /// @notice Unpause the contract
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Set the address that receives protocol fees
    /// @param _feeCollector New fee collector address
    function setFeeCollector(address _feeCollector) external onlyOwner {
        feeCollector = _feeCollector;
    }

    /// @notice Set the protocol fee for a specific pool
    /// @param poolId The pool to configure
    /// @param _feeBps Fee in basis points (max 100 = 1%)
    function setProtocolFee(PoolId poolId, uint256 _feeBps) external onlyOwner {
        if (_feeBps > 100) revert FeeTooHigh();
        poolStates[poolId].protocolFeeBps = _feeBps;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                     TEST/MOCK HELPERS (Owner Only)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Manually set plaintext reserves for testing purposes
    /// @dev In production, plaintext reserves are synced via async decrypts.
    ///      This function allows tests to bypass the async mechanism.
    ///      ONLY callable by owner - DO NOT use in production.
    /// @param poolId The pool to update
    /// @param reserve0 Plaintext reserve for token0
    /// @param reserve1 Plaintext reserve for token1
    function MOCK_setPlaintextReserves(
        PoolId poolId,
        uint256 reserve0,
        uint256 reserve1
    ) external onlyOwner {
        PoolReserves storage r = poolReserves[poolId];
        r.reserve0 = reserve0;
        r.reserve1 = reserve1;
        r.reserveBlockNumber = block.number;
    }

    /// @notice Get raw plaintext reserves from storage (for debugging)
    /// @dev Returns the direct storage values without checking for pending decrypts
    /// @param poolId The pool to query
    /// @return reserve0 Direct storage value for reserve0
    /// @return reserve1 Direct storage value for reserve1
    function getReservesRaw(PoolId poolId) external view returns (uint256, uint256) {
        PoolReserves storage r = poolReserves[poolId];
        return (r.reserve0, r.reserve1);
    }

    /// @notice Get current tick calculated from raw storage reserves (for debugging)
    /// @dev Uses the same calculation as deposit() for debugging PriceMoved errors
    /// @param poolId The pool to query
    /// @return Current tick calculated from raw reserves
    function MOCK_getCurrentTick(PoolId poolId) external view returns (int24) {
        PoolReserves storage r = poolReserves[poolId];
        return FheatherMath.getCurrentTick(r.reserve0, r.reserve1, TICK_SPACING);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Check if a token implements FHERC20 interface
    /// @param token Address to check
    /// @return True if token has balanceOfEncrypted function
    function _isFherc20(address token) internal view returns (bool) {
        (bool success, ) = token.staticcall(
            abi.encodeWithSelector(bytes4(keccak256("balanceOfEncrypted(address)")), address(0))
        );
        return success;
    }
}
