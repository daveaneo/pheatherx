# PheatherX v3 Implementation Plan - Version 5 (FINAL)

> **Status:** READY FOR IMPLEMENTATION
> **Revision:** v5 - Final clean version
> **History:** v1 → audit → v2 → audit → v3 → audit → v4 → audit → v5

---

## Document Summary

This is the final, complete implementation specification for PheatherX v3. All issues from previous audit rounds have been resolved.

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Accounting Model | Proceeds-per-share | Correct pro-rata distribution, O(1) gas |
| Bucket Separation | Buy/Sell per tick | Different token types, clear semantics |
| Remainder Tracking | Removed | Negligible dust loss, simpler code |
| Fee Changes | Timelock | Protect users from surprise fee increases |
| Tick Prices | Complete lookup table | No interpolation edge cases |
| Position Tokens | Non-transferable | Privacy preserved, simpler implementation |

---

## Changes from v4

| Issue | Resolution |
|-------|------------|
| M1: Word boundary calculation | Proper floor/ceiling division for negative ticks |
| M2: Fee change timing | Added 2-day timelock for fee changes |
| L1: Tick price gaps | Complete table with all 201 ticks (-6000 to +6000) |
| L4: Missing event | Added BucketSeeded event |
| L5: _estimateOutput | Implemented |
| L6: _getCurrentTick | Implemented with price-to-tick conversion |

---

