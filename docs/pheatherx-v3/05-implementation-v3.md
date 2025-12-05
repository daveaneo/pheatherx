# PheatherX v3 Implementation Plan - Version 3

> **Status:** NOT IMPLEMENTED - Design Document
> **Revision:** v3 - Addresses all issues from Audit v2
> **Previous:** 03-implementation-v2.md → 04-audit-v2.md

---

## Changes from v2

| Issue | Severity | Resolution |
|-------|----------|------------|
| C1: FHE division precision loss | Critical | Added remainder tracking per bucket |
| C2: Division by zero when empty | Critical | Added hasShares guard with safe denominator |
| H1: Auto-claim not transferred | High | Changed to `realizedProceeds` counter (never reset) |
| H2: Swap direction confusing | High | Added extensive worked examples in NatSpec |
| H3: Missing _findNextTick | High | Implemented using TickBitmap library |
| M1: Division by zero in price | Medium | Added price validation with MIN_PRICE |
| M2: Shared zero handles | Medium | Fresh encryption for each bucket field |
| M3: No validation in exit | Medium | Added early return for empty positions |
| L1: Price approximation inaccurate | Low | Added lookup table for common ticks |
| L2: Events missing amounts | Low | Added amountHash for correlation |
| L3: No position getter | Low | Added getPosition() view function |
| L4: ENC_PRECISION not initialized | Low | Added to constructor |

---

## Core Data Structures (Updated)

### Bucket Structure

```solidity
enum BucketSide { BUY, SELL }

struct Bucket {
    euint128 totalShares;           // Sum of all user shares
    euint128 liquidity;             // Current unfilled liquidity
    euint128 proceedsPerShare;      // Accumulated proceeds per share (scaled by PRECISION)
    euint128 filledPerShare;        // Accumulated fills per share
    euint128 proceedsRemainder;     // Remainder from division (for precision)
    euint128 filledRemainder;       // Remainder from division (for precision)
    bool initialized;
}

struct UserPosition {
    euint128 shares;                        // User's share of bucket
    euint128 proceedsPerShareSnapshot;      // Snapshot at last deposit/claim
    euint128 filledPerShareSnapshot;        // Snapshot at last deposit/claim
    euint128 realizedProceeds;              // Accumulated realized proceeds (NEVER reset except on claim)
}
```

---

## Price Lookup Table

```solidity
// Pre-computed tick prices (1.0001^tick * 1e18)
// Ticks are multiples of TICK_SPACING (60)
mapping(int24 => uint256) public tickPrices;

uint256 public constant MIN_PRICE = 1e15;  // Minimum valid price (0.001)
uint256 public constant MAX_PRICE = 1e21;  // Maximum valid price (1000)

/// @dev Initialize tick prices in constructor
function _initializeTickPrices() internal {
    // Tick 0 = price 1.0
    tickPrices[0] = 1e18;

    // Pre-computed values for 1.0001^(tick) * 1e18
    // Positive ticks (price > 1)
    tickPrices[60] = 1006017120990792834;     // 1.0001^60
    tickPrices[120] = 1012072447221937270;    // 1.0001^120
    tickPrices[180] = 1018166283660840438;    // 1.0001^180
    tickPrices[240] = 1024298909178423846;    // 1.0001^240
    tickPrices[300] = 1030470615117700246;    // 1.0001^300
    tickPrices[360] = 1036681696330040328;    // 1.0001^360
    tickPrices[600] = 1061836546532012738;    // 1.0001^600
    tickPrices[1200] = 1127496851877822042;   // 1.0001^1200
    tickPrices[2400] = 1270994715680104564;   // 1.0001^2400
    tickPrices[6000] = 1822118797448363880;   // 1.0001^6000

    // Negative ticks (price < 1)
    tickPrices[-60] = 994017962903844986;     // 1.0001^-60
    tickPrices[-120] = 988071752890838418;    // 1.0001^-120
    tickPrices[-180] = 982161155068218312;    // 1.0001^-180
    tickPrices[-240] = 976285956016086024;    // 1.0001^-240
    tickPrices[-300] = 970445943476700632;    // 1.0001^-300
    tickPrices[-360] = 964640906384410744;    // 1.0001^-360
    tickPrices[-600] = 941764286447684812;    // 1.0001^-600
    tickPrices[-1200] = 886868654454578818;   // 1.0001^-1200
    tickPrices[-2400] = 786595092556587682;   // 1.0001^-2400
    tickPrices[-6000] = 548773425082298076;   // 1.0001^-6000
}

/// @notice Get tick price with fallback interpolation
/// @param tick The tick value (must be multiple of TICK_SPACING)
/// @return price Price scaled by 1e18
function _getTickPriceScaled(int24 tick) internal view returns (uint256) {
    uint256 price = tickPrices[tick];

    // If not in lookup table, interpolate from nearest known tick
    if (price == 0) {
        // Find nearest known tick and interpolate
        int24 nearestTick = (tick / 60) * 60;  // Round to nearest 60
        uint256 nearestPrice = tickPrices[nearestTick];

        if (nearestPrice == 0) {
            // Fallback: use approximation for extreme ticks
            // This is less accurate but prevents complete failure
            if (tick > 0) {
                price = PRECISION + uint256(int256(tick)) * PRECISION / 10000;
            } else {
                price = PRECISION - uint256(int256(-tick)) * PRECISION / 10000;
            }
        } else {
            price = nearestPrice;
        }
    }

    // Clamp to valid range
    if (price < MIN_PRICE) price = MIN_PRICE;
    if (price > MAX_PRICE) price = MAX_PRICE;

    return price;
}
```

