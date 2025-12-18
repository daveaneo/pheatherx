# FHE Swap Gas Optimization – Verified Implementation Plan

This document provides verified optimization recommendations for reducing gas in the fully encrypted swap pipeline. Each suggestion includes code references, risk assessment, and expected savings.

**Current gas**: ~3.06M (testnet) | **Target**: <2.5M (18% reduction)

---

## Priority 1: Verified Quick Wins (Low Risk, High Impact)

### 1.1 Fix Duplicate FHE.select in `_matchMakerOrdersEncrypted`

**Location**: `FheatherXv8FHE.sol` lines 809 and 814

**Bug Found**: These two lines compute the **exact same value**:
```solidity
// Line 809
euint128 actualOutput = FHE.select(shouldApply, outputFromBucket, ENC_ZERO);
// Line 814
euint128 liquidityReduction = FHE.select(shouldApply, outputFromBucket, ENC_ZERO);
```

**Fix**: Reuse `actualOutput` instead of computing again:
```solidity
euint128 actualOutput = FHE.select(shouldApply, outputFromBucket, ENC_ZERO);
FHE.allowThis(actualOutput);

// Use actualOutput for both purposes
bucket.liquidity = FHE.sub(bucket.liquidity, actualOutput);  // was liquidityReduction
```

**Savings**: ~133k gas per bucket × up to 5 buckets × 2 directions = **up to 1.33M gas**
**Risk**: LOW - pure redundancy removal

---

### 1.2 Cache Encrypted Protocol Fee BPS

**Location**: `FheatherXv8FHE.sol` lines 701-703

**Current code** (every swap):
```solidity
uint256 feeBps = poolStates[poolId].protocolFeeBps;
euint128 encFeeBps = FHE.asEuint128(uint128(feeBps));  // 93k gas!
FHE.allowThis(encFeeBps);  // 26k gas
```

**Fix**: Store encrypted fee in pool state, update only when fee changes:
```solidity
// In PoolState struct, add:
euint128 encProtocolFeeBps;

// In setProtocolFee():
state.encProtocolFeeBps = FHE.asEuint128(uint128(feeBps));
FHE.allowThis(state.encProtocolFeeBps);

// In swap, just use:
euint128 encFeeBps = state.encProtocolFeeBps;
```

**Savings**: ~119k gas per swap (93k + 26k ACL)
**Risk**: LOW - fee changes are rare

---

### 1.3 Skip Maker Matching When Bitmaps Are Empty

**Location**: `FheatherXv8FHE.sol` lines 622-630

**Current code** (always runs):
```solidity
(euint128 remainderIfZeroForOne, euint128 makerOutputIfZeroForOne) =
    _matchMakerOrdersEncrypted(poolId, true, amountIn, startTick, direction);
(euint128 remainderIfOneForZero, euint128 makerOutputIfOneForZero) =
    _matchMakerOrdersEncrypted(poolId, false, amountIn, startTick, direction);
```

**Fix**: Check plaintext bitmaps first:
```solidity
bool hasBuyOrders = _hasAnyBits(buyBitmaps[poolId]);
bool hasSellOrders = _hasAnyBits(sellBitmaps[poolId]);

euint128 userRemainder;
euint128 outputFromMakers;

if (!hasBuyOrders && !hasSellOrders) {
    // Fast path: no orders exist
    userRemainder = amountIn;
    outputFromMakers = ENC_ZERO;
} else {
    // Existing logic
    ...
}
```

**Savings**: ~500-600k gas when no orders exist (common case)
**Risk**: LOW - bitmaps are already plaintext, no privacy leak
**Privacy note**: Order book emptiness is already observable from bitmap state

---

### 1.4 Compute `not(direction)` Once

**Location**: Multiple places compute `FHE.not(direction)`

**Current code**: Computed in `_matchMakerOrdersEncrypted` line 773:
```solidity
ebool shouldApply = evalZeroForOne ? actualDirection : FHE.not(actualDirection);
```

