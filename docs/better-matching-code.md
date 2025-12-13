# FheatherXv6 → v6.1: Better Matching Implementation Guide

This document outlines the code changes needed to implement the improved matching system from `better-matching.md`.

**Revision Notes:**
- Added word-boundary crossing wrapper `_findNextInitializedTick`
- Fixed opposing limit matching semantics (BUY/SELL bucket contents clarified)
- Changed to plaintext predicates for binary search (FHE too expensive)
- Added `_sumMomentumBucketsPlaintext` and `_sumMomentumBucketsEnc` separation
- Fixed `_fillOpposingBucket` to handle both zeroForOne directions correctly
- Added overflow-safe math using FullMath
- Updated integration to move order processing BEFORE AMM execution
- Added realistic contract size budget (warns about 11KB+ increase)
- Added plaintext liquidity cache options for binary search
- Added migration checklist
- Added `_estimateFinalTick` placeholder for tick range determination

---

## Executive Summary

**Goal**: Implement 1× AMM update per swap with proper opposing limit matching and momentum closure.

**Key Benefits**:
- Reduced FHE operations (major gas savings)
- Correct order matching semantics
- Bitmap word-level scanning (faster tick search)
- Division-free predicates for binary search

**Contract Size Strategy**: Net reduction expected through:
- Removing redundant code paths
- Consolidating fill logic
- Using library for bitmap operations

**Critical Design Decisions for v6.1**:
1. **Use plaintext reserves for binary search** - Encrypted predicates are too expensive
2. **Trigger orders BEFORE AMM execution** - Current code triggers AFTER, which is backwards
3. **Limit orders are MAKERS** - They provide liquidity; swapper is the TAKER
4. **Momentum orders are TAKERS** - They execute against AMM when triggered

---

## 1. Functions to DELETE

### 1.1 `_processTriggeredOrdersEncrypted` (lines 585-605)

**Reason**: This function uses a flawed approach—it tries to detect tick crossings by comparing old vs new reserves with XOR logic. The new system uses a deterministic binary search closure instead.

```solidity
// DELETE ENTIRELY - 47 lines saved
function _processTriggeredOrdersEncrypted(PoolId poolId, uint256 oldR0, uint256 oldR1) internal { ... }
```

### 1.2 `_tryFillBucketEncrypted` (lines 607-631)

**Reason**: Part of the flawed encrypted order triggering system. Replaced by virtual slicing allocation.

```solidity
// DELETE ENTIRELY - 25 lines saved
function _tryFillBucketEncrypted(...) internal { ... }
```

### 1.3 `_fillBucketAgainstAMM` (lines 539-558)

**Reason**: This executes AMM math per-bucket. The new system executes AMM exactly once, then allocates output via virtual slicing.

```solidity
// DELETE ENTIRELY - 20 lines saved
function _fillBucketAgainstAMM(PoolId poolId, int24 tick, BucketSide side) internal { ... }
```

**Total lines saved from deletions**: ~92 lines

---

## 2. Functions to MODIFY

### 2.1 `_findNextActiveTick` → `_nextInitializedTickWithinOneWord`

**Current** (lines 1449-1473): Linear tick-by-tick search, O(200) worst case.

**New**: Word-level bitmap scan using bit manipulation, O(1) per word.

```solidity
/// @notice Find next initialized tick using word-level bitmap scan
/// @param poolId Pool identifier
/// @param tick Starting compressed tick
/// @param side Which bitmap to search
/// @param lte Search direction: true = search left (<=), false = search right (>)
/// @return nextTick The next initialized tick (or boundary sentinel)
/// @return initialized Whether a tick was found in this word
function _nextInitializedTickWithinOneWord(
    PoolId poolId,
    int24 tick,
    BucketSide side,
    bool lte
) internal view returns (int24 nextTick, bool initialized) {
    int24 compressed = _compress(tick);

    mapping(int16 => uint256) storage bitmap = side == BucketSide.BUY
        ? buyBitmaps[poolId]
        : sellBitmaps[poolId];

    if (lte) {
        // Search left (towards lower ticks)
        (int16 wordPos, uint8 bitPos) = _position(compressed);
        uint256 mask = (1 << (bitPos + 1)) - 1; // bits <= bitPos
        uint256 masked = bitmap[wordPos] & mask;

        initialized = masked != 0;
        if (initialized) {
            nextTick = _decompress((int24(wordPos) << 8) + int24(uint24(_msb(masked))));
        } else {
            nextTick = _decompress(int24(wordPos) << 8); // word boundary
        }
    } else {
        // Search right (towards higher ticks)
        (int16 wordPos, uint8 bitPos) = _position(compressed + 1);
        uint256 mask = ~((1 << bitPos) - 1); // bits >= bitPos
        uint256 masked = bitmap[wordPos] & mask;

        initialized = masked != 0;
        if (initialized) {
            nextTick = _decompress((int24(wordPos) << 8) + int24(uint24(_lsb(masked))));
        } else {
            nextTick = _decompress((int24(wordPos) + 1) << 8); // next word boundary
        }
    }
}

/// @notice Compress tick to bitmap coordinate
function _compress(int24 tick) internal pure returns (int24 compressed) {
    compressed = tick / TICK_SPACING;
    // Solidity division rounds toward zero; we need floor division
    if (tick < 0 && tick % TICK_SPACING != 0) compressed--;
}

/// @notice Decompress bitmap coordinate to tick
function _decompress(int24 compressed) internal pure returns (int24) {
    return compressed * TICK_SPACING;
}

/// @notice Get word position and bit position for compressed tick
function _position(int24 compressed) internal pure returns (int16 wordPos, uint8 bitPos) {
    wordPos = int16(compressed >> 8);
    bitPos = uint8(uint24(compressed) & 0xFF);
}

/// @notice Least significant bit (using de Bruijn)
function _lsb(uint256 x) internal pure returns (uint8) {
    require(x > 0);
    uint256 r;
    assembly {
        r := sub(255, byte(shr(251, mul(and(x, sub(0, x)),
            0x818283848586878898a8b8c8d8e8f929395969799a9b9d9e9faaeb6bedeeff)),
            0x0001020903110a19042112290b311a3905412245134d2a550c5d32651b6d3a75
        )))
    }
    return uint8(255 - r);
}

/// @notice Most significant bit
function _msb(uint256 x) internal pure returns (uint8) {
    require(x > 0);
    uint8 r = 0;
    if (x >= 0x100000000000000000000000000000000) { x >>= 128; r += 128; }
    if (x >= 0x10000000000000000) { x >>= 64; r += 64; }
    if (x >= 0x100000000) { x >>= 32; r += 32; }
    if (x >= 0x10000) { x >>= 16; r += 16; }
    if (x >= 0x100) { x >>= 8; r += 8; }
    if (x >= 0x10) { x >>= 4; r += 4; }
    if (x >= 0x4) { x >>= 2; r += 2; }
    if (x >= 0x2) r += 1;
    return r;
}

/// @notice Find next initialized tick, crossing word boundaries if needed
/// @dev Wrapper around _nextInitializedTickWithinOneWord that handles word traversal
/// @param maxWords Maximum words to search (gas limiter)
function _findNextInitializedTick(
    PoolId poolId,
    int24 tick,
    BucketSide side,
    bool lte,
    uint8 maxWords
) internal view returns (int24 nextTick, bool found) {
    int24 current = tick;

    for (uint8 w = 0; w < maxWords; w++) {
        (nextTick, found) = _nextInitializedTickWithinOneWord(poolId, current, side, lte);

        if (found) return (nextTick, true);

        // Move to next word boundary
        int24 compressed = _compress(current);
        if (lte) {
            // Move to previous word (lower ticks)
            int16 wordPos = int16(compressed >> 8);
            if (wordPos == type(int16).min) break; // Can't go lower
            current = _decompress((int24(wordPos) << 8) - 1);
        } else {
            // Move to next word (higher ticks)
            int16 wordPos = int16(compressed >> 8);
            if (wordPos == type(int16).max) break; // Can't go higher
            current = _decompress((int24(wordPos) + 1) << 8);
        }

        // Bounds check
        if (current < MIN_TICK || current > MAX_TICK) break;
    }

    return (0, false);
}
```

