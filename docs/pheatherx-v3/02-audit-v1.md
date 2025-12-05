# PheatherX v3 Design Audit

> **Audit Date:** December 2024
> **Document Reviewed:** PHEATHERX_V3_IMPLEMENTATION.md
> **Status:** Design Phase - Pre-Implementation

---

## Executive Summary

The v3 design represents a significant architectural improvement over v2, correctly identifying that bucketed liquidity with O(1) gas per bucket is the right approach for FHE-based DEXs. However, the implementation details contain several critical issues that must be addressed before coding begins.

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Pro-Rata Math | 2 | 1 | - | - |
| State Management | 1 | 2 | 1 | - |
| Token Handling | 1 | 1 | 1 | - |
| Security | - | 2 | 1 | 1 |
| Gas/Privacy | - | 1 | 2 | - |

---

## Critical Issues

### C1: Pro-Rata Math is Fundamentally Broken

**Location:** `claim()` function, lines 483-491

**Problem:** The current claim logic doesn't actually calculate pro-rata shares:

```solidity
// Current (BROKEN):
euint128 totalFillsSinceEntry = FHE.sub(bucket.cumulativeFilled, pos.entryFilled);
euint128 totalProceedsSinceEntry = FHE.sub(bucket.cumulativeProceeds, pos.entryProceeds);
euint128 userProceeds = totalProceedsSinceEntry; // ← WRONG! Gives ALL proceeds to ONE user
```

**Impact:** If Alice and Bob both have positions in the same bucket, whoever claims first gets ALL the proceeds. This is a complete loss of funds for other depositors.

**Fix:** Must track `totalShares` per bucket and calculate user's proportion:

```solidity
struct Bucket {
    euint128 liquidity;
    euint128 cumulativeFilled;
    euint128 cumulativeProceeds;
    euint128 totalShares;           // ADD THIS
    euint128 totalSharesAtLastFill; // ADD THIS - snapshot for pro-rata
    bool initialized;
}

function claim(int24 tick) external returns (euint128 proceeds) {
    UserPosition storage pos = positions[msg.sender][tick];
    Bucket storage bucket = buckets[tick];

    // Calculate fills that happened while user was in the bucket
    euint128 fillsDuringPosition = FHE.sub(bucket.cumulativeFilled, pos.entryFilled);

    // User's share of those fills = (userShares / totalSharesAtFill) * fillsDuringPosition
    // This requires tracking totalShares at each fill event OR using a different accumulator model

    // RECOMMENDED: Use "proceeds per share" accumulator model (see recommendation R1)
}
```

---

### C2: Multiple Deposits Overwrite Entry Snapshot

**Location:** `deposit()` function, lines 401-405

**Problem:** When a user deposits a second time into the same bucket, their entry snapshot is overwritten:

```solidity
// Current (BROKEN):
pos.shares = FHE.add(pos.shares, amt);
pos.entryFilled = bucket.cumulativeFilled;      // ← OVERWRITES previous entry!
pos.entryProceeds = bucket.cumulativeProceeds;  // ← OVERWRITES previous entry!
```

**Impact:** Alice deposits 10 ETH. Bucket fills 5 ETH. Alice deposits 5 more ETH. Her `entryFilled` is now updated to the current value, erasing her claim to the first 5 ETH fill. She loses those proceeds.

**Fix:** Either:
1. Disallow multiple deposits (force exit and re-enter), OR
2. Auto-claim before updating entry snapshot, OR
3. Use a different accounting model that doesn't require entry snapshots

```solidity
function deposit(...) external returns (euint128 shares) {
    // Option 2: Auto-claim before deposit
    if (pos.shares > 0) {
        _claimInternal(msg.sender, tick); // Claim existing proceeds first
    }

    // Now safe to update entry snapshot
    pos.entryFilled = bucket.cumulativeFilled;
    pos.entryProceeds = bucket.cumulativeProceeds;
    pos.shares = FHE.add(pos.shares, amt);
    // ...
}
```

---

### C3: Buy vs Sell Buckets Not Separated

