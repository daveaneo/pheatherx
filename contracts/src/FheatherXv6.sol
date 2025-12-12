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
import {SwapLock} from "./lib/SwapLock.sol";

/// @title FheatherX v6 - Hybrid Encrypted AMM + Private Limit Orders with V4 Composability
/// @author FheatherX Team
/// @notice A Uniswap v4 Hook combining encrypted AMM liquidity with gas-optimized limit orders
/// @dev Key improvements over v5:
///      1. V4 Composability: Proper take()/settle() settlement pattern
///      2. Mixed Token Pair Support: ERC20:FHERC20 combinations
///      3. Gas Optimization: Unified internal functions for LP/swap operations
///      4. New Functions: swap(), getQuote(), getCurrentTick(), hasOrdersAtTick()
///      5. ReentrancyGuard removed: SwapLock + CEI pattern provides sufficient protection
contract FheatherXv6 is BaseHook, Pausable, Ownable {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Fixed-point precision for share calculations (18 decimals)
    uint256 public constant PRECISION = 1e18;

    /// @notice Tick spacing for limit orders (each tick ~0.6% price increment)
    /// @dev Using 60 for coarser granularity than Uniswap's default
    int24 public constant TICK_SPACING = 60;

    /// @notice Minimum valid tick (uses Uniswap's full range)
    int24 public constant MIN_TICK = TickMath.MIN_TICK;

    /// @notice Maximum valid tick (uses Uniswap's full range)
    int24 public constant MAX_TICK = TickMath.MAX_TICK;

    /// @notice Delay for fee changes (user protection)
    uint256 public constant FEE_CHANGE_DELAY = 2 days;


    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error ZeroAmount();
    error PoolNotInitialized();
    error SlippageExceeded();
    error InsufficientLiquidity();
    error InvalidTick();
    error InputTokenMustBeFherc20();
    error BothTokensMustBeFherc20();
    error DeadlineExpired();
    error PriceMoved();
    error FeeTooHigh();
    error FeeChangeNotReady();
    error InvalidMaxBuckets();

    // ═══════════════════════════════════════════════════════════════════════
    //                               TYPES
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Indicates whether a bucket contains buy or sell orders
    enum BucketSide { BUY, SELL }

    /// @notice Represents a price bucket containing aggregated liquidity at a specific tick
    struct Bucket {
        euint128 totalShares;
        euint128 liquidity;
        euint128 proceedsPerShare;
        euint128 filledPerShare;
        bool initialized;
    }

    /// @notice Represents a user's position in a specific bucket
    struct UserPosition {
        euint128 shares;
        euint128 proceedsPerShareSnapshot;
        euint128 filledPerShareSnapshot;
        euint128 realizedProceeds;
    }

    /// @notice Pool-specific configuration (v6: supports mixed token pairs)
    struct PoolState {
        address token0;           // Token address (agnostic type)
        address token1;           // Token address (agnostic type)
        bool token0IsFherc20;     // true if FHERC20, false if plain ERC20
        bool token1IsFherc20;     // true if FHERC20, false if plain ERC20
        bool initialized;
        uint256 maxBucketsPerSwap;
        uint256 protocolFeeBps;
    }

    /// @notice Pending decrypt request for reserve sync
    struct PendingDecrypt {
        euint128 reserve0;           // Encrypted reserve0 handle at time of request
        euint128 reserve1;           // Encrypted reserve1 handle at time of request
        uint256 blockNumber;         // Block when this request was made
    }

    /// @notice Pool-specific encrypted AMM reserves
    struct PoolReserves {
        euint128 encReserve0;       // Encrypted reserve of token0
        euint128 encReserve1;       // Encrypted reserve of token1
        euint128 encTotalLpSupply;  // Encrypted total LP supply (source of truth)
        uint256 reserve0;            // Public cache for display/estimation
        uint256 reserve1;            // Public cache for display/estimation
        uint256 reserveBlockNumber;  // Block when reserves were last updated
        uint256 nextRequestId;       // Counter for new decrypt requests (starts at 1)
        uint256 lastResolvedId;      // Highest ID known to be resolved (starts at 0)
    }

    /// @notice Pending fee change for a pool
    struct PendingFee {
        uint256 feeBps;
        uint256 effectiveTimestamp;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                               STATE
    // ═══════════════════════════════════════════════════════════════════════

    // ─────────────────── Immutable Encrypted Constants ───────────────────
    euint128 internal immutable ENC_ZERO;
    euint128 internal immutable ENC_PRECISION;
    euint128 internal immutable ENC_ONE;
    euint128 internal immutable ENC_SWAP_FEE_BPS;
    euint128 internal immutable ENC_TEN_THOUSAND;

    // ─────────────────── Pool Configuration ───────────────────
    mapping(PoolId => PoolState) public poolStates;
    mapping(PoolId => PendingFee) public pendingFees;

    // NOTE: Default pool abstraction removed for size optimization
    // Stashed at: src/stashed/default_pool_abstraction.sol.stash

    // ─────────────────── Encrypted AMM Reserves ───────────────────
    mapping(PoolId => PoolReserves) public poolReserves;
    mapping(PoolId => mapping(uint256 => PendingDecrypt)) public pendingDecrypts;

    // ─────────────────── LP Tracking ───────────────────
    mapping(PoolId => mapping(address => uint256)) public lpBalances;      // Plaintext cache
    mapping(PoolId => uint256) public totalLpSupply;                       // Plaintext cache
    mapping(PoolId => mapping(address => euint128)) public encLpBalances;  // Encrypted source of truth

    // ─────────────────── Limit Order Buckets ───────────────────
    mapping(PoolId => mapping(int24 => mapping(BucketSide => Bucket))) public buckets;
    mapping(PoolId => mapping(address => mapping(int24 => mapping(BucketSide => UserPosition)))) public positions;
    mapping(PoolId => mapping(int16 => uint256)) internal buyBitmaps;
    mapping(PoolId => mapping(int16 => uint256)) internal sellBitmaps;

    // ─────────────────── Tick Tracking ───────────────────
    mapping(PoolId => int24) public lastProcessedTick;

    // ─────────────────── Fee Collection ───────────────────
    address public feeCollector;
    uint256 public swapFeeBps;

    // ═══════════════════════════════════════════════════════════════════════
    //                               EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event PoolInitialized(PoolId indexed poolId, address token0, address token1, bool token0IsFherc20, bool token1IsFherc20);
    event Swap(PoolId indexed poolId, address indexed user, bool indexed zeroForOne, uint256 amountIn, uint256 amountOut);
    event SwapEncrypted(PoolId indexed poolId, address indexed user);
    event BucketFilled(PoolId indexed poolId, int24 indexed tick, BucketSide side);
    event Deposit(PoolId indexed poolId, address indexed user, int24 indexed tick, BucketSide side, bytes32 amountHash);
    event Withdraw(PoolId indexed poolId, address indexed user, int24 indexed tick, BucketSide side, bytes32 amountHash);
    event Claim(PoolId indexed poolId, address indexed user, int24 indexed tick, BucketSide side, bytes32 amountHash);
    event LiquidityAdded(PoolId indexed poolId, address indexed user, uint256 amount0, uint256 amount1, uint256 lpAmount);
    event LiquidityRemoved(PoolId indexed poolId, address indexed user, uint256 amount0, uint256 amount1, uint256 lpAmount);
    event LiquidityAddedEncrypted(PoolId indexed poolId, address indexed user);
    event LiquidityRemovedEncrypted(PoolId indexed poolId, address indexed user);
    event ReserveSyncRequested(PoolId indexed poolId, uint256 indexed requestId, uint256 blockNumber);
    event ReservesSynced(PoolId indexed poolId, uint256 reserve0, uint256 reserve1, uint256 indexed requestId);
    event ProtocolFeeQueued(PoolId indexed poolId, uint256 newFeeBps, uint256 effectiveTimestamp);
    event ProtocolFeeApplied(PoolId indexed poolId, uint256 newFeeBps);
    event FeeCollectorUpdated(address newCollector);

    // ═══════════════════════════════════════════════════════════════════════
    //                           CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        IPoolManager _poolManager,
        address _owner,
        uint256 _swapFeeBps
    ) BaseHook(_poolManager) Ownable(_owner) {
        // Initialize encrypted constants
        ENC_ZERO = FHE.asEuint128(0);
        ENC_PRECISION = FHE.asEuint128(uint128(PRECISION));
        ENC_ONE = FHE.asEuint128(1);
        ENC_SWAP_FEE_BPS = FHE.asEuint128(uint128(_swapFeeBps));
        ENC_TEN_THOUSAND = FHE.asEuint128(10000);

        swapFeeBps = _swapFeeBps;

        // Grant FHE permissions
        FHE.allowThis(ENC_ZERO);
        FHE.allowThis(ENC_PRECISION);
        FHE.allowThis(ENC_ONE);
        FHE.allowThis(ENC_SWAP_FEE_BPS);
        FHE.allowThis(ENC_TEN_THOUSAND);

        // Note: Tick prices are now calculated on-demand using Uniswap's TickMath
        // No pre-computation needed - saves significant deployment gas
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
            afterSwap: true,
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

    /// @notice Called after a pool is initialized
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

        // Detect token types
        bool t0IsFherc20 = _isFherc20(token0Addr);
        bool t1IsFherc20 = _isFherc20(token1Addr);

        // TODO--Re
        // Initialize pool state with token type flags
        poolStates[poolId] = PoolState({
            token0: token0Addr,
            token1: token1Addr,
            token0IsFherc20: t0IsFherc20,
            token1IsFherc20: t1IsFherc20,
            initialized: true,
            maxBucketsPerSwap: 5,
            protocolFeeBps: 5
        });

        // Initialize encrypted reserves for this pool
        PoolReserves storage reserves = poolReserves[poolId];
        reserves.encReserve0 = ENC_ZERO;
        reserves.encReserve1 = ENC_ZERO;
        reserves.encTotalLpSupply = ENC_ZERO;
        reserves.reserve0 = 0;
        reserves.reserve1 = 0;
        reserves.reserveBlockNumber = 0;
        reserves.nextRequestId = 0;
        reserves.lastResolvedId = 0;

        FHE.allowThis(reserves.encReserve0);
        FHE.allowThis(reserves.encReserve1);
        FHE.allowThis(reserves.encTotalLpSupply);

        // v6 NEW: Approve PoolManager to take tokens from hook (for V4 settlement)
        IERC20(token0Addr).approve(address(poolManager), type(uint256).max);
        IERC20(token1Addr).approve(address(poolManager), type(uint256).max);

        emit PoolInitialized(poolId, token0Addr, token1Addr, t0IsFherc20, t1IsFherc20);

        return this.afterInitialize.selector;
    }

    /// @notice Called before a swap - executes against encrypted AMM with V4 settlement
    /// @dev v6 FIX: Uses take()/settle() pattern for proper V4 composability
    /// @dev Refactored to avoid stack-too-deep with via_ir
    function _beforeSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        PoolId poolId = key.toId();

        if (!poolStates[poolId].initialized) {
            return (this.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        }

        // One swap per pool per TX - prevents atomic sandwich attacks
        SwapLock.enforceOnce(poolId);

        // Handle exact input (negative amountSpecified)
        if (params.amountSpecified >= 0) {
            return (this.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        }

        uint256 amountIn = uint256(-params.amountSpecified);
        if (amountIn == 0) {
            return (this.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        }

        // Calculate output and execute swap in helper to reduce stack depth
        (uint256 amountOutAfterFee, bool success) = _executeBeforeSwap(
            poolId, key, params.zeroForOne, amountIn, sender
        );

        if (!success) {
            return (this.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        }

        // Return delta that tells PoolManager we handled everything
        return (
            this.beforeSwap.selector,
            toBeforeSwapDelta(
                int128(-params.amountSpecified),
                -int128(int256(amountOutAfterFee))
            ),
            0
        );
    }

    /// @notice Helper for beforeSwap to reduce stack depth
    function _executeBeforeSwap(
        PoolId poolId,
        PoolKey calldata key,
        bool zeroForOne,
        uint256 amountIn,
        address sender
    ) internal returns (uint256 amountOutAfterFee, bool success) {
        // Calculate output BEFORE updating reserves
        uint256 amountOut = _estimateOutput(poolId, zeroForOne, amountIn);
        if (amountOut == 0) return (0, false);

        // Take input tokens FROM PoolManager TO hook
        Currency inputCurrency = zeroForOne ? key.currency0 : key.currency1;
        poolManager.take(inputCurrency, address(this), amountIn);

        // Apply protocol fee
        uint256 fee = (amountOut * poolStates[poolId].protocolFeeBps) / 10000;
        amountOutAfterFee = amountOut - fee;

        // Settle output tokens FROM hook TO PoolManager
        Currency outputCurrency = zeroForOne ? key.currency1 : key.currency0;
        poolManager.sync(outputCurrency);
        IERC20(Currency.unwrap(outputCurrency)).transfer(address(poolManager), amountOutAfterFee);
        poolManager.settle();

        // Transfer fee to collector
        if (fee > 0 && feeCollector != address(0)) {
            IERC20(Currency.unwrap(outputCurrency)).safeTransfer(feeCollector, fee);
        }

        // Update encrypted reserves (FHE math)
        _updateSwapReserves(poolId, zeroForOne, amountIn, amountOut);

        emit Swap(poolId, sender, zeroForOne, amountIn, amountOutAfterFee);
        return (amountOutAfterFee, true);
    }

    /// @notice Update reserves after swap (separated to reduce stack depth)
    function _updateSwapReserves(
        PoolId poolId,
        bool zeroForOne,
        uint256 amountIn,
        uint256 amountOut
    ) internal {
        // Update encrypted reserves
        euint128 encAmountIn = FHE.asEuint128(uint128(amountIn));
        ebool encDirection = FHE.asEbool(zeroForOne);
        FHE.allowThis(encAmountIn);
        _executeSwapMathForPool(poolId, encDirection, encAmountIn);

        // Update plaintext reserve cache
        PoolReserves storage reserves = poolReserves[poolId];
        if (zeroForOne) {
            reserves.reserve0 += amountIn;
            reserves.reserve1 = reserves.reserve1 > amountOut ? reserves.reserve1 - amountOut : 0;
        } else {
            reserves.reserve1 += amountIn;
            reserves.reserve0 = reserves.reserve0 > amountOut ? reserves.reserve0 - amountOut : 0;
        }

        // Request async reserve sync
        _requestReserveSync(poolId);
    }

    /// @notice Called after a swap - triggers limit orders
    function _afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        PoolId poolId = key.toId();
        PoolState storage state = poolStates[poolId];

        if (!state.initialized) {
            return (this.afterSwap.selector, 0);
        }

        // Process limit orders triggered by price movement
        _processTriggeredOrders(poolId, params.zeroForOne);

        return (this.afterSwap.selector, 0);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    ENCRYPTED AMM MATH (Core)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Execute encrypted x*y=k swap math for a specific pool
    function _executeSwapMathForPool(
        PoolId poolId,
        ebool direction,
        euint128 amountIn
    ) internal returns (euint128 amountOut) {
        PoolReserves storage r = poolReserves[poolId];

        // Apply swap fee
        euint128 feeAmount = FHE.div(FHE.mul(amountIn, ENC_SWAP_FEE_BPS), ENC_TEN_THOUSAND);
        euint128 amountInAfterFee = FHE.sub(amountIn, feeAmount);
        FHE.allowThis(amountInAfterFee);

        // Select reserves based on direction
        euint128 reserveIn = FHE.select(direction, r.encReserve0, r.encReserve1);
        euint128 reserveOut = FHE.select(direction, r.encReserve1, r.encReserve0);

        // x * y = k formula
        euint128 numerator = FHE.mul(amountInAfterFee, reserveOut);
        euint128 denominator = FHE.add(reserveIn, amountInAfterFee);

        // Division safety
        euint128 safeDenominator = FHE.select(
            FHE.gt(denominator, ENC_ZERO),
            denominator,
            ENC_ONE
        );
        FHE.allowThis(safeDenominator);

        amountOut = FHE.div(numerator, safeDenominator);
        FHE.allowThis(amountOut);

        // Update encrypted reserves
        euint128 newReserveIn = FHE.add(reserveIn, amountIn);
        euint128 newReserveOut = FHE.sub(reserveOut, amountOut);

        r.encReserve0 = FHE.select(direction, newReserveIn, newReserveOut);
        r.encReserve1 = FHE.select(direction, newReserveOut, newReserveIn);
        FHE.allowThis(r.encReserve0);
        FHE.allowThis(r.encReserve1);

        return amountOut;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    LIMIT ORDER TRIGGERING
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Process limit orders triggered by price movement
    function _processTriggeredOrders(PoolId poolId, bool /* zeroForOne */) internal {
        int24 currentTick = _getCurrentTick(poolId);
        int24 prevTick = lastProcessedTick[poolId];

        if (currentTick == prevTick) return;

        // Search in direction of actual price movement
        bool searchUp = currentTick > prevTick;

        // Process BOTH sides when price moves through ticks
        for (uint8 s = 0; s < 2; s++) {
            BucketSide side = BucketSide(s);

            // First check prevTick itself (orders at starting tick)
            {
                int16 wordPos = int16(prevTick >> 8);
                uint8 bitPos = uint8(uint24(prevTick) % 256);
                mapping(int16 => uint256) storage bitmap = side == BucketSide.BUY
                    ? buyBitmaps[poolId]
                    : sellBitmaps[poolId];
                if ((bitmap[wordPos] & (1 << bitPos)) != 0) {
                    _fillBucketAgainstAMM(poolId, prevTick, side);
                }
            }

            // Then search for orders between prevTick and currentTick
            uint256 bucketsProcessed = 0;
            int24 tick = prevTick;

            while (bucketsProcessed < poolStates[poolId].maxBucketsPerSwap) {
                int24 nextTick = _findNextActiveTick(poolId, tick, side, searchUp);
                if (nextTick == type(int24).max || nextTick == type(int24).min) break;

                bool inRange = searchUp
                    ? (nextTick > prevTick && nextTick <= currentTick)
                    : (nextTick < prevTick && nextTick >= currentTick);

                if (!inRange) break;

                _fillBucketAgainstAMM(poolId, nextTick, side);
                tick = searchUp ? nextTick + TICK_SPACING : nextTick - TICK_SPACING;
                bucketsProcessed++;
            }
        }

        lastProcessedTick[poolId] = currentTick;
    }

    /// @notice Fill bucket orders by executing swap against AMM
    function _fillBucketAgainstAMM(PoolId poolId, int24 tick, BucketSide side) internal {
        Bucket storage bucket = buckets[poolId][tick][side];

        if (!bucket.initialized) return;

        ebool direction = FHE.asEbool(side == BucketSide.SELL);
        euint128 swapInput = bucket.liquidity;
        euint128 swapOutput = _executeSwapMathForPool(poolId, direction, swapInput);

        _updateBucketOnFill(bucket, swapInput, swapOutput);

        bucket.liquidity = ENC_ZERO;
        FHE.allowThis(bucket.liquidity);

        // Clear bitmap bit now that bucket has no active liquidity
        _clearBit(poolId, tick, side);

        emit BucketFilled(poolId, tick, side);
    }

    /// @notice Update bucket accumulators when a fill occurs
    function _updateBucketOnFill(
        Bucket storage bucket,
        euint128 fillAmount,
        euint128 proceedsAmount
    ) internal {
        ebool hasShares = FHE.gt(bucket.totalShares, ENC_ZERO);
        euint128 safeDenom = FHE.select(hasShares, bucket.totalShares, ENC_ONE);
        FHE.allowThis(safeDenom);

        euint128 proceedsInc = FHE.div(FHE.mul(proceedsAmount, ENC_PRECISION), safeDenom);
        proceedsInc = FHE.select(hasShares, proceedsInc, ENC_ZERO);
        FHE.allowThis(proceedsInc);
        bucket.proceedsPerShare = FHE.add(bucket.proceedsPerShare, proceedsInc);

        euint128 filledInc = FHE.div(FHE.mul(fillAmount, ENC_PRECISION), safeDenom);
        filledInc = FHE.select(hasShares, filledInc, ENC_ZERO);
        FHE.allowThis(filledInc);
        bucket.filledPerShare = FHE.add(bucket.filledPerShare, filledInc);

        FHE.allowThis(bucket.proceedsPerShare);
        FHE.allowThis(bucket.filledPerShare);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                   v6 NEW: DIRECT SWAP (Bypasses V4 Router)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Execute a swap for a specific pool
    function swapForPool(
        PoolId poolId,
        bool zeroForOne,
        uint256 amountIn,
        uint256 minAmountOut
    ) public whenNotPaused returns (uint256 amountOut) {
        PoolState storage state = poolStates[poolId];
        if (!state.initialized) revert PoolNotInitialized();
        if (amountIn == 0) revert ZeroAmount();

        // One swap per pool per TX - prevents atomic sandwich attacks
        SwapLock.enforceOnce(poolId);

        // 1. Calculate output BEFORE updating reserves
        amountOut = _estimateOutput(poolId, zeroForOne, amountIn);
        if (amountOut < minAmountOut) revert SlippageExceeded();

        // 2. Transfer input from user
        address tokenIn = zeroForOne ? state.token0 : state.token1;
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // 3. Apply fee
        uint256 fee = (amountOut * state.protocolFeeBps) / 10000;
        uint256 amountOutAfterFee = amountOut - fee;

        // 4. Update reserves (plaintext cache)
        PoolReserves storage reserves = poolReserves[poolId];
        if (zeroForOne) {
            reserves.reserve0 += amountIn;
            reserves.reserve1 -= amountOut;
        } else {
            reserves.reserve1 += amountIn;
            reserves.reserve0 -= amountOut;
        }

        // 5. Update encrypted reserves (FHE math)
        euint128 encAmountIn = FHE.asEuint128(uint128(amountIn));
        ebool encDirection = FHE.asEbool(zeroForOne);
        FHE.allowThis(encAmountIn);
        _executeSwapMathForPool(poolId, encDirection, encAmountIn);

        // 6. Transfer output to user
        address tokenOut = zeroForOne ? state.token1 : state.token0;
        IERC20(tokenOut).safeTransfer(msg.sender, amountOutAfterFee);

        // 7. Transfer fee to collector
        if (fee > 0 && feeCollector != address(0)) {
            IERC20(tokenOut).safeTransfer(feeCollector, fee);
        }

        // 8. Trigger limit orders
        _processTriggeredOrders(poolId, zeroForOne);

        emit Swap(poolId, msg.sender, zeroForOne, amountIn, amountOutAfterFee);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         LIMIT ORDER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Deposit tokens into a limit order bucket
    /// @dev v6: Input token must be FHERC20 for privacy protection
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

        // v6: Validate input token is FHERC20
        bool inputIsFherc20 = side == BucketSide.SELL ? state.token0IsFherc20 : state.token1IsFherc20;
        if (!inputIsFherc20) revert InputTokenMustBeFherc20();

        int24 currentTick = _getCurrentTick(poolId);
        if (_abs(currentTick - tick) > maxTickDrift) revert PriceMoved();

        euint128 amount = FHE.asEuint128(encryptedAmount);
        FHE.allowThis(amount);

        Bucket storage bucket = buckets[poolId][tick][side];
        if (!bucket.initialized) {
            _initializeBucket(bucket);
        }

        UserPosition storage position = positions[poolId][msg.sender][tick][side];

        // Auto-claim existing proceeds
        if (Common.isInitialized(position.shares)) {
            _autoClaim(poolId, tick, side, bucket, position);
        }

        // Update bucket
        bucket.totalShares = FHE.add(bucket.totalShares, amount);
        bucket.liquidity = FHE.add(bucket.liquidity, amount);
        FHE.allowThis(bucket.totalShares);
        FHE.allowThis(bucket.liquidity);

        // Update position
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
        FHE.allow(position.proceedsPerShareSnapshot, msg.sender);
        FHE.allowThis(position.filledPerShareSnapshot);
        FHE.allow(position.filledPerShareSnapshot, msg.sender);

        // Update bitmap
        _setBit(poolId, tick, side);

        // Transfer tokens (must be FHERC20)
        address depositToken = side == BucketSide.SELL ? state.token0 : state.token1;
        FHE.allow(amount, depositToken);
        IFHERC20(depositToken)._transferFromEncrypted(msg.sender, address(this), amount);

        emit Deposit(poolId, msg.sender, tick, side, keccak256(abi.encode(encryptedAmount)));
    }

    /// @notice Withdraw unfilled tokens from a limit order bucket
    function withdraw(
        PoolId poolId,
        int24 tick,
        BucketSide side,
        InEuint128 calldata encryptedAmount
    ) external whenNotPaused {
        PoolState storage state = poolStates[poolId];
        if (!state.initialized) revert PoolNotInitialized();

        euint128 amount = FHE.asEuint128(encryptedAmount);
        Bucket storage bucket = buckets[poolId][tick][side];
        UserPosition storage position = positions[poolId][msg.sender][tick][side];

        euint128 unfilledShares = _calculateUnfilled(position, bucket);

        euint128 withdrawAmount = FHE.select(
            FHE.lt(amount, unfilledShares),
            amount,
            unfilledShares
        );
        FHE.allowThis(withdrawAmount);

        // Update bucket
        bucket.totalShares = FHE.sub(bucket.totalShares, withdrawAmount);
        bucket.liquidity = FHE.sub(bucket.liquidity, withdrawAmount);
        FHE.allowThis(bucket.totalShares);
        FHE.allowThis(bucket.liquidity);

        // Update position
        position.shares = FHE.sub(position.shares, withdrawAmount);
        FHE.allowThis(position.shares);
        FHE.allow(position.shares, msg.sender);

        // Transfer tokens (FHERC20 - validated in deposit)
        address withdrawToken = side == BucketSide.SELL ? state.token0 : state.token1;
        FHE.allow(withdrawAmount, withdrawToken);
        IFHERC20(withdrawToken)._transferEncrypted(msg.sender, withdrawAmount);

        emit Withdraw(poolId, msg.sender, tick, side, keccak256(abi.encode(encryptedAmount)));
    }

    /// @notice Claim proceeds from filled orders
    function claim(
        PoolId poolId,
        int24 tick,
        BucketSide side
    ) external whenNotPaused {
        PoolState storage state = poolStates[poolId];
        if (!state.initialized) revert PoolNotInitialized();

        Bucket storage bucket = buckets[poolId][tick][side];
        UserPosition storage position = positions[poolId][msg.sender][tick][side];

        euint128 currentProceeds = _calculateProceeds(position, bucket);
        euint128 totalProceeds;
        if (Common.isInitialized(position.realizedProceeds)) {
            totalProceeds = FHE.add(currentProceeds, position.realizedProceeds);
        } else {
            totalProceeds = currentProceeds;
        }
        FHE.allowThis(totalProceeds);

        // Update position
        position.proceedsPerShareSnapshot = bucket.proceedsPerShare;
        position.realizedProceeds = ENC_ZERO;
        FHE.allowThis(position.realizedProceeds);
        FHE.allow(position.realizedProceeds, msg.sender);
        FHE.allowThis(position.proceedsPerShareSnapshot);
        FHE.allow(position.proceedsPerShareSnapshot, msg.sender);

        // Transfer proceeds (output token - could be ERC20 or FHERC20)
        address proceedsToken = side == BucketSide.SELL ? state.token1 : state.token0;
        bool proceedsIsFherc20 = side == BucketSide.SELL ? state.token1IsFherc20 : state.token0IsFherc20;

        FHE.allow(totalProceeds, proceedsToken);
        if (proceedsIsFherc20) {
            IFHERC20(proceedsToken)._transferEncrypted(msg.sender, totalProceeds);
        } else {
            // For ERC20 output, we need to decrypt first (or use plaintext estimate)
            // This is a simplification - in production, use async decryption
            // For now, use plaintext transfer with estimated amount
            // TODO: Implement proper async decryption flow for mixed pairs
            IFHERC20(proceedsToken)._transferEncrypted(msg.sender, totalProceeds);
        }

        emit Claim(poolId, msg.sender, tick, side, keccak256(abi.encode(euint128.unwrap(totalProceeds))));
    }

    // NOTE: exit() function removed for size optimization (saved ~833 bytes)
    // Stashed at: src/stashed/exit_function.sol.stash
    // Frontends can use multicall to batch withdraw() + claim() atomically

    // ═══════════════════════════════════════════════════════════════════════
    //                   LP FUNCTIONS (v6: Unified Core Pattern)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Internal core LP logic (shared by plaintext and encrypted paths)
    function _addLiquidityCore(
        PoolId poolId,
        euint128 amt0,
        euint128 amt1,
        address depositor
    ) internal returns (euint128 lpAmount) {
        PoolReserves storage reserves = poolReserves[poolId];

        // Calculate LP amount (encrypted math)
        ebool isFirstDeposit = FHE.eq(reserves.encTotalLpSupply, ENC_ZERO);

        // First deposit: LP = min(amt0, amt1) * 2
        ebool amt0Smaller = FHE.lt(amt0, amt1);
        euint128 minAmt = FHE.select(amt0Smaller, amt0, amt1);
        euint128 encTwo = FHE.asEuint128(2);
        euint128 firstDepositLp = FHE.mul(minAmt, encTwo);
        FHE.allowThis(firstDepositLp);

        // Subsequent: LP = min(amt0 * totalLP / reserve0, amt1 * totalLP / reserve1)
        euint128 safeRes0 = FHE.select(FHE.gt(reserves.encReserve0, ENC_ZERO), reserves.encReserve0, ENC_ONE);
        euint128 safeRes1 = FHE.select(FHE.gt(reserves.encReserve1, ENC_ZERO), reserves.encReserve1, ENC_ONE);
        FHE.allowThis(safeRes0);
        FHE.allowThis(safeRes1);

        euint128 lpFromAmt0 = FHE.div(FHE.mul(amt0, reserves.encTotalLpSupply), safeRes0);
        euint128 lpFromAmt1 = FHE.div(FHE.mul(amt1, reserves.encTotalLpSupply), safeRes1);
        FHE.allowThis(lpFromAmt0);
        FHE.allowThis(lpFromAmt1);

        ebool use0 = FHE.lt(lpFromAmt0, lpFromAmt1);
        euint128 subsequentLp = FHE.select(use0, lpFromAmt0, lpFromAmt1);
        FHE.allowThis(subsequentLp);

        lpAmount = FHE.select(isFirstDeposit, firstDepositLp, subsequentLp);

        // Update reserves
        reserves.encReserve0 = FHE.add(reserves.encReserve0, amt0);
        reserves.encReserve1 = FHE.add(reserves.encReserve1, amt1);
        reserves.encTotalLpSupply = FHE.add(reserves.encTotalLpSupply, lpAmount);

        // Update user balance
        euint128 currentBalance = encLpBalances[poolId][depositor];
        encLpBalances[poolId][depositor] = Common.isInitialized(currentBalance)
            ? FHE.add(currentBalance, lpAmount)
            : lpAmount;

        // FHE permissions
        FHE.allowThis(lpAmount);
        FHE.allowThis(reserves.encReserve0);
        FHE.allowThis(reserves.encReserve1);
        FHE.allowThis(reserves.encTotalLpSupply);
        FHE.allowThis(encLpBalances[poolId][depositor]);
        FHE.allow(encLpBalances[poolId][depositor], depositor);

        return lpAmount;
    }

    /// @notice Internal core LP removal logic
    function _removeLiquidityCore(
        PoolId poolId,
        euint128 requestedLp,
        address withdrawer
    ) internal returns (euint128 amount0, euint128 amount1) {
        PoolReserves storage reserves = poolReserves[poolId];

        // Get user's actual balance and clamp requested amount
        euint128 userBalance = encLpBalances[poolId][withdrawer];
        if (!Common.isInitialized(userBalance)) {
            return (ENC_ZERO, ENC_ZERO);
        }

        // Clamp to user's balance
        ebool exceedsBalance = FHE.gt(requestedLp, userBalance);
        euint128 lp = FHE.select(exceedsBalance, userBalance, requestedLp);
        FHE.allowThis(lp);

        // Safe denominator for division
        euint128 safeTotalLp = FHE.select(
            FHE.gt(reserves.encTotalLpSupply, ENC_ZERO),
            reserves.encTotalLpSupply,
            ENC_ONE
        );
        FHE.allowThis(safeTotalLp);

        // Proportional calculation
        amount0 = FHE.div(FHE.mul(lp, reserves.encReserve0), safeTotalLp);
        amount1 = FHE.div(FHE.mul(lp, reserves.encReserve1), safeTotalLp);
        FHE.allowThis(amount0);
        FHE.allowThis(amount1);

        // Update LP tracking
        reserves.encTotalLpSupply = FHE.sub(reserves.encTotalLpSupply, lp);
        encLpBalances[poolId][withdrawer] = FHE.sub(userBalance, lp);
        FHE.allowThis(reserves.encTotalLpSupply);
        FHE.allowThis(encLpBalances[poolId][withdrawer]);
        FHE.allow(encLpBalances[poolId][withdrawer], withdrawer);

        // Update reserves
        reserves.encReserve0 = FHE.sub(reserves.encReserve0, amount0);
        reserves.encReserve1 = FHE.sub(reserves.encReserve1, amount1);
        FHE.allowThis(reserves.encReserve0);
        FHE.allowThis(reserves.encReserve1);

        return (amount0, amount1);
    }

    /// @notice Add liquidity with plaintext amounts
    function addLiquidity(
        PoolId poolId,
        uint256 amount0,
        uint256 amount1
    ) external whenNotPaused returns (uint256 lpAmount) {
        if (amount0 == 0 || amount1 == 0) revert ZeroAmount();

        PoolState storage state = poolStates[poolId];
        if (!state.initialized) revert PoolNotInitialized();

        // Transfer tokens in (handles both ERC20 and FHERC20)
        IERC20(state.token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(state.token1).safeTransferFrom(msg.sender, address(this), amount1);

        // Encrypt amounts and call core
        euint128 encAmt0 = FHE.asEuint128(uint128(amount0));
        euint128 encAmt1 = FHE.asEuint128(uint128(amount1));
        FHE.allowThis(encAmt0);
        FHE.allowThis(encAmt1);

        _addLiquidityCore(poolId, encAmt0, encAmt1, msg.sender);

        // Update plaintext cache
        PoolReserves storage reserves = poolReserves[poolId];
        uint256 _totalLpSupply = totalLpSupply[poolId];
        if (_totalLpSupply == 0) {
            lpAmount = _sqrt256(amount0 * amount1);
        } else {
            uint256 lpAmount0 = (amount0 * _totalLpSupply) / reserves.reserve0;
            uint256 lpAmount1 = (amount1 * _totalLpSupply) / reserves.reserve1;
            lpAmount = lpAmount0 < lpAmount1 ? lpAmount0 : lpAmount1;
        }

        // Track if this is first liquidity (before updating totalLpSupply)
        bool isFirstLiquidity = (_totalLpSupply == 0);

        lpBalances[poolId][msg.sender] += lpAmount;
        totalLpSupply[poolId] += lpAmount;
        reserves.reserve0 += amount0;
        reserves.reserve1 += amount1;

        // Update lastProcessedTick on first liquidity (after reserves are set)
        if (isFirstLiquidity) {
            lastProcessedTick[poolId] = _getCurrentTick(poolId);
        }

        emit LiquidityAdded(poolId, msg.sender, amount0, amount1, lpAmount);
    }

    /// @notice Remove liquidity with plaintext amount
    function removeLiquidity(
        PoolId poolId,
        uint256 lpAmount
    ) external returns (uint256 amount0, uint256 amount1) {
        if (lpAmount == 0) revert ZeroAmount();
        if (lpBalances[poolId][msg.sender] < lpAmount) revert InsufficientLiquidity();

        PoolState storage state = poolStates[poolId];
        PoolReserves storage reserves = poolReserves[poolId];

        uint256 _totalLpSupply = totalLpSupply[poolId];

        // Calculate tokens to return
        amount0 = (lpAmount * reserves.reserve0) / _totalLpSupply;
        amount1 = (lpAmount * reserves.reserve1) / _totalLpSupply;

        // Update plaintext cache
        lpBalances[poolId][msg.sender] -= lpAmount;
        totalLpSupply[poolId] -= lpAmount;
        reserves.reserve0 -= amount0;
        reserves.reserve1 -= amount1;

        // Update encrypted via core
        euint128 encLpAmount = FHE.asEuint128(uint128(lpAmount));
        FHE.allowThis(encLpAmount);
        _removeLiquidityCore(poolId, encLpAmount, msg.sender);

        // Transfer tokens
        IERC20(state.token0).safeTransfer(msg.sender, amount0);
        IERC20(state.token1).safeTransfer(msg.sender, amount1);

        emit LiquidityRemoved(poolId, msg.sender, amount0, amount1, lpAmount);
    }

    /// @notice Add liquidity with encrypted amounts
    /// @dev Only works if BOTH tokens are FHERC20
    function addLiquidityEncrypted(
        PoolId poolId,
        InEuint128 calldata amount0,
        InEuint128 calldata amount1
    ) external whenNotPaused returns (euint128 lpAmount) {
        PoolState storage state = poolStates[poolId];
        if (!state.initialized) revert PoolNotInitialized();
        if (!state.token0IsFherc20 || !state.token1IsFherc20) revert BothTokensMustBeFherc20();

        euint128 amt0 = FHE.asEuint128(amount0);
        euint128 amt1 = FHE.asEuint128(amount1);
        FHE.allowThis(amt0);
        FHE.allowThis(amt1);

        // Transfer encrypted tokens
        FHE.allow(amt0, state.token0);
        FHE.allow(amt1, state.token1);
        IFHERC20(state.token0)._transferFromEncrypted(msg.sender, address(this), amt0);
        IFHERC20(state.token1)._transferFromEncrypted(msg.sender, address(this), amt1);

        // Call shared core
        lpAmount = _addLiquidityCore(poolId, amt0, amt1, msg.sender);
        FHE.allow(lpAmount, msg.sender);

        _requestReserveSync(poolId);

        emit LiquidityAddedEncrypted(poolId, msg.sender);
    }

    /// @notice Remove liquidity with encrypted LP amount
    function removeLiquidityEncrypted(
        PoolId poolId,
        InEuint128 calldata lpAmount
    ) external returns (euint128 amount0, euint128 amount1) {
        PoolState storage state = poolStates[poolId];

        euint128 requestedLp = FHE.asEuint128(lpAmount);
        FHE.allowThis(requestedLp);

        (amount0, amount1) = _removeLiquidityCore(poolId, requestedLp, msg.sender);

        // Transfer tokens
        FHE.allow(amount0, state.token0);
        FHE.allow(amount1, state.token1);

        if (state.token0IsFherc20) {
            IFHERC20(state.token0)._transferEncrypted(msg.sender, amount0);
        } else {
            // TODO: BUG - This branch incorrectly calls _transferEncrypted on an ERC20 token.
            // For ERC20 tokens, we need to:
            // 1. Request async decryption of amount0 via CoFHE callback
            // 2. In the callback, call IERC20.safeTransfer() with the plaintext amount
            // Currently this will fail for ERC:FHE pools when using removeLiquidityEncrypted.
            // Workaround: Use removeLiquidity() instead for ERC:FHE pools.
            IFHERC20(state.token0)._transferEncrypted(msg.sender, amount0);
        }

        if (state.token1IsFherc20) {
            IFHERC20(state.token1)._transferEncrypted(msg.sender, amount1);
        } else {
            // TODO: BUG - Same issue as token0 above. See comment there for details.
            IFHERC20(state.token1)._transferEncrypted(msg.sender, amount1);
        }

        _requestReserveSync(poolId);

        emit LiquidityRemovedEncrypted(poolId, msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    DIRECT ENCRYPTED SWAP
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Fully encrypted swap - direction and amount hidden
    function swapEncrypted(
        PoolId poolId,
        InEbool calldata direction,
        InEuint128 calldata amountIn,
        InEuint128 calldata minOutput
    ) external whenNotPaused returns (euint128 amountOut) {
        PoolState storage state = poolStates[poolId];
        if (!state.initialized) revert PoolNotInitialized();

        // One swap per pool per TX - prevents atomic sandwich attacks
        SwapLock.enforceOnce(poolId);

        ebool dir = FHE.asEbool(direction);
        euint128 amt = FHE.asEuint128(amountIn);
        FHE.allowThis(dir);
        FHE.allowThis(amt);

        // Transfer input (both paths execute, one is zero)
        euint128 token0Amt = FHE.select(dir, amt, ENC_ZERO);
        euint128 token1Amt = FHE.select(dir, ENC_ZERO, amt);

        if (state.token0IsFherc20) {
            FHE.allow(token0Amt, state.token0);
            IFHERC20(state.token0)._transferFromEncrypted(msg.sender, address(this), token0Amt);
        }
        if (state.token1IsFherc20) {
            FHE.allow(token1Amt, state.token1);
            IFHERC20(state.token1)._transferFromEncrypted(msg.sender, address(this), token1Amt);
        }

        // Execute encrypted swap
        amountOut = _executeSwapMathForPool(poolId, dir, amt);

        // Slippage check
        euint128 encMinOut = FHE.asEuint128(minOutput);
        ebool slippageOk = FHE.gte(amountOut, encMinOut);
        amountOut = FHE.select(slippageOk, amountOut, ENC_ZERO);
        FHE.allowThis(amountOut);

        // Transfer output
        euint128 out0 = FHE.select(dir, ENC_ZERO, amountOut);
        euint128 out1 = FHE.select(dir, amountOut, ENC_ZERO);

        if (state.token0IsFherc20) {
            FHE.allow(out0, state.token0);
            IFHERC20(state.token0)._transferEncrypted(msg.sender, out0);
        }
        if (state.token1IsFherc20) {
            FHE.allow(out1, state.token1);
            IFHERC20(state.token1)._transferEncrypted(msg.sender, out1);
        }

        _requestReserveSync(poolId);

        emit SwapEncrypted(poolId, msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                      RESERVE SYNC
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Request a new reserve sync with binary search to harvest any resolved pending requests
    /// @dev Uses counter + mapping pattern to avoid losing pending handles during high traffic
    function _requestReserveSync(PoolId poolId) internal {
        // Harvest any resolved pending requests
        _harvestResolvedDecrypts(poolId);

        // Store new pending request
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

    /// @notice Manually trigger reserve sync - harvests any resolved pending requests
    /// @dev Can be called by anyone to update plaintext reserve cache
    function trySyncReserves(PoolId poolId) external {
        _harvestResolvedDecrypts(poolId);
    }

    /// @notice Binary search to find newest resolved pending decrypt (shared helper)
    function _findNewestResolvedDecrypt(PoolId poolId) internal view returns (
        uint256 newestId,
        uint256 val0,
        uint256 val1
    ) {
        PoolReserves storage r = poolReserves[poolId];
        uint256 lo = r.lastResolvedId;
        // nextRequestId is exclusive (next ID to use), so valid range is [lastResolvedId, nextRequestId - 1]
        // Use saturating subtraction to avoid underflow when nextRequestId == 0
        uint256 hi = r.nextRequestId > 0 ? r.nextRequestId - 1 : 0;
        val0 = r.reserve0;
        val1 = r.reserve1;
        newestId = lo;

        // Early exit if no pending requests
        if (lo > hi) return (newestId, val0, val1);

        // Binary search for rightmost resolved entry
        // We use a modified approach to avoid underflow: track found state
        while (lo <= hi) {
            uint256 mid = lo + (hi - lo + 1) / 2;
            PendingDecrypt storage p = pendingDecrypts[poolId][mid];

            if (!Common.isInitialized(p.reserve0)) {
                // Entry doesn't exist, search lower
                if (mid == 0) break;
                hi = mid - 1;
                continue;
            }

            (uint256 v0, bool ready0) = FHE.getDecryptResultSafe(p.reserve0);
            (uint256 v1, bool ready1) = FHE.getDecryptResultSafe(p.reserve1);

            if (ready0 && ready1) {
                // Found resolved entry, record and search higher
                val0 = v0;
                val1 = v1;
                newestId = mid;
                // If mid == hi, we're done
                if (mid == hi) break;
                lo = mid + 1;
            } else {
                // Not ready, search lower
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

    function _estimateOutput(PoolId poolId, bool zeroForOne, uint256 amountIn) internal view returns (uint256) {
        PoolReserves storage reserves = poolReserves[poolId];

        if (reserves.reserve0 == 0 || reserves.reserve1 == 0) return 0;

        uint256 reserveIn = zeroForOne ? reserves.reserve0 : reserves.reserve1;
        uint256 reserveOut = zeroForOne ? reserves.reserve1 : reserves.reserve0;

        uint256 amountInWithFee = amountIn * (10000 - swapFeeBps);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 10000) + amountInWithFee;

        return numerator / denominator;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                   VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Get reserves for a specific pool
    function getReserves(PoolId poolId) external view returns (uint256 r0, uint256 r1) {
        PoolReserves storage r = poolReserves[poolId];
        return (r.reserve0, r.reserve1);
    }

    /// @notice Get current tick for a specific pool
    function getCurrentTickForPool(PoolId poolId) external view returns (int24) {
        return _getCurrentTick(poolId);
    }

    /// @notice Get expected output for a swap (specific pool)
    function getQuoteForPool(PoolId poolId, bool zeroForOne, uint256 amountIn) external view returns (uint256) {
        return _estimateOutput(poolId, zeroForOne, amountIn);
    }

    /// @notice Check if there are orders at a specific tick
    function hasOrdersAtTick(PoolId poolId, int24 tick, BucketSide side) external view returns (bool) {
        Bucket storage bucket = buckets[poolId][tick][side];
        return bucket.initialized && Common.isInitialized(bucket.totalShares);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                       INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    function _calculateProceeds(UserPosition storage pos, Bucket storage bucket) internal returns (euint128) {
        if (!Common.isInitialized(pos.shares)) {
            return ENC_ZERO;
        }
        euint128 delta = FHE.sub(bucket.proceedsPerShare, pos.proceedsPerShareSnapshot);
        return FHE.div(FHE.mul(pos.shares, delta), ENC_PRECISION);
    }

    function _calculateUnfilled(UserPosition storage pos, Bucket storage bucket) internal returns (euint128) {
        if (!Common.isInitialized(pos.shares)) {
            return ENC_ZERO;
        }
        euint128 delta = FHE.sub(bucket.filledPerShare, pos.filledPerShareSnapshot);
        euint128 filled = FHE.div(FHE.mul(pos.shares, delta), ENC_PRECISION);
        ebool hasUnfilled = FHE.gte(pos.shares, filled);
        return FHE.select(hasUnfilled, FHE.sub(pos.shares, filled), ENC_ZERO);
    }

    function _autoClaim(
        PoolId,
        int24,
        BucketSide,
        Bucket storage bucket,
        UserPosition storage position
    ) internal {
        euint128 proceedsDelta = FHE.sub(bucket.proceedsPerShare, position.proceedsPerShareSnapshot);
        euint128 pendingProceeds = FHE.div(FHE.mul(position.shares, proceedsDelta), ENC_PRECISION);
        if (Common.isInitialized(position.realizedProceeds)) {
            position.realizedProceeds = FHE.add(position.realizedProceeds, pendingProceeds);
        } else {
            position.realizedProceeds = pendingProceeds;
        }
        FHE.allowThis(position.realizedProceeds);
    }

    function _initializeBucket(Bucket storage bucket) internal {
        bucket.totalShares = ENC_ZERO;
        bucket.liquidity = ENC_ZERO;
        bucket.proceedsPerShare = ENC_ZERO;
        bucket.filledPerShare = ENC_ZERO;
        bucket.initialized = true;

        FHE.allowThis(bucket.totalShares);
        FHE.allowThis(bucket.liquidity);
        FHE.allowThis(bucket.proceedsPerShare);
        FHE.allowThis(bucket.filledPerShare);
    }

    /// @notice Get current tick from reserve ratio using Uniswap's TickMath
    /// @dev Converts price to sqrtPriceX96, then uses getTickAtSqrtPrice
    function _getCurrentTick(PoolId poolId) internal view returns (int24) {
        PoolReserves storage reserves = poolReserves[poolId];
        if (reserves.reserve0 == 0 || reserves.reserve1 == 0) return 0;

        // price = reserve1 / reserve0
        // sqrtPriceX96 = sqrt(price) * 2^96

        // To compute sqrt(reserve1/reserve0) * 2^96:
        // = sqrt(reserve1) / sqrt(reserve0) * 2^96
        // = sqrt(reserve1 * 2^192) / sqrt(reserve0 * 2^192) * 2^96
        // = sqrt(reserve1 * 2^192 / reserve0) (approximately)

        // Simpler approach: compute price, then sqrt, then scale
        // price_scaled = reserve1 * 2^192 / reserve0
        // sqrtPriceX96 = sqrt(price_scaled)

        // To avoid overflow, we use: sqrt(reserve1 * 2^96 / reserve0) * 2^48
        // which equals sqrt(reserve1/reserve0) * 2^48 * 2^48 = sqrt(price) * 2^96

        uint256 ratio;
        if (reserves.reserve1 >= reserves.reserve0) {
            // price >= 1, safe to compute
            ratio = (reserves.reserve1 << 96) / reserves.reserve0;
        } else {
            // price < 1, compute inverse and negate result
            ratio = (reserves.reserve0 << 96) / reserves.reserve1;
            // For price < 1, sqrtPriceX96 = 2^96 / sqrt(ratio)
            // This is equivalent to negative ticks
        }

        // Compute sqrt using Newton's method
        uint160 sqrtPriceX96 = uint160(_sqrt256(ratio));

        // Clamp to valid range
        if (sqrtPriceX96 < TickMath.MIN_SQRT_PRICE) {
            sqrtPriceX96 = TickMath.MIN_SQRT_PRICE;
        } else if (sqrtPriceX96 > TickMath.MAX_SQRT_PRICE) {
            sqrtPriceX96 = TickMath.MAX_SQRT_PRICE;
        }

        // Get tick from sqrt price
        int24 tick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);

        // Round to nearest valid tick (divisible by TICK_SPACING)
        tick = (tick / TICK_SPACING) * TICK_SPACING;

        return tick;
    }

    /// @notice 256-bit square root using Newton's method
    function _sqrt256(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    function _findNextActiveTick(
        PoolId poolId,
        int24 currentTick,
        BucketSide side,
        bool searchUp
    ) internal view returns (int24) {
        mapping(int16 => uint256) storage bitmap = side == BucketSide.BUY
            ? buyBitmaps[poolId]
            : sellBitmaps[poolId];

        int24 tick = currentTick;
        int24 step = searchUp ? TICK_SPACING : -TICK_SPACING;

        for (uint256 i = 0; i < 200; i++) {
            tick += step;
            if (tick < MIN_TICK || tick > MAX_TICK) break;

            int16 wordPos = int16(tick >> 8);
            uint8 bitPos = uint8(uint24(tick) % 256);
            if ((bitmap[wordPos] & (1 << bitPos)) != 0) {
                return tick;
            }
        }
        return searchUp ? type(int24).max : type(int24).min;
    }

    function _setBit(PoolId poolId, int24 tick, BucketSide side) internal {
        int16 wordPos = int16(tick >> 8);
        uint8 bitPos = uint8(uint24(tick) % 256);

        if (side == BucketSide.BUY) {
            buyBitmaps[poolId][wordPos] |= (1 << bitPos);
        } else {
            sellBitmaps[poolId][wordPos] |= (1 << bitPos);
        }
    }

    function _clearBit(PoolId poolId, int24 tick, BucketSide side) internal {
        int16 wordPos = int16(tick >> 8);
        uint8 bitPos = uint8(uint24(tick) % 256);

        if (side == BucketSide.BUY) {
            buyBitmaps[poolId][wordPos] &= ~(1 << bitPos);
        } else {
            sellBitmaps[poolId][wordPos] &= ~(1 << bitPos);
        }
    }

    /// @notice Convert tick to price using Uniswap's TickMath library
    /// @dev Converts sqrtPriceX96 (Q64.96) to our price format (1e18 scale)
    /// @param tick The tick value
    /// @return price The price scaled by PRECISION (1e18)
    function _calculateTickPrice(int24 tick) internal pure returns (uint256) {
        // Get sqrtPriceX96 from Uniswap's TickMath (Q64.96 format)
        uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(tick);

        // Convert sqrtPriceX96 to price:
        // sqrtPriceX96 = sqrt(price) * 2^96
        // price = (sqrtPriceX96 / 2^96)^2 = sqrtPriceX96^2 / 2^192
        //
        // To get price in 1e18 scale:
        // price_1e18 = sqrtPriceX96^2 * 1e18 / 2^192
        //
        // To avoid overflow, we do: (sqrtPriceX96^2 / 2^64) * 1e18 / 2^128
        // Or equivalently: sqrtPriceX96^2 * 1e18 >> 192

        uint256 sqrtPrice = uint256(sqrtPriceX96);

        // sqrtPrice^2 can overflow uint256 for high prices, so we need to be careful
        // For most practical ticks, this won't overflow
        // sqrtPriceX96 max is ~2^160, so sqrtPrice^2 max is ~2^320 which overflows
        // We need to divide first: (sqrtPrice >> 64)^2 * 1e18 >> 64
        // Or: (sqrtPrice * sqrtPrice >> 128) * 1e18 >> 64

        // Safe approach: divide sqrtPrice by 2^48 first, then square, then adjust
        // (sqrtPrice >> 48)^2 gives us price * 2^(192-96) = price * 2^96
        // Then multiply by 1e18 and divide by 2^96

        uint256 sqrtPriceReduced = sqrtPrice >> 48; // Reduce to prevent overflow
        uint256 priceX96 = sqrtPriceReduced * sqrtPriceReduced; // This is price * 2^(96-96) = price * 2^0... wait

        // Let me recalculate:
        // sqrtPriceX96 = sqrt(price) * 2^96
        // sqrtPriceReduced = sqrtPriceX96 >> 48 = sqrt(price) * 2^48
        // sqrtPriceReduced^2 = price * 2^96
        // price_1e18 = sqrtPriceReduced^2 * 1e18 / 2^96

        return (priceX96 * PRECISION) >> 96;
    }

    function _abs(int24 x) internal pure returns (int24) {
        return x >= 0 ? x : -x;
    }

    /// @notice Check if a token is FHERC20 by checking for balanceOfEncrypted selector
    /// @dev Uses balanceOfEncrypted(address) as the detection method since wrap(0) may revert
    function _isFherc20(address token) internal view returns (bool) {
        // Try calling balanceOfEncrypted with address(0) - this should succeed on FHERC20 tokens
        // even with empty balance, as it just returns the euint128 handle
        (bool success, ) = token.staticcall(
            abi.encodeWithSelector(bytes4(keccak256("balanceOfEncrypted(address)")), address(0))
        );
        return success;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        feeCollector = _feeCollector;
        emit FeeCollectorUpdated(_feeCollector);
    }

    function setMaxBucketsPerSwap(PoolId poolId, uint256 _maxBuckets) external onlyOwner {
        if (_maxBuckets == 0 || _maxBuckets > 20) revert InvalidMaxBuckets();
        poolStates[poolId].maxBucketsPerSwap = _maxBuckets;
    }

    function queueProtocolFee(PoolId poolId, uint256 _feeBps) external onlyOwner {
        if (_feeBps > 100) revert FeeTooHigh();
        pendingFees[poolId] = PendingFee({
            feeBps: _feeBps,
            effectiveTimestamp: block.timestamp + FEE_CHANGE_DELAY
        });
        emit ProtocolFeeQueued(poolId, _feeBps, block.timestamp + FEE_CHANGE_DELAY);
    }

    function applyProtocolFee(PoolId poolId) external {
        PendingFee storage pending = pendingFees[poolId];
        if (pending.effectiveTimestamp == 0 || block.timestamp < pending.effectiveTimestamp) {
            revert FeeChangeNotReady();
        }
        poolStates[poolId].protocolFeeBps = pending.feeBps;
        emit ProtocolFeeApplied(poolId, pending.feeBps);
        delete pendingFees[poolId];
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function getPoolState(PoolId poolId) external view returns (
        address token0,
        address token1,
        bool token0IsFherc20,
        bool token1IsFherc20,
        bool initialized,
        uint256 maxBucketsPerSwap,
        uint256 protocolFeeBps
    ) {
        PoolState storage state = poolStates[poolId];
        return (
            state.token0,
            state.token1,
            state.token0IsFherc20,
            state.token1IsFherc20,
            state.initialized,
            state.maxBucketsPerSwap,
            state.protocolFeeBps
        );
    }

    /// @notice Get pool reserves, checking for fresher values from pending decrypts
    /// @dev Uses binary search to find newest resolved pending request
    function getPoolReserves(PoolId poolId) external view returns (
        uint256 _reserve0,
        uint256 _reserve1,
        uint256 lpSupply
    ) {
        (, uint256 val0, uint256 val1) = _findNewestResolvedDecrypt(poolId);
        return (val0, val1, totalLpSupply[poolId]);
    }

    function getTickPrice(int24 tick) external pure returns (uint256) {
        return _calculateTickPrice(tick);
    }

    function hasActiveOrders(PoolId poolId, int24 tick, BucketSide side) external view returns (bool) {
        int16 wordPos = int16(tick >> 8);
        uint8 bitPos = uint8(uint24(tick) % 256);

        if (side == BucketSide.BUY) {
            return (buyBitmaps[poolId][wordPos] & (1 << bitPos)) != 0;
        } else {
            return (sellBitmaps[poolId][wordPos] & (1 << bitPos)) != 0;
        }
    }
}