**Size impact**: Slightly larger but much faster. Consider extracting to library.

**IMPORTANT**: The original `_nextInitializedTickWithinOneWord` only searches within ONE 256-bit word. The wrapper `_findNextInitializedTick` is needed to cross word boundaries.

---

### 2.2 `_processTriggeredOrders` → Complete Rewrite

**Current** (lines 490-537): Iterates through ticks, calls `_fillBucketAgainstAMM` for each.

**New**: Implements the full pipeline:
1. Match opposing limits (no AMM)
2. Binary search for momentum closure
3. Execute AMM once
4. Virtual slicing allocation

**IMPORTANT ARCHITECTURAL CHANGE**: This function is now called BEFORE the main AMM swap, not after. The user's input goes through:
1. Opposing limit fills (at tick prices)
2. Remainder + momentum → single AMM execution

```solidity
/// @notice Process limit orders triggered by price movement (NEW PIPELINE)
/// @dev Implements: opposing match → momentum closure → 1× AMM → virtual slicing
/// @dev CALLED BEFORE main swap - user input is matched against limits first
/// @param userInputEnc User's swap input (encrypted)
/// @param userInputPlaintext User's swap input (plaintext for binary search)
/// @return userOutputFromLimits Output user receives from opposing limit fills
/// @return userOutputFromAmm Output user receives from AMM (their share of total output)
function _processOrdersAndSwap(
    PoolId poolId,
    bool zeroForOne,
    euint128 userInputEnc,
    uint256 userInputPlaintext
) internal returns (euint128 userOutputFromLimits, euint128 userOutputFromAmm) {
    int24 currentTick = _getCurrentTick(poolId);
    int24 prevTick = lastProcessedTick[poolId];

    // Estimate tick after swap for range determination
    PoolReserves storage r = poolReserves[poolId];
    int24 estimatedFinalTick = _estimateFinalTick(
        r.reserve0, r.reserve1, userInputPlaintext, zeroForOne
    );

    // Step 1: Match opposing limits first (fills at tick price, no AMM)
    euint128 remainderEnc;
    (remainderEnc, userOutputFromLimits) = _matchOpposingLimits(
        poolId,
        zeroForOne,
        userInputEnc,
        prevTick,
        estimatedFinalTick
    );
    FHE.allowThis(userOutputFromLimits);

    // Step 2: Find momentum closure tick via binary search (uses plaintext)
    // Momentum side is SAME direction as swap (they execute with the swap)
    BucketSide momentumSide = zeroForOne ? BucketSide.SELL : BucketSide.BUY;

    // Estimate plaintext remainder for binary search
    // (In production, could decrypt remainder or use proportion-based estimate)
    uint256 remainderPlaintext = userInputPlaintext; // Conservative estimate

    (int24 closureTick, euint128 momentumTotal) = _findMomentumClosure(
        poolId,
        momentumSide,
        remainderPlaintext,
        prevTick,
        estimatedFinalTick
    );
    FHE.allowThis(momentumTotal);

    // Step 3: Execute AMM exactly once with total input
    euint128 totalAmmInput = FHE.add(remainderEnc, momentumTotal);
    FHE.allowThis(totalAmmInput);

    ebool hasAmmInput = FHE.gt(totalAmmInput, ENC_ZERO);
    ebool direction = FHE.asEbool(zeroForOne);

    euint128 totalAmmOutput = _executeSwapMathForPool(poolId, direction, totalAmmInput);
    totalAmmOutput = FHE.select(hasAmmInput, totalAmmOutput, ENC_ZERO);
    FHE.allowThis(totalAmmOutput);

    // Step 4: Allocate AMM output
    // User gets their proportional share: userOutput = totalOutput * userRemainder / totalInput
    euint128 safeDenom = FHE.select(
        FHE.gt(totalAmmInput, ENC_ZERO),
        totalAmmInput,
        ENC_ONE
    );
    FHE.allowThis(safeDenom);

    userOutputFromAmm = FHE.div(
        FHE.mul(totalAmmOutput, remainderEnc),
        safeDenom
    );
    FHE.allowThis(userOutputFromAmm);

    // Momentum buckets get their share via virtual slicing
    if (Common.isInitialized(momentumTotal)) {
        euint128 momentumOutput = FHE.sub(totalAmmOutput, userOutputFromAmm);
        FHE.allowThis(momentumOutput);

        _allocateVirtualSlicing(
            poolId,
            momentumSide,
            prevTick,
            closureTick,
            momentumTotal,
            momentumOutput
        );
    }

    lastProcessedTick[poolId] = estimatedFinalTick;

    return (userOutputFromLimits, userOutputFromAmm);
}

/// @notice Estimate final tick after a swap (for range determination)
function _estimateFinalTick(
    uint256 x0,
    uint256 y0,
    uint256 amountIn,
    bool zeroForOne
) internal view returns (int24) {
    if (x0 == 0 || y0 == 0) return 0;

    uint256 newX0;
    uint256 newY0;

    if (zeroForOne) {
        newX0 = x0 + amountIn;
        newY0 = (x0 * y0) / newX0; // k = x*y preserved
    } else {
        newY0 = y0 + amountIn;
        newX0 = (x0 * y0) / newY0;
    }

    // Convert new ratio to tick
    // This reuses the existing _getCurrentTick logic but with hypothetical reserves
    // For simplicity, compute approximate tick from ratio
    if (newX0 == 0) return MAX_TICK;
    if (newY0 == 0) return MIN_TICK;

    // ratio = newY0 / newX0 (price in terms of token1 per token0)
    // tick ≈ log1.0001(ratio) but we use sqrtPrice approach from TickMath
    // For a rough estimate, use the current tick calculation on new reserves

    // Simplified: estimate tick movement as proportional to log of price change
    // This is a placeholder - in production use proper TickMath
    int24 currentTick = _getCurrentTick(PoolId.wrap(bytes32(0))); // Placeholder
    return currentTick; // TODO: implement proper estimation
}
```