**Location:** `deposit()` function, Bucket struct

**Problem:** The design uses a single bucket per tick, but buy and sell orders at the same price are fundamentally different:

- **Sell bucket at tick 60:** Users deposit token0, want token1 when price rises to tick 60
- **Buy bucket at tick 60:** Users deposit token1, want token0 when price falls to tick 60

Combining them in one bucket means:
1. Liquidity accounting is broken (mixing token0 and token1 deposits)
2. Proceeds distribution is impossible (which token do you return?)

**Fix:** Separate buy and sell buckets:

```solidity
// Change bucket key from just tick to (tick, isSell)
mapping(int24 => mapping(bool => Bucket)) public buckets;

// Or encode in the tick itself
// Positive ticks = sell buckets, negative ticks = buy buckets (or vice versa)
```

---

## High Severity Issues

### H1: Withdraw Calculation Uses Wrong Filled Amount

**Location:** `withdraw()` function, lines 523-525

**Problem:**
```solidity
euint128 filledShares = FHE.sub(bucket.cumulativeFilled, pos.entryFilled);
euint128 unfilledShares = FHE.sub(pos.shares, filledShares);
```

This assumes `cumulativeFilled - entryFilled` equals the user's filled shares. But `cumulativeFilled` is a global bucket metric—if Alice deposited 10 and the bucket filled 100 total, this calculation would say Alice has -90 unfilled shares (underflow).

**Fix:** Need to track per-user filled amount or calculate user's proportion of fills:

```solidity
// User's filled = (totalFilled - entryFilled) * (userShares / totalSharesWhenFilled)
// This is complex with FHE. Consider tracking per-user filled directly.
```

---

### H2: No Reentrancy Protection

**Location:** All external functions

**Problem:** Functions like `deposit()`, `claim()`, `withdraw()`, and `exit()` modify state and make external calls (`transferFromEncryptedDirect`) without reentrancy guards.

**Fix:** Add `nonReentrant` modifier to all state-changing external functions, just like v2.

---

### H3: FHERC6909 Missing Infinite Allowance Pattern

**Location:** FHERC6909 `_spendAllowance()`, lines 299-311

**Problem:** Standard ERC-20/6909 allows `type(uint256).max` approval to mean "infinite allowance, don't decrement." The FHE version doesn't handle this:

```solidity
// Current - always decrements
_allowances[owner][spender][id] = FHE.sub(currentAllowance, amount);
```

**Impact:** Users must re-approve after every transaction, degrading UX.

**Fix:** Add infinite allowance check:

```solidity
function _spendAllowance(...) internal {
    euint128 currentAllowance = _allowances[owner][spender][id];

    // Check if infinite allowance (need to define what "max" means in encrypted context)
    // Option: Use a separate `isInfiniteAllowance` bool mapping
    // Option: Skip allowance check entirely for operators (already implemented)

    _allowances[owner][spender][id] = FHE.sub(currentAllowance, amount);
    // ...
}
```

---

### H4: Exit Function Double-Calculates Filled Shares

**Location:** `exit()` function, lines 549-558

**Problem:** `exit()` calls `claim()` which reads `bucket.cumulativeFilled`, then reads it again to calculate unfilled. If state changes between these (reentrancy), the math breaks.

**Fix:** Calculate once and pass to internal functions, or use reentrancy guard.

---

## Medium Severity Issues

### M1: Price Calculation Placeholder

**Location:** `swap()` function, lines 444-450

**Problem:** The price calculation is a placeholder:

```solidity
euint128 bucketValue = FHE.mul(bucket.liquidity, _getTickPrice(nextTick));
euint128 fillAmount = FHE.mul(fillValue, _getTickPriceInverse(nextTick));
euint128 output = fillValue; // ← Just returns input, ignoring price!
```

**Impact:** Swaps won't work correctly—output always equals input regardless of price.

**Fix:** Implement actual price math:

```solidity
// Tick to price: price = 1.0001^tick
// For tick 60: price ≈ 1.006
//
// But FHE can't do floating point. Options:
// 1. Fixed-point math with scaling factor (e.g., 1e18)
// 2. Pre-computed price table for valid ticks
// 3. Approximate using integer ratios

// Example with fixed-point (1e18 scale):
uint256 priceScaled = _getTickPriceScaled(nextTick); // Returns price * 1e18
euint128 outputScaled = FHE.mul(fillAmount, FHE.asEuint128(priceScaled));
euint128 output = FHE.div(outputScaled, FHE.asEuint128(1e18));
```

---

### M2: Bucket Initialization Race Condition

**Location:** `deposit()` function, lines 396-399

**Problem:**
```solidity
if (!bucket.initialized) {
    bucket.initialized = true;
    tickBitmap.setTick(tick);
}
```

If two users deposit into the same tick in the same block (different transactions), both might see `initialized = false` and both call `setTick()`. Depending on bitmap implementation, this could double-set or cause issues.

**Fix:** Check bitmap state directly or use atomic initialization:

```solidity
if (!tickBitmap.isSet(tick)) {
    tickBitmap.setTick(tick);
}
bucket.initialized = true;
```

---

### M3: No Bucket Deactivation When Empty

**Location:** `withdraw()` function

**Problem:** When all liquidity is withdrawn from a bucket, `bucket.initialized` remains true and the tick remains in the bitmap. This means swaps will still try to process empty buckets, wasting gas.

**Fix:** Check if bucket is empty after withdrawal and clear from bitmap:

```solidity
function withdraw(...) external returns (euint128 withdrawn) {
    // ... existing logic ...

    // Clean up empty bucket
    ebool isEmpty = FHE.eq(bucket.liquidity, ENC_ZERO);
    // Problem: Can't branch on encrypted bool for plaintext bitmap update
    // Solution: Use FHE.decrypt() async, or accept the gas waste
}
```

---

### M4: Missing Slippage Protection on Deposit

**Location:** `deposit()` function

**Problem:** Users deposit at a specific tick but have no guarantee the price hasn't moved significantly by the time their transaction executes. They might deposit into a tick that's about to be crossed immediately.

**Fix:** Add optional deadline and/or price bound parameters:

```solidity
function deposit(
    int24 tick,
    InEuint128 calldata amount,
    InEbool calldata isSell,
    uint256 deadline,           // ADD
    int24 maxTickDrift          // ADD - revert if current tick moved too far
) external returns (euint128 shares) {
    require(block.timestamp <= deadline, "Expired");
    require(abs(_getCurrentTick() - tick) <= maxTickDrift, "Price moved");
    // ...
}
```

---

## Low Severity Issues

### L1: Events Missing Critical Information

**Location:** FHERC6909 events

**Problem:** The `Transfer` event doesn't include the amount (by design for privacy), but also doesn't include a transaction identifier for off-chain tracking.

**Fix:** Consider adding a nonce or event index:

```solidity
event Transfer(
    address indexed sender,
    address indexed receiver,
    uint256 indexed id,
    uint256 nonce  // For off-chain correlation
);
```

---

### L2: No View Function for User's Claimable Amount

**Location:** Missing from interface

**Problem:** Users can't check how much they can claim without submitting a transaction.

**Fix:** Add view function (returns encrypted value user can decrypt):

```solidity
function getClaimable(address user, int24 tick) external view returns (euint128);
```

---

## Recommendations

### R1: Use "Proceeds Per Share" Accumulator Model

Instead of tracking `cumulativeFilled` and `cumulativeProceeds` globally, use a "proceeds per share" model similar to how staking contracts work:

```solidity
struct Bucket {
    euint128 liquidity;
    euint128 totalShares;
    euint128 proceedsPerShare;  // Accumulated proceeds per 1 share (scaled by 1e18)
    bool initialized;
}

struct UserPosition {
    euint128 shares;
    euint128 proceedsPerShareSnapshot;  // proceedsPerShare at entry
    euint128 claimedProceeds;
}

// On fill:
bucket.proceedsPerShare = FHE.add(
    bucket.proceedsPerShare,
    FHE.div(FHE.mul(proceeds, SCALE), bucket.totalShares)
);

// On claim:
euint128 entitled = FHE.mul(
    pos.shares,
    FHE.sub(bucket.proceedsPerShare, pos.proceedsPerShareSnapshot)
);
entitled = FHE.div(entitled, SCALE);
euint128 available = FHE.sub(entitled, pos.claimedProceeds);
```

This correctly handles:
- Multiple depositors
- Deposits at different times
- Partial fills
- Multiple claims

---

### R2: Separate Buy and Sell Bucket Types

Define clear bucket types:

```solidity
enum BucketType { SELL, BUY }

struct Bucket {
    BucketType bucketType;
    IFHERC20 inputToken;   // Token deposited by LPs
    IFHERC20 outputToken;  // Token received on fill
    euint128 liquidity;
    // ...
}

// Mapping: tick => bucketType => Bucket
mapping(int24 => mapping(BucketType => Bucket)) public buckets;
```

---

### R3: Add Emergency Withdraw Function

For safety, add an owner-callable emergency function:

```solidity
function emergencyWithdraw(int24 tick, address user) external onlyOwner {
    // Return user's unfilled liquidity without pro-rata calculation
    // For use if pro-rata math has a bug
}
```

---

### R4: Consider Plaintext Entry Path

Like v2, consider supporting plaintext deposits for users who don't need full privacy:

```solidity
function depositPlaintext(
    int24 tick,
    uint256 amount,
    bool isSell
) external returns (uint256 shares) {
    // Take plaintext tokens, encrypt internally
    // Simpler UX for users who don't have FHERC20 tokens yet
}
```

---

### R5: Add Comprehensive Invariant Tests

Add tests that verify critical invariants:

```solidity
// Invariant: Sum of all user shares == bucket.totalShares
// Invariant: bucket.liquidity >= sum of all unfilled positions
// Invariant: No user can claim more than their pro-rata share
// Invariant: Late depositors cannot claim pre-deposit fills
```

---

## Open Questions Resolution

### Q1: Tick spacing

**Recommendation:** Start with 60 (same as v2). Can increase later if privacy analysis shows it's needed. Wider spacing = more privacy but worse price execution.

### Q2: Buy vs Sell buckets

**Answer:** Must be separate. See Critical Issue C3. Same tick can have both a buy bucket and a sell bucket.

### Q3: Price representation

**Recommendation:** Use fixed-point math with 1e18 scaling. Pre-compute a lookup table for common tick values to save gas.

### Q4: Executor incentives

**Recommendation:** Swapper is the executor—they get the output tokens as incentive. No additional reward needed. If buckets are deep, the `MAX_BUCKETS_PER_SWAP` limit means subsequent swappers process remaining buckets.

### Q5: Partial bucket sweep

**Answer:** The "proceeds per share" model (R1) handles this correctly. When a bucket partially fills, `proceedsPerShare` increases proportionally, and all users claim their pro-rata share of that partial fill.

---

## Audit Checklist Before Implementation

- [ ] Fix pro-rata math (C1) - CRITICAL
- [ ] Handle multiple deposits (C2) - CRITICAL
- [ ] Separate buy/sell buckets (C3) - CRITICAL
- [ ] Fix withdraw calculation (H1)
- [ ] Add reentrancy guards (H2)
- [ ] Implement actual price math (M1)
- [ ] Add slippage protection (M4)
- [ ] Add view functions for UX (L2)
- [ ] Write invariant tests (R5)
- [ ] Resolve all open questions

---

## Conclusion

The v3 architecture is sound—bucketed liquidity with O(1) gas is the right approach for FHE. However, the pro-rata distribution math has critical bugs that would result in loss of funds. The "proceeds per share" accumulator model (Recommendation R1) should be adopted as the core accounting mechanism before implementation begins.

Estimated additional design work needed: 1-2 days to finalize the accounting model and separate buy/sell bucket handling.