**Fix**: Compute once at swap entry, pass both:
```solidity
// At start of _executeEncryptedSwap:
ebool notDirection = FHE.not(direction);
FHE.allowThis(notDirection);

// Pass both to subroutines
_matchMakerOrdersEncrypted(poolId, true, amountIn, startTick, direction, notDirection);
```

**Savings**: ~77k gas (one less FHE.not per swap)
**Risk**: LOW - simple refactor

---

## Priority 2: ACL Optimization (Medium Risk)

### 2.1 Core ACL Rule

**When `FHE.allowThis()` is required**:
- Value is written to storage
- Value is passed to external contract (FHERC20 transfers)
- Value is decrypted or emitted

**When `FHE.allowThis()` is NOT required**:
- Intermediate values consumed by subsequent FHE operations
- Values that stay within the same contract function

### 2.2 Safe ACL Removals in `_executeSwapMath`

**Location**: `FheatherXv8FHE.sol` lines 522-556

**Current code**:
```solidity
euint128 feeAmount = FHE.div(FHE.mul(amountIn, ENC_SWAP_FEE_BPS), ENC_TEN_THOUSAND);
euint128 amountInAfterFee = FHE.sub(amountIn, feeAmount);
FHE.allowThis(amountInAfterFee);  // REMOVE - intermediate only
...
FHE.allowThis(safeDenominator);  // REMOVE - intermediate only
...
FHE.allowThis(amountOut);  // KEEP if returned, REMOVE if only used internally
```

**Safe to remove**:
- `amountInAfterFee` - only used in next FHE ops
- `safeDenominator` - only used in division
- `numerator`, `denominator` - never stored

**Must keep**:
- `r.encReserve0`, `r.encReserve1` - stored to state

**Savings**: ~78k gas (3 × 26k)
**Risk**: MEDIUM - requires testing on real Fhenix to confirm ACL semantics

---

### 2.3 Safe ACL Removals in Maker Loop

**Location**: `FheatherXv8FHE.sol` lines 790-826

**Current code** (per bucket):
```solidity
FHE.allowThis(encTickPrice);   // MAYBE REMOVE if using cache
FHE.allowThis(capacity);       // REMOVE - intermediate
FHE.allowThis(fill);           // REMOVE - intermediate
FHE.allowThis(outputFromBucket);  // REMOVE - intermediate
FHE.allowThis(actualFill);     // REMOVE - intermediate
FHE.allowThis(actualOutput);   // REMOVE - used for liquidityReduction
FHE.allowThis(liquidityReduction);  // REMOVE after fix 1.1
FHE.allowThis(bucket.liquidity);   // KEEP - stored
FHE.allowThis(remainder);      // KEEP if returned
FHE.allowThis(userOutput);     // KEEP if returned
```

**Savings**: Up to ~156k gas per bucket (6 × 26k)
**Risk**: MEDIUM - test on real Fhenix

---

## Priority 3: Algorithmic Improvements (Higher Risk)

### 3.1 Cache Encrypted Tick Prices

**Location**: `FheatherXv8FHE.sol` line 790

**Current code** (in loop):
```solidity
euint128 encTickPrice = FHE.asEuint128(uint128(FheatherMath.calculateTickPrice(nextTick)));
FHE.allowThis(encTickPrice);
```

**Issue**: Tick price is deterministic - same tick always = same price. No need to re-encrypt.

**Fix**: Add price cache:
```solidity
// New storage
mapping(int24 => euint128) internal encTickPriceCache;
mapping(int24 => bool) internal tickPriceCached;

// Helper function
function _getEncTickPrice(int24 tick) internal returns (euint128) {
    if (!tickPriceCached[tick]) {
        encTickPriceCache[tick] = FHE.asEuint128(uint128(FheatherMath.calculateTickPrice(tick)));
        FHE.allowThis(encTickPriceCache[tick]);
        tickPriceCached[tick] = true;
    }
    return encTickPriceCache[tick];
}
```

**Savings**: ~119k gas per cache hit (93k encrypt + 26k ACL)
**Risk**: MEDIUM - adds storage, but prices never change
**Note**: First swap at each tick pays encryption cost, subsequent swaps are free

---

### 3.2 Remove Safe Denominator Guard

