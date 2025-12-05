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

/// @title PheatherX v3 - Private Bucketed Limit Order DEX
/// @author PheatherX Team
/// @notice Encrypted limit orders with O(1) gas per bucket using FHE
/// @dev Uses "proceeds per share" accumulator model for pro-rata distribution
contract PheatherXv3 is ReentrancyGuard, Pausable, Ownable {
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

    enum BucketSide { BUY, SELL }

    struct Bucket {
        euint128 totalShares;       // Sum of all user shares
        euint128 liquidity;         // Current unfilled liquidity
        euint128 proceedsPerShare;  // Accumulated proceeds per share (scaled)
        euint128 filledPerShare;    // Accumulated fills per share (scaled)
        bool initialized;
    }

    struct UserPosition {
        euint128 shares;
        euint128 proceedsPerShareSnapshot;
        euint128 filledPerShareSnapshot;
        euint128 realizedProceeds;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                               STATE
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Token pair
    IFHERC20 public immutable token0;
    IFHERC20 public immutable token1;

    /// @notice Encrypted constants
    euint128 internal immutable ENC_ZERO;
    euint128 internal immutable ENC_PRECISION;
    euint128 internal immutable ENC_ONE;

    /// @notice Buckets: tick => side => bucket
    mapping(int24 => mapping(BucketSide => Bucket)) public buckets;

    /// @notice Positions: user => tick => side => position
    mapping(address => mapping(int24 => mapping(BucketSide => UserPosition))) public positions;

    /// @notice Tick bitmaps (mapping from word index to bitmap)
    mapping(int16 => uint256) internal buyBitmap;
    mapping(int16 => uint256) internal sellBitmap;

    /// @notice Tick prices: tick => price (scaled by PRECISION)
    mapping(int24 => uint256) public tickPrices;

    /// @notice Configuration
    uint256 public maxBucketsPerSwap = 5;
    uint256 public protocolFeeBps = 5;  // 0.05%
    address public feeCollector;

    /// @notice Fee change timelock
    uint256 public pendingFeeBps;
    uint256 public feeChangeTimestamp;

    /// @notice Public reserves for price estimation
    uint256 public reserve0;
    uint256 public reserve1;

    // ═══════════════════════════════════════════════════════════════════════
    //                               EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event Deposit(address indexed user, int24 indexed tick, BucketSide indexed side, bytes32 amountHash);
    event Withdraw(address indexed user, int24 indexed tick, BucketSide indexed side, bytes32 amountHash);
    event Claim(address indexed user, int24 indexed tick, BucketSide indexed side, bytes32 amountHash);
    event Swap(address indexed user, bool indexed zeroForOne, uint256 amountIn, uint256 amountOut);
    event BucketFilled(int24 indexed tick, BucketSide indexed side);
    event BucketSeeded(int24 indexed tick, BucketSide indexed side);
    event MaxBucketsPerSwapUpdated(uint256 newMax);
    event ProtocolFeeQueued(uint256 newFeeBps, uint256 effectiveTimestamp);
    event ProtocolFeeApplied(uint256 newFeeBps);
    event FeeCollectorUpdated(address newCollector);

    // ═══════════════════════════════════════════════════════════════════════
    //                            CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

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

    /// @notice Exit entire position
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

    function setMaxBucketsPerSwap(uint256 _max) external onlyOwner {
        require(_max >= 1 && _max <= 20, "Invalid range");
        maxBucketsPerSwap = _max;
        emit MaxBucketsPerSwapUpdated(_max);
    }

    function queueProtocolFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 100, "Fee too high");
        pendingFeeBps = _feeBps;
        feeChangeTimestamp = block.timestamp + FEE_CHANGE_DELAY;
        emit ProtocolFeeQueued(_feeBps, feeChangeTimestamp);
    }

    function applyProtocolFee() external {
        require(feeChangeTimestamp > 0 && block.timestamp >= feeChangeTimestamp, "Too early");
        protocolFeeBps = pendingFeeBps;
        feeChangeTimestamp = 0;
        emit ProtocolFeeApplied(pendingFeeBps);
    }

    function setFeeCollector(address _collector) external onlyOwner {
        feeCollector = _collector;
        emit FeeCollectorUpdated(_collector);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

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

    /// @notice Initialize reserves for price estimation
    function initializeReserves(uint256 _reserve0, uint256 _reserve1) external onlyOwner {
        reserve0 = _reserve0;
        reserve1 = _reserve1;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function getClaimable(address user, int24 tick, BucketSide side) external returns (euint128) {
        UserPosition storage pos = positions[user][tick][side];
        Bucket storage bucket = buckets[tick][side];
        euint128 current = _calculateProceeds(pos, bucket);
        if (Common.isInitialized(pos.realizedProceeds)) {
            return FHE.add(current, pos.realizedProceeds);
        }
        return current;
    }

    function getWithdrawable(address user, int24 tick, BucketSide side) external returns (euint128) {
        return _calculateUnfilled(positions[user][tick][side], buckets[tick][side]);
    }

    function getPosition(address user, int24 tick, BucketSide side) external view returns (
        euint128 shares, euint128 proceedsSnapshot, euint128 filledSnapshot, euint128 realized
    ) {
        UserPosition storage pos = positions[user][tick][side];
        return (pos.shares, pos.proceedsPerShareSnapshot, pos.filledPerShareSnapshot, pos.realizedProceeds);
    }

    function getBucket(int24 tick, BucketSide side) external view returns (
        euint128 totalShares, euint128 liquidity, euint128 proceedsPerShare, euint128 filledPerShare, bool initialized
    ) {
        Bucket storage b = buckets[tick][side];
        return (b.totalShares, b.liquidity, b.proceedsPerShare, b.filledPerShare, b.initialized);
    }

    function getTickPrices(int24[] calldata ticks) external view returns (uint256[] memory prices) {
        prices = new uint256[](ticks.length);
        for (uint256 i = 0; i < ticks.length; i++) {
            prices[i] = tickPrices[ticks[i]];
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                        INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

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

    function _ensureBucketInitialized(int24 tick, BucketSide side) internal {
        mapping(int16 => uint256) storage bitmap = (side == BucketSide.SELL) ? sellBitmap : buyBitmap;
        if (!TickBitmap.hasOrdersAtTick(bitmap, tick)) {
            _initializeBucket(tick, side);
        }
    }

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

    function _getCurrentTick() internal view returns (int24) {
        if (reserve0 == 0 || reserve1 == 0) return 0;
        uint256 priceScaled = reserve1 * PRECISION / reserve0;
        return _priceToTick(priceScaled);
    }

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

    function _mulPrecision(euint128 amount, uint256 price) internal returns (euint128) {
        euint128 encPrice = FHE.asEuint128(uint128(price));
        FHE.allowThis(encPrice);
        return FHE.div(FHE.mul(amount, encPrice), ENC_PRECISION);
    }

    function _divPrecision(euint128 amount, uint256 price) internal returns (euint128) {
        euint128 encPrice = FHE.asEuint128(uint128(price));
        FHE.allowThis(encPrice);
        return FHE.div(FHE.mul(amount, ENC_PRECISION), encPrice);
    }

    function _abs(int24 x) internal pure returns (int24) { return x >= 0 ? x : -x; }

    function _ceilDiv256(int24 x) internal pure returns (int24) {
        if (x >= 0) return int24(((int256(x) + 255) / 256) * 256);
        return int24((int256(x) / 256) * 256);
    }

    function _floorDiv256(int24 x) internal pure returns (int24) {
        if (x >= 0) return int24((int256(x) / 256) * 256);
        return int24(((int256(x) - 255) / 256) * 256);
    }

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
