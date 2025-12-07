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
///      - Orders are grouped by price ticks (buckets) for efficient O(1) gas per bucket
///      - Pro-rata distribution using "proceeds per share" accumulator model
///      - Separate BUY and SELL buckets at each tick to prevent crossing issues
///
///      Integration with Uniswap v4:
///      - Inherits from BaseHook for proper hook lifecycle
///      - Uses afterSwap to process limit orders when price moves
///      - Encrypted order state is maintained separately from pool state
///
///      Security features:
///      - ReentrancyGuard on all state-changing external functions
///      - Pausable for emergency stops
///      - Ownable for administrative control
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
        /// @notice Protocol fee in basis points
        uint256 protocolFeeBps;
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

    /// @notice Emitted when limit orders are matched during a swap
    event OrdersMatched(
        PoolId indexed poolId,
        int24 fromTick,
        int24 toTick,
        bool zeroForOne
    );

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error InvalidTick();
    error PoolNotInitialized();
    error ZeroAmount();
    error InsufficientBalance();
    error OnlyFHERC20();

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

        // Pre-compute tick prices
        _initializeTickPrices();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         HOOK PERMISSIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Returns the hook permissions for this contract
    /// @dev This hook uses:
    ///      - afterInitialize: To set up pool-specific state
    ///      - afterSwap: To process limit orders when price moves
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,      // Set up pool state
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: false,
            afterSwap: true,            // Process limit orders
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
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
            protocolFeeBps: 5
        });

        emit PoolInitialized(
            poolId,
            Currency.unwrap(key.currency0),
            Currency.unwrap(key.currency1)
        );

        return this.afterInitialize.selector;
    }

    /// @notice Called after a swap is executed
    /// @dev Processes limit orders that should be filled based on the new price
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

        // Determine which direction the price moved and process matching orders
        // If zeroForOne (selling token0), price goes down -> match SELL orders
        // If oneForZero (selling token1), price goes up -> match BUY orders
        bool zeroForOne = params.zeroForOne;

        // Process limit orders that should be filled
        _processLimitOrders(poolId, state, zeroForOne);

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
    function deposit(
        PoolId poolId,
        int24 tick,
        BucketSide side,
        InEuint128 calldata encryptedAmount
    ) external nonReentrant whenNotPaused {
        PoolState storage state = poolStates[poolId];
        if (!state.initialized) revert PoolNotInitialized();
        if (tick < MIN_TICK || tick > MAX_TICK || tick % TICK_SPACING != 0) revert InvalidTick();

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

        // Update reserves
        if (side == BucketSide.SELL) {
            state.reserve0 += 1; // Placeholder - actual amount is encrypted
        } else {
            state.reserve1 += 1;
        }

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

        // Calculate unfilled shares using FHE
        euint128 filledDelta = FHE.sub(bucket.filledPerShare, position.filledPerShareSnapshot);
        euint128 filledAmount = FHE.div(FHE.mul(position.shares, filledDelta), ENC_PRECISION);
        euint128 unfilledShares = FHE.sub(position.shares, filledAmount);

        // Ensure withdrawal doesn't exceed unfilled balance
        euint128 withdrawAmount = FHE.select(
            FHE.lt(amount, unfilledShares),
            amount,
            unfilledShares
        );

        // Update bucket
        bucket.totalShares = FHE.sub(bucket.totalShares, withdrawAmount);
        bucket.liquidity = FHE.sub(bucket.liquidity, withdrawAmount);

        // Update position
        position.shares = FHE.sub(position.shares, withdrawAmount);

        // Allow this contract to access the encrypted value
        FHE.allowThis(withdrawAmount);

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

        // Calculate pending proceeds
        euint128 proceedsDelta = FHE.sub(bucket.proceedsPerShare, position.proceedsPerShareSnapshot);
        euint128 pendingProceeds = FHE.div(FHE.mul(position.shares, proceedsDelta), ENC_PRECISION);
        euint128 totalProceeds = FHE.add(pendingProceeds, position.realizedProceeds);

        // Update position
        position.proceedsPerShareSnapshot = bucket.proceedsPerShare;
        position.realizedProceeds = ENC_ZERO;

        // Allow this contract and token to access the encrypted value
        FHE.allowThis(totalProceeds);

        // Transfer proceeds to user
        IFHERC20 proceedsToken = side == BucketSide.SELL ? state.token1 : state.token0;
        FHE.allow(totalProceeds, address(proceedsToken));
        proceedsToken.transferEncryptedDirect(msg.sender, totalProceeds);

        emit Claim(poolId, msg.sender, tick, side, keccak256(abi.encode(euint128.unwrap(totalProceeds))));
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Process limit orders after a swap
    function _processLimitOrders(
        PoolId poolId,
        PoolState storage state,
        bool zeroForOne
    ) internal {
        // For zeroForOne swaps (selling token0), match SELL orders
        // For oneForZero swaps (buying token0), match BUY orders
        BucketSide matchSide = zeroForOne ? BucketSide.SELL : BucketSide.BUY;

        uint256 bucketsProcessed = 0;
        int24 currentTick = _getCurrentTick(poolId);

        // Iterate through ticks with orders to match
        while (bucketsProcessed < state.maxBucketsPerSwap) {
            int24 nextTick = _findNextActiveTick(poolId, currentTick, matchSide);
            if (nextTick == type(int24).max || nextTick == type(int24).min) break;

            Bucket storage bucket = buckets[poolId][nextTick][matchSide];
            if (!bucket.initialized) {
                currentTick = nextTick + (zeroForOne ? -TICK_SPACING : TICK_SPACING);
                continue;
            }

            // Match orders at this tick (simplified - actual matching uses encrypted math)
            _matchBucket(poolId, state, nextTick, matchSide, bucket);

            bucketsProcessed++;
            currentTick = nextTick + (zeroForOne ? -TICK_SPACING : TICK_SPACING);
        }

        if (bucketsProcessed > 0) {
            emit OrdersMatched(poolId, currentTick, _getCurrentTick(poolId), zeroForOne);
        }
    }

    /// @notice Match orders in a single bucket
    function _matchBucket(
        PoolId poolId,
        PoolState storage state,
        int24 tick,
        BucketSide side,
        Bucket storage bucket
    ) internal {
        uint256 price = tickPrices[tick];

        // Calculate fill amount based on available liquidity
        euint128 fillAmount = bucket.liquidity;

        // Update proceeds per share accumulator
        euint128 proceedsIncrease = FHE.div(
            FHE.mul(fillAmount, ENC_PRECISION),
            FHE.add(bucket.totalShares, ENC_ONE)
        );
        bucket.proceedsPerShare = FHE.add(bucket.proceedsPerShare, proceedsIncrease);

        // Update filled per share accumulator
        euint128 filledIncrease = FHE.div(
            FHE.mul(fillAmount, ENC_PRECISION),
            FHE.add(bucket.totalShares, ENC_ONE)
        );
        bucket.filledPerShare = FHE.add(bucket.filledPerShare, filledIncrease);

        // Reduce liquidity
        bucket.liquidity = ENC_ZERO;
        FHE.allowThis(bucket.liquidity);
        FHE.allowThis(bucket.proceedsPerShare);
        FHE.allowThis(bucket.filledPerShare);
    }

    /// @notice Auto-claim proceeds when depositing again
    function _autoClaim(
        PoolId poolId,
        int24 tick,
        BucketSide side,
        Bucket storage bucket,
        UserPosition storage position
    ) internal {
        euint128 proceedsDelta = FHE.sub(bucket.proceedsPerShare, position.proceedsPerShareSnapshot);
        euint128 pendingProceeds = FHE.div(FHE.mul(position.shares, proceedsDelta), ENC_PRECISION);
        position.realizedProceeds = FHE.add(position.realizedProceeds, pendingProceeds);
    }

    /// @notice Initialize a bucket with encrypted zero values
    function _initializeBucket(Bucket storage bucket) internal {
        bucket.totalShares = ENC_ZERO;
        bucket.liquidity = ENC_ZERO;
        bucket.proceedsPerShare = ENC_ZERO;
        bucket.filledPerShare = ENC_ZERO;
        bucket.initialized = true;
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
        BucketSide side
    ) internal view returns (int24) {
        mapping(int16 => uint256) storage bitmap = side == BucketSide.BUY
            ? buyBitmaps[poolId]
            : sellBitmaps[poolId];

        // Simplified - in production would use TickBitmap library
        for (int24 tick = currentTick; tick >= MIN_TICK && tick <= MAX_TICK;
             tick += (side == BucketSide.SELL ? -TICK_SPACING : TICK_SPACING)) {
            int16 wordPos = int16(tick >> 8);
            uint8 bitPos = uint8(int8(tick % 256));
            if ((bitmap[wordPos] & (1 << bitPos)) != 0) {
                return tick;
            }
        }
        return side == BucketSide.SELL ? type(int24).min : type(int24).max;
    }

    /// @notice Set bit in bitmap for active tick
    function _setBit(PoolId poolId, int24 tick, BucketSide side) internal {
        int16 wordPos = int16(tick >> 8);
        uint8 bitPos = uint8(int8(tick % 256));

        if (side == BucketSide.BUY) {
            buyBitmaps[poolId][wordPos] |= (1 << bitPos);
        } else {
            sellBitmaps[poolId][wordPos] |= (1 << bitPos);
        }
    }

    /// @notice Clear bit in bitmap for empty tick
    function _clearBit(PoolId poolId, int24 tick, BucketSide side) internal {
        int16 wordPos = int16(tick >> 8);
        uint8 bitPos = uint8(int8(tick % 256));

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
    }

    /// @notice Update max buckets per swap for a pool
    function setMaxBucketsPerSwap(PoolId poolId, uint256 _maxBuckets) external onlyOwner {
        require(_maxBuckets > 0 && _maxBuckets <= 20, "Invalid value");
        poolStates[poolId].maxBucketsPerSwap = _maxBuckets;
    }

    /// @notice Update protocol fee for a pool
    function setProtocolFee(PoolId poolId, uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 100, "Fee too high");
        poolStates[poolId].protocolFeeBps = _feeBps;
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
        uint256 reserve1
    ) {
        PoolState storage state = poolStates[poolId];
        return (
            address(state.token0),
            address(state.token1),
            state.initialized,
            state.reserve0,
            state.reserve1
        );
    }

    /// @notice Check if a tick has active orders
    function hasActiveOrders(PoolId poolId, int24 tick, BucketSide side) external view returns (bool) {
        int16 wordPos = int16(tick >> 8);
        uint8 bitPos = uint8(int8(tick % 256));

        if (side == BucketSide.BUY) {
            return (buyBitmaps[poolId][wordPos] & (1 << bitPos)) != 0;
        } else {
            return (sellBitmaps[poolId][wordPos] & (1 << bitPos)) != 0;
        }
    }
}
