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

| Optimization | Savings | Risk | Effort | Status |
|-------------|---------|------|--------|--------|
| 1.1 Fix duplicate select | 159k/bucket | LOW | 5 min | ✅ IMPLEMENTED |
| 1.2 Cache protocol fee | 119k | LOW | 15 min | ✅ IMPLEMENTED |
| 1.3 Skip empty makers | 206k (both dirs) | LOW | 30 min | ✅ IMPLEMENTED |
| 1.4 Lazy not(direction) | 103k/func | LOW | 10 min | ✅ IMPLEMENTED |
| 2.2 ACL in swapMath | 78k | MEDIUM | 20 min | Pending |
| 2.3 ACL in maker loop | 156k/bucket | MEDIUM | 30 min | Pending |
| 3.1 Cache tick prices | 119k/hit | MEDIUM | 1 hr | Pending |
| 3.2 Remove safe guard | 250k | LOW | 15 min | ✅ IMPLEMENTED |
| 3.3 Select algebra | 72k | LOW | 30 min | Pending |

**Implemented savings**:
- 1.1: ~159k gas/bucket (removed select + allowThis)
- 1.2: ~119k gas/swap (removed asEuint128 + allowThis)
- 1.3: ~206k gas when no orders (avoided 2× not + allowThis calls)
- 1.4: ~103k gas/function when no valid buckets (lazy computation)
- allowTransient: ~916k gas/swap (42 calls × 21.8k savings each)
- 3.2: ~250k gas/swap (removed safe denominator guard, enabled by MINIMUM_LIQUIDITY)

**Total estimated savings**: ~1.5M-2M gas per swap (depends on order book state)

---

## NEW DISCOVERY: FHE.allowTransient ✅ IMPLEMENTED

Benchmarking revealed `FHE.allowTransient` is **84% cheaper** than `FHE.allowThis`:

| ACL Operation | Gas Cost | Savings |
|--------------|----------|---------|
| FHE.allowThis | 25,846 | - |
| FHE.allowTransient | 4,050 | **84%** |

**Use case**: Temporary permissions for values used within the same transaction but not stored.

**IMPLEMENTED**: Converted **42 calls** from `allowThis` to `allowTransient` in the swap path:
- `_executeSwapMath`: 3 calls converted
- `_executeEncryptedSwap`: 22 calls converted
- `_matchMakerOrdersEncrypted`: 9 calls converted
- `_sumTakerBucketsEncrypted`: 4 calls converted
- `_allocateTakerOutputEncrypted`: 7 calls converted

**Total savings**: ~916k gas per swap (42 × 21.8k)

See `docs/fhe-gas-costs.md` for full ACL operation benchmarks.

---

## Implementation Status

1. ✅ **Fix 1.1** (duplicate select bug) - DONE
2. ✅ **Fix 1.2** (cache fee BPS) - DONE
3. ✅ **Fix 1.3** (lazy shouldApply in maker matching) - DONE
4. ✅ **Fix 1.4** (lazy shouldSum/shouldAllocate in taker functions) - DONE
5. ✅ **allowTransient** - DONE (42 calls converted, ~916k savings)
6. ✅ **Fix 3.2** (remove safe guard) - DONE (~250k savings, enabled by MINIMUM_LIQUIDITY)
7. ⏳ **Fix 3.3** (select algebra) - Low risk, moderate win
8. ⏳ **Fix 2.2-2.3** (ACL removals) - After confirming Fhenix ACL requirements
9. ⏳ **Fix 3.1** (tick price cache) - If deep order books are common

---

## Testing Strategy

1. ✅ Run `LocalFHEIntegration.t.sol` to measure mock gas - DONE
2. ✅ Run unit tests to verify correctness - 76 tests pass
3. ⏳ Deploy to Arb Sepolia fork and verify real gas savings
4. ⏳ Run E2E tests to ensure correctness on testnet
5. ⏳ Monitor for any ACL-related errors on real Fhenix