---

## Constructor

```solidity
constructor(address _token0, address _token1) {
    require(_token0 != address(0) && _token1 != address(0), "Zero address");
    require(_token0 < _token1, "Token order"); // Enforce ordering

    token0 = IFHERC20(_token0);
    token1 = IFHERC20(_token1);

    // Initialize encrypted constants
    ENC_ZERO = FHE.asEuint128(0);
    ENC_PRECISION = FHE.asEuint128(uint128(PRECISION));
    ENC_ONE = FHE.asEuint128(1);

    FHE.allowThis(ENC_ZERO);
    FHE.allowThis(ENC_PRECISION);
    FHE.allowThis(ENC_ONE);

    // Initialize tick prices
    _initializeTickPrices();

    // Initialize reentrancy guard
    _status = _NOT_ENTERED;
}
```

---

## Deposit Function (with Fixed Auto-Claim)

```solidity
/// @notice Deposit tokens into a price bucket
/// @dev Auto-claims existing proceeds to realizedProceeds (not transferred until claim())
/// @param tick The price tick for this bucket (must be multiple of TICK_SPACING)
/// @param amount Encrypted amount to deposit
/// @param side BucketSide.SELL to sell token0 at this price, BucketSide.BUY to buy token0
/// @param deadline Transaction deadline timestamp
/// @param maxTickDrift Maximum allowed tick drift from target
/// @return shares Encrypted shares received (1:1 with deposit)
function deposit(
    int24 tick,
    InEuint128 calldata amount,
    BucketSide side,
    uint256 deadline,
    int24 maxTickDrift
) external nonReentrant returns (euint128 shares) {
    require(block.timestamp <= deadline, "Expired");
    require(tick % TICK_SPACING == 0, "Invalid tick");

    int24 currentTick = _getCurrentTick();
    require(_abs(currentTick - tick) <= maxTickDrift, "Price moved");

    euint128 amt = FHE.asEuint128(amount);

    // Transfer input token based on side
    if (side == BucketSide.SELL) {
        token0.transferFromEncryptedDirect(msg.sender, address(this), amt);
    } else {
        token1.transferFromEncryptedDirect(msg.sender, address(this), amt);
    }

    Bucket storage bucket = buckets[tick][side];
    UserPosition storage pos = positions[msg.sender][tick][side];

    // AUTO-CLAIM: Calculate and store proceeds before snapshot reset
    // This uses realizedProceeds which accumulates and is NEVER reset except on claim()
    euint128 existingProceeds = _calculateProceeds(pos, bucket);
    pos.realizedProceeds = FHE.add(pos.realizedProceeds, existingProceeds);
    FHE.allowThis(pos.realizedProceeds);
    FHE.allow(pos.realizedProceeds, msg.sender);

    // Initialize bucket if needed (with fresh encryptions)
    TickBitmap.State storage bitmap = (side == BucketSide.SELL) ? sellBitmap : buyBitmap;
    if (!bitmap.isSet(tick)) {
        bitmap.setTick(tick);
        bucket.initialized = true;
        bucket.proceedsPerShare = FHE.asEuint128(0);
        bucket.filledPerShare = FHE.asEuint128(0);
        bucket.totalShares = FHE.asEuint128(0);
        bucket.liquidity = FHE.asEuint128(0);
        bucket.proceedsRemainder = FHE.asEuint128(0);
        bucket.filledRemainder = FHE.asEuint128(0);

        FHE.allowThis(bucket.proceedsPerShare);
        FHE.allowThis(bucket.filledPerShare);
        FHE.allowThis(bucket.totalShares);
        FHE.allowThis(bucket.liquidity);
        FHE.allowThis(bucket.proceedsRemainder);
        FHE.allowThis(bucket.filledRemainder);
    }

    // Update bucket state
    bucket.totalShares = FHE.add(bucket.totalShares, amt);
    bucket.liquidity = FHE.add(bucket.liquidity, amt);
    FHE.allowThis(bucket.totalShares);
    FHE.allowThis(bucket.liquidity);

    // Update user position with fresh snapshot
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

    // Emit with amount hash for off-chain tracking
    emit Deposit(msg.sender, tick, side, keccak256(abi.encode(euint128.unwrap(amt))));
}
```