**Note on `_estimateFinalTick`**: This is a placeholder. In production, either:
1. Use TickMath.getTickAtSqrtPrice with estimated final sqrtPrice
2. Accept a tick hint from the caller (frontend can compute this)
3. Use a bounded search window instead of exact tick

---

### 2.3 `_updateBucketOnFill` - Keep but simplify

**Current** (lines 561-582): Good structure, keep mostly as-is.

**Modification**: Add a parameter to skip liquidity decrement (for opposing fills).

```solidity
/// @notice Update bucket accumulators when a fill occurs
/// @param clearLiquidity Whether to set liquidity to zero (true for momentum, false for opposing)
function _updateBucketOnFill(
    Bucket storage bucket,
    euint128 fillAmount,
    euint128 proceedsAmount,
    bool clearLiquidity
) internal {
    // ... existing accumulator logic ...

    if (clearLiquidity) {
        bucket.liquidity = ENC_ZERO;
        FHE.allowThis(bucket.liquidity);
    }
}
```

---

### 2.4 `_setBit` / `_clearBit` - Use compressed ticks

**Current** (lines 1475-1495): Uses raw ticks.

**New**: Use compressed ticks for consistency with bitmap scan.

```solidity
function _setBit(PoolId poolId, int24 tick, BucketSide side) internal {
    int24 compressed = _compress(tick);
    (int16 wordPos, uint8 bitPos) = _position(compressed);

    if (side == BucketSide.BUY) {
        buyBitmaps[poolId][wordPos] |= (1 << bitPos);
    } else {
        sellBitmaps[poolId][wordPos] |= (1 << bitPos);
    }
}

function _clearBit(PoolId poolId, int24 tick, BucketSide side) internal {
    int24 compressed = _compress(tick);
    (int16 wordPos, uint8 bitPos) = _position(compressed);

    if (side == BucketSide.BUY) {
        buyBitmaps[poolId][wordPos] &= ~(1 << bitPos);
    } else {
        sellBitmaps[poolId][wordPos] &= ~(1 << bitPos);
    }
}
```

---

## 3. NEW Functions to Add

### 3.1 Opposing Limit Matching (No AMM)

**Order Semantics Clarification:**
- **BUY bucket** at tick T: Users deposited **quote tokens (token1)** wanting to buy base (token0) at price ≤ T
- **SELL bucket** at tick T: Users deposited **base tokens (token0)** wanting to sell for quote (token1) at price ≥ T

When a swapper sells token0 (`zeroForOne=true`), they match against **BUY buckets** (which want token0).
When a swapper sells token1 (`zeroForOne=false`), they match against **SELL buckets** (which want token1).

