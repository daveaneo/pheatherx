// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {FHE, euint128, ebool, InEuint128, InEbool, Common} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IFHERC20} from "./interface/IFHERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TickBitmap} from "./lib/TickBitmap.sol";

/// @title FheatherX v5 - Hybrid Encrypted AMM + Private Limit Orders
/// @author FheatherX Team
/// @notice A Uniswap v4 Hook combining encrypted AMM liquidity with gas-optimized limit orders
/// @dev This contract merges the best of V2 and V4:
///      FROM V2:
///      - Encrypted AMM reserves (encReserve0, encReserve1) with x*y=k FHE math
///      - Always-available liquidity from LP deposits
///      - Dual swap paths: hook-based and direct swapEncrypted()
///      - LP functions: addLiquidity, removeLiquidity (plaintext + encrypted)
///
///      FROM V4:
///      - Gas-optimized limit orders with tick bitmap for O(1) lookup
///      - Bucketed orders with proceeds-per-share accumulators
///      - Pre-computed tick prices
///      - Multi-pool support via PoolId
///
///      KEY CHANGE FROM V4:
///      - V4 routed ALL swaps through limit order buckets (failed if no orders)
///      - V5 routes swaps through encrypted AMM first (always succeeds)
///      - Limit orders trigger on price movement and fill AGAINST the AMM
contract FheatherXv5 is BaseHook, ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Fixed-point precision for share calculations (18 decimals)
    uint256 public constant PRECISION = 1e18;

    /// @notice Tick spacing - each tick is 0.6% price increment
    int24 public constant TICK_SPACING = 60;

    /// @notice Minimum valid tick (~0.55x price)
    int24 public constant MIN_TICK = -6000;

    /// @notice Maximum valid tick (~1.8x price)
    int24 public constant MAX_TICK = 6000;

    /// @notice Delay for fee changes (user protection)
    uint256 public constant FEE_CHANGE_DELAY = 2 days;

    /// @notice Minimum blocks between reserve sync requests
    uint256 public constant SYNC_COOLDOWN_BLOCKS = 5;

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

    /// @notice Pool-specific configuration
    struct PoolState {
        IFHERC20 token0;
        IFHERC20 token1;
        bool initialized;
        uint256 maxBucketsPerSwap;
        uint256 protocolFeeBps;
    }

    /// @notice Pool-specific encrypted AMM reserves (NEW from V2)
    struct PoolReserves {
        euint128 encReserve0;       // Encrypted reserve of token0
        euint128 encReserve1;       // Encrypted reserve of token1
        euint128 encTotalLpSupply;  // Encrypted total LP supply (source of truth)
        uint256 reserve0;            // Public cache for display/estimation
        uint256 reserve1;            // Public cache for display/estimation
        uint256 lastSyncBlock;       // Last block when sync was requested
        euint128 pendingReserve0;    // Pending decryption result
        euint128 pendingReserve1;    // Pending decryption result
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

    // ─────────────────── Pool Configuration (from V4) ───────────────────
    mapping(PoolId => PoolState) public poolStates;
    mapping(PoolId => PendingFee) public pendingFees;

    // ─────────────────── Encrypted AMM Reserves (NEW from V2) ───────────────────
    mapping(PoolId => PoolReserves) public poolReserves;

    // ─────────────────── LP Tracking (NEW from V2) ───────────────────
    mapping(PoolId => mapping(address => uint256)) public lpBalances;      // Plaintext cache
    mapping(PoolId => uint256) public totalLpSupply;                       // Plaintext cache
    mapping(PoolId => mapping(address => euint128)) public encLpBalances;  // Encrypted source of truth

    // ─────────────────── Limit Order Buckets (from V4) ───────────────────
    mapping(PoolId => mapping(int24 => mapping(BucketSide => Bucket))) public buckets;
    mapping(PoolId => mapping(address => mapping(int24 => mapping(BucketSide => UserPosition)))) public positions;
    mapping(PoolId => mapping(int16 => uint256)) internal buyBitmaps;
    mapping(PoolId => mapping(int16 => uint256)) internal sellBitmaps;

    // ─────────────────── Tick Tracking ───────────────────
    mapping(int24 => uint256) public tickPrices;
    mapping(PoolId => int24) public lastProcessedTick;

    // ─────────────────── Fee Collection ───────────────────
    address public feeCollector;
    uint256 public swapFeeBps;

    // ═══════════════════════════════════════════════════════════════════════
    //                               EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event PoolInitialized(PoolId indexed poolId, address token0, address token1);
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
    event ReserveSyncRequested(PoolId indexed poolId, uint256 blockNumber);
    event ReservesSynced(PoolId indexed poolId, uint256 reserve0, uint256 reserve1);
    event ProtocolFeeQueued(PoolId indexed poolId, uint256 newFeeBps, uint256 effectiveTimestamp);
    event ProtocolFeeApplied(PoolId indexed poolId, uint256 newFeeBps);
    event FeeCollectorUpdated(address newCollector);

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error InvalidTick();
    error PoolNotInitialized();
    error ZeroAmount();
    error InsufficientBalance();
    error InsufficientLiquidity();
    error DeadlineExpired();
    error PriceMoved();
    error SlippageExceeded();
    error FeeTooHigh();
    error FeeChangeNotReady();

    // ═══════════════════════════════════════════════════════════════════════
    //                           CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        IPoolManager _poolManager,
        address _owner,
        uint256 _swapFeeBps
    ) BaseHook(_poolManager) Ownable(_owner) {
        // Initialize V4 encrypted constants
        ENC_ZERO = FHE.asEuint128(0);
        ENC_PRECISION = FHE.asEuint128(uint128(PRECISION));
        ENC_ONE = FHE.asEuint128(1);

        // Initialize V2 fee constants
        swapFeeBps = _swapFeeBps;
        ENC_SWAP_FEE_BPS = FHE.asEuint128(uint128(_swapFeeBps));
        ENC_TEN_THOUSAND = FHE.asEuint128(10000);

        // Grant FHE permissions
        FHE.allowThis(ENC_ZERO);
        FHE.allowThis(ENC_PRECISION);
        FHE.allowThis(ENC_ONE);
        FHE.allowThis(ENC_SWAP_FEE_BPS);
        FHE.allowThis(ENC_TEN_THOUSAND);

        // Pre-compute tick prices (V4 optimization)
        _initializeTickPrices();
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
        int24
    ) internal override returns (bytes4) {
        PoolId poolId = key.toId();

        // Initialize pool state
        poolStates[poolId] = PoolState({
            token0: IFHERC20(Currency.unwrap(key.currency0)),
            token1: IFHERC20(Currency.unwrap(key.currency1)),
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
        reserves.lastSyncBlock = 0;
        reserves.pendingReserve0 = ENC_ZERO;
        reserves.pendingReserve1 = ENC_ZERO;

        FHE.allowThis(reserves.encReserve0);
        FHE.allowThis(reserves.encReserve1);
        FHE.allowThis(reserves.encTotalLpSupply);
        FHE.allowThis(reserves.pendingReserve0);
        FHE.allowThis(reserves.pendingReserve1);

        emit PoolInitialized(poolId, Currency.unwrap(key.currency0), Currency.unwrap(key.currency1));

        return this.afterInitialize.selector;
    }

    /// @notice Called before a swap - executes against encrypted AMM
    /// @dev KEY CHANGE FROM V4: Swaps go through AMM, not limit order buckets
    function _beforeSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        PoolId poolId = key.toId();
        PoolState storage state = poolStates[poolId];
        PoolReserves storage reserves = poolReserves[poolId];

        if (!state.initialized) {
            return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        bool zeroForOne = params.zeroForOne;
        uint256 amountIn = params.amountSpecified < 0
            ? uint256(-params.amountSpecified)
            : uint256(params.amountSpecified);

        if (amountIn == 0) {
            return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        // ══════════════════════════════════════════════════════════════════
        // KEY CHANGE: Execute against encrypted AMM reserves (V2 style)
        // ══════════════════════════════════════════════════════════════════
        euint128 encAmountIn = FHE.asEuint128(uint128(amountIn));
        ebool encDirection = FHE.asEbool(zeroForOne);
        FHE.allowThis(encAmountIn);

        // Execute encrypted x*y=k swap math
        _executeSwapMathForPool(poolId, encDirection, encAmountIn);

        // Estimate plaintext output from public reserve cache
        uint256 amountOut = _estimateOutput(poolId, zeroForOne, amountIn);

        // Apply protocol fee
        uint256 fee = (amountOut * state.protocolFeeBps) / 10000;
        uint256 amountOutAfterFee = amountOut - fee;

        // Transfer fee to collector
        if (fee > 0 && feeCollector != address(0)) {
            IERC20 feeToken = IERC20(address(zeroForOne ? state.token1 : state.token0));
            feeToken.safeTransfer(feeCollector, fee);
        }

        // Update public reserve cache
        if (zeroForOne) {
            reserves.reserve0 += amountIn;
            reserves.reserve1 = reserves.reserve1 > amountOut ? reserves.reserve1 - amountOut : 0;
        } else {
            reserves.reserve1 += amountIn;
            reserves.reserve0 = reserves.reserve0 > amountOut ? reserves.reserve0 - amountOut : 0;
        }

        // Request async reserve sync
        _requestReserveSync(poolId);

        emit Swap(poolId, sender, zeroForOne, amountIn, amountOutAfterFee);

        // Return delta for PoolManager settlement
        int128 delta0 = zeroForOne
            ? int128(int256(amountIn))
            : -int128(int256(amountOutAfterFee));
        int128 delta1 = zeroForOne
            ? -int128(int256(amountOutAfterFee))
            : int128(int256(amountIn));

        BeforeSwapDelta delta = BeforeSwapDelta.wrap(
            (int256(delta0) << 128) | (int256(delta1) & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF)
        );

        return (this.beforeSwap.selector, delta, 0);
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
    //                    ENCRYPTED AMM MATH (from V2)
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
        // amountOut = (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee)
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
    //                    LIMIT ORDER TRIGGERING (NEW)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Process limit orders triggered by price movement
    function _processTriggeredOrders(PoolId poolId, bool zeroForOne) internal {
        int24 currentTick = _getCurrentTick(poolId);
        int24 prevTick = lastProcessedTick[poolId];

        if (currentTick == prevTick) return;

        // Determine which side of orders to check
        // Price went up (zeroForOne) -> SELL orders trigger
        // Price went down (!zeroForOne) -> BUY orders trigger
        BucketSide side = zeroForOne ? BucketSide.SELL : BucketSide.BUY;
        bool searchUp = !zeroForOne;

        uint256 bucketsProcessed = 0;
        int24 tick = prevTick;

        while (bucketsProcessed < poolStates[poolId].maxBucketsPerSwap) {
            int24 nextTick = _findNextActiveTick(poolId, tick, side, searchUp);
            if (nextTick == type(int24).max || nextTick == type(int24).min) break;

            // Check if tick was crossed
            bool crossed = searchUp
                ? (nextTick > prevTick && nextTick <= currentTick)
                : (nextTick < prevTick && nextTick >= currentTick);

            if (crossed) {
                _fillBucketAgainstAMM(poolId, nextTick, side);
            }

            tick = searchUp ? nextTick + TICK_SPACING : nextTick - TICK_SPACING;
            bucketsProcessed++;
        }

        lastProcessedTick[poolId] = currentTick;
    }

    /// @notice Fill bucket orders by executing swap against AMM
    function _fillBucketAgainstAMM(PoolId poolId, int24 tick, BucketSide side) internal {
        Bucket storage bucket = buckets[poolId][tick][side];

        if (!bucket.initialized) return;

        // Execute swap against AMM with bucket's liquidity as input
        // SELL bucket: users deposited token0, want token1 -> zeroForOne = true
        // BUY bucket: users deposited token1, want token0 -> zeroForOne = false
        ebool direction = FHE.asEbool(side == BucketSide.SELL);

        euint128 swapInput = bucket.liquidity;
        euint128 swapOutput = _executeSwapMathForPool(poolId, direction, swapInput);

        // Update bucket accumulators (V4's efficient distribution)
        _updateBucketOnFill(bucket, swapInput, swapOutput);

        // Clear bucket liquidity
        bucket.liquidity = ENC_ZERO;
        FHE.allowThis(bucket.liquidity);

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
    //                         LIMIT ORDER FUNCTIONS (from V4)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Deposit tokens into a limit order bucket
    function deposit(
        PoolId poolId,
        int24 tick,
        BucketSide side,
        InEuint128 calldata encryptedAmount,
        uint256 deadline,
        int24 maxTickDrift
    ) external nonReentrant whenNotPaused {
        if (block.timestamp > deadline) revert DeadlineExpired();

        PoolState storage state = poolStates[poolId];
        if (!state.initialized) revert PoolNotInitialized();
        if (tick < MIN_TICK || tick > MAX_TICK || tick % TICK_SPACING != 0) revert InvalidTick();

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

        // Transfer tokens
        IFHERC20 depositToken = side == BucketSide.SELL ? state.token0 : state.token1;
        FHE.allow(amount, address(depositToken));
        depositToken.transferFromEncryptedDirect(msg.sender, address(this), amount);

        emit Deposit(poolId, msg.sender, tick, side, keccak256(abi.encode(encryptedAmount)));
    }

    /// @notice Withdraw unfilled tokens from a limit order bucket
    function withdraw(
        PoolId poolId,
        int24 tick,
        BucketSide side,
        InEuint128 calldata encryptedAmount
    ) external nonReentrant whenNotPaused {
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

        // Transfer tokens
        IFHERC20 withdrawToken = side == BucketSide.SELL ? state.token0 : state.token1;
        FHE.allow(withdrawAmount, address(withdrawToken));
        withdrawToken.transferEncryptedDirect(msg.sender, withdrawAmount);

        emit Withdraw(poolId, msg.sender, tick, side, keccak256(abi.encode(encryptedAmount)));
    }

    /// @notice Claim proceeds from filled orders
    function claim(
        PoolId poolId,
        int24 tick,
        BucketSide side
    ) external nonReentrant whenNotPaused {
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

        // Transfer proceeds
        IFHERC20 proceedsToken = side == BucketSide.SELL ? state.token1 : state.token0;
        FHE.allow(totalProceeds, address(proceedsToken));
        proceedsToken.transferEncryptedDirect(msg.sender, totalProceeds);

        emit Claim(poolId, msg.sender, tick, side, keccak256(abi.encode(euint128.unwrap(totalProceeds))));
    }

    /// @notice Exit entire position
    function exit(
        PoolId poolId,
        int24 tick,
        BucketSide side
    ) external nonReentrant whenNotPaused {
        PoolState storage state = poolStates[poolId];
        if (!state.initialized) revert PoolNotInitialized();

        Bucket storage bucket = buckets[poolId][tick][side];
        UserPosition storage position = positions[poolId][msg.sender][tick][side];

        euint128 unfilled = _calculateUnfilled(position, bucket);
        euint128 currentProceeds = _calculateProceeds(position, bucket);
        euint128 totalProceeds;
        if (Common.isInitialized(position.realizedProceeds)) {
            totalProceeds = FHE.add(currentProceeds, position.realizedProceeds);
        } else {
            totalProceeds = currentProceeds;
        }

        FHE.allowThis(unfilled);
        FHE.allowThis(totalProceeds);

        // Update bucket
        bucket.totalShares = FHE.sub(bucket.totalShares, position.shares);
        bucket.liquidity = FHE.sub(bucket.liquidity, unfilled);
        FHE.allowThis(bucket.totalShares);
        FHE.allowThis(bucket.liquidity);

        // Reset position
        position.shares = ENC_ZERO;
        position.realizedProceeds = ENC_ZERO;
        position.proceedsPerShareSnapshot = bucket.proceedsPerShare;
        position.filledPerShareSnapshot = bucket.filledPerShare;

        FHE.allowThis(position.shares);
        FHE.allow(position.shares, msg.sender);
        FHE.allowThis(position.realizedProceeds);
        FHE.allow(position.realizedProceeds, msg.sender);

        // Transfer tokens
        IFHERC20 depositToken = side == BucketSide.SELL ? state.token0 : state.token1;
        IFHERC20 proceedsToken = side == BucketSide.SELL ? state.token1 : state.token0;

        FHE.allow(unfilled, address(depositToken));
        FHE.allow(totalProceeds, address(proceedsToken));

        depositToken.transferEncryptedDirect(msg.sender, unfilled);
        proceedsToken.transferEncryptedDirect(msg.sender, totalProceeds);

        emit Withdraw(poolId, msg.sender, tick, side, keccak256(abi.encode(euint128.unwrap(unfilled))));
        emit Claim(poolId, msg.sender, tick, side, keccak256(abi.encode(euint128.unwrap(totalProceeds))));
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                      LP FUNCTIONS (from V2)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Add liquidity to encrypted AMM (plaintext path)
    /// @dev Updates both plaintext cache and encrypted source of truth
    function addLiquidity(
        PoolId poolId,
        uint256 amount0,
        uint256 amount1
    ) external nonReentrant whenNotPaused returns (uint256 lpAmount) {
        if (amount0 == 0 || amount1 == 0) revert ZeroAmount();

        PoolState storage state = poolStates[poolId];
        PoolReserves storage reserves = poolReserves[poolId];
        if (!state.initialized) revert PoolNotInitialized();

        // Transfer tokens
        IERC20(address(state.token0)).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(address(state.token1)).safeTransferFrom(msg.sender, address(this), amount1);

        // Calculate LP tokens
        uint256 _totalLpSupply = totalLpSupply[poolId];
        if (_totalLpSupply == 0) {
            lpAmount = _sqrt(amount0 * amount1);
        } else {
            uint256 lpAmount0 = (amount0 * _totalLpSupply) / reserves.reserve0;
            uint256 lpAmount1 = (amount1 * _totalLpSupply) / reserves.reserve1;
            lpAmount = lpAmount0 < lpAmount1 ? lpAmount0 : lpAmount1;
        }

        // Update plaintext cache
        lpBalances[poolId][msg.sender] += lpAmount;
        totalLpSupply[poolId] += lpAmount;
        reserves.reserve0 += amount0;
        reserves.reserve1 += amount1;

        // Update encrypted reserves (source of truth)
        euint128 encAmount0 = FHE.asEuint128(uint128(amount0));
        euint128 encAmount1 = FHE.asEuint128(uint128(amount1));
        euint128 encLpAmount = FHE.asEuint128(uint128(lpAmount));
        FHE.allowThis(encAmount0);
        FHE.allowThis(encAmount1);
        FHE.allowThis(encLpAmount);

        reserves.encReserve0 = FHE.add(reserves.encReserve0, encAmount0);
        reserves.encReserve1 = FHE.add(reserves.encReserve1, encAmount1);
        reserves.encTotalLpSupply = FHE.add(reserves.encTotalLpSupply, encLpAmount);
        FHE.allowThis(reserves.encReserve0);
        FHE.allowThis(reserves.encReserve1);
        FHE.allowThis(reserves.encTotalLpSupply);

        // Update user's encrypted LP balance
        euint128 currentBalance = encLpBalances[poolId][msg.sender];
        if (Common.isInitialized(currentBalance)) {
            encLpBalances[poolId][msg.sender] = FHE.add(currentBalance, encLpAmount);
        } else {
            encLpBalances[poolId][msg.sender] = encLpAmount;
        }
        FHE.allowThis(encLpBalances[poolId][msg.sender]);
        FHE.allow(encLpBalances[poolId][msg.sender], msg.sender);

        emit LiquidityAdded(poolId, msg.sender, amount0, amount1, lpAmount);
    }

    /// @notice Remove liquidity from encrypted AMM
    /// @dev Updates both plaintext cache and encrypted source of truth
    function removeLiquidity(
        PoolId poolId,
        uint256 lpAmount
    ) external nonReentrant returns (uint256 amount0, uint256 amount1) {
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

        // Update encrypted reserves (source of truth)
        euint128 encAmount0 = FHE.asEuint128(uint128(amount0));
        euint128 encAmount1 = FHE.asEuint128(uint128(amount1));
        euint128 encLpAmount = FHE.asEuint128(uint128(lpAmount));
        FHE.allowThis(encAmount0);
        FHE.allowThis(encAmount1);
        FHE.allowThis(encLpAmount);

        reserves.encReserve0 = FHE.sub(reserves.encReserve0, encAmount0);
        reserves.encReserve1 = FHE.sub(reserves.encReserve1, encAmount1);
        reserves.encTotalLpSupply = FHE.sub(reserves.encTotalLpSupply, encLpAmount);
        FHE.allowThis(reserves.encReserve0);
        FHE.allowThis(reserves.encReserve1);
        FHE.allowThis(reserves.encTotalLpSupply);

        // Update user's encrypted LP balance
        euint128 currentBalance = encLpBalances[poolId][msg.sender];
        encLpBalances[poolId][msg.sender] = FHE.sub(currentBalance, encLpAmount);
        FHE.allowThis(encLpBalances[poolId][msg.sender]);
        FHE.allow(encLpBalances[poolId][msg.sender], msg.sender);

        // Transfer tokens
        IERC20(address(state.token0)).safeTransfer(msg.sender, amount0);
        IERC20(address(state.token1)).safeTransfer(msg.sender, amount1);

        emit LiquidityRemoved(poolId, msg.sender, amount0, amount1, lpAmount);
    }

    /// @notice Add liquidity with encrypted amounts
    /// @dev First deposit: LP = min(amt0, amt1) * 2 (approximates sqrt, prevents manipulation)
    ///      Subsequent: LP = min(amt0 * totalLP / reserve0, amt1 * totalLP / reserve1)
    function addLiquidityEncrypted(
        PoolId poolId,
        InEuint128 calldata amount0,
        InEuint128 calldata amount1
    ) external nonReentrant whenNotPaused returns (euint128 lpAmount) {
        PoolState storage state = poolStates[poolId];
        PoolReserves storage reserves = poolReserves[poolId];
        if (!state.initialized) revert PoolNotInitialized();

        euint128 amt0 = FHE.asEuint128(amount0);
        euint128 amt1 = FHE.asEuint128(amount1);
        FHE.allowThis(amt0);
        FHE.allowThis(amt1);

        // Transfer encrypted tokens
        FHE.allow(amt0, address(state.token0));
        FHE.allow(amt1, address(state.token1));
        state.token0.transferFromEncryptedDirect(msg.sender, address(this), amt0);
        state.token1.transferFromEncryptedDirect(msg.sender, address(this), amt1);

        // Calculate LP amount
        ebool isFirstDeposit = FHE.eq(reserves.encTotalLpSupply, ENC_ZERO);

        // First deposit: LP = min(amt0, amt1) * 2
        // This approximates sqrt and prevents manipulation (excess stays in pool)
        ebool amt0Smaller = FHE.lt(amt0, amt1);
        euint128 minAmt = FHE.select(amt0Smaller, amt0, amt1);
        euint128 encTwo = FHE.asEuint128(2);
        euint128 firstDepositLp = FHE.mul(minAmt, encTwo);
        FHE.allowThis(firstDepositLp);

        // Subsequent deposits: LP = min(amt0 * totalLP / reserve0, amt1 * totalLP / reserve1)
        // Safe denominators (reserves > 0 for non-first deposit)
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

        // Select based on first deposit or not
        lpAmount = FHE.select(isFirstDeposit, firstDepositLp, subsequentLp);
        FHE.allowThis(lpAmount);
        FHE.allow(lpAmount, msg.sender);

        // Update encrypted reserves
        reserves.encReserve0 = FHE.add(reserves.encReserve0, amt0);
        reserves.encReserve1 = FHE.add(reserves.encReserve1, amt1);
        FHE.allowThis(reserves.encReserve0);
        FHE.allowThis(reserves.encReserve1);

        // Update encrypted LP tracking
        reserves.encTotalLpSupply = FHE.add(reserves.encTotalLpSupply, lpAmount);
        FHE.allowThis(reserves.encTotalLpSupply);

        // Update user's encrypted LP balance
        euint128 currentBalance = encLpBalances[poolId][msg.sender];
        if (Common.isInitialized(currentBalance)) {
            encLpBalances[poolId][msg.sender] = FHE.add(currentBalance, lpAmount);
        } else {
            encLpBalances[poolId][msg.sender] = lpAmount;
        }
        FHE.allowThis(encLpBalances[poolId][msg.sender]);
        FHE.allow(encLpBalances[poolId][msg.sender], msg.sender);

        _requestReserveSync(poolId);

        emit LiquidityAddedEncrypted(poolId, msg.sender);
    }

    /// @notice Remove liquidity with encrypted LP amount
    /// @dev Proportional withdrawal: amount = lp * reserve / totalLpSupply
    ///      Clamped to user's actual balance to prevent over-withdrawal
    function removeLiquidityEncrypted(
        PoolId poolId,
        InEuint128 calldata lpAmount
    ) external nonReentrant returns (euint128 amount0, euint128 amount1) {
        PoolState storage state = poolStates[poolId];
        PoolReserves storage reserves = poolReserves[poolId];

        euint128 requestedLp = FHE.asEuint128(lpAmount);
        FHE.allowThis(requestedLp);

        // Get user's actual balance and clamp requested amount
        euint128 userBalance = encLpBalances[poolId][msg.sender];
        if (!Common.isInitialized(userBalance)) {
            // No balance - return zeros
            amount0 = ENC_ZERO;
            amount1 = ENC_ZERO;
            return (amount0, amount1);
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

        // Proportional calculation: amount = lp * reserve / totalLpSupply
        amount0 = FHE.div(FHE.mul(lp, reserves.encReserve0), safeTotalLp);
        amount1 = FHE.div(FHE.mul(lp, reserves.encReserve1), safeTotalLp);
        FHE.allowThis(amount0);
        FHE.allowThis(amount1);

        // Update encrypted LP tracking
        reserves.encTotalLpSupply = FHE.sub(reserves.encTotalLpSupply, lp);
        encLpBalances[poolId][msg.sender] = FHE.sub(userBalance, lp);
        FHE.allowThis(reserves.encTotalLpSupply);
        FHE.allowThis(encLpBalances[poolId][msg.sender]);
        FHE.allow(encLpBalances[poolId][msg.sender], msg.sender);

        // Update encrypted reserves
        reserves.encReserve0 = FHE.sub(reserves.encReserve0, amount0);
        reserves.encReserve1 = FHE.sub(reserves.encReserve1, amount1);
        FHE.allowThis(reserves.encReserve0);
        FHE.allowThis(reserves.encReserve1);

        // Transfer tokens
        FHE.allow(amount0, address(state.token0));
        FHE.allow(amount1, address(state.token1));
        state.token0.transferEncryptedDirect(msg.sender, amount0);
        state.token1.transferEncryptedDirect(msg.sender, amount1);

        _requestReserveSync(poolId);

        emit LiquidityRemovedEncrypted(poolId, msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    DIRECT ENCRYPTED SWAP (from V2)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Fully encrypted swap - direction and amount hidden
    function swapEncrypted(
        PoolId poolId,
        InEbool calldata direction,
        InEuint128 calldata amountIn,
        InEuint128 calldata minOutput
    ) external nonReentrant whenNotPaused returns (euint128 amountOut) {
        PoolState storage state = poolStates[poolId];
        if (!state.initialized) revert PoolNotInitialized();

        ebool dir = FHE.asEbool(direction);
        euint128 amt = FHE.asEuint128(amountIn);
        FHE.allowThis(dir);
        FHE.allowThis(amt);

        // Transfer input (both paths execute, one is zero)
        euint128 token0Amt = FHE.select(dir, amt, ENC_ZERO);
        euint128 token1Amt = FHE.select(dir, ENC_ZERO, amt);

        FHE.allow(token0Amt, address(state.token0));
        FHE.allow(token1Amt, address(state.token1));

        state.token0.transferFromEncryptedDirect(msg.sender, address(this), token0Amt);
        state.token1.transferFromEncryptedDirect(msg.sender, address(this), token1Amt);

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

        FHE.allow(out0, address(state.token0));
        FHE.allow(out1, address(state.token1));

        state.token0.transferEncryptedDirect(msg.sender, out0);
        state.token1.transferEncryptedDirect(msg.sender, out1);

        _requestReserveSync(poolId);

        emit SwapEncrypted(poolId, msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                      RESERVE SYNC (from V2)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Request async decryption of reserves
    function _requestReserveSync(PoolId poolId) internal {
        PoolReserves storage reserves = poolReserves[poolId];

        if (block.number < reserves.lastSyncBlock + SYNC_COOLDOWN_BLOCKS) {
            return;
        }

        reserves.pendingReserve0 = reserves.encReserve0;
        reserves.pendingReserve1 = reserves.encReserve1;
        FHE.decrypt(reserves.pendingReserve0);
        FHE.decrypt(reserves.pendingReserve1);

        reserves.lastSyncBlock = block.number;
        emit ReserveSyncRequested(poolId, block.number);
    }

    /// @notice Try to sync reserves from decrypted values
    function trySyncReserves(PoolId poolId) external {
        PoolReserves storage reserves = poolReserves[poolId];

        (uint256 val0, bool ready0) = FHE.getDecryptResultSafe(reserves.pendingReserve0);
        (uint256 val1, bool ready1) = FHE.getDecryptResultSafe(reserves.pendingReserve1);

        if (ready0 && ready1) {
            reserves.reserve0 = val0;
            reserves.reserve1 = val1;
            emit ReservesSynced(poolId, val0, val1);
        }
    }

    /// @notice Estimate swap output from public reserve cache
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

    function _getCurrentTick(PoolId poolId) internal view returns (int24) {
        PoolReserves storage reserves = poolReserves[poolId];
        if (reserves.reserve0 == 0 || reserves.reserve1 == 0) return 0;

        uint256 price = (reserves.reserve1 * PRECISION) / reserves.reserve0;

        for (int24 tick = MIN_TICK; tick <= MAX_TICK; tick += TICK_SPACING) {
            if (tickPrices[tick] >= price) {
                return tick;
            }
        }
        return MAX_TICK;
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

    function _initializeTickPrices() internal {
        for (int24 tick = MIN_TICK; tick <= MAX_TICK; tick += TICK_SPACING) {
            tickPrices[tick] = _calculateTickPrice(tick);
        }
    }

    function _calculateTickPrice(int24 tick) internal pure returns (uint256) {
        if (tick == 0) return PRECISION;

        uint256 absTick = tick > 0 ? uint256(int256(tick)) : uint256(-int256(tick));
        uint256 ratio = PRECISION;

        for (uint256 i = 0; i < absTick / 60; i++) {
            ratio = (ratio * 10060) / 10000;
        }

        if (tick < 0) {
            ratio = (PRECISION * PRECISION) / ratio;
        }

        return ratio;
    }

    function _abs(int24 x) internal pure returns (int24) {
        return x >= 0 ? x : -x;
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
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
        require(_maxBuckets > 0 && _maxBuckets <= 20, "Invalid value");
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
        bool initialized,
        uint256 maxBucketsPerSwap,
        uint256 protocolFeeBps
    ) {
        PoolState storage state = poolStates[poolId];
        return (
            address(state.token0),
            address(state.token1),
            state.initialized,
            state.maxBucketsPerSwap,
            state.protocolFeeBps
        );
    }

    function getPoolReserves(PoolId poolId) external view returns (
        uint256 reserve0,
        uint256 reserve1,
        uint256 lpSupply
    ) {
        PoolReserves storage reserves = poolReserves[poolId];
        return (reserves.reserve0, reserves.reserve1, totalLpSupply[poolId]);
    }

    function getTickPrice(int24 tick) external view returns (uint256) {
        return tickPrices[tick];
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