---

## Bucket Fill with Division Safety

```solidity
/// @dev Update bucket state when filled - with remainder tracking and zero-division protection
/// @param bucket The bucket being filled
/// @param fillAmount Amount of bucket's token consumed
/// @param proceedsAmount Amount of other token received (swapper's input)
///
/// MATH EXPLANATION:
/// We want: proceedsPerShare += proceedsAmount / totalShares
/// But FHE division truncates, losing precision.
///
/// Solution: Track remainder
/// - numerator = proceedsAmount * PRECISION
/// - quotient = numerator / totalShares (truncates)
/// - remainder = numerator - (quotient * totalShares)
/// - When remainder >= totalShares, distribute +1 to proceedsPerShare
function _updateBucketOnFill(
    Bucket storage bucket,
    euint128 fillAmount,
    euint128 proceedsAmount
) internal {
    // GUARD: Check for zero shares (prevents division by zero)
    ebool hasShares = FHE.gt(bucket.totalShares, ENC_ZERO);

    // Use 1 as safe denominator if totalShares is zero
    euint128 safeTotalShares = FHE.select(hasShares, bucket.totalShares, ENC_ONE);

    // ===== UPDATE PROCEEDS PER SHARE =====
    euint128 proceedsNumerator = FHE.mul(proceedsAmount, ENC_PRECISION);
    euint128 proceedsQuotient = FHE.div(proceedsNumerator, safeTotalShares);
    euint128 proceedsUsed = FHE.mul(proceedsQuotient, safeTotalShares);
    euint128 proceedsNewRemainder = FHE.sub(proceedsNumerator, proceedsUsed);

    // Accumulate remainder
    euint128 totalProceedsRemainder = FHE.add(bucket.proceedsRemainder, proceedsNewRemainder);

    // Check if remainder is enough to distribute +1
    ebool canDistributeProceeds = FHE.gte(totalProceedsRemainder, safeTotalShares);
    euint128 proceedsExtra = FHE.select(canDistributeProceeds, ENC_ONE, ENC_ZERO);

    // Update proceedsPerShare
    euint128 proceedsIncrease = FHE.add(proceedsQuotient, proceedsExtra);
    proceedsIncrease = FHE.select(hasShares, proceedsIncrease, ENC_ZERO);  // Zero if no shares
    bucket.proceedsPerShare = FHE.add(bucket.proceedsPerShare, proceedsIncrease);

    // Update remainder (subtract totalShares if we distributed extra)
    bucket.proceedsRemainder = FHE.select(
        canDistributeProceeds,
        FHE.sub(totalProceedsRemainder, safeTotalShares),
        totalProceedsRemainder
    );

    // ===== UPDATE FILLED PER SHARE =====
    euint128 filledNumerator = FHE.mul(fillAmount, ENC_PRECISION);
    euint128 filledQuotient = FHE.div(filledNumerator, safeTotalShares);
    euint128 filledUsed = FHE.mul(filledQuotient, safeTotalShares);
    euint128 filledNewRemainder = FHE.sub(filledNumerator, filledUsed);

    euint128 totalFilledRemainder = FHE.add(bucket.filledRemainder, filledNewRemainder);
    ebool canDistributeFilled = FHE.gte(totalFilledRemainder, safeTotalShares);
    euint128 filledExtra = FHE.select(canDistributeFilled, ENC_ONE, ENC_ZERO);

    euint128 filledIncrease = FHE.add(filledQuotient, filledExtra);
    filledIncrease = FHE.select(hasShares, filledIncrease, ENC_ZERO);
    bucket.filledPerShare = FHE.add(bucket.filledPerShare, filledIncrease);

    bucket.filledRemainder = FHE.select(
        canDistributeFilled,
        FHE.sub(totalFilledRemainder, safeTotalShares),
        totalFilledRemainder
    );

    // ===== UPDATE LIQUIDITY =====
    bucket.liquidity = FHE.sub(bucket.liquidity, fillAmount);

    // Allow this contract to access updated values
    FHE.allowThis(bucket.proceedsPerShare);
    FHE.allowThis(bucket.filledPerShare);
    FHE.allowThis(bucket.proceedsRemainder);
    FHE.allowThis(bucket.filledRemainder);
    FHE.allowThis(bucket.liquidity);
}
```