```solidity
/// @notice Match user's input against opposing limit orders at tick prices
/// @dev Fills happen at tick price semantics - no AMM movement
/// @param userInputEnc The encrypted amount the user is swapping IN
/// @return remainderEnc Amount remaining after opposing fills
/// @return userOutputEnc Amount the user receives from opposing fills
function _matchOpposingLimits(
    PoolId poolId,
    bool zeroForOne,
    euint128 userInputEnc,
    int24 fromTick,
    int24 toTick
) internal returns (euint128 remainderEnc, euint128 userOutputEnc) {
    remainderEnc = userInputEnc;
    userOutputEnc = ENC_ZERO;

    // Opposing side: if user is selling token0 (zeroForOne), match against BUY orders
    BucketSide opposingSide = zeroForOne ? BucketSide.BUY : BucketSide.SELL;
    bool searchUp = toTick > fromTick;

    int24 tick = fromTick;
    uint256 maxBuckets = poolStates[poolId].maxBucketsPerSwap;

    for (uint256 i = 0; i < maxBuckets; i++) {
        // Use word-crossing search with max 3 words
        (int24 nextTick, bool found) = _findNextInitializedTick(
            poolId, tick, opposingSide, !searchUp, 3
        );

        if (!found) break;

        // Check if tick is within range
        bool inRange = searchUp
            ? (nextTick > fromTick && nextTick <= toTick)
            : (nextTick < fromTick && nextTick >= toTick);
        if (!inRange) break;

        // Fill at tick price (no AMM movement)
        euint128 outputFromBucket;
        (remainderEnc, outputFromBucket) = _fillOpposingBucket(
            poolId, nextTick, opposingSide, remainderEnc, zeroForOne
        );

        userOutputEnc = FHE.add(userOutputEnc, outputFromBucket);
        FHE.allowThis(userOutputEnc);

        tick = searchUp ? nextTick + TICK_SPACING : nextTick - TICK_SPACING;
    }

    return (remainderEnc, userOutputEnc);
}

/// @notice Fill a single opposing bucket at its tick price
/// @dev Tick price = token1/token0 (how much token1 per token0)
/// @param zeroForOne True if user is selling token0 (matching against BUY bucket)
/// @return remainingInput User's remaining input after fill
/// @return outputToUser Amount of output token the user receives
function _fillOpposingBucket(
    PoolId poolId,
    int24 tick,
    BucketSide side,
    euint128 userInputEnc,
    bool zeroForOne
) internal returns (euint128 remainingInput, euint128 outputToUser) {
    Bucket storage bucket = buckets[poolId][tick][side];
    if (!bucket.initialized || !Common.isInitialized(bucket.liquidity)) {
        return (userInputEnc, ENC_ZERO);
    }

    // Tick price = token1/token0 (scaled by PRECISION)
    uint256 tickPrice = _calculateTickPrice(tick);

    if (zeroForOne) {
        // User sells token0, wants token1
        // BUY bucket has token1 (quote), wants token0 (base)
        // User provides: token0 (base)
        // User receives: token1 (quote) = base * price
        // Bucket provides: token1 (its liquidity)
        // Bucket receives: token0 (from user) = quote / price

        // How much token0 can this bucket absorb?
        // bucketLiquidity is in token1, convert to token0: liq / price
        euint128 encTickPrice = FHE.asEuint128(uint128(tickPrice));
        FHE.allowThis(encTickPrice);

        // bucketCapacityBase = bucket.liquidity * PRECISION / tickPrice
        euint128 bucketCapacityBase = FHE.div(
            FHE.mul(bucket.liquidity, ENC_PRECISION),
            encTickPrice
        );
        FHE.allowThis(bucketCapacityBase);

        // fillBase = min(userInput, bucketCapacity)
        ebool userExceedsBucket = FHE.gt(userInputEnc, bucketCapacityBase);
        euint128 fillBase = FHE.select(userExceedsBucket, bucketCapacityBase, userInputEnc);
        FHE.allowThis(fillBase);

        // outputQuote = fillBase * tickPrice / PRECISION
        outputToUser = FHE.div(FHE.mul(fillBase, encTickPrice), ENC_PRECISION);
        FHE.allowThis(outputToUser);

        // Update bucket: receives fillBase (token0), gives outputQuote (token1)
        _updateBucketOnFill(bucket, outputToUser, fillBase, false);

        // Reduce bucket liquidity (token1)
        bucket.liquidity = FHE.sub(bucket.liquidity, outputToUser);
        FHE.allowThis(bucket.liquidity);

        remainingInput = FHE.sub(userInputEnc, fillBase);
        FHE.allowThis(remainingInput);

    } else {
        // User sells token1, wants token0
        // SELL bucket has token0 (base), wants token1 (quote)
        // User provides: token1 (quote)
        // User receives: token0 (base) = quote / price
        // Bucket provides: token0 (its liquidity)
        // Bucket receives: token1 (from user) = base * price

        euint128 encTickPrice = FHE.asEuint128(uint128(tickPrice));
        FHE.allowThis(encTickPrice);

        // How much token1 can this bucket absorb?
        // bucketLiquidity is in token0, convert to token1: liq * price
        euint128 bucketCapacityQuote = FHE.div(
            FHE.mul(bucket.liquidity, encTickPrice),
            ENC_PRECISION
        );
        FHE.allowThis(bucketCapacityQuote);

        // fillQuote = min(userInput, bucketCapacity)
        ebool userExceedsBucket = FHE.gt(userInputEnc, bucketCapacityQuote);
        euint128 fillQuote = FHE.select(userExceedsBucket, bucketCapacityQuote, userInputEnc);
        FHE.allowThis(fillQuote);

        // outputBase = fillQuote * PRECISION / tickPrice
        outputToUser = FHE.div(FHE.mul(fillQuote, ENC_PRECISION), encTickPrice);
        FHE.allowThis(outputToUser);

        // Update bucket: receives fillQuote (token1), gives outputBase (token0)
        _updateBucketOnFill(bucket, outputToUser, fillQuote, false);

        // Reduce bucket liquidity (token0)
        bucket.liquidity = FHE.sub(bucket.liquidity, outputToUser);
        FHE.allowThis(bucket.liquidity);

        remainingInput = FHE.sub(userInputEnc, fillQuote);
        FHE.allowThis(remainingInput);
    }

    // Check if bucket is empty and clear bitmap
    // Note: Can't conditionally clear without decryption, so check plaintext cache
    // or defer to lazy clearing

    emit BucketFilled(poolId, tick, side);
    return (remainingInput, outputToUser);
}
```

### 3.2 Momentum Closure via Binary Search

**v6.1 Simplification**: Use **plaintext reserves** for the binary search predicate. This avoids expensive FHE operations in the loop and is acceptable because:
1. Plaintext cache is updated after each swap
2. Order triggering is inherently approximate (tick-based, not exact price)
3. The 1× AMM invariant is still preserved

```solidity
/// @notice Find final tick where momentum activation is consistent
/// @dev Uses PLAINTEXT reserves for binary search (FHE predicates too expensive)
/// @return closureTick The tick where momentum stops activating
/// @return totalMomentum Sum of all activated momentum bucket inputs (encrypted)
function _findMomentumClosure(
    PoolId poolId,
    BucketSide side,
    uint256 userRemainderPlaintext, // Use plaintext for binary search
    int24 startTick,
    int24 boundaryTick
) internal view returns (int24 closureTick, euint128 totalMomentum) {
    PoolReserves storage r = poolReserves[poolId];

    // Binary search bounds
    bool searchUp = boundaryTick > startTick;
    int24 lo = startTick;
    int24 hi = boundaryTick;

    // Ensure lo < hi for binary search
    if (!searchUp) {
        lo = boundaryTick;
        hi = startTick;
    }

    // Cap search range for gas (10 words = 600 ticks at spacing=60)
    int24 maxDelta = int24(int256(poolStates[poolId].maxBucketsPerSwap)) * TICK_SPACING * 2;
    if (hi - lo > maxDelta) {
        if (searchUp) {
            hi = lo + maxDelta;
        } else {
            lo = hi - maxDelta;
        }
    }

    closureTick = startTick;
    totalMomentum = ENC_ZERO;
    uint256 momentumPlaintext = 0; // Track plaintext sum for predicate

    // Fixed iterations (12 is enough for typical ranges)
    for (uint8 iter = 0; iter < 12; iter++) {
        if (lo > hi) break;

        // Calculate midpoint aligned to tick spacing
        int24 mid = lo + ((hi - lo) / (2 * TICK_SPACING)) * TICK_SPACING;

        // Prevent infinite loop if mid equals lo
        if (mid == lo) mid = lo + TICK_SPACING;
        if (mid > hi) break;

        // Sum momentum buckets (plaintext estimate from cache)
        uint256 momSumPlaintext = _sumMomentumBucketsPlaintext(
            poolId, side, startTick, mid, searchUp
        );

        uint256 totalIn = userRemainderPlaintext + momSumPlaintext;

        // Plaintext predicate: does totalIn push price beyond mid?
        bool crossesMid = _predicateCrossesTickPlaintext(
            r.reserve0,
            r.reserve1,
            totalIn,
            mid,
            side == BucketSide.SELL // zeroForOne
        );

        if (crossesMid) {
            // Price goes beyond mid, search further
            closureTick = mid;
            momentumPlaintext = momSumPlaintext;
            lo = mid + TICK_SPACING;
        } else {
            // Price doesn't reach mid, search closer
            hi = mid - TICK_SPACING;
        }
    }

    // Now compute the actual encrypted sum for the final range
    if (closureTick != startTick) {
        totalMomentum = _sumMomentumBucketsEnc(poolId, side, startTick, closureTick, searchUp);
    }

    return (closureTick, totalMomentum);
}

/// @notice Sum momentum bucket liquidity using PLAINTEXT estimates
/// @dev Used for binary search predicate - does not need to be exact
function _sumMomentumBucketsPlaintext(
    PoolId poolId,
    BucketSide side,
    int24 fromTick,
    int24 toTick,
    bool searchUp
) internal view returns (uint256 total) {
    total = 0;
    int24 tick = fromTick;
    uint256 maxBuckets = poolStates[poolId].maxBucketsPerSwap;

    for (uint256 i = 0; i < maxBuckets; i++) {
        (int24 nextTick, bool found) = _findNextInitializedTick(
            poolId, tick, side, !searchUp, 2
        );

        if (!found) break;

        bool inRange = searchUp
            ? (nextTick > fromTick && nextTick <= toTick)
            : (nextTick < fromTick && nextTick >= toTick);
        if (!inRange) break;

        // Use plaintext estimate (could store alongside encrypted, or use 0 as placeholder)
        // For v6.1: assume each active bucket has some liquidity, use fixed estimate
        // In production: maintain plaintext liquidity cache per bucket
        total += 1e18; // Placeholder - replace with actual plaintext tracking

        tick = searchUp ? nextTick + TICK_SPACING : nextTick - TICK_SPACING;
    }

    return total;
}

/// @notice Sum momentum bucket liquidity (ENCRYPTED) for final allocation
function _sumMomentumBucketsEnc(
    PoolId poolId,
    BucketSide side,
    int24 fromTick,
    int24 toTick,
    bool searchUp
) internal view returns (euint128 total) {
    total = ENC_ZERO;
    int24 tick = fromTick;
    uint256 maxBuckets = poolStates[poolId].maxBucketsPerSwap;

    for (uint256 i = 0; i < maxBuckets; i++) {
        (int24 nextTick, bool found) = _findNextInitializedTick(
            poolId, tick, side, !searchUp, 2
        );

        if (!found) break;

        bool inRange = searchUp
            ? (nextTick > fromTick && nextTick <= toTick)
            : (nextTick < fromTick && nextTick >= toTick);
        if (!inRange) break;

        Bucket storage b = buckets[poolId][nextTick][side];
        if (b.initialized && Common.isInitialized(b.liquidity)) {
            total = FHE.add(total, b.liquidity);
            // Note: No FHE.allowThis in view function - caller handles permissions
        }

        tick = searchUp ? nextTick + TICK_SPACING : nextTick - TICK_SPACING;
    }

    return total;
}
```

