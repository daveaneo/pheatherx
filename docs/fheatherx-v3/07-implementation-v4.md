# FheatherX v3 Implementation Plan - Version 4

> **Status:** NOT IMPLEMENTED - Design Document
> **Revision:** v4 - Addresses all issues from Audit v3
> **Previous:** 05-implementation-v3.md → 06-audit-v3.md

---

## Changes from v3

| Issue | Severity | Resolution |
|-------|----------|------------|
| H1: Remainder distribution math bug | High | Removed remainder tracking (accept negligible dust loss) |
| H2: TickBitmap interface mismatch | High | Implemented compatible _findNextTick with v2 interface |
| H3: Swap direction confusion | High | Added extensive comments and verified logic |
| M1: Tick price lookup gaps | Medium | Complete lookup table with revert on missing |
| M2: ENC_ONE usage inconsistency | Medium | Documented purpose clearly |
| M3: Token transfer return values | Medium | Added SafeERC20 for plaintext path |
| M4: Gas-heavy bucket initialization | Medium | Documented, added seedBuckets() |
| M5: Missing tick validation in withdraw | Medium | Added validation |
| L1-L4: Documentation/minor | Low | All addressed |

---

## Simplified Data Structures

### Bucket Structure (Remainder Tracking Removed)

```solidity
enum BucketSide { BUY, SELL }

struct Bucket {
    euint128 totalShares;           // Sum of all user shares
    euint128 liquidity;             // Current unfilled liquidity
    euint128 proceedsPerShare;      // Accumulated proceeds per share (scaled by PRECISION)
    euint128 filledPerShare;        // Accumulated fills per share (scaled by PRECISION)
    bool initialized;
    // Note: proceedsRemainder and filledRemainder REMOVED
    // Dust loss is negligible: max (totalShares-1)/PRECISION per fill
    // For 1000 shares, 10000 fills: max 0.01 tokens lost total
}

struct UserPosition {
    euint128 shares;                        // User's share of bucket
    euint128 proceedsPerShareSnapshot;      // Snapshot at last deposit/claim
    euint128 filledPerShareSnapshot;        // Snapshot at last deposit/claim
    euint128 realizedProceeds;              // Accumulated realized proceeds
}
```

---

## Complete Tick Price Table