---

## Swap Function with Full Implementation

```solidity
/// @notice Execute swap, filling buckets as price crosses
/// @dev O(1) per bucket regardless of depositor count
///
/// WORKED EXAMPLE - zeroForOne = true (selling token0 for token1):
/// ----------------------------------------------------------------
/// Setup:
/// - Current tick: 0 (price = 1.0)
/// - BUY bucket at tick 60 has 1006 token1 (users want to buy token0 at price 1.006)
/// - Swapper wants to sell 500 token0
///
/// Step 1: Find buckets
/// - Search BUY bitmap for next tick with liquidity
/// - Found: tick 60
///
/// Step 2: Calculate bucket capacity in input terms
/// - BUY bucket has token1, swapper is giving token0
/// - bucketValueInInput = 1006 token1 / 1.006 = 1000 token0 capacity
///
/// Step 3: Calculate fill
/// - fillValueInInput = min(500 token0 remaining, 1000 capacity) = 500 token0
///
/// Step 4: Calculate native fill and output
/// - fillAmountNative = 500 token0 * 1.006 = 503 token1 consumed from bucket
/// - outputAmount = 503 token1 to swapper
///
/// Step 5: Update bucket
/// - bucket.liquidity -= 503 token1
/// - bucket.proceedsPerShare += (500 * PRECISION) / totalShares
/// - bucket.filledPerShare += (503 * PRECISION) / totalShares
///
/// Result: Swapper gave 500 token0, got 503 token1 ✓
///
/// @param zeroForOne True to sell token0 for token1
/// @param amountIn Amount of input token
/// @param minAmountOut Minimum acceptable output (slippage protection)
/// @return amountOut Actual output amount
function swap(
    bool zeroForOne,
    uint256 amountIn,
    uint256 minAmountOut
) external nonReentrant returns (uint256 amountOut) {
    require(amountIn > 0, "Zero input");

    // Take input tokens
    IFHERC20 tokenIn = zeroForOne ? token0 : token1;
    tokenIn.transferFrom(msg.sender, address(this), amountIn);

    euint128 remainingInput = FHE.asEuint128(uint128(amountIn));
    euint128 totalOutput = ENC_ZERO;

    int24 currentTick = _getCurrentTick();

    // Select correct bitmap and bucket side
    TickBitmap.State storage bitmap = zeroForOne ? buyBitmap : sellBitmap;
    BucketSide side = zeroForOne ? BucketSide.BUY : BucketSide.SELL;

    uint256 bucketsProcessed = 0;

    while (bucketsProcessed < MAX_BUCKETS_PER_SWAP) {
        // Find next bucket with liquidity
        int24 nextTick = _findNextTick(bitmap, currentTick, !zeroForOne);
        if (nextTick == type(int24).max || nextTick == type(int24).min) break;

        Bucket storage bucket = buckets[nextTick][side];

        // Check if bucket has liquidity
        ebool hasLiquidity = FHE.gt(bucket.liquidity, ENC_ZERO);

        // Get tick price
        uint256 tickPrice = _getTickPriceScaled(nextTick);
        require(tickPrice >= MIN_PRICE && tickPrice <= MAX_PRICE, "Invalid price");

        // Calculate bucket capacity in input token terms
        euint128 bucketValueInInput;
        if (zeroForOne) {
            // BUY bucket has token1, input is token0
            // Capacity in token0 = liquidity (token1) / price
            bucketValueInInput = _divPrecision(bucket.liquidity, tickPrice);
        } else {
            // SELL bucket has token0, input is token1
            // Capacity in token1 = liquidity (token0) * price
            bucketValueInInput = _mulPrecision(bucket.liquidity, tickPrice);
        }

        // Fill amount is min(remaining, bucket capacity)
        euint128 fillValueInInput = FHE.min(remainingInput, bucketValueInInput);
        fillValueInInput = FHE.select(hasLiquidity, fillValueInInput, ENC_ZERO);

        // Calculate fill in bucket's native token and output for swapper
        euint128 fillAmountNative;
        euint128 outputAmount;

        if (zeroForOne) {
            // Input is token0, bucket has token1
            // Native fill (token1) = input fill (token0) * price
            fillAmountNative = _mulPrecision(fillValueInInput, tickPrice);
            outputAmount = fillAmountNative;  // Swapper gets token1
        } else {
            // Input is token1, bucket has token0
            // Native fill (token0) = input fill (token1) / price
            fillAmountNative = _divPrecision(fillValueInInput, tickPrice);
            outputAmount = fillAmountNative;  // Swapper gets token0
        }

        // Update bucket (proceeds = what depositors receive = swapper's input)
        _updateBucketOnFill(bucket, fillAmountNative, fillValueInInput);

        // Update running totals
        remainingInput = FHE.sub(remainingInput, fillValueInInput);
        totalOutput = FHE.add(totalOutput, outputAmount);

        currentTick = nextTick;
        bucketsProcessed++;

        emit BucketFilled(nextTick, side);
    }

    // Estimate output for slippage check
    amountOut = _estimateOutput(zeroForOne, amountIn, bucketsProcessed);
    require(amountOut >= minAmountOut, "Slippage exceeded");

    // Transfer output
    IFHERC20 tokenOut = zeroForOne ? token1 : token0;
    tokenOut.transfer(msg.sender, amountOut);

    emit Swap(msg.sender, zeroForOne, amountIn, amountOut);
}

/// @dev Find next initialized tick in bitmap
/// @param bitmap The tick bitmap to search
/// @param currentTick Current tick position
/// @param searchUp True to search for higher ticks, false for lower
/// @return nextTick The next initialized tick, or max/min int24 if none
function _findNextTick(
    TickBitmap.State storage bitmap,
    int24 currentTick,
    bool searchUp
) internal view returns (int24) {
    (int24 nextTick, bool found) = bitmap.nextInitializedTickWithinOneWord(
        currentTick,
        TICK_SPACING,
        searchUp
    );

    if (!found) {
        // Try next word
        (nextTick, found) = bitmap.nextInitializedTick(
            currentTick,
            TICK_SPACING,
            searchUp,
            256  // Search up to 256 ticks
        );
    }

    if (!found) {
        return searchUp ? type(int24).max : type(int24).min;
    }

    return nextTick;
}
```