**IMPORTANT**: `_sumMomentumBucketsEnc` is marked `view` but creates new FHE handles. The caller must call `FHE.allowThis(totalMomentum)` after receiving the result.

### 3.3 Plaintext Price Predicate (v6.1)

For v6.1, we use **plaintext reserves** exclusively for the binary search predicate. This is the recommended approach because:
- FHE predicates would require async decryption (complex)
- Plaintext cache is sufficiently accurate for tick-based triggering
- Massive gas savings (no FHE operations in the search loop)

```solidity
/// @notice Test if swap input pushes price beyond target tick (PLAINTEXT, NO DIVISION)
/// @dev Uses inequality: (y0+dy)^2 >= k * p(tick) for buy, k <= p(tick) * (x0+dx)^2 for sell
/// @param x0 Current reserve0 (plaintext cache)
/// @param y0 Current reserve1 (plaintext cache)
/// @param amountIn Swap input amount (plaintext)
/// @param targetTick Tick to test against
/// @param zeroForOne Swap direction (true = selling token0)
/// @return crosses True if swap pushes price beyond targetTick
function _predicateCrossesTickPlaintext(
    uint256 x0,
    uint256 y0,
    uint256 amountIn,
    int24 targetTick,
    bool zeroForOne
) internal pure returns (bool crosses) {
    if (x0 == 0 || y0 == 0) return false;

    // Get target price (scaled by PRECISION = 1e18)
    uint256 targetPrice = _calculateTickPrice(targetTick);

    // k = x0 * y0 (can overflow for large reserves, so we scale)
    // Use 1e9 scaling to prevent overflow while maintaining precision
    uint256 x0Scaled = x0 / 1e9;
    uint256 y0Scaled = y0 / 1e9;
    uint256 kScaled = x0Scaled * y0Scaled; // Now fits in uint256

    if (zeroForOne) {
        // Selling token0: x1 = x0 + dx, price falls (reserve1/reserve0 decreases)
        // Final price p1 = k / x1^2 (after swap, y1 = k/x1)
        // Test: p1 <= targetPrice
        // => k / x1^2 <= targetPrice
        // => k <= targetPrice * x1^2

        uint256 x1 = x0 + amountIn;
        uint256 x1Scaled = x1 / 1e9;

        // LHS = kScaled (already computed)
        // RHS = targetPrice * x1Scaled^2 / 1e18 (adjust for price scaling)
        // Rearrange to avoid division: kScaled * 1e18 <= targetPrice * x1Scaled^2

        // Further scaling to prevent overflow:
        // kScaled * 1e9 <= targetPrice * x1Scaled^2 / 1e9
        uint256 lhs = kScaled;
        uint256 rhs = (targetPrice / 1e9) * (x1Scaled * x1Scaled / 1e9);

        crosses = lhs <= rhs;

    } else {
        // Buying token0: y1 = y0 + dy, price rises (reserve1/reserve0 increases)
        // Final price p1 = y1^2 / k (after swap, x1 = k/y1)
        // Test: p1 >= targetPrice
        // => y1^2 / k >= targetPrice
        // => y1^2 >= k * targetPrice

        uint256 y1 = y0 + amountIn;
        uint256 y1Scaled = y1 / 1e9;

        // LHS = y1Scaled^2
        // RHS = kScaled * targetPrice / 1e18

        uint256 lhs = y1Scaled * y1Scaled;
        uint256 rhs = (kScaled * targetPrice) / 1e18;

        crosses = lhs >= rhs;
    }

    return crosses;
}
```

**Overflow Analysis:**
- Reserves up to ~1e27 (1 billion tokens with 18 decimals): x0Scaled = 1e18, x0Scaled^2 = 1e36 ✓
- targetPrice up to ~1e36 for extreme ticks: (1e36 / 1e9) * 1e36 / 1e9 = 1e54 ✗ OVERFLOW

**Fix for extreme cases:** Add bounds check or use mulDiv library:

