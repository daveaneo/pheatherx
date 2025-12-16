# FheatherX v3 Design Audit - Version 2

> **Audit Date:** December 2024
> **Document Reviewed:** 03-implementation-v2.md
> **Auditor Persona:** Senior Solidity Engineer & Cryptographic Systems Expert
> **Status:** Design Phase - Pre-Implementation

---

## Executive Summary

Implementation v2 successfully addresses the critical issues from v1. The "proceeds per share" accumulator model is the correct approach, and separating buy/sell buckets eliminates token accounting ambiguity. However, several new issues have emerged from the more complex implementation.

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| FHE Math Precision | 1 | 1 | - | - |
| Division by Zero | 1 | - | 1 | - |
| State Consistency | - | 2 | 1 | - |
| Token Flow | - | 1 | 1 | - |
| Gas/UX | - | - | 2 | 2 |

**Overall:** Significant improvement. Critical issues reduced from 3 to 2, but new precision/division issues introduced.

---

## Critical Issues

### C1: FHE Division Precision Loss Causes Cumulative Rounding Errors

**Location:** `_updateBucketOnFill()`, `_calculateProceeds()`, `_calculateUnfilled()`

**Problem:** The current math does not account for FHE division truncation properly:

```solidity
// In _updateBucketOnFill:
euint128 proceedsPerShareIncrease = FHE.div(
    FHE.mul(proceedsAmount, ENC_PRECISION),
    bucket.totalShares
);
```

When `totalShares` doesn't divide evenly into `proceedsAmount * PRECISION`, the remainder is **permanently lost**. Over many fills, this adds up.

**Example:**
- `totalShares = 3`
- `proceedsAmount = 10`
- `proceedsPerShareIncrease = (10 * 1e18) / 3 = 3.333...e18` (truncated to `3333333333333333333`)
- Lost per fill: `0.333...e18` worth of proceeds
- After 1000 fills: `333e18` lost (significant!)

**Impact:** Users receive slightly less than their fair share. Protocol accumulates "dust" that belongs to no one.

**Fix:** Track remainder and distribute it fairly:

```solidity
struct Bucket {
    // ... existing fields ...
    euint128 proceedsRemainder;  // Accumulated remainder from divisions
}

function _updateBucketOnFill(...) internal {
    euint128 numerator = FHE.mul(proceedsAmount, ENC_PRECISION);
    euint128 quotient = FHE.div(numerator, bucket.totalShares);
    euint128 remainder = FHE.sub(numerator, FHE.mul(quotient, bucket.totalShares));

    bucket.proceedsPerShare = FHE.add(bucket.proceedsPerShare, quotient);
    bucket.proceedsRemainder = FHE.add(bucket.proceedsRemainder, remainder);

    // When remainder exceeds totalShares, distribute 1 unit
    ebool canDistribute = FHE.gte(bucket.proceedsRemainder, bucket.totalShares);
    euint128 extraDistribution = FHE.select(canDistribute, FHE.asEuint128(1), ENC_ZERO);
    bucket.proceedsPerShare = FHE.add(bucket.proceedsPerShare, extraDistribution);
    bucket.proceedsRemainder = FHE.select(
        canDistribute,
        FHE.sub(bucket.proceedsRemainder, bucket.totalShares),
        bucket.proceedsRemainder
    );
}
```

---

### C2: Division by Zero When Bucket is Empty

**Location:** `_updateBucketOnFill()`, line with `FHE.div(..., bucket.totalShares)`

**Problem:** If `bucket.totalShares` is zero (all users withdrew), the swap will attempt to divide by zero:

```solidity
euint128 proceedsPerShareIncrease = FHE.div(
    FHE.mul(proceedsAmount, ENC_PRECISION),
    bucket.totalShares  // ← Could be zero!
);
```

**Impact:** Transaction reverts (FHE.div with zero denominator behavior depends on implementation). Worse: if FHE doesn't revert, produces garbage value.

**Scenario:**
1. Alice deposits 10 into bucket
2. Alice withdraws 10 (bucket now has 0 totalShares but may still be in bitmap)
3. Swap tries to fill this bucket → Division by zero

**Fix:** Skip buckets with zero shares:

```solidity
function _updateBucketOnFill(...) internal {
    // Guard: skip if no shares
    ebool hasShares = FHE.gt(bucket.totalShares, ENC_ZERO);

    // Calculate with guard (use 1 as denominator if zero to avoid error)
    euint128 safeTotalShares = FHE.select(hasShares, bucket.totalShares, FHE.asEuint128(1));
    euint128 proceedsPerShareIncrease = FHE.div(
        FHE.mul(proceedsAmount, ENC_PRECISION),
        safeTotalShares
    );

    // Only apply if has shares
    proceedsPerShareIncrease = FHE.select(hasShares, proceedsPerShareIncrease, ENC_ZERO);
    bucket.proceedsPerShare = FHE.add(bucket.proceedsPerShare, proceedsPerShareIncrease);
    // ...
}
```

Better yet, remove bucket from bitmap when totalShares reaches zero (requires async decrypt).

---

## High Severity Issues

### H1: Auto-Claim Proceeds Not Actually Transferred

**Location:** `deposit()` function, auto-claim section

**Problem:** The auto-claim logic calculates `existingProceeds` and adds it to `pendingProceeds`, but never transfers the tokens:

```solidity
// Auto-claim calculates proceeds
euint128 existingProceeds = _calculateProceeds(pos, bucket);

// Adds to pending
pos.pendingProceeds = FHE.add(pos.pendingProceeds, existingProceeds);
// ...

// BUT: No transfer happens here!
// Proceeds are only transferred in claim() or exit()
```

This is actually **intentional** (deferred transfer), but creates a subtle bug:

**The Bug:** If user deposits, then deposits again before claiming, their `pendingProceeds` gets overwritten because the snapshot is reset:

```solidity
// Second deposit resets snapshot
pos.proceedsPerShareSnapshot = bucket.proceedsPerShare;
```

After this reset, `_calculateProceeds()` returns zero for the period before this snapshot, but `pendingProceeds` should have captured it. However, if bucket fills happen between the two deposits, the accounting gets confused.

**Fix:** Either:
1. Transfer immediately on auto-claim (costs gas)
2. Track a separate "realized but unclaimed" counter that's never reset

```solidity
struct UserPosition {
    euint128 shares;
    euint128 proceedsPerShareSnapshot;
    euint128 filledPerShareSnapshot;
    euint128 realizedProceeds;    // Accumulated from auto-claims, NEVER reset except on claim()
}
```

---

### H2: Swap Direction Logic May Be Inverted

**Location:** `swap()` function, bucket selection logic

**Problem:** The comment says one thing, but the logic might do another:

```solidity
// zeroForOne (selling token0) → fills BUY buckets (people wanting to buy token0)
// !zeroForOne (selling token1) → fills SELL buckets (people wanting to sell token0 for token1)
BucketSide side = zeroForOne ? BucketSide.BUY : BucketSide.SELL;
```

Let's trace through:
- **User wants to sell token0 (zeroForOne=true)**
- They need to find someone willing to **buy token0** with token1
- That's a **BUY bucket** → BucketSide.BUY ✓

- **User wants to sell token1 (zeroForOne=false)**
- They need to find someone willing to **sell token0** for token1
- That's a **SELL bucket** → BucketSide.SELL ✓

The logic appears correct, but the price math inside is suspect:

```solidity
if (zeroForOne) {
    // Buying from BUY bucket: they have token1, want token0
    bucketValueInInput = _divPrecision(bucket.liquidity, tickPrice);
}
```

Wait—**BUY bucket** depositors deposited **token1** (they want to buy token0). So `bucket.liquidity` is in token1. When a swapper sells token0, they're giving token0 and want token1. The bucket's token1 liquidity should be consumed.

The value conversion seems off. Let me trace:
- BUY bucket at tick 60 (price 1.006): Users deposited token1 to buy token0
- Swapper sells 100 token0
- At price 1.006: 100 token0 = 100.6 token1
- Bucket should give 100.6 token1 to swapper

But the code does:
```solidity
bucketValueInInput = _divPrecision(bucket.liquidity, tickPrice);
// = bucket.liquidity / 1.006
// If liquidity = 100 token1, bucketValueInInput = 99.4
```

This converts token1 to token0 terms, which is correct for comparing against `remainingInput` (which is token0). But then:

```solidity
fillAmountNative = _mulPrecision(fillValueInInput, tickPrice);
// = fillValueInInput * 1.006
```

If `fillValueInInput = 99.4` (token0), then `fillAmountNative = 100` (token1). This is correct!

**Verdict:** Logic is actually correct, but very confusing. Recommend adding extensive comments.