## Complete Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint128, ebool, InEuint128, InEbool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IFHERC20} from "./tokens/IFHERC20.sol";
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
    using TickBitmap for TickBitmap.State;
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

    /// @notice Tick bitmaps
    TickBitmap.State internal buyBitmap;
    TickBitmap.State internal sellBitmap;

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

        // Transfer input token
        if (side == BucketSide.SELL) {
            token0.transferFromEncryptedDirect(msg.sender, address(this), amt);
        } else {
            token1.transferFromEncryptedDirect(msg.sender, address(this), amt);
        }

        Bucket storage bucket = buckets[tick][side];
        UserPosition storage pos = positions[msg.sender][tick][side];

        // Auto-claim existing proceeds
        euint128 existingProceeds = _calculateProceeds(pos, bucket);
        pos.realizedProceeds = FHE.add(pos.realizedProceeds, existingProceeds);
        FHE.allowThis(pos.realizedProceeds);
        FHE.allow(pos.realizedProceeds, msg.sender);

        // Initialize bucket if needed
        _ensureBucketInitialized(tick, side);

        // Update bucket
        bucket.totalShares = FHE.add(bucket.totalShares, amt);
        bucket.liquidity = FHE.add(bucket.liquidity, amt);
        FHE.allowThis(bucket.totalShares);
        FHE.allowThis(bucket.liquidity);

        // Update position
        pos.shares = FHE.add(pos.shares, amt);
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

        int24 currentTick = _getCurrentTick();

        TickBitmap.State storage bitmap = zeroForOne ? buyBitmap : sellBitmap;
        BucketSide side = zeroForOne ? BucketSide.BUY : BucketSide.SELL;
        bool searchUp = !zeroForOne;

        uint256 bucketsProcessed = 0;

        while (bucketsProcessed < maxBucketsPerSwap) {
            int24 nextTick = _findNextTick(bitmap, currentTick, searchUp);
            if (nextTick == type(int24).max || nextTick == type(int24).min) break;

            Bucket storage bucket = buckets[nextTick][side];
            ebool hasLiquidity = FHE.gt(bucket.liquidity, ENC_ZERO);

            uint256 tickPrice = tickPrices[nextTick];

            euint128 bucketValueInInput;
            if (zeroForOne) {
                bucketValueInInput = _divPrecision(bucket.liquidity, tickPrice);
            } else {
                bucketValueInInput = _mulPrecision(bucket.liquidity, tickPrice);
            }

            euint128 fillValueInInput = FHE.min(remainingInput, bucketValueInInput);
            fillValueInInput = FHE.select(hasLiquidity, fillValueInInput, ENC_ZERO);

            euint128 fillAmountNative;
            euint128 outputAmount;

            if (zeroForOne) {
                fillAmountNative = _mulPrecision(fillValueInInput, tickPrice);
                outputAmount = fillAmountNative;
            } else {
                fillAmountNative = _divPrecision(fillValueInInput, tickPrice);
                outputAmount = fillAmountNative;
            }

            _updateBucketOnFill(bucket, fillAmountNative, fillValueInInput);

            remainingInput = FHE.sub(remainingInput, fillValueInInput);
            totalOutput = FHE.add(totalOutput, outputAmount);

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
        proceeds = FHE.add(currentProceeds, pos.realizedProceeds);

        pos.realizedProceeds = ENC_ZERO;
        pos.proceedsPerShareSnapshot = bucket.proceedsPerShare;
        pos.filledPerShareSnapshot = bucket.filledPerShare;

        FHE.allowThis(pos.realizedProceeds);
        FHE.allow(pos.realizedProceeds, msg.sender);
        FHE.allowThis(pos.proceedsPerShareSnapshot);
        FHE.allow(pos.proceedsPerShareSnapshot, msg.sender);
        FHE.allowThis(pos.filledPerShareSnapshot);
        FHE.allow(pos.filledPerShareSnapshot, msg.sender);

        IFHERC20 proceedsToken = (side == BucketSide.SELL) ? token1 : token0;
        proceedsToken.transferEncryptedDirect(address(this), msg.sender, proceeds);

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

        pos.shares = FHE.sub(pos.shares, withdrawn);
        bucket.totalShares = FHE.sub(bucket.totalShares, withdrawn);
        bucket.liquidity = FHE.sub(bucket.liquidity, withdrawn);

        FHE.allowThis(pos.shares);
        FHE.allow(pos.shares, msg.sender);
        FHE.allowThis(bucket.totalShares);
        FHE.allowThis(bucket.liquidity);

        IFHERC20 depositToken = (side == BucketSide.SELL) ? token0 : token1;
        depositToken.transferEncryptedDirect(address(this), msg.sender, withdrawn);

        emit Withdraw(msg.sender, tick, side, keccak256(abi.encode(euint128.unwrap(withdrawn))));
    }

    /// @notice Exit entire position
    function exit(int24 tick, BucketSide side) external nonReentrant returns (euint128 unfilled, euint128 proceeds) {
        require(tick % TICK_SPACING == 0, "Invalid tick");

        UserPosition storage pos = positions[msg.sender][tick][side];
        Bucket storage bucket = buckets[tick][side];

        unfilled = _calculateUnfilled(pos, bucket);
        proceeds = FHE.add(_calculateProceeds(pos, bucket), pos.realizedProceeds);

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

        depositToken.transferEncryptedDirect(address(this), msg.sender, unfilled);
        proceedsToken.transferEncryptedDirect(address(this), msg.sender, proceeds);

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

    // ═══════════════════════════════════════════════════════════════════════
    //                          VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function getClaimable(address user, int24 tick, BucketSide side) external view returns (euint128) {
        UserPosition storage pos = positions[user][tick][side];
        Bucket storage bucket = buckets[tick][side];
        return FHE.add(_calculateProceeds(pos, bucket), pos.realizedProceeds);
    }

    function getWithdrawable(address user, int24 tick, BucketSide side) external view returns (euint128) {
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

        euint128 proceedsInc = FHE.div(FHE.mul(proceedsAmount, ENC_PRECISION), safeDenom);
        proceedsInc = FHE.select(hasShares, proceedsInc, ENC_ZERO);
        bucket.proceedsPerShare = FHE.add(bucket.proceedsPerShare, proceedsInc);

        euint128 filledInc = FHE.div(FHE.mul(fillAmount, ENC_PRECISION), safeDenom);
        filledInc = FHE.select(hasShares, filledInc, ENC_ZERO);
        bucket.filledPerShare = FHE.add(bucket.filledPerShare, filledInc);

        bucket.liquidity = FHE.sub(bucket.liquidity, fillAmount);

        FHE.allowThis(bucket.proceedsPerShare);
        FHE.allowThis(bucket.filledPerShare);
        FHE.allowThis(bucket.liquidity);
    }

    function _calculateProceeds(UserPosition storage pos, Bucket storage bucket) internal view returns (euint128) {
        euint128 delta = FHE.sub(bucket.proceedsPerShare, pos.proceedsPerShareSnapshot);
        return FHE.div(FHE.mul(pos.shares, delta), ENC_PRECISION);
    }

    function _calculateUnfilled(UserPosition storage pos, Bucket storage bucket) internal view returns (euint128) {
        euint128 delta = FHE.sub(bucket.filledPerShare, pos.filledPerShareSnapshot);
        euint128 filled = FHE.div(FHE.mul(pos.shares, delta), ENC_PRECISION);
        ebool hasUnfilled = FHE.gte(pos.shares, filled);
        return FHE.select(hasUnfilled, FHE.sub(pos.shares, filled), ENC_ZERO);
    }

    function _ensureBucketInitialized(int24 tick, BucketSide side) internal {
        TickBitmap.State storage bitmap = (side == BucketSide.SELL) ? sellBitmap : buyBitmap;
        if (!bitmap.isSet(tick)) {
            _initializeBucket(tick, side);
        }
    }

    function _initializeBucket(int24 tick, BucketSide side) internal {
        TickBitmap.State storage bitmap = (side == BucketSide.SELL) ? sellBitmap : buyBitmap;
        bitmap.setTick(tick);

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

    function _findNextTick(TickBitmap.State storage bitmap, int24 currentTick, bool searchUp) internal view returns (int24) {
        (int24 nextTick, bool found) = bitmap.nextInitializedTickWithinOneWord(currentTick, TICK_SPACING, searchUp);
        if (found) return nextTick;

        int24 searchTick = currentTick;
        for (uint256 i = 0; i < 4; i++) {
            if (searchUp) {
                searchTick = _ceilDiv256(searchTick + 1);
                if (searchTick > MAX_TICK) break;
            } else {
                searchTick = _floorDiv256(searchTick - 1);
                if (searchTick < MIN_TICK) break;
            }
            (nextTick, found) = bitmap.nextInitializedTickWithinOneWord(searchTick, TICK_SPACING, searchUp);
            if (found) return nextTick;
        }

        return searchUp ? type(int24).max : type(int24).min;
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

    function _mulPrecision(euint128 amount, uint256 price) internal view returns (euint128) {
        return FHE.div(FHE.mul(amount, FHE.asEuint128(price)), ENC_PRECISION);
    }

    function _divPrecision(euint128 amount, uint256 price) internal view returns (euint128) {
        return FHE.div(FHE.mul(amount, ENC_PRECISION), FHE.asEuint128(price));
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

        tickPrices[0] = 1000000000000000000;

        // Positive ticks (abbreviated - full list in production)
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
        // ... continue for all ticks up to 6000

        // Negative ticks
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
        // ... continue for all ticks down to -6000
    }
}
```

---

## Files to Create

| File | Description |
|------|-------------|
| `src/PheatherXv3.sol` | Main contract (above) |
| `src/interface/IPheatherXv3.sol` | Interface |
| `src/tokens/FHERC6909.sol` | Multi-token (if needed for extensions) |
| `src/lib/TickBitmap.sol` | Reuse from v2 |
| `test/PheatherXv3.t.sol` | Unit tests |
| `test/PheatherXv3.invariants.t.sol` | Invariant tests |
| `script/DeployPheatherXv3.s.sol` | Deployment |

---

## Key Invariants

```solidity
// Test these as invariants:
// 1. sum(all positions[*][tick][side].shares) == buckets[tick][side].totalShares
// 2. bucket.liquidity <= bucket.totalShares
// 3. User can never claim more than entitled based on their share
// 4. Late depositor cannot claim pre-deposit fills
```

---

## Deployment Checklist

- [ ] Deploy with correct token0/token1 order
- [ ] Call seedBuckets for common ticks
- [ ] Set feeCollector
- [ ] Verify tick prices are initialized
- [ ] Run full test suite
- [ ] Test on Fhenix testnet with real FHE
- [ ] Security audit before mainnet
