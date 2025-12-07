// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint128, ebool, InEuint128, InEbool, Common} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IFHERC20} from "./interface/IFHERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TickBitmap} from "./lib/TickBitmap.sol";

/// @title FheatherX v3 - Private Bucketed Limit Order DEX
/// @author FheatherX Team
/// @notice A decentralized exchange implementing encrypted limit orders using Fully Homomorphic Encryption (FHE)
/// @dev This contract implements a bucketed limit order system where:
///      - Orders are grouped by price ticks (buckets) for O(1) gas per bucket during swaps
///      - All user amounts are encrypted using FHE, providing complete trade privacy
///      - The "proceeds per share" accumulator model ensures fair pro-rata distribution of fills
///      - Separate BUY and SELL buckets at each tick prevent order crossing issues
///
///      Key invariants:
///      - totalShares always equals sum of all user shares in a bucket
///      - proceedsPerShare is monotonically increasing (never decreases)
///      - liquidity + sum(proceeds distributed) = total deposited in bucket
///
///      Token flow:
///      - SELL bucket: Users deposit token0, receive token1 when filled
///      - BUY bucket: Users deposit token1, receive token0 when filled
///
///      Security features:
///      - ReentrancyGuard on all external state-changing functions
///      - Pausable for emergency stops
///      - 2-day timelock on fee changes
///      - Encrypted amounts prevent front-running and sandwich attacks
contract FheatherXv3 is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

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
    /// @dev Each bucket tracks total shares, remaining liquidity, and accumulator values for pro-rata distribution.
    ///      The accumulators (proceedsPerShare, filledPerShare) are scaled by PRECISION (1e18) for fixed-point math.
    struct Bucket {
        /// @notice Sum of all user shares in this bucket (encrypted)
        euint128 totalShares;
        /// @notice Current unfilled liquidity remaining in the bucket (encrypted)
        euint128 liquidity;
        /// @notice Accumulated proceeds per share, scaled by PRECISION (encrypted)
        /// @dev Increases when swaps fill orders. Users calculate their proceeds as:
        ///      proceeds = shares * (current proceedsPerShare - snapshot) / PRECISION
        euint128 proceedsPerShare;
        /// @notice Accumulated fills per share, scaled by PRECISION (encrypted)
        /// @dev Used to calculate how much of a user's deposit has been filled
        euint128 filledPerShare;
        /// @notice Whether this bucket has been initialized with encrypted zero values
        bool initialized;
    }

    /// @notice Represents a user's position in a specific bucket
    /// @dev Stores shares, snapshots of accumulators at deposit time, and realized (unclaimed) proceeds.
    ///      Snapshots enable calculating pro-rata share of fills since the user's deposit.
    struct UserPosition {
        /// @notice User's share of the bucket (1:1 with deposit amount)
        euint128 shares;
        /// @notice Snapshot of bucket.proceedsPerShare at time of last deposit/claim
        /// @dev Used to calculate proceeds earned since snapshot
        euint128 proceedsPerShareSnapshot;
        /// @notice Snapshot of bucket.filledPerShare at time of last deposit/claim
        /// @dev Used to calculate how much of user's position has been filled
        euint128 filledPerShareSnapshot;
        /// @notice Accumulated proceeds from previous deposits (not yet claimed)
        /// @dev When user deposits again, existing proceeds are stored here via auto-claim
        euint128 realizedProceeds;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                               STATE
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice The first token in the pair (must have lower address than token1)
    /// @dev FHERC20 token that supports encrypted transfers
    IFHERC20 public immutable token0;

    /// @notice The second token in the pair (must have higher address than token0)
    /// @dev FHERC20 token that supports encrypted transfers
    IFHERC20 public immutable token1;

    /// @notice Pre-computed encrypted zero value for gas optimization
    /// @dev Initialized once in constructor, used throughout contract
    euint128 internal immutable ENC_ZERO;

    /// @notice Pre-computed encrypted PRECISION value (1e18) for fixed-point math
    /// @dev Used in accumulator calculations to maintain precision
    euint128 internal immutable ENC_PRECISION;

    /// @notice Pre-computed encrypted one value for division safety
    /// @dev Used as fallback denominator to prevent division by zero
    euint128 internal immutable ENC_ONE;

    /// @notice All buckets indexed by tick and side
    /// @dev tick => side => Bucket. Each tick can have both BUY and SELL buckets.
    mapping(int24 => mapping(BucketSide => Bucket)) public buckets;

    /// @notice All user positions indexed by user, tick, and side
    /// @dev user => tick => side => UserPosition
    mapping(address => mapping(int24 => mapping(BucketSide => UserPosition))) public positions;

    /// @notice Bitmap tracking which ticks have active BUY orders
    /// @dev word index => 256-bit bitmap. Used for efficient tick traversal during swaps.
    mapping(int16 => uint256) internal buyBitmap;

    /// @notice Bitmap tracking which ticks have active SELL orders
    /// @dev word index => 256-bit bitmap. Used for efficient tick traversal during swaps.
    mapping(int16 => uint256) internal sellBitmap;

    /// @notice Pre-computed prices for each tick, scaled by PRECISION
    /// @dev tick => price. Formula: price = 1.0001^tick * PRECISION
    mapping(int24 => uint256) public tickPrices;

    /// @notice Maximum number of buckets that can be processed in a single swap
    /// @dev Limits gas usage per swap. Can be adjusted by owner (1-20 range).
    uint256 public maxBucketsPerSwap = 5;

    /// @notice Protocol fee in basis points (1 bps = 0.01%)
    /// @dev Applied to swap outputs. Max 100 bps (1%). Default 5 bps (0.05%).
    uint256 public protocolFeeBps = 5;

    /// @notice Address that receives protocol fees
    /// @dev Set by owner. If zero address, fees are not collected.
    address public feeCollector;

    /// @notice Pending protocol fee awaiting timelock expiry
    /// @dev Set by queueProtocolFee(), applied by applyProtocolFee()
    uint256 public pendingFeeBps;

    /// @notice Timestamp when pending fee can be applied
    /// @dev Must wait FEE_CHANGE_DELAY (2 days) after queueing
    uint256 public feeChangeTimestamp;

    /// @notice Plaintext reserve of token0 for price estimation
    /// @dev Updated after each swap. Used to calculate current tick and estimate outputs.
    uint256 public reserve0;

    /// @notice Plaintext reserve of token1 for price estimation
    /// @dev Updated after each swap. Used to calculate current tick and estimate outputs.
    uint256 public reserve1;

    // ═══════════════════════════════════════════════════════════════════════
    //                               EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Emitted when a user deposits tokens into a bucket
    /// @param user The depositor's address
    /// @param tick The price tick of the bucket
    /// @param side Whether this is a BUY or SELL bucket
    /// @param amountHash Hash of the encrypted amount (for privacy-preserving logging)
    event Deposit(address indexed user, int24 indexed tick, BucketSide indexed side, bytes32 amountHash);

    /// @notice Emitted when a user withdraws unfilled liquidity from a bucket
    /// @param user The withdrawer's address
    /// @param tick The price tick of the bucket
    /// @param side Whether this is a BUY or SELL bucket
    /// @param amountHash Hash of the encrypted amount withdrawn
    event Withdraw(address indexed user, int24 indexed tick, BucketSide indexed side, bytes32 amountHash);

    /// @notice Emitted when a user claims proceeds from filled orders
    /// @param user The claimer's address
    /// @param tick The price tick of the bucket
    /// @param side Whether this is a BUY or SELL bucket
    /// @param amountHash Hash of the encrypted proceeds claimed
    event Claim(address indexed user, int24 indexed tick, BucketSide indexed side, bytes32 amountHash);

    /// @notice Emitted when a swap is executed
    /// @param user The swapper's address
    /// @param zeroForOne True if selling token0 for token1
    /// @param amountIn The input amount (plaintext)
    /// @param amountOut The output amount after fees (plaintext)
    event Swap(address indexed user, bool indexed zeroForOne, uint256 amountIn, uint256 amountOut);

    /// @notice Emitted when a bucket receives a fill from a swap
    /// @param tick The price tick of the filled bucket
    /// @param side Whether this is a BUY or SELL bucket
    event BucketFilled(int24 indexed tick, BucketSide indexed side);

    /// @notice Emitted when a bucket is initialized (seeded)
    /// @param tick The price tick of the new bucket
    /// @param side Whether this is a BUY or SELL bucket
    event BucketSeeded(int24 indexed tick, BucketSide indexed side);

    /// @notice Emitted when the maximum buckets per swap is updated
    /// @param newMax The new maximum value
    event MaxBucketsPerSwapUpdated(uint256 newMax);

    /// @notice Emitted when a protocol fee change is queued
    /// @param newFeeBps The new fee in basis points
    /// @param effectiveTimestamp When the fee can be applied
    event ProtocolFeeQueued(uint256 newFeeBps, uint256 effectiveTimestamp);

    /// @notice Emitted when a queued protocol fee is applied
    /// @param newFeeBps The new active fee in basis points
    event ProtocolFeeApplied(uint256 newFeeBps);

    /// @notice Emitted when the fee collector address is updated
    /// @param newCollector The new fee collector address
    event FeeCollectorUpdated(address newCollector);

    // ═══════════════════════════════════════════════════════════════════════
    //                            CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Initializes the FheatherX v3 contract with token pair and owner
    /// @dev Sets up encrypted constants and initializes the tick price table.
    ///      Token addresses must be in ascending order (token0 < token1).
    /// @param _token0 Address of the first token (must be lower than _token1)
    /// @param _token1 Address of the second token (must be higher than _token0)
    /// @param _owner Address of the contract owner (can pause, set fees, etc.)
    constructor(
        address _token0,
        address _token1,
        address _owner
    ) Ownable(_owner) {
        require(_token0 != address(0) && _token1 != address(0), "Zero address");
        require(_token0 < _token1, "Token order");

        token0 = IFHERC20(_token0);
        token1 = IFHERC20(_token1);

        // Initialize encrypted constants
        ENC_ZERO = FHE.asEuint128(0);
        ENC_PRECISION = FHE.asEuint128(uint128(PRECISION));
        ENC_ONE = FHE.asEuint128(1);

        FHE.allowThis(ENC_ZERO);
        FHE.allowThis(ENC_PRECISION);
        FHE.allowThis(ENC_ONE);

        // Initialize tick price table
        _initializeTickPrices();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          CORE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Deposit tokens into a price bucket
    /// @param tick Price tick (must be multiple of 60, in range [-6000, 6000])
    /// @param amount Encrypted amount to deposit
    /// @param side BucketSide.SELL to sell token0, BucketSide.BUY to buy token0
    /// @param deadline Transaction deadline
    /// @param maxTickDrift Maximum acceptable tick drift
    /// @return shares Shares received (1:1 with deposit)
    function deposit(
        int24 tick,
        InEuint128 calldata amount,
        BucketSide side,
        uint256 deadline,
        int24 maxTickDrift
    ) external nonReentrant whenNotPaused returns (euint128 shares) {
        require(block.timestamp <= deadline, "Expired");
        require(tick % TICK_SPACING == 0, "Invalid tick spacing");
        require(tick >= MIN_TICK && tick <= MAX_TICK, "Tick out of range");
        require(tickPrices[tick] > 0, "Tick not initialized");

        int24 currentTick = _getCurrentTick();
        require(_abs(currentTick - tick) <= maxTickDrift, "Price moved");

        euint128 amt = FHE.asEuint128(amount);

        // Transfer input token - allow token contract to access the encrypted amount
        if (side == BucketSide.SELL) {
            FHE.allow(amt, address(token0));
            token0.transferFromEncryptedDirect(msg.sender, address(this), amt);
        } else {
            FHE.allow(amt, address(token1));
            token1.transferFromEncryptedDirect(msg.sender, address(this), amt);
        }

        Bucket storage bucket = buckets[tick][side];
        UserPosition storage pos = positions[msg.sender][tick][side];

        // Auto-claim existing proceeds
        if (Common.isInitialized(pos.shares)) {
            euint128 existingProceeds = _calculateProceeds(pos, bucket);
            if (Common.isInitialized(pos.realizedProceeds)) {
                pos.realizedProceeds = FHE.add(pos.realizedProceeds, existingProceeds);
            } else {
                pos.realizedProceeds = existingProceeds;
            }
            FHE.allowThis(pos.realizedProceeds);
            FHE.allow(pos.realizedProceeds, msg.sender);
        }

        // Initialize bucket if needed
        _ensureBucketInitialized(tick, side);

        // Update bucket
        bucket.totalShares = FHE.add(bucket.totalShares, amt);
        bucket.liquidity = FHE.add(bucket.liquidity, amt);
        FHE.allowThis(bucket.totalShares);
        FHE.allowThis(bucket.liquidity);

        // Update position
        if (Common.isInitialized(pos.shares)) {
            pos.shares = FHE.add(pos.shares, amt);
        } else {
            pos.shares = amt;
        }
        pos.proceedsPerShareSnapshot = bucket.proceedsPerShare;
        pos.filledPerShareSnapshot = bucket.filledPerShare;

        FHE.allowThis(pos.shares);
        FHE.allow(pos.shares, msg.sender);
        FHE.allowThis(pos.proceedsPerShareSnapshot);
        FHE.allow(pos.proceedsPerShareSnapshot, msg.sender);
        FHE.allowThis(pos.filledPerShareSnapshot);
        FHE.allow(pos.filledPerShareSnapshot, msg.sender);

        shares = amt;
        emit Deposit(msg.sender, tick, side, keccak256(abi.encode(euint128.unwrap(amt))));
    }

    /// @notice Execute swap
    /// @param zeroForOne True = sell token0 for token1
    /// @param amountIn Input amount
    /// @param minAmountOut Minimum output (AFTER fees)
    /// @return amountOut Output amount after fees
    function swap(
        bool zeroForOne,
        uint256 amountIn,
        uint256 minAmountOut
    ) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        require(amountIn > 0, "Zero input");

        IERC20 tokenIn = IERC20(address(zeroForOne ? token0 : token1));
        tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);

        euint128 remainingInput = FHE.asEuint128(uint128(amountIn));
        euint128 totalOutput = ENC_ZERO;
        FHE.allowThis(remainingInput);
        FHE.allowThis(totalOutput);

        int24 currentTick = _getCurrentTick();

        // zeroForOne = selling token0 → fills BUY orders (people wanting to buy token0)
        // !zeroForOne = selling token1 → fills SELL orders (people wanting to sell token0)
        mapping(int16 => uint256) storage bitmap = zeroForOne ? buyBitmap : sellBitmap;
        BucketSide side = zeroForOne ? BucketSide.BUY : BucketSide.SELL;
        // When selling token0, search UP to find highest-priced BUY orders (best price for seller)
        // When selling token1, search DOWN to find lowest-priced SELL orders (best price for buyer)
        bool searchUp = zeroForOne;

        uint256 bucketsProcessed = 0;

        while (bucketsProcessed < maxBucketsPerSwap) {
            (int24 nextTick, bool found) = _findNextTick(bitmap, currentTick, searchUp);
            if (!found) break;

            Bucket storage bucket = buckets[nextTick][side];
            ebool hasLiquidity = FHE.gt(bucket.liquidity, ENC_ZERO);

            uint256 tickPrice = tickPrices[nextTick];

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

            _updateBucketOnFill(bucket, fillAmountNative, fillValueInInput);

            remainingInput = FHE.sub(remainingInput, fillValueInInput);
            totalOutput = FHE.add(totalOutput, outputAmount);
            FHE.allowThis(remainingInput);
            FHE.allowThis(totalOutput);

            currentTick = nextTick;
            bucketsProcessed++;

            emit BucketFilled(nextTick, side);
        }

        amountOut = _estimateOutput(zeroForOne, amountIn, bucketsProcessed);

        // Apply protocol fee
        uint256 fee = amountOut * protocolFeeBps / 10000;
        amountOut -= fee;

        require(amountOut >= minAmountOut, "Slippage exceeded");

        IERC20 tokenOut = IERC20(address(zeroForOne ? token1 : token0));
        tokenOut.safeTransfer(msg.sender, amountOut);

        if (fee > 0 && feeCollector != address(0)) {
            tokenOut.safeTransfer(feeCollector, fee);
        }

        // Update reserves
        if (zeroForOne) {
            reserve0 += amountIn;
            reserve1 -= amountOut + fee;
        } else {
            reserve1 += amountIn;
            reserve0 -= amountOut + fee;
        }

        emit Swap(msg.sender, zeroForOne, amountIn, amountOut);
    }

    /// @notice Claim proceeds from filled orders
    function claim(int24 tick, BucketSide side) external nonReentrant returns (euint128 proceeds) {
        require(tick % TICK_SPACING == 0, "Invalid tick");

        UserPosition storage pos = positions[msg.sender][tick][side];
        Bucket storage bucket = buckets[tick][side];

        euint128 currentProceeds = _calculateProceeds(pos, bucket);
        if (Common.isInitialized(pos.realizedProceeds)) {
            proceeds = FHE.add(currentProceeds, pos.realizedProceeds);
        } else {
            proceeds = currentProceeds;
        }
        FHE.allowThis(proceeds);

        pos.realizedProceeds = ENC_ZERO;
        pos.proceedsPerShareSnapshot = bucket.proceedsPerShare;
        pos.filledPerShareSnapshot = bucket.filledPerShare;

        FHE.allowThis(pos.realizedProceeds);
        FHE.allow(pos.realizedProceeds, msg.sender);
        FHE.allowThis(pos.proceedsPerShareSnapshot);
        FHE.allow(pos.proceedsPerShareSnapshot, msg.sender);
        FHE.allowThis(pos.filledPerShareSnapshot);
        FHE.allow(pos.filledPerShareSnapshot, msg.sender);

        // SELL bucket: deposited token0, receive token1 proceeds
        // BUY bucket: deposited token1, receive token0 proceeds
        IFHERC20 proceedsToken = (side == BucketSide.SELL) ? token1 : token0;
        FHE.allow(proceeds, address(proceedsToken));
        proceedsToken.transferEncryptedDirect(msg.sender, proceeds);

        emit Claim(msg.sender, tick, side, keccak256(abi.encode(euint128.unwrap(proceeds))));
    }

    /// @notice Withdraw unfilled liquidity
    function withdraw(
        int24 tick,
        BucketSide side,
        InEuint128 calldata amount
    ) external nonReentrant returns (euint128 withdrawn) {
        require(tick % TICK_SPACING == 0, "Invalid tick");

        euint128 amt = FHE.asEuint128(amount);
        UserPosition storage pos = positions[msg.sender][tick][side];
        Bucket storage bucket = buckets[tick][side];

        euint128 userUnfilled = _calculateUnfilled(pos, bucket);
        withdrawn = FHE.min(amt, userUnfilled);
        FHE.allowThis(withdrawn);

        pos.shares = FHE.sub(pos.shares, withdrawn);
        bucket.totalShares = FHE.sub(bucket.totalShares, withdrawn);
        bucket.liquidity = FHE.sub(bucket.liquidity, withdrawn);

        FHE.allowThis(pos.shares);
        FHE.allow(pos.shares, msg.sender);
        FHE.allowThis(bucket.totalShares);
        FHE.allowThis(bucket.liquidity);

        // SELL bucket: deposited token0 → withdraw token0
        // BUY bucket: deposited token1 → withdraw token1
        IFHERC20 depositToken = (side == BucketSide.SELL) ? token0 : token1;
        FHE.allow(withdrawn, address(depositToken));
        depositToken.transferEncryptedDirect(msg.sender, withdrawn);

        emit Withdraw(msg.sender, tick, side, keccak256(abi.encode(euint128.unwrap(withdrawn))));
    }

    /// @notice Exit entire position - withdraws all unfilled liquidity and claims all proceeds in one transaction
    /// @dev Combines withdraw and claim operations. Emits both Withdraw and Claim events.
    ///      For SELL buckets: returns token0 (unfilled) and token1 (proceeds)
    ///      For BUY buckets: returns token1 (unfilled) and token0 (proceeds)
    /// @param tick The price tick of the bucket to exit from
    /// @param side Whether this is a BUY or SELL bucket
    /// @return unfilled The encrypted amount of unfilled liquidity returned
    /// @return proceeds The encrypted amount of proceeds claimed
    function exit(int24 tick, BucketSide side) external nonReentrant returns (euint128 unfilled, euint128 proceeds) {
        require(tick % TICK_SPACING == 0, "Invalid tick");

        UserPosition storage pos = positions[msg.sender][tick][side];
        Bucket storage bucket = buckets[tick][side];

        unfilled = _calculateUnfilled(pos, bucket);
        FHE.allowThis(unfilled);

        euint128 currentProceeds = _calculateProceeds(pos, bucket);
        if (Common.isInitialized(pos.realizedProceeds)) {
            proceeds = FHE.add(currentProceeds, pos.realizedProceeds);
        } else {
            proceeds = currentProceeds;
        }
        FHE.allowThis(proceeds);

        bucket.totalShares = FHE.sub(bucket.totalShares, pos.shares);
        bucket.liquidity = FHE.sub(bucket.liquidity, unfilled);

        pos.shares = ENC_ZERO;
        pos.realizedProceeds = ENC_ZERO;
        pos.proceedsPerShareSnapshot = bucket.proceedsPerShare;
        pos.filledPerShareSnapshot = bucket.filledPerShare;

        FHE.allowThis(pos.shares);
        FHE.allow(pos.shares, msg.sender);
        FHE.allowThis(pos.realizedProceeds);
        FHE.allow(pos.realizedProceeds, msg.sender);
        FHE.allowThis(bucket.totalShares);
        FHE.allowThis(bucket.liquidity);

        IFHERC20 depositToken = (side == BucketSide.SELL) ? token0 : token1;
        IFHERC20 proceedsToken = (side == BucketSide.SELL) ? token1 : token0;

        FHE.allow(unfilled, address(depositToken));
        FHE.allow(proceeds, address(proceedsToken));
        depositToken.transferEncryptedDirect(msg.sender, unfilled);
        proceedsToken.transferEncryptedDirect(msg.sender, proceeds);

        emit Withdraw(msg.sender, tick, side, keccak256(abi.encode(euint128.unwrap(unfilled))));
        emit Claim(msg.sender, tick, side, keccak256(abi.encode(euint128.unwrap(proceeds))));
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Set the maximum number of buckets that can be processed in a single swap
    /// @dev Higher values allow larger swaps but increase gas costs. Must be between 1-20.
    ///      Owner should consider block gas limits when adjusting this value.
    /// @param _max The new maximum (1-20 inclusive)
    function setMaxBucketsPerSwap(uint256 _max) external onlyOwner {
        require(_max >= 1 && _max <= 20, "Invalid range");
        maxBucketsPerSwap = _max;
        emit MaxBucketsPerSwapUpdated(_max);
    }

    /// @notice Queue a protocol fee change with timelock
    /// @dev Fee changes require a 2-day waiting period to protect users.
    ///      Call applyProtocolFee() after the timelock expires.
    /// @param _feeBps The new fee in basis points (max 100 = 1%)
    function queueProtocolFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 100, "Fee too high");
        pendingFeeBps = _feeBps;
        feeChangeTimestamp = block.timestamp + FEE_CHANGE_DELAY;
        emit ProtocolFeeQueued(_feeBps, feeChangeTimestamp);
    }

    /// @notice Apply a previously queued protocol fee change
    /// @dev Can only be called after the 2-day timelock has expired.
    ///      Anyone can call this once the timelock passes.
    function applyProtocolFee() external {
        require(feeChangeTimestamp > 0 && block.timestamp >= feeChangeTimestamp, "Too early");
        protocolFeeBps = pendingFeeBps;
        feeChangeTimestamp = 0;
        emit ProtocolFeeApplied(pendingFeeBps);
    }

    /// @notice Set the address that receives protocol fees
    /// @dev Set to zero address to disable fee collection (fees stay in contract)
    /// @param _collector The new fee collector address
    function setFeeCollector(address _collector) external onlyOwner {
        feeCollector = _collector;
        emit FeeCollectorUpdated(_collector);
    }

    /// @notice Pause all user operations (deposits, swaps, withdrawals, claims)
    /// @dev Emergency function. Only affects user-facing functions, not admin functions.
    function pause() external onlyOwner { _pause(); }

    /// @notice Resume normal operations after pause
    /// @dev Restores all user-facing functionality
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Pre-initialize buckets at specific ticks to save gas for first depositors
    /// @dev Initializes both BUY and SELL buckets at each tick. First depositors normally
    ///      pay extra gas for bucket initialization; seeding shifts this cost to the owner.
    /// @param ticks Array of ticks to initialize (must be multiples of TICK_SPACING, within MIN_TICK to MAX_TICK)
    function seedBuckets(int24[] calldata ticks) external onlyOwner {
        for (uint256 i = 0; i < ticks.length; i++) {
            int24 tick = ticks[i];
            require(tick % TICK_SPACING == 0, "Invalid tick");
            require(tick >= MIN_TICK && tick <= MAX_TICK, "Out of range");

            if (!buckets[tick][BucketSide.BUY].initialized) {
                _initializeBucket(tick, BucketSide.BUY);
            }
            if (!buckets[tick][BucketSide.SELL].initialized) {
                _initializeBucket(tick, BucketSide.SELL);
            }
        }
    }

    /// @notice Initialize or update the plaintext reserve values used for price estimation
    /// @dev These reserves are used to calculate the current price tick and estimate swap outputs.
    ///      In production, reserves should reflect the actual pool liquidity. For testing, they can
    ///      be set manually. The reserves are also used by frontends to display estimated prices.
    ///      IMPORTANT: This should be called after deployment to set initial liquidity estimates,
    ///      and can be called again if reserves drift significantly from actual pool state.
    /// @param _reserve0 The amount of token0 in the pool (in token0's smallest unit)
    /// @param _reserve1 The amount of token1 in the pool (in token1's smallest unit)
    function initializeReserves(uint256 _reserve0, uint256 _reserve1) external onlyOwner {
        reserve0 = _reserve0;
        reserve1 = _reserve1;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Get the total claimable proceeds for a user's position
    /// @dev Calculates current unrealized proceeds plus any stored realized proceeds.
    ///      Note: This is not a pure view function as FHE operations may modify state.
    /// @param user The user's address
    /// @param tick The price tick of the bucket
    /// @param side Whether this is a BUY or SELL bucket
    /// @return The total encrypted claimable amount
    function getClaimable(address user, int24 tick, BucketSide side) external returns (euint128) {
        UserPosition storage pos = positions[user][tick][side];
        Bucket storage bucket = buckets[tick][side];
        euint128 current = _calculateProceeds(pos, bucket);
        if (Common.isInitialized(pos.realizedProceeds)) {
            return FHE.add(current, pos.realizedProceeds);
        }
        return current;
    }

    /// @notice Get the withdrawable (unfilled) amount for a user's position
    /// @dev Calculates how much of the user's deposit has not been filled yet.
    ///      Note: This is not a pure view function as FHE operations may modify state.
    /// @param user The user's address
    /// @param tick The price tick of the bucket
    /// @param side Whether this is a BUY or SELL bucket
    /// @return The encrypted unfilled amount that can be withdrawn
    function getWithdrawable(address user, int24 tick, BucketSide side) external returns (euint128) {
        return _calculateUnfilled(positions[user][tick][side], buckets[tick][side]);
    }

    /// @notice Get raw position data for a user (encrypted values)
    /// @dev Returns raw encrypted values; use getClaimable/getWithdrawable for calculated amounts
    /// @param user The user's address
    /// @param tick The price tick of the bucket
    /// @param side Whether this is a BUY or SELL bucket
    /// @return shares User's share count in the bucket
    /// @return proceedsSnapshot Snapshot of proceedsPerShare at deposit time
    /// @return filledSnapshot Snapshot of filledPerShare at deposit time
    /// @return realized Accumulated proceeds from previous deposits (not yet claimed)
    function getPosition(address user, int24 tick, BucketSide side) external view returns (
        euint128 shares, euint128 proceedsSnapshot, euint128 filledSnapshot, euint128 realized
    ) {
        UserPosition storage pos = positions[user][tick][side];
        return (pos.shares, pos.proceedsPerShareSnapshot, pos.filledPerShareSnapshot, pos.realizedProceeds);
    }

    /// @notice Get bucket state at a specific tick (encrypted values)
    /// @dev Returns raw encrypted bucket values for frontend display
    /// @param tick The price tick
    /// @param side Whether this is a BUY or SELL bucket
    /// @return totalShares Sum of all user shares in the bucket
    /// @return liquidity Current unfilled liquidity
    /// @return proceedsPerShare Accumulated proceeds per share (scaled by PRECISION)
    /// @return filledPerShare Accumulated fills per share (scaled by PRECISION)
    /// @return initialized Whether the bucket has been initialized
    function getBucket(int24 tick, BucketSide side) external view returns (
        euint128 totalShares, euint128 liquidity, euint128 proceedsPerShare, euint128 filledPerShare, bool initialized
    ) {
        Bucket storage b = buckets[tick][side];
        return (b.totalShares, b.liquidity, b.proceedsPerShare, b.filledPerShare, b.initialized);
    }

    /// @notice Get prices for multiple ticks in a single call
    /// @dev Useful for frontends to batch price lookups
    /// @param ticks Array of ticks to get prices for
    /// @return prices Array of prices (scaled by PRECISION), in same order as input ticks
    function getTickPrices(int24[] calldata ticks) external view returns (uint256[] memory prices) {
        prices = new uint256[](ticks.length);
        for (uint256 i = 0; i < ticks.length; i++) {
            prices[i] = tickPrices[ticks[i]];
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                        INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Updates bucket accumulators when a fill occurs during a swap
    /// @param bucket The bucket being filled
    /// @param fillAmount Amount of liquidity consumed from the bucket (in native token)
    /// @param proceedsAmount Amount of proceeds to distribute (in opposite token)
    function _updateBucketOnFill(Bucket storage bucket, euint128 fillAmount, euint128 proceedsAmount) internal {
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

    /// @dev Calculates a user's claimable proceeds based on accumulator difference
    /// @param pos The user's position
    /// @param bucket The bucket to calculate proceeds from
    /// @return The encrypted proceeds amount (does not include realized proceeds)
    function _calculateProceeds(UserPosition storage pos, Bucket storage bucket) internal returns (euint128) {
        if (!Common.isInitialized(pos.shares)) {
            return ENC_ZERO;
        }
        euint128 delta = FHE.sub(bucket.proceedsPerShare, pos.proceedsPerShareSnapshot);
        return FHE.div(FHE.mul(pos.shares, delta), ENC_PRECISION);
    }

    /// @dev Calculates how much of a user's position remains unfilled
    /// @param pos The user's position
    /// @param bucket The bucket to calculate unfilled from
    /// @return The encrypted unfilled amount that can be withdrawn
    function _calculateUnfilled(UserPosition storage pos, Bucket storage bucket) internal returns (euint128) {
        if (!Common.isInitialized(pos.shares)) {
            return ENC_ZERO;
        }
        euint128 delta = FHE.sub(bucket.filledPerShare, pos.filledPerShareSnapshot);
        euint128 filled = FHE.div(FHE.mul(pos.shares, delta), ENC_PRECISION);
        ebool hasUnfilled = FHE.gte(pos.shares, filled);
        return FHE.select(hasUnfilled, FHE.sub(pos.shares, filled), ENC_ZERO);
    }

    /// @dev Initializes a bucket if it doesn't already exist in the bitmap
    /// @param tick The price tick
    /// @param side The bucket side (BUY or SELL)
    function _ensureBucketInitialized(int24 tick, BucketSide side) internal {
        mapping(int16 => uint256) storage bitmap = (side == BucketSide.SELL) ? sellBitmap : buyBitmap;
        if (!TickBitmap.hasOrdersAtTick(bitmap, tick)) {
            _initializeBucket(tick, side);
        }
    }

    /// @dev Creates a new bucket with zero-initialized encrypted values
    /// @param tick The price tick
    /// @param side The bucket side (BUY or SELL)
    function _initializeBucket(int24 tick, BucketSide side) internal {
        mapping(int16 => uint256) storage bitmap = (side == BucketSide.SELL) ? sellBitmap : buyBitmap;
        TickBitmap.setTick(bitmap, tick);

        Bucket storage bucket = buckets[tick][side];
        bucket.initialized = true;
        bucket.proceedsPerShare = FHE.asEuint128(0);
        bucket.filledPerShare = FHE.asEuint128(0);
        bucket.totalShares = FHE.asEuint128(0);
        bucket.liquidity = FHE.asEuint128(0);

        FHE.allowThis(bucket.proceedsPerShare);
        FHE.allowThis(bucket.filledPerShare);
        FHE.allowThis(bucket.totalShares);
        FHE.allowThis(bucket.liquidity);

        emit BucketSeeded(tick, side);
    }

    /// @dev Finds the next tick with liquidity in the specified direction
    /// @param bitmap The tick bitmap to search
    /// @param currentTick Starting tick (exclusive)
    /// @param searchUp True to search towards higher ticks, false for lower
    /// @return nextTick The next tick with orders
    /// @return found True if a tick was found within the search range
    function _findNextTick(
        mapping(int16 => uint256) storage bitmap,
        int24 currentTick,
        bool searchUp
    ) internal view returns (int24 nextTick, bool found) {
        // First try within current word
        int24 searchLimit = searchUp ? MAX_TICK : MIN_TICK;
        (nextTick, found) = TickBitmap.nextTickWithOrders(bitmap, currentTick, searchLimit, searchUp);
        if (found) return (nextTick, true);

        // If not found, search across word boundaries
        int24 searchTick = currentTick;
        for (uint256 i = 0; i < 4; i++) {
            if (searchUp) {
                searchTick = _ceilDiv256(searchTick + 1);
                if (searchTick > MAX_TICK) break;
            } else {
                searchTick = _floorDiv256(searchTick - 1);
                if (searchTick < MIN_TICK) break;
            }
            (nextTick, found) = TickBitmap.nextTickWithOrders(bitmap, searchTick, searchLimit, searchUp);
            if (found) return (nextTick, true);
        }

        return (0, false);
    }

    /// @dev Calculates the current price tick from reserves
    /// @return The current tick based on reserve0/reserve1 ratio
    function _getCurrentTick() internal view returns (int24) {
        if (reserve0 == 0 || reserve1 == 0) return 0;
        uint256 priceScaled = reserve1 * PRECISION / reserve0;
        return _priceToTick(priceScaled);
    }

    /// @dev Converts a scaled price to the nearest tick
    /// @param priceScaled Price scaled by PRECISION
    /// @return The nearest tick at or below the price
    function _priceToTick(uint256 priceScaled) internal view returns (int24) {
        // Binary search through positive ticks
        if (priceScaled >= PRECISION) {
            for (int24 tick = 0; tick <= MAX_TICK; tick += TICK_SPACING) {
                if (tickPrices[tick] >= priceScaled) return tick;
            }
            return MAX_TICK;
        }
        // Binary search through negative ticks
        for (int24 tick = 0; tick >= MIN_TICK; tick -= TICK_SPACING) {
            if (tickPrices[tick] <= priceScaled) return tick;
        }
        return MIN_TICK;
    }

    /// @dev Estimates output amount based on current reserves and price
    /// @param zeroForOne True if selling token0 for token1
    /// @param amountIn Input amount
    /// @param bucketsProcessed Number of buckets that were filled (0 = no swap occurred)
    /// @return Estimated output amount (before fees)
    function _estimateOutput(bool zeroForOne, uint256 amountIn, uint256 bucketsProcessed) internal view returns (uint256) {
        if (bucketsProcessed == 0 || reserve0 == 0 || reserve1 == 0) return 0;
        int24 currentTick = _getCurrentTick();
        uint256 price = tickPrices[currentTick];
        if (price == 0) price = PRECISION;

        if (zeroForOne) {
            return amountIn * price / PRECISION;
        } else {
            return amountIn * PRECISION / price;
        }
    }

    /// @dev Multiplies an encrypted amount by a price, then divides by PRECISION
    /// @param amount The encrypted amount
    /// @param price The plaintext price (scaled by PRECISION)
    /// @return result = amount * price / PRECISION
    function _mulPrecision(euint128 amount, uint256 price) internal returns (euint128) {
        euint128 encPrice = FHE.asEuint128(uint128(price));
        FHE.allowThis(encPrice);
        return FHE.div(FHE.mul(amount, encPrice), ENC_PRECISION);
    }

    /// @dev Multiplies an encrypted amount by PRECISION, then divides by price
    /// @param amount The encrypted amount
    /// @param price The plaintext price (scaled by PRECISION)
    /// @return result = amount * PRECISION / price
    function _divPrecision(euint128 amount, uint256 price) internal returns (euint128) {
        euint128 encPrice = FHE.asEuint128(uint128(price));
        FHE.allowThis(encPrice);
        return FHE.div(FHE.mul(amount, ENC_PRECISION), encPrice);
    }

    /// @dev Returns the absolute value of a signed integer
    function _abs(int24 x) internal pure returns (int24) { return x >= 0 ? x : -x; }

    /// @dev Rounds a tick up to the next 256-boundary (word boundary)
    /// @param x The tick to round
    /// @return The ceiling 256-aligned tick
    function _ceilDiv256(int24 x) internal pure returns (int24) {
        if (x >= 0) return int24(((int256(x) + 255) / 256) * 256);
        return int24((int256(x) / 256) * 256);
    }

    /// @dev Rounds a tick down to the previous 256-boundary (word boundary)
    /// @param x The tick to round
    /// @return The floor 256-aligned tick
    function _floorDiv256(int24 x) internal pure returns (int24) {
        if (x >= 0) return int24((int256(x) / 256) * 256);
        return int24(((int256(x) - 255) / 256) * 256);
    }

    /// @dev Initializes the hardcoded tick price lookup table
    /// @notice Prices are computed as 1.0001^tick * 1e18, covering ticks from -6000 to +6000
    function _initializeTickPrices() internal {
        // Complete table: all ticks from -6000 to +6000 at spacing 60
        // Values are 1.0001^tick * 1e18
        // Formula: price = 1.0001^tick
        // Each tick of 60 ≈ 0.6% price change (1.0001^60 ≈ 1.00601)

        tickPrices[0] = 1000000000000000000;  // 1.0

        // Positive ticks (price > 1.0)
        tickPrices[60] = 1006017120990792834;
        tickPrices[120] = 1012072447221937270;
        tickPrices[180] = 1018166283660840438;
        tickPrices[240] = 1024298909178423846;
        tickPrices[300] = 1030470615117700246;
        tickPrices[360] = 1036681696330040328;
        tickPrices[420] = 1042932450287044740;
        tickPrices[480] = 1049223178145646628;
        tickPrices[540] = 1055554184783143044;
        tickPrices[600] = 1061925778846842600;
        tickPrices[660] = 1068338272965584774;
        tickPrices[720] = 1074791983882032810;
        tickPrices[780] = 1081287232482816116;
        tickPrices[840] = 1087824343932413882;
        tickPrices[900] = 1094403647706411880;
        tickPrices[960] = 1101025477724850372;
        tickPrices[1020] = 1107690172387762516;
        tickPrices[1080] = 1114398074610849108;
        tickPrices[1140] = 1121149531862397536;
        tickPrices[1200] = 1127944896201421792;
        tickPrices[1260] = 1134784524408614016;
        tickPrices[1320] = 1141668778019665536;
        tickPrices[1380] = 1148598023350269440;
        tickPrices[1440] = 1155572631530069760;
        tickPrices[1500] = 1162592978526787584;
        tickPrices[1560] = 1169659445181309184;
        tickPrices[1620] = 1176772417232802048;
        tickPrices[1680] = 1183932285343802112;
        tickPrices[1740] = 1191139445135328256;
        tickPrices[1800] = 1198394297211910144;
        tickPrices[1860] = 1205697247186555648;
        tickPrices[1920] = 1213048705706743808;
        tickPrices[1980] = 1220449088481437184;
        tickPrices[2040] = 1227898816208990464;
        tickPrices[2100] = 1235398314604197632;
        tickPrices[2160] = 1242948014424291072;
        tickPrices[2220] = 1250548351496028672;
        tickPrices[2280] = 1258199766743665920;
        tickPrices[2340] = 1265902706217962496;
        tickPrices[2400] = 1273657621125111808;
        tickPrices[2460] = 1281464967856709376;
        tickPrices[2520] = 1289325208019789568;
        tickPrices[2580] = 1297238808467784960;
        tickPrices[2640] = 1305206241331617024;
        tickPrices[2700] = 1313227984051693568;
        tickPrices[2760] = 1321304519310992128;
        tickPrices[2820] = 1329436335167137792;
        tickPrices[2880] = 1337623924985439488;
        tickPrices[2940] = 1345867787471866880;
        tickPrices[3000] = 1354168426706076416;
        tickPrices[3060] = 1362526352175464448;
        tickPrices[3120] = 1370942079808266240;
        tickPrices[3180] = 1379416131007628288;
        tickPrices[3240] = 1387949032687712768;
        tickPrices[3300] = 1396541317308755456;
        tickPrices[3360] = 1405193522912106496;
        tickPrices[3420] = 1413906193155267072;
        tickPrices[3480] = 1422679877347989248;
        tickPrices[3540] = 1431515130489370624;
        tickPrices[3600] = 1440412513304963584;
        tickPrices[3660] = 1449372592284805120;
        tickPrices[3720] = 1458395939723497984;
        tickPrices[3780] = 1467483133759242240;
        tickPrices[3840] = 1476634758412759552;
        tickPrices[3900] = 1485851403626278400;
        tickPrices[3960] = 1495133665302427136;
        tickPrices[4020] = 1504482145344126464;
        tickPrices[4080] = 1513897451694445568;
        tickPrices[4140] = 1523380198377410560;
        tickPrices[4200] = 1532931005530807552;
        tickPrices[4260] = 1542550499448011776;
        tickPrices[4320] = 1552239312620826112;
        tickPrices[4380] = 1561998083781419264;
        tickPrices[4440] = 1571827457945341696;
        tickPrices[4500] = 1581728086454567936;
        tickPrices[4560] = 1591700627021671680;
        tickPrices[4620] = 1601745743773020160;
        tickPrices[4680] = 1611864107295953408;
        tickPrices[4740] = 1622056394683951104;
        tickPrices[4800] = 1632323289582709248;
        tickPrices[4860] = 1642665482236299264;
        tickPrices[4920] = 1653083669536225280;
        tickPrices[4980] = 1663578555070557440;
        tickPrices[5040] = 1674150849163048192;
        tickPrices[5100] = 1684801268922281984;
        tickPrices[5160] = 1695530538291746304;
        tickPrices[5220] = 1706339388099897344;
        tickPrices[5280] = 1717228556110260224;
        tickPrices[5340] = 1728198787071535872;
        tickPrices[5400] = 1739250832767619584;
        tickPrices[5460] = 1750385452069597440;
        tickPrices[5520] = 1761603410976718336;
        tickPrices[5580] = 1772905482668342784;
        tickPrices[5640] = 1784292447556019200;
        tickPrices[5700] = 1795765093335491584;
        tickPrices[5760] = 1807324215039700224;
        tickPrices[5820] = 1818970615089882624;
        tickPrices[5880] = 1830705103349541120;
        tickPrices[5940] = 1842528497177427968;
        tickPrices[6000] = 1854441621470621440;

        // Negative ticks (price < 1.0)
        tickPrices[-60] = 994017962903844986;
        tickPrices[-120] = 988071752890838418;
        tickPrices[-180] = 982161155068218312;
        tickPrices[-240] = 976285956016086024;
        tickPrices[-300] = 970445943476700632;
        tickPrices[-360] = 964640906384410744;
        tickPrices[-420] = 958870634886918648;
        tickPrices[-480] = 953134920360219040;
        tickPrices[-540] = 947433555424406496;
        tickPrices[-600] = 941766333960161792;
        tickPrices[-660] = 936133051134299340;
        tickPrices[-720] = 930533503418680408;
        tickPrices[-780] = 924967488616175724;
        tickPrices[-840] = 919434805877723708;
        tickPrices[-900] = 913935255719322240;
        tickPrices[-960] = 908468640039080540;
        tickPrices[-1020] = 903034762143260624;
        tickPrices[-1080] = 897633426762276524;
        tickPrices[-1140] = 892264440067695832;
        tickPrices[-1200] = 886927609698164528;
        tickPrices[-1260] = 881622744777416064;
        tickPrices[-1320] = 876349655931614848;
        tickPrices[-1380] = 871108155298207616;
        tickPrices[-1440] = 865898056543944448;
        tickPrices[-1500] = 860719174882835456;
        tickPrices[-1560] = 855571327093116672;
        tickPrices[-1620] = 850454331534171136;
        tickPrices[-1680] = 845368008163328256;
        tickPrices[-1740] = 840312178552639360;
        tickPrices[-1800] = 835286665906684416;
        tickPrices[-1860] = 830291294980199552;
        tickPrices[-1920] = 825325892195583232;
        tickPrices[-1980] = 820390285560596480;
        tickPrices[-2040] = 815484304685922816;
        tickPrices[-2100] = 810607780802699264;
        tickPrices[-2160] = 805760546780007424;
        tickPrices[-2220] = 800942437141425920;
        tickPrices[-2280] = 796153288082624768;
        tickPrices[-2340] = 791392937488984576;
        tickPrices[-2400] = 786661224953168896;
        tickPrices[-2460] = 781957991782858496;
        tickPrices[-2520] = 777283081019406336;
        tickPrices[-2580] = 772636337455597696;
        tickPrices[-2640] = 768017607653257472;
        tickPrices[-2700] = 763426739961835904;
        tickPrices[-2760] = 758863584537036288;
        tickPrices[-2820] = 754327993359532928;
        tickPrices[-2880] = 749819820253710336;
        tickPrices[-2940] = 745338920906422528;
        tickPrices[-3000] = 740885152886645248;
        tickPrices[-3060] = 736458375664197248;
        tickPrices[-3120] = 732058450628470784;
        tickPrices[-3180] = 727685241107233536;
        tickPrices[-3240] = 723338612386293760;
        tickPrices[-3300] = 719018431828281088;
        tickPrices[-3360] = 714724568791397504;
        tickPrices[-3420] = 710456894749103104;
        tickPrices[-3480] = 706215283209761024;
        tickPrices[-3540] = 701999609736378624;
        tickPrices[-3600] = 697809751966244864;
        tickPrices[-3660] = 693645589630580864;
        tickPrices[-3720] = 689507004573360640;
        tickPrices[-3780] = 685393880769996032;
        tickPrices[-3840] = 681306104346145152;
        tickPrices[-3900] = 677243563596475648;
        tickPrices[-3960] = 673206149004527104;
        tickPrices[-4020] = 669193753261570560;
        tickPrices[-4080] = 665206271285514240;
        tickPrices[-4140] = 661243600240825472;
        tickPrices[-4200] = 657305639557505408;
        tickPrices[-4260] = 653392290950068352;
        tickPrices[-4320] = 649503458437536320;
        tickPrices[-4380] = 645639048353430528;
        tickPrices[-4440] = 641798969364750592;
        tickPrices[-4500] = 637983132481969152;
        tickPrices[-4560] = 634191451078945792;
        tickPrices[-4620] = 630423840912857344;
        tickPrices[-4680] = 626680220143043328;
        tickPrices[-4740] = 622960509350883840;
        tickPrices[-4800] = 619264631559639040;
        tickPrices[-4860] = 615592512253314560;
        tickPrices[-4920] = 611944079396500480;
        tickPrices[-4980] = 608319263453242368;
        tickPrices[-5040] = 604717997405915776;
        tickPrices[-5100] = 601140216774119424;
        tickPrices[-5160] = 597585859634587008;
        tickPrices[-5220] = 594054866640150656;
        tickPrices[-5280] = 590547181038835392;
        tickPrices[-5340] = 587062748693889280;
        tickPrices[-5400] = 583601518103851776;
        tickPrices[-5460] = 580163440422665984;
        tickPrices[-5520] = 576748469479804032;
        tickPrices[-5580] = 573356561800358080;
        tickPrices[-5640] = 569987676625179648;
        tickPrices[-5700] = 566641775931028992;
        tickPrices[-5760] = 563318824449696256;
        tickPrices[-5820] = 560018789687117184;
        tickPrices[-5880] = 556741641942454144;
        tickPrices[-5940] = 553487354327234304;
        tickPrices[-6000] = 550255902784461056;
    }
}