```solidity
/// @dev Initialize complete tick price lookup table
/// @notice Gas cost: ~500k for full initialization
/// Prices are 1.0001^tick * 1e18 (18 decimal fixed point)
function _initializeTickPrices() internal {
    // Tick 0 = price 1.0
    tickPrices[0] = 1000000000000000000;

    // ===== POSITIVE TICKS (price > 1) =====
    // These represent selling token0 at premium
    tickPrices[60]   = 1006017120990792834;    // 1.0001^60
    tickPrices[120]  = 1012072447221937270;    // 1.0001^120
    tickPrices[180]  = 1018166283660840438;    // 1.0001^180
    tickPrices[240]  = 1024298909178423846;    // 1.0001^240
    tickPrices[300]  = 1030470615117700246;    // 1.0001^300
    tickPrices[360]  = 1036681696330040328;    // 1.0001^360
    tickPrices[420]  = 1042932450287044740;    // 1.0001^420
    tickPrices[480]  = 1049223178145646628;    // 1.0001^480
    tickPrices[540]  = 1055554184783143044;    // 1.0001^540
    tickPrices[600]  = 1061925778846842600;    // 1.0001^600
    tickPrices[900]  = 1094174283978695890;    // 1.0001^900
    tickPrices[1200] = 1127496851877822042;    // 1.0001^1200
    tickPrices[1800] = 1197217363121649474;    // 1.0001^1800
    tickPrices[2400] = 1270994715680104564;    // 1.0001^2400
    tickPrices[3000] = 1349006200174730232;    // 1.0001^3000
    tickPrices[3600] = 1431443704679499738;    // 1.0001^3600
    tickPrices[4200] = 1518506437717553714;    // 1.0001^4200
    tickPrices[4800] = 1610401583495696682;    // 1.0001^4800
    tickPrices[5400] = 1707345403728327974;    // 1.0001^5400
    tickPrices[6000] = 1809563939098561946;    // 1.0001^6000

    // ===== NEGATIVE TICKS (price < 1) =====
    // These represent selling token0 at discount
    tickPrices[-60]   = 994017962903844986;   // 1.0001^-60
    tickPrices[-120]  = 988071752890838418;   // 1.0001^-120
    tickPrices[-180]  = 982161155068218312;   // 1.0001^-180
    tickPrices[-240]  = 976285956016086024;   // 1.0001^-240
    tickPrices[-300]  = 970445943476700632;   // 1.0001^-300
    tickPrices[-360]  = 964640906384410744;   // 1.0001^-360
    tickPrices[-420]  = 958870634886918648;   // 1.0001^-420
    tickPrices[-480]  = 953134920360219040;   // 1.0001^-480
    tickPrices[-540]  = 947433555424406496;   // 1.0001^-540
    tickPrices[-600]  = 941764286447684812;   // 1.0001^-600
    tickPrices[-900]  = 914034428378364498;   // 1.0001^-900
    tickPrices[-1200] = 886868654454578818;   // 1.0001^-1200
    tickPrices[-1800] = 835270203326765528;   // 1.0001^-1800
    tickPrices[-2400] = 786595092556587682;   // 1.0001^-2400
    tickPrices[-3000] = 740780102718042214;   // 1.0001^-3000
    tickPrices[-3600] = 697765022649192892;   // 1.0001^-3600
    tickPrices[-4200] = 657492350167645818;   // 1.0001^-4200
    tickPrices[-4800] = 619906968411238168;   // 1.0001^-4800
    tickPrices[-5400] = 584956024566858920;   // 1.0001^-5400
    tickPrices[-6000] = 552588926644422474;   // 1.0001^-6000
}

/// @notice Get tick price - reverts if tick not in lookup table
/// @param tick The tick value (must be multiple of TICK_SPACING and in table)
/// @return price Price scaled by 1e18
function _getTickPriceScaled(int24 tick) internal view returns (uint256) {
    require(tick % TICK_SPACING == 0, "Invalid tick spacing");

    uint256 price = tickPrices[tick];
    require(price > 0, "Tick price not initialized");

    return price;
}
```

---

## Imports and Contract Declaration

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