**Location**: `FheatherXv8FHE.sol` lines 539-544

**Current code**:
```solidity
euint128 safeDenominator = FHE.select(
    FHE.gt(denominator, ENC_ZERO),
    denominator,
    ENC_ONE
);
```

**This costs**: ~246k gas (gt: 113k + select: 133k)

**Condition for removal**:
1. Pool reserves are NEVER zero after initialization
2. Zero-input swaps are rejected before FHE

**If both hold**, remove the guard entirely:
```solidity
amountOut = FHE.div(numerator, denominator);  // Direct divide
```

**Savings**: ~246k gas
**Risk**: HIGH - division by zero if invariants violated
**Recommendation**: Add require check for zero input BEFORE FHE operations

---

### 3.3 Reduce Paired Selects with Algebra

**Location**: Various (transfers, reserve updates)

**Current pattern**:
```solidity
euint128 token0Amount = FHE.select(direction, amountIn, ENC_ZERO);
euint128 token1Amount = FHE.select(direction, ENC_ZERO, amountIn);
```

**Alternative pattern**:
```solidity
euint128 token0Amount = FHE.select(direction, amountIn, ENC_ZERO);
euint128 token1Amount = FHE.sub(amountIn, token0Amount);
```

**Savings**: ~18k gas per occurrence (133k select - 115k sub)
**Risk**: LOW - mathematically equivalent
**Occurrences**: ~4 places in swap = ~72k gas

---

## Priority 4: Structural Changes (High Effort)

### 4.1 Use `amountInAfterFee` for Reserve Updates

**Location**: `FheatherXv8FHE.sol` lines 549-550

**Current code**:
```solidity
euint128 newReserveIn = FHE.add(reserveIn, amountIn);  // Uses full amount
```

**Issue**: This credits reserves with the full input including fee. The fee should stay in the pool but this over-accounts liquidity.

**Fix**:
```solidity
euint128 newReserveIn = FHE.add(reserveIn, amountInAfterFee);  // Correct accounting
```

**Savings**: None (same ops)
**Risk**: LOW - improves correctness
**Benefit**: More accurate reserve tracking

---

## Expected Savings Summary

| Optimization | Savings | Risk | Effort |
|-------------|---------|------|--------|
| 1.1 Fix duplicate select | 133k-1.33M | LOW | 5 min |
| 1.2 Cache protocol fee | 119k | LOW | 15 min |
| 1.3 Skip empty makers | 500-600k | LOW | 30 min |
| 1.4 Compute not(dir) once | 77k | LOW | 10 min |
| 2.2 ACL in swapMath | 78k | MEDIUM | 20 min |
| 2.3 ACL in maker loop | 156k/bucket | MEDIUM | 30 min |
| 3.1 Cache tick prices | 119k/hit | MEDIUM | 1 hr |
| 3.2 Remove safe guard | 246k | HIGH | 15 min |
| 3.3 Select algebra | 72k | LOW | 30 min |

**Conservative estimate (low-risk only)**: ~800k-1.9M gas saved
**Optimistic estimate (all changes)**: ~1.5M-2.5M gas saved

**Target**: Reduce from 3.06M to <2.5M is achievable with Priority 1 changes alone.

---

## Implementation Order

1. **Fix 1.1** (duplicate select bug) - Immediate, obvious win
2. **Fix 1.2** (cache fee BPS) - Quick, safe
3. **Fix 1.3** (skip empty makers) - Biggest single win
4. **Fix 1.4** (not(direction) once) - Simple refactor
5. **Test on local mock** to verify savings
6. **Fix 3.3** (select algebra) - Low risk, moderate win
7. **Fix 2.2-2.3** (ACL removals) - After confirming Fhenix ACL requirements
8. **Fix 3.1** (tick price cache) - If deep order books are common
9. **Fix 3.2** (remove guard) - Only if invariants are provably safe

---

## Testing Strategy

1. Run `LocalFHEIntegration.t.sol` to measure mock gas before/after
2. Deploy to Arb Sepolia fork and verify real gas savings
3. Run E2E tests to ensure correctness
4. Monitor for any ACL-related errors on real Fhenix