**Fix:** Add clear documentation with worked examples:

```solidity
// WORKED EXAMPLE - zeroForOne = true (selling token0 for token1):
// - Tick 60 = price 1.006 (1 token0 = 1.006 token1)
// - BUY bucket has 1006 token1 deposited (users want to buy ~1000 token0)
// - Swapper wants to sell 500 token0
//
// Step 1: bucketValueInInput = 1006 / 1.006 = 1000 token0 capacity
// Step 2: fillValueInInput = min(500, 1000) = 500 token0
// Step 3: fillAmountNative = 500 * 1.006 = 503 token1 consumed from bucket
// Step 4: outputAmount = 503 token1 to swapper
//
// Result: Swapper gets 503 token1 for 500 token0 ✓
```

---

### H3: Tick Bitmap Traversal Function Missing

**Location:** `swap()` function calls `_findNextTick()` which is not defined

**Problem:** The implementation references `_findNextTick(bitmap, currentTick, zeroForOne)` but this function is not provided:

```solidity
int24 nextTick = _findNextTick(bitmap, currentTick, zeroForOne);
```

**Fix:** Implement the function using TickBitmap library:

```solidity
function _findNextTick(
    TickBitmap.State storage bitmap,
    int24 currentTick,
    bool searchUp
) internal view returns (int24) {
    // Use existing TickBitmap.nextInitializedTick() or similar
    (int24 nextTick, bool found) = bitmap.nextInitializedTickWithinOneWord(
        currentTick,
        TICK_SPACING,
        searchUp
    );

    if (!found) {
        return searchUp ? type(int24).max : type(int24).min;
    }
    return nextTick;
}
```

---

## Medium Severity Issues

### M1: Division by Zero in Price Math

**Location:** `_divPrecision()` when `priceScaled = 0`

**Problem:**
```solidity
function _divPrecision(euint128 amount, uint256 priceScaled) internal view returns (euint128) {
    return FHE.div(
        FHE.mul(amount, ENC_PRECISION),
        FHE.asEuint128(priceScaled)  // ← Could be 0 if tick is extreme
    );
}
```

**Fix:** Validate tick range or add guard:

```solidity
function _divPrecision(euint128 amount, uint256 priceScaled) internal view returns (euint128) {
    require(priceScaled > 0, "Invalid price");
    // ...
}
```

---

### M2: Bucket Initialization Creates Zero Handles

**Location:** `deposit()` bucket initialization

**Problem:**
```solidity
bucket.proceedsPerShare = ENC_ZERO;
bucket.filledPerShare = ENC_ZERO;
bucket.totalShares = ENC_ZERO;
bucket.liquidity = ENC_ZERO;
```

In FHE systems, assigning the same encrypted zero to multiple storage slots might cause issues with handle management. Each slot should have its own unique ciphertext.

**Fix:**
```solidity
bucket.proceedsPerShare = FHE.asEuint128(0);  // Fresh encryption
bucket.filledPerShare = FHE.asEuint128(0);
bucket.totalShares = FHE.asEuint128(0);
bucket.liquidity = FHE.asEuint128(0);
```

Note: This costs more gas but ensures unique handles.

---

### M3: Missing Validation in Exit

**Location:** `exit()` function

**Problem:** No check that user actually has a position:

```solidity
function exit(int24 tick, BucketSide side) external nonReentrant returns (...) {
    UserPosition storage pos = positions[msg.sender][tick][side];
    // No check that pos.shares > 0
```

If user calls exit on a non-existent position, they get 0 tokens transferred (which is fine) but gas is wasted and events are emitted.

**Fix:**
```solidity
function exit(...) external nonReentrant returns (...) {
    UserPosition storage pos = positions[msg.sender][tick][side];

    // Early exit if no position
    if (euint128.unwrap(pos.shares) == 0) {
        return (ENC_ZERO, ENC_ZERO);
    }
    // ... rest of function
}
```

---

## Low Severity Issues

### L1: Price Approximation Is Too Inaccurate

**Location:** `_getTickPriceScaled()`

**Problem:** The linear approximation is inaccurate for large ticks:

```solidity
// Approximate: price ≈ PRECISION * (1 + tick * 0.0001)
return PRECISION + uint256(tickInt) * PRECISION / 10000;
```

For tick 6000: `1 + 0.6 = 1.6`, but actual `1.0001^6000 ≈ 1.822`. Error: 14%.