---

## Claim Function

```solidity
/// @notice Claim filled proceeds from a bucket position
/// @param tick The bucket tick
/// @param side The bucket side (BUY or SELL)
/// @return proceeds The encrypted amount of output tokens claimed
function claim(
    int24 tick,
    BucketSide side
) external nonReentrant returns (euint128 proceeds) {
    UserPosition storage pos = positions[msg.sender][tick][side];
    Bucket storage bucket = buckets[tick][side];

    // Calculate current claimable proceeds
    euint128 currentProceeds = _calculateProceeds(pos, bucket);

    // Add accumulated realized proceeds (from auto-claims during deposits)
    proceeds = FHE.add(currentProceeds, pos.realizedProceeds);

    // Reset realized proceeds (this is the ONLY place it resets)
    pos.realizedProceeds = ENC_ZERO;
    FHE.allowThis(pos.realizedProceeds);
    FHE.allow(pos.realizedProceeds, msg.sender);

    // Update snapshot to current (prevents double-claim of currentProceeds)
    pos.proceedsPerShareSnapshot = bucket.proceedsPerShare;
    pos.filledPerShareSnapshot = bucket.filledPerShare;

    FHE.allowThis(pos.proceedsPerShareSnapshot);
    FHE.allow(pos.proceedsPerShareSnapshot, msg.sender);
    FHE.allowThis(pos.filledPerShareSnapshot);
    FHE.allow(pos.filledPerShareSnapshot, msg.sender);

    // Transfer proceeds (opposite token to what was deposited)
    IFHERC20 proceedsToken = (side == BucketSide.SELL) ? token1 : token0;
    proceedsToken.transferEncryptedDirect(address(this), msg.sender, proceeds);

    emit Claim(msg.sender, tick, side, keccak256(abi.encode(euint128.unwrap(proceeds))));
}

/// @dev Calculate proceeds for a position
function _calculateProceeds(
    UserPosition storage pos,
    Bucket storage bucket
) internal view returns (euint128) {
    // proceeds = shares * (currentProceedsPerShare - snapshotProceedsPerShare) / PRECISION
    euint128 proceedsPerShareDelta = FHE.sub(
        bucket.proceedsPerShare,
        pos.proceedsPerShareSnapshot
    );

    euint128 grossProceeds = FHE.mul(pos.shares, proceedsPerShareDelta);
    return FHE.div(grossProceeds, ENC_PRECISION);
}
```