```solidity
// Alternative using FullMath (from Uniswap)
// import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

function _predicateCrossesTickPlaintextSafe(
    uint256 x0,
    uint256 y0,
    uint256 amountIn,
    int24 targetTick,
    bool zeroForOne
) internal pure returns (bool) {
    if (x0 == 0 || y0 == 0) return false;

    uint256 targetPrice = _calculateTickPrice(targetTick);
    uint256 k = FullMath.mulDiv(x0, y0, 1); // Full precision k

    if (zeroForOne) {
        uint256 x1 = x0 + amountIn;
        // k <= targetPrice * x1^2 / 1e18
        // k * 1e18 <= targetPrice * x1^2
        uint256 lhs = FullMath.mulDiv(k, 1e18, 1);
        uint256 rhs = FullMath.mulDiv(targetPrice, FullMath.mulDiv(x1, x1, 1), 1);
        return lhs <= rhs;
    } else {
        uint256 y1 = y0 + amountIn;
        // y1^2 >= k * targetPrice / 1e18
        uint256 lhs = FullMath.mulDiv(y1, y1, 1);
        uint256 rhs = FullMath.mulDiv(k, targetPrice, 1e18);
        return lhs >= rhs;
    }
}
```

**Recommendation:** Import `FullMath` from Uniswap v4-core (already a dependency) for safe overflow handling.

### 3.4 Virtual Slicing Allocation

```solidity
/// @notice Allocate AMM output to momentum buckets fairly
/// @dev Uses simple pro-rata allocation for v6.1
/// @dev Full virtual slicing (B-fairness with curve position) deferred to v7
function _allocateVirtualSlicing(
    PoolId poolId,
    BucketSide side,
    int24 fromTick,
    int24 toTick,
    euint128 totalMomentum,
    euint128 totalOutput
) internal {
    bool up = toTick > fromTick;
    int24 tick = fromTick;
    uint256 maxBuckets = poolStates[poolId].maxBucketsPerSwap;

    // Pre-compute safe denominator once
    euint128 safeDenom = FHE.select(
        FHE.gt(totalMomentum, ENC_ZERO),
        totalMomentum,
        ENC_ONE
    );
    FHE.allowThis(safeDenom);

    for (uint256 i = 0; i < maxBuckets; i++) {
        // Use word-crossing search
        (int24 nextTick, bool found) = _findNextInitializedTick(
            poolId, tick, side, !up, 2
        );

        if (!found) break;

        bool inRange = up
            ? (nextTick > fromTick && nextTick <= toTick)
            : (nextTick < fromTick && nextTick >= toTick);
        if (!inRange) break;

        Bucket storage bucket = buckets[poolId][nextTick][side];
        if (!bucket.initialized || !Common.isInitialized(bucket.liquidity)) {
            tick = up ? nextTick + TICK_SPACING : nextTick - TICK_SPACING;
            continue;
        }

        // Pro-rata share: bucketOutput = totalOutput * bucketLiq / totalMomentum
        euint128 bucketOutput = FHE.div(
            FHE.mul(totalOutput, bucket.liquidity),
            safeDenom
        );
        FHE.allowThis(bucketOutput);

        // Update bucket accounting (fills = liquidity consumed, proceeds = output received)
        _updateBucketOnFill(bucket, bucket.liquidity, bucketOutput, true);

        // Clear bitmap (bucket is now empty)
        _clearBit(poolId, nextTick, side);

        emit BucketFilled(poolId, nextTick, side);

        tick = up ? nextTick + TICK_SPACING : nextTick - TICK_SPACING;
    }
}
```

**Future Enhancement (v7)**: True virtual slicing computes each bucket's curve position:
```solidity
// B-fairness: earlier buckets get better prices
// For bucket i with input dy_i:
//   prefix Y_i = y0 + sum(dy_j for j < i)
//   bucket output dx_i = k/Y_i - k/(Y_i + dy_i)
// This requires per-bucket reciprocal computation (expensive in FHE)
```

---

## 4. Integration Points

### 4.1 Modify `swapForPool` (lines 638-692)

**MAJOR CHANGE**: Move order processing BEFORE transfer/AMM execution.

```solidity
function swapForPool(
    PoolId poolId,
    bool zeroForOne,
    uint256 amountIn,
    uint256 minAmountOut
) public whenNotPaused returns (uint256 amountOut) {
    PoolState storage state = poolStates[poolId];
    if (!state.initialized) revert PoolNotInitialized();
    if (amountIn == 0) revert ZeroAmount();

    SwapLock.enforceOnce(poolId);

    // 1. Transfer input from user FIRST
    address tokenIn = zeroForOne ? state.token0 : state.token1;
    IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

    // 2. Encrypt input for order matching
    euint128 encAmountIn = FHE.asEuint128(uint128(amountIn));
    FHE.allowThis(encAmountIn);

    // 3. NEW: Process orders and execute AMM in unified pipeline
    (euint128 outputFromLimits, euint128 outputFromAmm) = _processOrdersAndSwap(
        poolId,
        zeroForOne,
        encAmountIn,
        amountIn  // plaintext for binary search
    );

    // 4. Total output = limit fills + AMM output
    euint128 totalOutputEnc = FHE.add(outputFromLimits, outputFromAmm);
    FHE.allowThis(totalOutputEnc);

    // 5. For plaintext swap, we need to decrypt or use estimate
    // Option A: Use plaintext estimate from reserves (fast but approximate)
    amountOut = _estimateOutput(poolId, zeroForOne, amountIn);

    // Option B: Request async decryption (accurate but delayed)
    // FHE.decrypt(totalOutputEnc); // handle in callback

    if (amountOut < minAmountOut) revert SlippageExceeded();

    // 6. Apply fee
    uint256 fee = (amountOut * state.protocolFeeBps) / 10000;
    uint256 amountOutAfterFee = amountOut - fee;

    // 7. Update plaintext reserve cache
    PoolReserves storage reserves = poolReserves[poolId];
    if (zeroForOne) {
        reserves.reserve0 += amountIn;
        reserves.reserve1 -= amountOut;
    } else {
        reserves.reserve1 += amountIn;
        reserves.reserve0 -= amountOut;
    }

    // 8. Transfer output to user
    address tokenOut = zeroForOne ? state.token1 : state.token0;
    IERC20(tokenOut).safeTransfer(msg.sender, amountOutAfterFee);

    // 9. Transfer fee to collector
    if (fee > 0 && feeCollector != address(0)) {
        IERC20(tokenOut).safeTransfer(feeCollector, fee);
    }

    _requestReserveSync(poolId);
    emit Swap(poolId, msg.sender, zeroForOne, amountIn, amountOutAfterFee);
}
```

### 4.2 Modify `swapEncrypted` (lines 1134-1197)

For encrypted swaps, direction is encrypted. Two options:

**Option A: Accept plaintext direction hint (RECOMMENDED for v6.1)**
```solidity
function swapEncrypted(
    PoolId poolId,
    InEbool calldata direction,
    InEuint128 calldata amountIn,
    InEuint128 calldata minOutput,
    bool directionHint  // NEW: plaintext hint for tick range search
) external whenNotPaused returns (euint128 amountOut) {
    // ... existing setup ...

    // Use directionHint for order matching (plaintext search)
    // Use encrypted direction for actual AMM execution
    (euint128 outputFromLimits, euint128 outputFromAmm) = _processOrdersAndSwap(
        poolId,
        directionHint,  // Use hint for search
        amt,
        0  // No plaintext amount available
    );

    // ... rest unchanged ...
}
```

**Option B: Skip order matching for fully encrypted swaps**
If direction is truly private, we can't know which tick range to search. Options:
- Search BOTH directions (2× gas)
- Skip order matching entirely (orders only trigger on plaintext swaps)
- Require direction hint (privacy tradeoff)

### 4.3 Modify `_beforeSwap` / `_afterSwap` callbacks

**Option A: Remove order triggering from hooks entirely**
Since `swapForPool` now handles everything, the hooks can be simplified:

```solidity
function _beforeSwap(...) internal override returns (bytes4, BeforeSwapDelta, uint24) {
    // Just validate and return - no order processing
    if (!poolStates[poolId].initialized) {
        return (this.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
    }
    SwapLock.enforceOnce(poolId);
    return (this.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
}

function _afterSwap(...) internal override returns (bytes4, int128) {
    // No order processing - handled in swapForPool
    return (this.afterSwap.selector, 0);
}
```

**Option B: Keep hook-based swaps with new pipeline**
If you need V4 router compatibility, integrate `_processOrdersAndSwap` into `_beforeSwap`. This is more complex but preserves composability.

### 4.4 Update `deposit()` to track plaintext liquidity

```solidity
function deposit(...) external whenNotPaused {
    // ... existing logic ...

    // NEW: Update plaintext liquidity estimate
    // Since deposit amount is encrypted, we can only track that "something was deposited"
    // Option: Store hash of encrypted amount for later verification
    // Option: Accept plaintext hint (privacy tradeoff)

    // For v6.1: Just track bucket is active (no size estimate)
    bucket.liquidityPlaintext = 1; // Marker that bucket has liquidity
}
```

---

## 5. Gas Optimization Strategies

### 5.1 Extract BitMath to Library (~500 bytes saved)

```solidity
// contracts/src/lib/BitMath.sol
library BitMath {
    function lsb(uint256 x) internal pure returns (uint8) { ... }
    function msb(uint256 x) internal pure returns (uint8) { ... }
}
```

### 5.2 Use Plaintext Predicate for Binary Search

The division-free predicate can use the **plaintext reserve cache** instead of encrypted reserves for the tick comparison. This:
- Avoids expensive FHE multiplications in the loop
- Uses stale-but-safe reserves (order triggering is approximate anyway)
- Reduces gas by ~80% for the binary search

```solidity
function _predicateCrossesTickPlaintext(
    uint256 x0,
    uint256 y0,
    uint256 amountIn,
    int24 targetTick,
    bool zeroForOne
) internal pure returns (bool) {
    uint256 targetPrice = _calculateTickPrice(targetTick);
    uint256 k = x0 * y0;

    if (zeroForOne) {
        uint256 x1 = x0 + amountIn;
        // k <= targetPrice * x1^2 / 1e18
        return k * 1e18 <= targetPrice * x1 * x1;
    } else {
        uint256 y1 = y0 + amountIn;
        // y1^2 * 1e18 >= k * targetPrice
        return y1 * y1 * 1e18 >= k * targetPrice;
    }
}
```

### 5.3 Lazy Bitmap Clearing

Don't clear bitmap bits immediately—let them remain set and check `bucket.liquidity == 0` when scanning. Clear in batches during low-activity periods.

### 5.4 Skip Empty Buckets Early

```solidity
// In _sumMomentumBuckets and _allocateVirtualSlicing:
if (!Common.isInitialized(b.liquidity)) continue;
```

---

## 6. Contract Size Budget

Current v6 is near the 24KB limit. Here's a more realistic size analysis:

| Change | Lines | Est. Bytes | Notes |
|--------|-------|------------|-------|
| **DELETIONS** | | | |
| Delete `_processTriggeredOrdersEncrypted` | -21 | -800 | |
| Delete `_tryFillBucketEncrypted` | -25 | -1000 | |
| Delete `_fillBucketAgainstAMM` | -20 | -700 | |
| | | **-2500** | |
| **ADDITIONS** | | | |
| `_compress`, `_decompress`, `_position` | +15 | +400 | |
| `_lsb`, `_msb` | +25 | +600 | Or import library |
| `_nextInitializedTickWithinOneWord` | +30 | +800 | |
| `_findNextInitializedTick` | +25 | +600 | Word-crossing wrapper |
| `_matchOpposingLimits` | +35 | +1200 | |
| `_fillOpposingBucket` | +70 | +2500 | Two branches |
| `_findMomentumClosure` | +50 | +1500 | |
| `_sumMomentumBucketsPlaintext` | +25 | +700 | |
| `_sumMomentumBucketsEnc` | +25 | +700 | |
| `_predicateCrossesTickPlaintext` | +35 | +900 | |
| `_allocateVirtualSlicing` | +45 | +1200 | |
| `_processOrdersAndSwap` | +80 | +2500 | Main pipeline |
| `_estimateFinalTick` | +25 | +600 | |
| | | **+14200** | |
| **NET** | | **+11700** (~11.4 KB) | **OVER LIMIT!** |

### Size Reduction Strategies

**Critical - Must implement to fit:**

1. **Extract to library (~4 KB saved)**
   ```solidity
   // lib/TickBitmap.sol - external library
   library TickBitmap {
       function compress(int24 tick, int24 spacing) external pure returns (int24);
       function nextInitializedTick(...) external view returns (int24, bool);
       // ... other bitmap functions
   }
   ```

2. **Merge redundant code paths (~2 KB saved)**
   - Combine `_sumMomentumBucketsPlaintext` and `_sumMomentumBucketsEnc` with a flag
   - Combine the two branches in `_fillOpposingBucket` using conditional math

3. **Remove less-used features (~2 KB saved)**
   - Remove `swapEncrypted` if V4 router integration is primary
   - Remove `addLiquidityEncrypted` / `removeLiquidityEncrypted`

4. **Simplify for v6.1 (~3 KB saved)**
   - Skip momentum closure entirely - just match opposing limits
   - Use fixed tick window instead of binary search
   - Skip virtual slicing - just clear buckets without allocation