**Fix:** Use a lookup table for common ticks or better approximation:

```solidity
// Pre-computed prices for tick spacing 60
mapping(int24 => uint256) internal tickPrices;

constructor() {
    // Initialize common tick prices
    tickPrices[0] = 1e18;
    tickPrices[60] = 1006017e15;      // 1.0001^60
    tickPrices[120] = 1012072e15;     // 1.0001^120
    tickPrices[-60] = 994020e15;      // 1.0001^-60
    // etc.
}
```

---

### L2: Events Don't Include Amounts

**Location:** All event emissions

**Problem:** Events like `Deposit`, `Withdraw`, `Claim` don't include amounts:

```solidity
emit Deposit(msg.sender, tick, side);  // No amount!
```

This makes off-chain tracking difficult.

**Fix:** Add encrypted amount hash or plaintext estimate:

```solidity
event Deposit(
    address indexed user,
    int24 indexed tick,
    BucketSide indexed side,
    bytes32 amountHash  // Hash of encrypted amount for correlation
);
```

---

### L3: No Getter for User Position

**Location:** Missing from interface

**Problem:** No way to query full position state.

**Fix:**
```solidity
function getPosition(
    address user,
    int24 tick,
    BucketSide side
) external view returns (
    euint128 shares,
    euint128 proceedsPerShareSnapshot,
    euint128 filledPerShareSnapshot,
    euint128 pendingProceeds
) {
    UserPosition storage pos = positions[user][tick][side];
    return (
        pos.shares,
        pos.proceedsPerShareSnapshot,
        pos.filledPerShareSnapshot,
        pos.pendingProceeds
    );
}
```

---

### L4: Constructor Doesn't Initialize ENC_PRECISION

**Location:** Contract constants

**Problem:** `ENC_PRECISION` is declared but not shown being initialized:

```solidity
euint128 internal immutable ENC_PRECISION;
```

**Fix:** Initialize in constructor:

```solidity
constructor(address _token0, address _token1) {
    token0 = IFHERC20(_token0);
    token1 = IFHERC20(_token1);

    ENC_ZERO = FHE.asEuint128(0);
    ENC_PRECISION = FHE.asEuint128(uint128(PRECISION));

    FHE.allowThis(ENC_ZERO);
    FHE.allowThis(ENC_PRECISION);
}
```

---

## Recommendations

### R1: Add Comprehensive NatSpec Documentation

Every function should have:
- `@notice` - What it does
- `@dev` - Implementation details and math
- `@param` - Each parameter
- `@return` - Return values

### R2: Create a Math Library

Extract all precision math into a separate library:

```solidity
library FHEMath {
    function mulPrecision(euint128 a, uint256 b, euint128 precision) internal returns (euint128);
    function divPrecision(euint128 a, uint256 b, euint128 precision) internal returns (euint128);
    function safeDivPrecision(euint128 a, euint128 b, euint128 precision) internal returns (euint128);
}
```

### R3: Consider Fee Mechanism

No fee collection mechanism exists. Consider:
- Protocol fee on swaps
- LP fee distribution

### R4: Add Pause Mechanism

For emergency situations:

```solidity
bool public paused;

modifier whenNotPaused() {
    require(!paused, "Paused");
    _;
}

function pause() external onlyOwner {
    paused = true;
}
```

---

## Verification Checklist

- [ ] C1: Add remainder tracking for division precision
- [ ] C2: Guard against division by zero in bucket updates
- [ ] H1: Fix auto-claim to use non-resetting counter
- [ ] H2: Add worked examples to swap documentation
- [ ] H3: Implement _findNextTick function
- [ ] M1: Add price validation
- [ ] M2: Use fresh encryptions for bucket init
- [ ] M3: Add early return for empty positions
- [ ] L1: Implement tick price lookup table
- [ ] L2: Add amount hash to events
- [ ] L3: Add position getter
- [ ] L4: Initialize ENC_PRECISION in constructor

---

## Conclusion

v2 is a significant improvement over v1. The core architecture is now sound:
- Proceeds-per-share accumulator: ✓ Correct
- Separate buy/sell buckets: ✓ Correct
- Auto-claim on deposit: ✓ Good idea, needs refinement

The remaining issues are primarily:
1. FHE division precision (solvable with remainder tracking)
2. Edge cases (division by zero, missing functions)
3. Documentation and UX improvements

Estimated additional work: 1 day to fix critical/high issues.