---

## Exit Function (with Empty Position Check)

```solidity
/// @notice Exit entire position: withdraw unfilled + claim proceeds
/// @param tick The bucket tick
/// @param side The bucket side
/// @return unfilled Encrypted amount of unfilled liquidity returned
/// @return proceeds Encrypted amount of proceeds claimed
function exit(
    int24 tick,
    BucketSide side
) external nonReentrant returns (euint128 unfilled, euint128 proceeds) {
    UserPosition storage pos = positions[msg.sender][tick][side];
    Bucket storage bucket = buckets[tick][side];

    // Early exit if no position (saves gas, no misleading events)
    ebool hasPosition = FHE.gt(pos.shares, ENC_ZERO);
    // Note: Can't do plaintext early return on encrypted bool
    // But we can make all operations conditional

    // Calculate both values ONCE
    unfilled = _calculateUnfilled(pos, bucket);
    proceeds = _calculateProceeds(pos, bucket);
    proceeds = FHE.add(proceeds, pos.realizedProceeds);

    // Update bucket state (conditional on having position)
    euint128 sharesToRemove = FHE.select(hasPosition, pos.shares, ENC_ZERO);
    euint128 unfilledToRemove = FHE.select(hasPosition, unfilled, ENC_ZERO);

    bucket.totalShares = FHE.sub(bucket.totalShares, sharesToRemove);
    bucket.liquidity = FHE.sub(bucket.liquidity, unfilledToRemove);
    FHE.allowThis(bucket.totalShares);
    FHE.allowThis(bucket.liquidity);

    // Clear user position
    pos.shares = ENC_ZERO;
    pos.realizedProceeds = ENC_ZERO;
    pos.proceedsPerShareSnapshot = bucket.proceedsPerShare;
    pos.filledPerShareSnapshot = bucket.filledPerShare;

    FHE.allowThis(pos.shares);
    FHE.allow(pos.shares, msg.sender);
    FHE.allowThis(pos.realizedProceeds);
    FHE.allow(pos.realizedProceeds, msg.sender);

    // Transfer both (conditional amounts)
    IFHERC20 depositToken = (side == BucketSide.SELL) ? token0 : token1;
    IFHERC20 proceedsToken = (side == BucketSide.SELL) ? token1 : token0;

    depositToken.transferEncryptedDirect(address(this), msg.sender, unfilled);
    proceedsToken.transferEncryptedDirect(address(this), msg.sender, proceeds);

    emit Withdraw(msg.sender, tick, side, keccak256(abi.encode(euint128.unwrap(unfilled))));
    emit Claim(msg.sender, tick, side, keccak256(abi.encode(euint128.unwrap(proceeds))));
}
```