### Recommended v6.1 Minimal Implementation

If size is critical, implement only:
1. Bitmap word scan (required for efficiency)
2. Opposing limit matching (core feature)
3. Skip momentum/trigger orders for now (defer to v7)

This reduces additions to ~5 KB, giving net change of ~+2.5 KB.

---

## 7. Implementation Order

1. **Phase 1: Deletions** (safe, reduces size)
   - Remove `_processTriggeredOrdersEncrypted`
   - Remove `_tryFillBucketEncrypted`
   - Remove `_fillBucketAgainstAMM`

2. **Phase 2: Bitmap Upgrade**
   - Add `_compress`, `_decompress`, `_position`
   - Add `_lsb`, `_msb`
   - Replace `_findNextActiveTick` with `_nextInitializedTickWithinOneWord`
   - Update `_setBit`, `_clearBit`

3. **Phase 3: New Pipeline**
   - Add `_matchOpposingLimits` and `_fillOpposingBucket`
   - Add `_findMomentumClosure` (use plaintext predicate)
   - Add `_allocateVirtualSlicing`
   - Rewrite `_processTriggeredOrders`

4. **Phase 4: Integration**
   - Update `swapForPool`
   - Update `swapEncrypted`
   - Update `_beforeSwap` / `_afterSwap`

5. **Phase 5: Testing**
   - Unit tests for bitmap operations
   - Integration tests for order matching
   - Fuzz tests for edge cases

---

## 8. Simplifications for v6.1 (Reduce Scope)

To ship faster with smaller code:

1. **Skip full virtual slicing** - Use simple pro-rata instead of curve-aware slicing
2. **Use plaintext predicates** - Binary search uses cached reserves
3. **Skip Fenwick/segment tree** - Linear sum is fine for maxBuckets=5
4. **Skip encrypted direction** - `swapEncrypted` can use plaintext hint for tick range

---

## 9. Test Cases to Add

```solidity
// tests to add in test/FheatherXv6Matching.t.sol

function test_opposingMatch_fullFill() public { }
function test_opposingMatch_partialFill() public { }
function test_opposingMatch_noLiquidity() public { }
function test_momentumClosure_singleBucket() public { }
function test_momentumClosure_multipleBuckets() public { }
function test_virtualSlicing_fairAllocation() public { }
function test_bitmapScan_wordBoundary() public { }
function test_bitmapScan_negativeTicks() public { }
function test_compress_roundingNegative() public { }
function test_oneAmmUpdate_invariant() public { }
```

---

## 10. Additional Requirements

### 10.1 Plaintext Liquidity Cache for Binary Search

The binary search requires plaintext bucket liquidity estimates. Options:

**Option A: Track plaintext alongside encrypted (RECOMMENDED)**
```solidity
struct Bucket {
    euint128 totalShares;
    euint128 liquidity;
    euint128 proceedsPerShare;
    euint128 filledPerShare;
    uint256 liquidityPlaintext;  // NEW: plaintext estimate for binary search
    bool initialized;
}
```

Update `liquidityPlaintext` on every deposit/withdraw/fill using the plaintext amount hint.

**Option B: Use bucket count instead of liquidity sum**
In `_sumMomentumBucketsPlaintext`, just count active buckets and multiply by average:
```solidity
total = activeBucketCount * averageBucketSize;
```
Less accurate but simpler.

**Option C: Fixed estimate per bucket**
Assume each active bucket has a fixed amount (e.g., 1e18). Good enough for tick range estimation.

### 10.2 Storage Layout Changes

If adding `liquidityPlaintext` to Bucket struct:
- Increases storage per bucket by 32 bytes
- Total storage impact: ~32 bytes × (MAX_TICKS / TICK_SPACING) × 2 sides = minimal for sparse usage
- Consider if this breaks existing storage layout (upgrade concerns)

### 10.3 Import Dependencies

Add these imports to FheatherXv6.sol:
```solidity
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
// BitMath could be imported from Uniswap or implemented inline
```

---

## 11. Summary

**What we're doing:**
- Removing 3 flawed functions (~92 lines, ~2.6 KB)
- Adding word-level bitmap scanning (faster tick search)
- Adding opposing limit matching (correct semantics)
- Adding momentum binary search closure (deterministic)
- Adding virtual slicing allocation (fair fills)
- Ensuring 1× AMM update invariant (major gas savings)
- Moving order processing BEFORE AMM execution (correct flow)

**What we're NOT doing (defer to v7):**
- Full B-fairness virtual slicing with Newton-Raphson
- Fenwick tree for O(log N) range sums
- Async decryption for encrypted predicates
- Encrypted direction in swapEncrypted tick matching

**Risk areas:**
- Tick compression negative rounding (test extensively with negative ticks)
- Bitmap word boundary edge cases (test at wordPos transitions)
- Plaintext predicate staleness vs encrypted predicate cost
- Storage layout changes if adding plaintext liquidity cache
- Integration with existing swapForPool/swapEncrypted callers

---

## 12. Migration Checklist

- [ ] Delete `_processTriggeredOrdersEncrypted`
- [ ] Delete `_tryFillBucketEncrypted`
- [ ] Delete `_fillBucketAgainstAMM`
- [ ] Add `_compress`, `_decompress`, `_position`
- [ ] Add `_lsb`, `_msb` (or import BitMath)
- [ ] Add `_nextInitializedTickWithinOneWord`
- [ ] Add `_findNextInitializedTick` (word-crossing wrapper)
- [ ] Update `_setBit`, `_clearBit` to use compressed ticks
- [ ] Add `_matchOpposingLimits`
- [ ] Add `_fillOpposingBucket`
- [ ] Add `_findMomentumClosure`
- [ ] Add `_sumMomentumBucketsPlaintext`
- [ ] Add `_sumMomentumBucketsEnc`
- [ ] Add `_predicateCrossesTickPlaintext`
- [ ] Add `_allocateVirtualSlicing`
- [ ] Rewrite `_processTriggeredOrders` → `_processOrdersAndSwap`
- [ ] Add `_estimateFinalTick` (or accept tick hint from caller)
- [ ] Update `swapForPool` to call new pipeline
- [ ] Update `swapEncrypted` to call new pipeline
- [ ] Update `_beforeSwap` / `_afterSwap` hooks
- [ ] Add plaintext liquidity tracking (optional but recommended)
- [ ] Import `FullMath` for overflow-safe math
- [ ] Write unit tests for bitmap operations
- [ ] Write integration tests for full swap flow
- [ ] Test with negative ticks extensively
- [ ] Measure contract size delta
- [ ] Deploy to testnet and verify
