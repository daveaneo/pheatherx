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

/// @title FheatherX v4 - Private Limit Order Hook for Uniswap v4
/// @author FheatherX Team
/// @notice A Uniswap v4 Hook implementing encrypted limit orders using Fully Homomorphic Encryption (FHE)
/// @dev This contract extends Uniswap v4's hook system to provide:
///      - Privacy-preserving limit orders where amounts are encrypted via Fhenix CoFHE
///      - Custom swap logic that matches against encrypted limit order buckets
///      - Orders are grouped by price ticks (buckets) for efficient O(1) gas per bucket
///      - Pro-rata distribution using "proceeds per share" accumulator model
///      - Separate BUY and SELL buckets at each tick to prevent crossing issues
///      - Protocol fee collection with timelock for user protection
///
///      Integration with Uniswap v4:
///      - Inherits from BaseHook for proper hook lifecycle
///      - Uses beforeSwap to implement custom swap logic against limit order buckets
///      - Uses afterSwap to process any remaining limit order matching
///
///      Security features:
///      - ReentrancyGuard on all state-changing external functions
///      - Pausable for emergency stops
///      - 2-day timelock on fee changes
///      - FHE encryption prevents front-running and sandwich attacks
contract FheatherXv4 is BaseHook, ReentrancyGuard, Pausable, Ownable {
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

    // ═══════════════════════════════════════════════════════════════════════
    //                               TYPES
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Indicates whether a bucket contains buy or sell orders
    /// @dev BUY = users want to buy token0 (deposit token1), SELL = users want to sell token0 (deposit token0)
    enum BucketSide { BUY, SELL }

    /// @notice Represents a price bucket containing aggregated liquidity at a specific tick
    /// @dev Each bucket tracks total shares, remaining liquidity, and accumulator values
    struct Bucket {
        /// @notice Sum of all user shares in this bucket (encrypted)
        euint128 totalShares;
        /// @notice Current unfilled liquidity remaining in the bucket (encrypted)
        euint128 liquidity;
        /// @notice Accumulated proceeds per share, scaled by PRECISION (encrypted)
        euint128 proceedsPerShare;
        /// @notice Accumulated fills per share, scaled by PRECISION (encrypted)
        euint128 filledPerShare;
        /// @notice Whether this bucket has been initialized
        bool initialized;
    }

    /// @notice Represents a user's position in a specific bucket
    struct UserPosition {
        /// @notice User's share of the bucket (1:1 with deposit amount)
        euint128 shares;
        /// @notice Snapshot of bucket.proceedsPerShare at time of last deposit/claim
        euint128 proceedsPerShareSnapshot;
        /// @notice Snapshot of bucket.filledPerShare at time of last deposit/claim
        euint128 filledPerShareSnapshot;
        /// @notice Accumulated proceeds from previous deposits (not yet claimed)
        euint128 realizedProceeds;
    }

    /// @notice Pool-specific configuration and state
    struct PoolState {
        /// @notice Token addresses for this pool
        IFHERC20 token0;
        IFHERC20 token1;
        /// @notice Whether this pool has been initialized
        bool initialized;
        /// @notice Plaintext reserve of token0 for price estimation
        uint256 reserve0;
        /// @notice Plaintext reserve of token1 for price estimation
        uint256 reserve1;
        /// @notice Maximum buckets processed per swap
        uint256 maxBucketsPerSwap;
        /// @notice Protocol fee in basis points (applied to swap outputs)
        uint256 protocolFeeBps;
    }

    /// @notice Pending fee change for a pool
    struct PendingFee {
        uint256 feeBps;
        uint256 effectiveTimestamp;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                               STATE
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Pre-computed encrypted zero value for gas optimization
    euint128 internal immutable ENC_ZERO;

    /// @notice Pre-computed encrypted PRECISION value (1e18) for fixed-point math
    euint128 internal immutable ENC_PRECISION;

    /// @notice Pre-computed encrypted one value for division safety
    euint128 internal immutable ENC_ONE;

    /// @notice Pool-specific state indexed by PoolId
    mapping(PoolId => PoolState) public poolStates;

    /// @notice Buckets indexed by pool, tick, and side
    mapping(PoolId => mapping(int24 => mapping(BucketSide => Bucket))) public buckets;

    /// @notice User positions indexed by pool, user, tick, and side
    mapping(PoolId => mapping(address => mapping(int24 => mapping(BucketSide => UserPosition)))) public positions;

    /// @notice Bitmap tracking which ticks have active BUY orders per pool
    mapping(PoolId => mapping(int16 => uint256)) internal buyBitmaps;

    /// @notice Bitmap tracking which ticks have active SELL orders per pool
    mapping(PoolId => mapping(int16 => uint256)) internal sellBitmaps;

    /// @notice Pre-computed prices for each tick, scaled by PRECISION
    mapping(int24 => uint256) public tickPrices;

    /// @notice Address that receives protocol fees
    address public feeCollector;

    /// @notice Pending fee changes per pool (for timelock)
    mapping(PoolId => PendingFee) public pendingFees;

    // ═══════════════════════════════════════════════════════════════════════
    //                               EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Emitted when a user deposits tokens into a bucket
    event Deposit(
        PoolId indexed poolId,
        address indexed user,
        int24 indexed tick,
        BucketSide side,
        bytes32 amountHash
    );

    /// @notice Emitted when a user withdraws unfilled liquidity from a bucket
    event Withdraw(
        PoolId indexed poolId,
        address indexed user,
        int24 indexed tick,
        BucketSide side,
        bytes32 amountHash
    );

    /// @notice Emitted when a user claims proceeds from filled orders
    event Claim(
        PoolId indexed poolId,
        address indexed user,
        int24 indexed tick,
        BucketSide side,
        bytes32 amountHash
    );

    /// @notice Emitted when a pool is initialized with this hook
    event PoolInitialized(
        PoolId indexed poolId,
        address token0,
        address token1
    );

    /// @notice Emitted when a swap is executed through our hook
    event Swap(
        PoolId indexed poolId,
        address indexed user,
        bool indexed zeroForOne,
        uint256 amountIn,
        uint256 amountOut
    );

    /// @notice Emitted when a bucket is filled during a swap
    event BucketFilled(
        PoolId indexed poolId,
        int24 indexed tick,
        BucketSide side
    );

    /// @notice Emitted when a protocol fee change is queued
    event ProtocolFeeQueued(
        PoolId indexed poolId,
        uint256 newFeeBps,
        uint256 effectiveTimestamp
    );

    /// @notice Emitted when a queued protocol fee is applied
    event ProtocolFeeApplied(
        PoolId indexed poolId,
        uint256 newFeeBps
    );

    /// @notice Emitted when the fee collector address is updated
    event FeeCollectorUpdated(address newCollector);

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error InvalidTick();
    error PoolNotInitialized();
    error ZeroAmount();
    error InsufficientBalance();
    error OnlyFHERC20();
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
        address _owner
    ) BaseHook(_poolManager) Ownable(_owner) {
        // Initialize encrypted constants
        ENC_ZERO = FHE.asEuint128(0);
        ENC_PRECISION = FHE.asEuint128(uint128(PRECISION));
        ENC_ONE = FHE.asEuint128(1);

        FHE.allowThis(ENC_ZERO);
        FHE.allowThis(ENC_PRECISION);
        FHE.allowThis(ENC_ONE);

        // Pre-compute tick prices
        _initializeTickPrices();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         HOOK PERMISSIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Returns the hook permissions for this contract
    /// @dev This hook uses:
    ///      - afterInitialize: To set up pool-specific state
    ///      - beforeSwap: To implement custom swap logic against limit order buckets
    ///      - beforeSwapReturnDelta: To modify the swap amounts
    ///      - afterSwap: To process any remaining limit order matching
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,           // Set up pool state
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,                // Custom swap logic
            afterSwap: true,                 // Process remaining limit orders
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,     // Modify swap amounts
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          HOOK CALLBACKS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Called after a pool is initialized
    /// @dev Sets up pool-specific state including token addresses
    function _afterInitialize(
        address,
        PoolKey calldata key,
        uint160,
        int24
    ) internal override returns (bytes4) {
        PoolId poolId = key.toId();

        // Store pool configuration
        poolStates[poolId] = PoolState({
            token0: IFHERC20(Currency.unwrap(key.currency0)),
            token1: IFHERC20(Currency.unwrap(key.currency1)),
            initialized: true,
            reserve0: 0,
            reserve1: 0,
            maxBucketsPerSwap: 5,
            protocolFeeBps: 5  // 0.05% default fee
        });

        emit PoolInitialized(
            poolId,
            Currency.unwrap(key.currency0),
            Currency.unwrap(key.currency1)
        );

        return this.afterInitialize.selector;
    }

    /// @notice Called before a swap is executed
    /// @dev Implements custom swap logic by matching against limit order buckets
    function _beforeSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        PoolId poolId = key.toId();
        PoolState storage state = poolStates[poolId];

        if (!state.initialized) {
            // Pass through to normal Uniswap AMM
            return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        // Determine swap direction and amount
        bool zeroForOne = params.zeroForOne;
        // Note: amountSpecified is negative for exact input swaps
        uint256 amountIn = params.amountSpecified < 0
            ? uint256(-params.amountSpecified)
            : uint256(params.amountSpecified);

        if (amountIn == 0) {
            return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        // Execute custom swap against our limit order buckets
        uint256 amountOut = _executeSwap(poolId, state, zeroForOne, amountIn, sender);

        // Apply protocol fee
        uint256 fee = (amountOut * state.protocolFeeBps) / 10000;
        uint256 amountOutAfterFee = amountOut - fee;

        // Transfer fee to collector if set
        if (fee > 0 && feeCollector != address(0)) {
            IERC20 feeToken = IERC20(address(zeroForOne ? state.token1 : state.token0));
            feeToken.safeTransfer(feeCollector, fee);
        }

        // Update reserves
        if (zeroForOne) {
            state.reserve0 += amountIn;
            if (state.reserve1 >= amountOut) {
                state.reserve1 -= amountOut;
            }
        } else {
            state.reserve1 += amountIn;
            if (state.reserve0 >= amountOut) {
                state.reserve0 -= amountOut;
            }
        }

        emit Swap(poolId, sender, zeroForOne, amountIn, amountOutAfterFee);

        // Return delta to tell PoolManager we handled the swap
        // Positive values are tokens the hook owes the pool
        // Negative values are tokens the pool owes the hook
        int128 delta0 = zeroForOne ? int128(int256(amountIn)) : -int128(int256(amountOutAfterFee));
        int128 delta1 = zeroForOne ? -int128(int256(amountOutAfterFee)) : int128(int256(amountIn));

        BeforeSwapDelta delta = BeforeSwapDelta.wrap(
            (int256(delta0) << 128) | (int256(delta1) & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF)
        );

        return (this.beforeSwap.selector, delta, 0);
    }

    /// @notice Called after a swap is executed
    /// @dev Processes any remaining limit order matching after price movement
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

        // Process any limit orders that should be filled based on the new price
        _processLimitOrders(poolId, state, params.zeroForOne);

        return (this.afterSwap.selector, 0);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         LIMIT ORDER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Deposit tokens into a limit order bucket
    /// @param poolId The pool to deposit into
    /// @param tick The price tick for the order
    /// @param side Whether this is a BUY or SELL order
    /// @param encryptedAmount The encrypted amount to deposit
    /// @param deadline Transaction deadline
    /// @param maxTickDrift Maximum acceptable tick drift from current price
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

        // Check price drift
        int24 currentTick = _getCurrentTick(poolId);
        if (_abs(currentTick - tick) > maxTickDrift) revert PriceMoved();

        euint128 amount = FHE.asEuint128(encryptedAmount);
        FHE.allowThis(amount);

        // Ensure bucket is initialized
        Bucket storage bucket = buckets[poolId][tick][side];
        if (!bucket.initialized) {
            _initializeBucket(bucket);
        }

        // Get or initialize user position
        UserPosition storage position = positions[poolId][msg.sender][tick][side];

        // Auto-claim any existing proceeds before updating position
        if (Common.isInitialized(position.shares)) {
            _autoClaim(poolId, tick, side, bucket, position);
        }

        // Update bucket totals
        bucket.totalShares = FHE.add(bucket.totalShares, amount);
        bucket.liquidity = FHE.add(bucket.liquidity, amount);
        FHE.allowThis(bucket.totalShares);
        FHE.allowThis(bucket.liquidity);

        // Update user position
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

        // Transfer tokens from user
        IFHERC20 depositToken = side == BucketSide.SELL ? state.token0 : state.token1;
        FHE.allow(amount, address(depositToken));
        depositToken.transferFromEncryptedDirect(msg.sender, address(this), amount);

        emit Deposit(poolId, msg.sender, tick, side, keccak256(abi.encode(encryptedAmount)));
    }

    /// @notice Withdraw unfilled tokens from a limit order bucket
    /// @param poolId The pool to withdraw from
    /// @param tick The price tick of the order
    /// @param side Whether this is a BUY or SELL order
    /// @param encryptedAmount The encrypted amount to withdraw
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

        // Calculate unfilled shares
        euint128 unfilledShares = _calculateUnfilled(position, bucket);

        // Ensure withdrawal doesn't exceed unfilled balance
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

        // Transfer tokens back to user
        IFHERC20 withdrawToken = side == BucketSide.SELL ? state.token0 : state.token1;
        FHE.allow(withdrawAmount, address(withdrawToken));
        withdrawToken.transferEncryptedDirect(msg.sender, withdrawAmount);

        emit Withdraw(poolId, msg.sender, tick, side, keccak256(abi.encode(encryptedAmount)));
    }

    /// @notice Claim proceeds from filled orders
    /// @param poolId The pool to claim from
    /// @param tick The price tick of the order
    /// @param side Whether this is a BUY or SELL order
    function claim(
        PoolId poolId,
        int24 tick,
        BucketSide side
    ) external nonReentrant whenNotPaused {
        PoolState storage state = poolStates[poolId];
        if (!state.initialized) revert PoolNotInitialized();

        Bucket storage bucket = buckets[poolId][tick][side];
        UserPosition storage position = positions[poolId][msg.sender][tick][side];

        // Calculate total proceeds
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

        // Transfer proceeds to user (SELL bucket: deposited token0, receive token1)
        IFHERC20 proceedsToken = side == BucketSide.SELL ? state.token1 : state.token0;
        FHE.allow(totalProceeds, address(proceedsToken));
        proceedsToken.transferEncryptedDirect(msg.sender, totalProceeds);

        emit Claim(poolId, msg.sender, tick, side, keccak256(abi.encode(euint128.unwrap(totalProceeds))));
    }

    /// @notice Exit entire position - withdraws all unfilled liquidity and claims all proceeds
    /// @param poolId The pool to exit from
    /// @param tick The price tick of the bucket
    /// @param side Whether this is a BUY or SELL bucket
    function exit(
        PoolId poolId,
        int24 tick,
        BucketSide side
    ) external nonReentrant whenNotPaused {
        PoolState storage state = poolStates[poolId];
        if (!state.initialized) revert PoolNotInitialized();

        Bucket storage bucket = buckets[poolId][tick][side];
        UserPosition storage position = positions[poolId][msg.sender][tick][side];

        // Calculate unfilled and proceeds
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
    //                         INTERNAL: SWAP LOGIC
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Execute a swap against our limit order buckets
    /// @dev Port of FheatherXv3's swap logic
    function _executeSwap(
        PoolId poolId,
        PoolState storage state,
        bool zeroForOne,
        uint256 amountIn,
        address
    ) internal returns (uint256 amountOut) {
        // Transfer input tokens from swapper via PoolManager (already handled by hook system)

        euint128 remainingInput = FHE.asEuint128(uint128(amountIn));
        euint128 totalOutput = ENC_ZERO;
        FHE.allowThis(remainingInput);
        FHE.allowThis(totalOutput);

        int24 currentTick = _getCurrentTick(poolId);

        // zeroForOne = selling token0 → fills BUY orders (people wanting to buy token0)
        // !zeroForOne = selling token1 → fills SELL orders (people wanting to sell token0)
        BucketSide side = zeroForOne ? BucketSide.BUY : BucketSide.SELL;
        // When selling token0, search UP to find highest-priced BUY orders (best price for seller)
        // When selling token1, search DOWN to find lowest-priced SELL orders (best price for buyer)
        bool searchUp = zeroForOne;

        uint256 bucketsProcessed = 0;

        while (bucketsProcessed < state.maxBucketsPerSwap) {
            int24 nextTick = _findNextActiveTick(poolId, currentTick, side, searchUp);
            if (nextTick == type(int24).max || nextTick == type(int24).min) break;

            Bucket storage bucket = buckets[poolId][nextTick][side];
            if (!bucket.initialized) {
                currentTick = searchUp ? nextTick + TICK_SPACING : nextTick - TICK_SPACING;
                continue;
            }

            ebool hasLiquidity = FHE.gt(bucket.liquidity, ENC_ZERO);
            uint256 tickPrice = tickPrices[nextTick];

            // Calculate bucket value in input token terms
            euint128 bucketValueInInput;
            if (zeroForOne) {
                // Selling token0 → BUY bucket holds token1
                // bucketValueInInput = liquidity / price (convert token1 to token0 equivalent)
                bucketValueInInput = _divPrecision(bucket.liquidity, tickPrice);
            } else {
                // Selling token1 → SELL bucket holds token0
                // bucketValueInInput = liquidity * price (convert token0 to token1 equivalent)
                bucketValueInInput = _mulPrecision(bucket.liquidity, tickPrice);
            }

            euint128 fillValueInInput = FHE.min(remainingInput, bucketValueInInput);
            fillValueInInput = FHE.select(hasLiquidity, fillValueInInput, ENC_ZERO);
            FHE.allowThis(fillValueInInput);

            euint128 fillAmountNative;
            euint128 outputAmount;

            if (zeroForOne) {
                // Fill in native = amount of token1 consumed from bucket
                fillAmountNative = _mulPrecision(fillValueInInput, tickPrice);
                outputAmount = fillAmountNative;
            } else {
                // Fill in native = amount of token0 consumed from bucket
                fillAmountNative = _divPrecision(fillValueInInput, tickPrice);
                outputAmount = fillAmountNative;
            }
            FHE.allowThis(fillAmountNative);
            FHE.allowThis(outputAmount);

            // Update bucket accumulators
            _updateBucketOnFill(bucket, fillAmountNative, fillValueInInput);

            remainingInput = FHE.sub(remainingInput, fillValueInInput);
            totalOutput = FHE.add(totalOutput, outputAmount);
            FHE.allowThis(remainingInput);
            FHE.allowThis(totalOutput);

            currentTick = searchUp ? nextTick + TICK_SPACING : nextTick - TICK_SPACING;
            bucketsProcessed++;

            emit BucketFilled(poolId, nextTick, side);
        }

        // Estimate output for plaintext return value
        amountOut = _estimateOutput(zeroForOne, amountIn, bucketsProcessed, poolId);
    }

    /// @notice Process limit orders after a swap (for any orders triggered by price movement)
    function _processLimitOrders(
        PoolId poolId,
        PoolState storage state,
        bool zeroForOne
    ) internal {
        // For zeroForOne swaps (selling token0), match SELL orders
        // For oneForZero swaps (buying token0), match BUY orders
        BucketSide matchSide = zeroForOne ? BucketSide.SELL : BucketSide.BUY;
        bool searchUp = !zeroForOne;

        uint256 bucketsProcessed = 0;
        int24 currentTick = _getCurrentTick(poolId);

        while (bucketsProcessed < state.maxBucketsPerSwap) {
            int24 nextTick = _findNextActiveTick(poolId, currentTick, matchSide, searchUp);
            if (nextTick == type(int24).max || nextTick == type(int24).min) break;

            Bucket storage bucket = buckets[poolId][nextTick][matchSide];
            if (!bucket.initialized) {
                currentTick = searchUp ? nextTick + TICK_SPACING : nextTick - TICK_SPACING;
                continue;
            }

            // Match orders at this tick
            _matchBucket(bucket, nextTick);

            bucketsProcessed++;
            currentTick = searchUp ? nextTick + TICK_SPACING : nextTick - TICK_SPACING;
        }
    }

    /// @notice Update bucket accumulators when a fill occurs during a swap
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

        bucket.liquidity = FHE.sub(bucket.liquidity, fillAmount);

        FHE.allowThis(bucket.proceedsPerShare);
        FHE.allowThis(bucket.filledPerShare);
        FHE.allowThis(bucket.liquidity);
    }

    /// @notice Match orders in a single bucket (full fill)
    function _matchBucket(
        Bucket storage bucket,
        int24 /* tick */
    ) internal {
        // Calculate fill amount based on available liquidity
        euint128 fillAmount = bucket.liquidity;

        ebool hasShares = FHE.gt(bucket.totalShares, ENC_ZERO);
        euint128 safeDenom = FHE.select(hasShares, bucket.totalShares, ENC_ONE);
        FHE.allowThis(safeDenom);

        // Update proceeds per share accumulator
        euint128 proceedsIncrease = FHE.div(
            FHE.mul(fillAmount, ENC_PRECISION),
            safeDenom
        );
        proceedsIncrease = FHE.select(hasShares, proceedsIncrease, ENC_ZERO);
        bucket.proceedsPerShare = FHE.add(bucket.proceedsPerShare, proceedsIncrease);

        // Update filled per share accumulator
        euint128 filledIncrease = FHE.div(
            FHE.mul(fillAmount, ENC_PRECISION),
            safeDenom
        );
        filledIncrease = FHE.select(hasShares, filledIncrease, ENC_ZERO);
        bucket.filledPerShare = FHE.add(bucket.filledPerShare, filledIncrease);

        // Reduce liquidity
        bucket.liquidity = ENC_ZERO;
        FHE.allowThis(bucket.liquidity);
        FHE.allowThis(bucket.proceedsPerShare);
        FHE.allowThis(bucket.filledPerShare);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                       INTERNAL: HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Calculate a user's claimable proceeds
    function _calculateProceeds(
        UserPosition storage pos,
        Bucket storage bucket
    ) internal returns (euint128) {
        if (!Common.isInitialized(pos.shares)) {
            return ENC_ZERO;
        }
        euint128 delta = FHE.sub(bucket.proceedsPerShare, pos.proceedsPerShareSnapshot);
        return FHE.div(FHE.mul(pos.shares, delta), ENC_PRECISION);
    }

    /// @notice Calculate how much of a user's position remains unfilled
    function _calculateUnfilled(
        UserPosition storage pos,
        Bucket storage bucket
    ) internal returns (euint128) {
        if (!Common.isInitialized(pos.shares)) {
            return ENC_ZERO;
        }
        euint128 delta = FHE.sub(bucket.filledPerShare, pos.filledPerShareSnapshot);
        euint128 filled = FHE.div(FHE.mul(pos.shares, delta), ENC_PRECISION);
        ebool hasUnfilled = FHE.gte(pos.shares, filled);
        return FHE.select(hasUnfilled, FHE.sub(pos.shares, filled), ENC_ZERO);
    }

    /// @notice Auto-claim proceeds when depositing again
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

    /// @notice Initialize a bucket with encrypted zero values
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

    /// @notice Multiplies an encrypted amount by a price, then divides by PRECISION
    function _mulPrecision(euint128 amount, uint256 price) internal returns (euint128) {
        euint128 encPrice = FHE.asEuint128(uint128(price));
        FHE.allowThis(encPrice);
        return FHE.div(FHE.mul(amount, encPrice), ENC_PRECISION);
    }

    /// @notice Multiplies an encrypted amount by PRECISION, then divides by price
    function _divPrecision(euint128 amount, uint256 price) internal returns (euint128) {
        euint128 encPrice = FHE.asEuint128(uint128(price));
        FHE.allowThis(encPrice);
        return FHE.div(FHE.mul(amount, ENC_PRECISION), encPrice);
    }

    /// @notice Estimates output amount based on current reserves and price
    function _estimateOutput(
        bool zeroForOne,
        uint256 amountIn,
        uint256 bucketsProcessed,
        PoolId poolId
    ) internal view returns (uint256) {
        PoolState storage state = poolStates[poolId];
        if (bucketsProcessed == 0 || state.reserve0 == 0 || state.reserve1 == 0) return 0;

        int24 currentTick = _getCurrentTick(poolId);
        uint256 price = tickPrices[currentTick];
        if (price == 0) price = PRECISION;

        if (zeroForOne) {
            return (amountIn * price) / PRECISION;
        } else {
            return (amountIn * PRECISION) / price;
        }
    }

    /// @notice Returns the absolute value of a signed integer
    function _abs(int24 x) internal pure returns (int24) {
        return x >= 0 ? x : -x;
    }

    /// @notice Initialize tick prices
    function _initializeTickPrices() internal {
        for (int24 tick = MIN_TICK; tick <= MAX_TICK; tick += TICK_SPACING) {
            tickPrices[tick] = _calculateTickPrice(tick);
        }
    }

    /// @notice Calculate the price for a given tick
    function _calculateTickPrice(int24 tick) internal pure returns (uint256) {
        if (tick == 0) return PRECISION;

        uint256 absTick = tick > 0 ? uint256(int256(tick)) : uint256(-int256(tick));
        uint256 ratio = PRECISION;

        // Price = 1.0001^tick * PRECISION
        for (uint256 i = 0; i < absTick / 60; i++) {
            ratio = (ratio * 10060) / 10000; // 1.006 per 60 ticks
        }

        if (tick < 0) {
            ratio = (PRECISION * PRECISION) / ratio;
        }

        return ratio;
    }

    /// @notice Get current tick based on reserves
    function _getCurrentTick(PoolId poolId) internal view returns (int24) {
        PoolState storage state = poolStates[poolId];
        if (state.reserve0 == 0 || state.reserve1 == 0) return 0;

        uint256 price = (state.reserve1 * PRECISION) / state.reserve0;

        // Find closest tick
        for (int24 tick = MIN_TICK; tick <= MAX_TICK; tick += TICK_SPACING) {
            if (tickPrices[tick] >= price) {
                return tick;
            }
        }
        return MAX_TICK;
    }

    /// @notice Find next active tick in the bitmap
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

    /// @notice Set bit in bitmap for active tick
    function _setBit(PoolId poolId, int24 tick, BucketSide side) internal {
        int16 wordPos = int16(tick >> 8);
        uint8 bitPos = uint8(uint24(tick) % 256);

        if (side == BucketSide.BUY) {
            buyBitmaps[poolId][wordPos] |= (1 << bitPos);
        } else {
            sellBitmaps[poolId][wordPos] |= (1 << bitPos);
        }
    }

    /// @notice Clear bit in bitmap for empty tick
    function _clearBit(PoolId poolId, int24 tick, BucketSide side) internal {
        int16 wordPos = int16(tick >> 8);
        uint8 bitPos = uint8(uint24(tick) % 256);

        if (side == BucketSide.BUY) {
            buyBitmaps[poolId][wordPos] &= ~(1 << bitPos);
        } else {
            sellBitmaps[poolId][wordPos] &= ~(1 << bitPos);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Pause the contract
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the contract
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Set fee collector address
    function setFeeCollector(address _feeCollector) external onlyOwner {
        feeCollector = _feeCollector;
        emit FeeCollectorUpdated(_feeCollector);
    }

    /// @notice Update max buckets per swap for a pool
    function setMaxBucketsPerSwap(PoolId poolId, uint256 _maxBuckets) external onlyOwner {
        require(_maxBuckets > 0 && _maxBuckets <= 20, "Invalid value");
        poolStates[poolId].maxBucketsPerSwap = _maxBuckets;
    }

    /// @notice Queue a protocol fee change with timelock
    /// @param poolId The pool to change fee for
    /// @param _feeBps The new fee in basis points (max 100 = 1%)
    function queueProtocolFee(PoolId poolId, uint256 _feeBps) external onlyOwner {
        if (_feeBps > 100) revert FeeTooHigh();

        pendingFees[poolId] = PendingFee({
            feeBps: _feeBps,
            effectiveTimestamp: block.timestamp + FEE_CHANGE_DELAY
        });

        emit ProtocolFeeQueued(poolId, _feeBps, block.timestamp + FEE_CHANGE_DELAY);
    }

    /// @notice Apply a previously queued protocol fee change
    /// @param poolId The pool to apply fee change for
    function applyProtocolFee(PoolId poolId) external {
        PendingFee storage pending = pendingFees[poolId];
        if (pending.effectiveTimestamp == 0 || block.timestamp < pending.effectiveTimestamp) {
            revert FeeChangeNotReady();
        }

        poolStates[poolId].protocolFeeBps = pending.feeBps;
        emit ProtocolFeeApplied(poolId, pending.feeBps);

        // Clear pending
        delete pendingFees[poolId];
    }

    /// @notice Initialize or update the plaintext reserve values for a pool
    /// @param poolId The pool to set reserves for
    /// @param _reserve0 The amount of token0
    /// @param _reserve1 The amount of token1
    function initializeReserves(PoolId poolId, uint256 _reserve0, uint256 _reserve1) external onlyOwner {
        poolStates[poolId].reserve0 = _reserve0;
        poolStates[poolId].reserve1 = _reserve1;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Get pool state
    function getPoolState(PoolId poolId) external view returns (
        address token0,
        address token1,
        bool initialized,
        uint256 reserve0,
        uint256 reserve1,
        uint256 maxBucketsPerSwap,
        uint256 protocolFeeBps
    ) {
        PoolState storage state = poolStates[poolId];
        return (
            address(state.token0),
            address(state.token1),
            state.initialized,
            state.reserve0,
            state.reserve1,
            state.maxBucketsPerSwap,
            state.protocolFeeBps
        );
    }

    /// @notice Check if a tick has active orders
    function hasActiveOrders(PoolId poolId, int24 tick, BucketSide side) external view returns (bool) {
        int16 wordPos = int16(tick >> 8);
        uint8 bitPos = uint8(uint24(tick) % 256);

        if (side == BucketSide.BUY) {
            return (buyBitmaps[poolId][wordPos] & (1 << bitPos)) != 0;
        } else {
            return (sellBitmaps[poolId][wordPos] & (1 << bitPos)) != 0;
        }
    }

    /// @notice Get tick price
    function getTickPrice(int24 tick) external view returns (uint256) {
        return tickPrices[tick];
    }

    /// @notice Get pending fee change for a pool
    function getPendingFee(PoolId poolId) external view returns (uint256 feeBps, uint256 effectiveTimestamp) {
        PendingFee storage pending = pendingFees[poolId];
        return (pending.feeBps, pending.effectiveTimestamp);
    }
}