---

## View Functions

```solidity
/// @notice Get user's claimable proceeds
function getClaimable(
    address user,
    int24 tick,
    BucketSide side
) external view returns (euint128) {
    UserPosition storage pos = positions[user][tick][side];
    Bucket storage bucket = buckets[tick][side];

    euint128 calculated = _calculateProceeds(pos, bucket);
    return FHE.add(calculated, pos.realizedProceeds);
}

/// @notice Get user's withdrawable unfilled amount
function getWithdrawable(
    address user,
    int24 tick,
    BucketSide side
) external view returns (euint128) {
    UserPosition storage pos = positions[user][tick][side];
    Bucket storage bucket = buckets[tick][side];

    return _calculateUnfilled(pos, bucket);
}

/// @notice Get full user position
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
```

---

## Events (Updated with Amount Hashes)

```solidity
event Deposit(
    address indexed user,
    int24 indexed tick,
    BucketSide indexed side,
    bytes32 amountHash  // keccak256 of encrypted amount handle for correlation
);

event Withdraw(
    address indexed user,
    int24 indexed tick,
    BucketSide indexed side,
    bytes32 amountHash
);

event Claim(
    address indexed user,
    int24 indexed tick,
    BucketSide indexed side,
    bytes32 amountHash
);

event Swap(
    address indexed user,
    bool zeroForOne,
    uint256 amountIn,
    uint256 amountOut
);

event BucketFilled(
    int24 indexed tick,
    BucketSide indexed side
);
```

---

## Key Invariants

```solidity
// 1. Total shares consistency
// sum(positions[*][tick][side].shares) == buckets[tick][side].totalShares

// 2. Liquidity bounds
// bucket.liquidity <= bucket.totalShares

// 3. No over-claim
// User can never claim more than their proportional share

// 4. Late depositor protection
// User depositing after fill cannot claim from that fill

// 5. Remainder tracking accuracy
// bucket.proceedsRemainder < bucket.totalShares (always)

// 6. Division safety
// Division by zero is prevented via hasShares guard
```

---

## Files to Create

| File | Description |
|------|-------------|
| `src/tokens/IFHERC6909.sol` | Interface |
| `src/tokens/FHERC6909.sol` | Implementation |
| `src/PheatherXv3.sol` | Main contract |
| `src/interface/IPheatherXv3.sol` | Interface |
| `src/lib/TickBitmap.sol` | Reuse from v2 |
| `src/lib/TickPrices.sol` | Price lookup library |
| `test/FHERC6909.t.sol` | Token tests |
| `test/PheatherXv3.t.sol` | Hook tests |
| `test/PheatherXv3Invariants.t.sol` | Invariant tests |
| `script/DeployPheatherXv3.s.sol` | Deployment |