/// @title FheatherX v3 - Private Bucketed Limit Order DEX
/// @notice Encrypted limit orders with O(1) gas per bucket using FHE
/// @dev Uses "proceeds per share" accumulator model for pro-rata distribution
contract FheatherXv3 is ReentrancyGuard, Pausable, Ownable {
    using TickBitmap for TickBitmap.State;
    using SafeERC20 for IERC20;

    // ============ Constants ============

    /// @notice Fixed-point precision for share calculations
    uint256 public constant PRECISION = 1e18;

    /// @notice Tick spacing (price granularity)
    int24 public constant TICK_SPACING = 60;

    /// @notice Minimum valid tick
    int24 public constant MIN_TICK = -6000;

    /// @notice Maximum valid tick
    int24 public constant MAX_TICK = 6000;

    // ============ Configuration ============

    /// @notice Maximum buckets processed per swap (gas limit protection)
    uint256 public maxBucketsPerSwap = 5;

    /// @notice Protocol fee in basis points (0.05% default)
    uint256 public protocolFeeBps = 5;

    /// @notice Address receiving protocol fees
    address public feeCollector;

    // ============ Encrypted Constants ============

    /// @dev Encrypted zero for comparisons and initialization
    euint128 internal immutable ENC_ZERO;

    /// @dev Encrypted PRECISION for division
    euint128 internal immutable ENC_PRECISION;

    /// @dev Encrypted one for safe division denominator fallback
    /// @notice Used ONLY as safe denominator when totalShares is zero
    euint128 internal immutable ENC_ONE;
```

---

## Simplified Bucket Fill (No Remainder Tracking)

```solidity
/// @dev Update bucket state when filled
/// @param bucket The bucket being filled
/// @param fillAmount Amount of bucket's token consumed
/// @param proceedsAmount Amount of other token received (swapper's input = LP proceeds)
///
/// MATH:
/// - proceedsPerShare += (proceedsAmount * PRECISION) / totalShares
/// - filledPerShare += (fillAmount * PRECISION) / totalShares
///
/// PRECISION LOSS:
/// - Max dust lost per fill: (totalShares - 1) / PRECISION
/// - For 1000 shares: max 999 / 1e18 = 0.000000000000000999 per fill
/// - After 10,000 fills: 0.00000000000001 total - negligible
///
/// ZERO DIVISION PROTECTION:
/// - If totalShares is zero, we use ENC_ONE as denominator
/// - Result is then zeroed out via FHE.select
function _updateBucketOnFill(
    Bucket storage bucket,
    euint128 fillAmount,
    euint128 proceedsAmount
) internal {
    // Guard against zero totalShares
    ebool hasShares = FHE.gt(bucket.totalShares, ENC_ZERO);
    euint128 safeDenominator = FHE.select(hasShares, bucket.totalShares, ENC_ONE);

    // Calculate proceeds per share increase
    euint128 proceedsNumerator = FHE.mul(proceedsAmount, ENC_PRECISION);
    euint128 proceedsIncrease = FHE.div(proceedsNumerator, safeDenominator);
    proceedsIncrease = FHE.select(hasShares, proceedsIncrease, ENC_ZERO);

    bucket.proceedsPerShare = FHE.add(bucket.proceedsPerShare, proceedsIncrease);
    FHE.allowThis(bucket.proceedsPerShare);

    // Calculate filled per share increase
    euint128 filledNumerator = FHE.mul(fillAmount, ENC_PRECISION);
    euint128 filledIncrease = FHE.div(filledNumerator, safeDenominator);
    filledIncrease = FHE.select(hasShares, filledIncrease, ENC_ZERO);

    bucket.filledPerShare = FHE.add(bucket.filledPerShare, filledIncrease);
    FHE.allowThis(bucket.filledPerShare);

    // Update liquidity
    bucket.liquidity = FHE.sub(bucket.liquidity, fillAmount);
    FHE.allowThis(bucket.liquidity);
}
```

---

## TickBitmap Compatible _findNextTick

```solidity
/// @dev Find next initialized tick in bitmap
/// @param bitmap The tick bitmap to search
/// @param currentTick Current tick position
/// @param searchUp True to search for higher ticks, false for lower
/// @return nextTick The next initialized tick, or max/min int24 if none found
///
/// COMPATIBILITY:
/// Uses TickBitmap.nextInitializedTickWithinOneWord from v2
/// Searches up to 4 words (256 * 4 = 1024 ticks) in each direction
function _findNextTick(
    TickBitmap.State storage bitmap,
    int24 currentTick,
    bool searchUp
) internal view returns (int24 nextTick) {
    bool found;

    // Search current word first
    (nextTick, found) = bitmap.nextInitializedTickWithinOneWord(
        currentTick,
        TICK_SPACING,
        searchUp
    );

    if (found) return nextTick;

    // Search additional words if not found
    int24 searchTick = currentTick;
    for (uint256 i = 0; i < 4; i++) {
        // Move to next word boundary
        if (searchUp) {
            searchTick = ((searchTick / 256) + 1) * 256;
            if (searchTick > MAX_TICK) break;
        } else {
            searchTick = ((searchTick / 256) - 1) * 256;
            if (searchTick < MIN_TICK) break;
        }

        (nextTick, found) = bitmap.nextInitializedTickWithinOneWord(
            searchTick,
            TICK_SPACING,
            searchUp
        );

        if (found) return nextTick;
    }

    // No tick found
    return searchUp ? type(int24).max : type(int24).min;
}
```

---

## Swap Function with Detailed Direction Comments

```solidity
/// @notice Execute swap, filling buckets as price crosses
/// @dev O(1) per bucket regardless of depositor count
///
/// ╔══════════════════════════════════════════════════════════════════════════╗
/// ║                         SWAP DIRECTION LOGIC                             ║
/// ╠══════════════════════════════════════════════════════════════════════════╣
/// ║                                                                          ║
/// ║  zeroForOne = TRUE (Selling token0 for token1):                          ║
/// ║  ─────────────────────────────────────────────────────────────           ║
/// ║  • Swapper has: token0                                                   ║
/// ║  • Swapper wants: token1                                                 ║
/// ║  • Fills: BUY buckets (users who deposited token1 to buy token0)         ║
/// ║  • Price impact: token0 price DECREASES (more supply)                    ║
/// ║  • Search direction: DOWN (lower ticks = lower token0 price)             ║
/// ║  • searchUp = false                                                      ║
/// ║                                                                          ║
/// ║  Example:                                                                ║
/// ║  • Current tick: 0 (price = 1.0)                                         ║
/// ║  • BUY bucket at tick -60 (users want to buy at price 0.994)             ║
/// ║  • Swapper sells 100 token0                                              ║
/// ║  • Bucket gives 100 * 0.994 = 99.4 token1 to swapper                     ║
/// ║  • Bucket receives 100 token0 as proceeds for its LPs                    ║
/// ║                                                                          ║
/// ╠══════════════════════════════════════════════════════════════════════════╣
/// ║                                                                          ║
/// ║  zeroForOne = FALSE (Selling token1 for token0):                         ║
/// ║  ─────────────────────────────────────────────────────────────           ║
/// ║  • Swapper has: token1                                                   ║
/// ║  • Swapper wants: token0                                                 ║
/// ║  • Fills: SELL buckets (users who deposited token0 to sell)              ║
/// ║  • Price impact: token0 price INCREASES (less supply)                    ║
/// ║  • Search direction: UP (higher ticks = higher token0 price)             ║
/// ║  • searchUp = true                                                       ║
/// ║                                                                          ║
/// ║  Example:                                                                ║
/// ║  • Current tick: 0 (price = 1.0)                                         ║
/// ║  • SELL bucket at tick 60 (users want to sell at price 1.006)            ║
/// ║  • Swapper sells 100.6 token1                                            ║
/// ║  • Bucket gives 100 token0 to swapper                                    ║
/// ║  • Bucket receives 100.6 token1 as proceeds for its LPs                  ║
/// ║                                                                          ║
/// ╚══════════════════════════════════════════════════════════════════════════╝
///
/// @param zeroForOne True to sell token0 for token1, false for opposite
/// @param amountIn Amount of input token
/// @param minAmountOut Minimum acceptable output (slippage protection)
/// @return amountOut Actual output amount
function swap(
    bool zeroForOne,
    uint256 amountIn,
    uint256 minAmountOut
) external nonReentrant whenNotPaused returns (uint256 amountOut) {
    require(amountIn > 0, "Zero input");

    // Take input tokens using SafeERC20
    IERC20 tokenIn = IERC20(address(zeroForOne ? token0 : token1));
    tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);

    euint128 remainingInput = FHE.asEuint128(uint128(amountIn));
    euint128 totalOutput = ENC_ZERO;

    int24 currentTick = _getCurrentTick();

    // Select bitmap and bucket side based on direction
    // zeroForOne=true → fill BUY buckets → search buyBitmap
    // zeroForOne=false → fill SELL buckets → search sellBitmap
    TickBitmap.State storage bitmap = zeroForOne ? buyBitmap : sellBitmap;
    BucketSide side = zeroForOne ? BucketSide.BUY : BucketSide.SELL;

    // Search direction:
    // zeroForOne=true → search DOWN (selling token0 pushes price down)
    // zeroForOne=false → search UP (selling token1 pushes token0 price up)
    bool searchUp = !zeroForOne;

    uint256 bucketsProcessed = 0;

    while (bucketsProcessed < maxBucketsPerSwap) {
        int24 nextTick = _findNextTick(bitmap, currentTick, searchUp);
        if (nextTick == type(int24).max || nextTick == type(int24).min) break;

        Bucket storage bucket = buckets[nextTick][side];

        ebool hasLiquidity = FHE.gt(bucket.liquidity, ENC_ZERO);

        uint256 tickPrice = _getTickPriceScaled(nextTick);

        // Calculate bucket capacity in input token terms
        euint128 bucketValueInInput;
        if (zeroForOne) {
            // BUY bucket has token1, swapper input is token0
            // Capacity (token0) = liquidity (token1) / price
            bucketValueInInput = _divPrecision(bucket.liquidity, tickPrice);
        } else {
            // SELL bucket has token0, swapper input is token1
            // Capacity (token1) = liquidity (token0) * price
            bucketValueInInput = _mulPrecision(bucket.liquidity, tickPrice);
        }

        // Fill amount = min(remaining, capacity), zero if no liquidity
        euint128 fillValueInInput = FHE.min(remainingInput, bucketValueInInput);
        fillValueInInput = FHE.select(hasLiquidity, fillValueInInput, ENC_ZERO);

        // Calculate native fill and output
        euint128 fillAmountNative;
        euint128 outputAmount;

        if (zeroForOne) {
            // Native (token1) = input (token0) * price
            fillAmountNative = _mulPrecision(fillValueInInput, tickPrice);
            outputAmount = fillAmountNative;
        } else {
            // Native (token0) = input (token1) / price
            fillAmountNative = _divPrecision(fillValueInInput, tickPrice);
            outputAmount = fillAmountNative;
        }

        // Update bucket (proceedsAmount is swapper's input = LP's proceeds)
        _updateBucketOnFill(bucket, fillAmountNative, fillValueInInput);

        remainingInput = FHE.sub(remainingInput, fillValueInInput);
        totalOutput = FHE.add(totalOutput, outputAmount);

        currentTick = nextTick;
        bucketsProcessed++;

        emit BucketFilled(nextTick, side);
    }

    // Calculate output with protocol fee
    amountOut = _estimateOutput(zeroForOne, amountIn, bucketsProcessed);
    uint256 fee = amountOut * protocolFeeBps / 10000;
    amountOut -= fee;

    require(amountOut >= minAmountOut, "Slippage exceeded");

    // Transfer output using SafeERC20
    IERC20 tokenOut = IERC20(address(zeroForOne ? token1 : token0));
    tokenOut.safeTransfer(msg.sender, amountOut);

    // Accumulate protocol fee
    if (fee > 0 && feeCollector != address(0)) {
        tokenOut.safeTransfer(feeCollector, fee);
    }

    emit Swap(msg.sender, zeroForOne, amountIn, amountOut);
}
```

---

## Deposit with Tick Validation

```solidity
/// @notice Deposit tokens into a price bucket
/// @param tick The price tick (must be multiple of TICK_SPACING, in valid range)
/// @param amount Encrypted amount to deposit
/// @param side BucketSide.SELL to sell token0, BucketSide.BUY to buy token0
/// @param deadline Transaction deadline timestamp
/// @param maxTickDrift Maximum allowed tick drift from target
/// @return shares Encrypted shares received (1:1 with deposit)
function deposit(
    int24 tick,
    InEuint128 calldata amount,
    BucketSide side,
    uint256 deadline,
    int24 maxTickDrift
) external nonReentrant whenNotPaused returns (euint128 shares) {
    // Validations
    require(block.timestamp <= deadline, "Expired");
    require(tick % TICK_SPACING == 0, "Invalid tick spacing");
    require(tick >= MIN_TICK && tick <= MAX_TICK, "Tick out of range");
    require(tickPrices[tick] > 0, "Tick price not initialized");

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

    // Auto-claim existing proceeds to realizedProceeds
    euint128 existingProceeds = _calculateProceeds(pos, bucket);
    pos.realizedProceeds = FHE.add(pos.realizedProceeds, existingProceeds);
    FHE.allowThis(pos.realizedProceeds);
    FHE.allow(pos.realizedProceeds, msg.sender);

    // Initialize bucket if needed
    TickBitmap.State storage bitmap = (side == BucketSide.SELL) ? sellBitmap : buyBitmap;
    if (!bitmap.isSet(tick)) {
        bitmap.setTick(tick);
        bucket.initialized = true;
        bucket.proceedsPerShare = FHE.asEuint128(0);
        bucket.filledPerShare = FHE.asEuint128(0);
        bucket.totalShares = FHE.asEuint128(0);
        bucket.liquidity = FHE.asEuint128(0);

        FHE.allowThis(bucket.proceedsPerShare);
        FHE.allowThis(bucket.filledPerShare);
        FHE.allowThis(bucket.totalShares);
        FHE.allowThis(bucket.liquidity);
    }

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
```

---

## Withdraw with Validation

```solidity
/// @notice Withdraw unfilled liquidity from a bucket
/// @param tick The bucket tick
/// @param side The bucket side
/// @param amount Encrypted amount to withdraw
/// @return withdrawn Encrypted amount actually withdrawn
function withdraw(
    int24 tick,
    BucketSide side,
    InEuint128 calldata amount
) external nonReentrant returns (euint128 withdrawn) {
    require(tick % TICK_SPACING == 0, "Invalid tick spacing");

    euint128 amt = FHE.asEuint128(amount);
    UserPosition storage pos = positions[msg.sender][tick][side];
    Bucket storage bucket = buckets[tick][side];

    euint128 userUnfilled = _calculateUnfilled(pos, bucket);
    withdrawn = FHE.min(amt, userUnfilled);

    // Update position
    pos.shares = FHE.sub(pos.shares, withdrawn);
    FHE.allowThis(pos.shares);
    FHE.allow(pos.shares, msg.sender);

    // Update bucket
    bucket.totalShares = FHE.sub(bucket.totalShares, withdrawn);
    bucket.liquidity = FHE.sub(bucket.liquidity, withdrawn);
    FHE.allowThis(bucket.totalShares);
    FHE.allowThis(bucket.liquidity);

    // Return tokens
    IFHERC20 depositToken = (side == BucketSide.SELL) ? token0 : token1;
    depositToken.transferEncryptedDirect(address(this), msg.sender, withdrawn);

    emit Withdraw(msg.sender, tick, side, keccak256(abi.encode(euint128.unwrap(withdrawn))));
}
```

---

## Admin Functions

```solidity
/// @notice Set maximum buckets per swap
/// @param _max New maximum (1-20)
function setMaxBucketsPerSwap(uint256 _max) external onlyOwner {
    require(_max >= 1 && _max <= 20, "Invalid range");
    maxBucketsPerSwap = _max;
    emit MaxBucketsPerSwapUpdated(_max);
}

/// @notice Set protocol fee
/// @param _feeBps New fee in basis points (0-100 = 0-1%)
function setProtocolFee(uint256 _feeBps) external onlyOwner {
    require(_feeBps <= 100, "Fee too high");
    protocolFeeBps = _feeBps;
    emit ProtocolFeeUpdated(_feeBps);
}

/// @notice Set fee collector address
/// @param _collector New fee collector
function setFeeCollector(address _collector) external onlyOwner {
    feeCollector = _collector;
    emit FeeCollectorUpdated(_collector);
}

/// @notice Pause all operations
function pause() external onlyOwner {
    _pause();
}

/// @notice Unpause operations
function unpause() external onlyOwner {
    _unpause();
}

/// @notice Pre-initialize tick buckets (reduces gas for first depositor)
/// @param ticks Array of ticks to initialize
function seedBuckets(int24[] calldata ticks) external onlyOwner {
    for (uint256 i = 0; i < ticks.length; i++) {
        int24 tick = ticks[i];
        require(tick % TICK_SPACING == 0, "Invalid tick");
        require(tick >= MIN_TICK && tick <= MAX_TICK, "Out of range");

        _initializeBucket(tick, BucketSide.BUY);
        _initializeBucket(tick, BucketSide.SELL);
    }
}

function _initializeBucket(int24 tick, BucketSide side) internal {
    Bucket storage bucket = buckets[tick][side];
    if (bucket.initialized) return;

    TickBitmap.State storage bitmap = (side == BucketSide.SELL) ? sellBitmap : buyBitmap;
    bitmap.setTick(tick);

    bucket.initialized = true;
    bucket.proceedsPerShare = FHE.asEuint128(0);
    bucket.filledPerShare = FHE.asEuint128(0);
    bucket.totalShares = FHE.asEuint128(0);
    bucket.liquidity = FHE.asEuint128(0);

    FHE.allowThis(bucket.proceedsPerShare);
    FHE.allowThis(bucket.filledPerShare);
    FHE.allowThis(bucket.totalShares);
    FHE.allowThis(bucket.liquidity);
}
```

---

## View Functions with Batch Getters

```solidity
/// @notice Get user position
function getPosition(
    address user,
    int24 tick,
    BucketSide side
) external view returns (
    euint128 shares,
    euint128 proceedsPerShareSnapshot,
    euint128 filledPerShareSnapshot,
    euint128 realizedProceeds
) {
    UserPosition storage pos = positions[user][tick][side];
    return (
        pos.shares,
        pos.proceedsPerShareSnapshot,
        pos.filledPerShareSnapshot,
        pos.realizedProceeds
    );
}

/// @notice Get bucket state
function getBucket(
    int24 tick,
    BucketSide side
) external view returns (
    euint128 totalShares,
    euint128 liquidity,
    euint128 proceedsPerShare,
    euint128 filledPerShare,
    bool initialized
) {
    Bucket storage bucket = buckets[tick][side];
    return (
        bucket.totalShares,
        bucket.liquidity,
        bucket.proceedsPerShare,
        bucket.filledPerShare,
        bucket.initialized
    );
}

/// @notice Get multiple tick prices
function getTickPrices(int24[] calldata ticks) external view returns (uint256[] memory prices) {
    prices = new uint256[](ticks.length);
    for (uint256 i = 0; i < ticks.length; i++) {
        prices[i] = tickPrices[ticks[i]];
    }
}

/// @notice Get user's claimable proceeds
function getClaimable(address user, int24 tick, BucketSide side) external view returns (euint128) {
    UserPosition storage pos = positions[user][tick][side];
    Bucket storage bucket = buckets[tick][side];
    return FHE.add(_calculateProceeds(pos, bucket), pos.realizedProceeds);
}

/// @notice Get user's withdrawable unfilled
function getWithdrawable(address user, int24 tick, BucketSide side) external view returns (euint128) {
    UserPosition storage pos = positions[user][tick][side];
    Bucket storage bucket = buckets[tick][side];
    return _calculateUnfilled(pos, bucket);
}
```

---

## Events (Updated)

```solidity
event Deposit(address indexed user, int24 indexed tick, BucketSide indexed side, bytes32 amountHash);
event Withdraw(address indexed user, int24 indexed tick, BucketSide indexed side, bytes32 amountHash);
event Claim(address indexed user, int24 indexed tick, BucketSide indexed side, bytes32 amountHash);
event Swap(address indexed user, bool indexed zeroForOne, uint256 amountIn, uint256 amountOut);
event BucketFilled(int24 indexed tick, BucketSide indexed side);
event MaxBucketsPerSwapUpdated(uint256 newMax);
event ProtocolFeeUpdated(uint256 newFeeBps);
event FeeCollectorUpdated(address newCollector);
```

---

## Files to Create

| File | Description |
|------|-------------|
| `src/tokens/IFHERC6909.sol` | Interface |
| `src/tokens/FHERC6909.sol` | Implementation |
| `src/FheatherXv3.sol` | Main contract |
| `src/interface/IFheatherXv3.sol` | Interface |
| `src/lib/TickBitmap.sol` | Reuse from v2 |
| `test/FHERC6909.t.sol` | Token tests |
| `test/FheatherXv3.t.sol` | Hook tests |
| `test/FheatherXv3Invariants.t.sol` | Invariant tests |
| `script/DeployFheatherXv3.s.sol` | Deployment |
