# Matching System Audit: FheatherXv8Mixed.sol

## Overview

This audit compares the Solidity implementation in `FheatherXv8Mixed.sol` against the mathematical specification in `momentum.py` to verify correctness of the order matching system.

**Audit Date:** 2024
**Contract:** FheatherXv8Mixed.sol (Mixed FHE:ERC20 or ERC20:FHE pairs)
**Reference:** momentum.py (Python proof-of-concept)

---

## Executive Summary

| Category | Status | Notes |
|----------|--------|-------|
| Momentum Closure Algorithm | ⚠️ **CRITICAL ISSUE** | Uses binary search - may find phantom fixed points |
| Limit Order Matching | ✅ Correct | Same as FHE version |
| Single AMM Execution | ✅ Correct | Batches all orders into one swap |
| Virtual Slicing | ⚠️ **DIFFERS** | Pro-rata allocation, not priority-based |
| Liquidity Cap | ❌ **MISSING** | No 100% liquidity cap check |
| Division Safety | ✅ Handled | Uses safeDenominator pattern |
| Mixed Token Handling | ✅ Correct | Properly handles FHE/ERC20 asymmetry |

---

## CRITICAL: Binary Search for Momentum Closure

### Location
`_findMomentumClosure()` lines 438-479

### Issue
**IDENTICAL to FheatherXv8FHE.sol** - Uses binary search which fails due to the Phantom Fixed Point Problem.

```solidity
for (uint8 i = 0; i < BINARY_SEARCH_ITERATIONS; i++) {
    if (lo >= hi) break;
    int24 mid = lo + (hi - lo) / 2;
    mid = (mid / TICK_SPACING) * TICK_SPACING;
    // ... binary search logic
}
```

### Why This Is Wrong

As proven in `momentum.py`, the tick-after function is a **STEP FUNCTION**. Binary search skips over valid fixed points between step discontinuities.

**The Phantom Fixed Point Problem:**
- Multiple mathematically valid fixed points can exist
- Only ONE is reachable via the actual cascade process
- Binary search may find an unreachable "phantom" fixed point

### Impact
Same as FHE version:
- Over-activation of momentum orders
- Incorrect final price
- User receives less output than entitled

### Recommendation
Replace with iterative tick expansion (see FHE audit for details).

---

## Mixed Token Handling

### Location
Various locations, particularly `claim()` lines 726-764

### Analysis

The Mixed contract correctly handles the asymmetry between FHE and ERC20 tokens:

```solidity
if (proceedsIsFherc20) {
    // FHERC20 proceeds - direct encrypted transfer
    FHE.allow(totalProceeds, proceedsToken);
    IFHERC20(proceedsToken)._transferEncrypted(msg.sender, totalProceeds);
} else {
    // ERC20 proceeds - queue async decrypt, user calls claimErc20() after
    FHE.decrypt(totalProceeds);
    pendingErc20Claims[poolId][msg.sender][tick][side] = PendingErc20Claim({...});
}
```

### Status: ✅ CORRECT

The two-step claim process for ERC20 proceeds is necessary because:
1. Encrypted amount must be decrypted first
2. Decryption is async in FHE systems
3. User calls `claimErc20()` after decrypt resolves

This is a valid pattern for mixed FHE/ERC20 systems.

---

## Deposit Token Validation

### Location
`deposit()` lines 642-644

### Analysis

```solidity
bool inputIsFherc20 = side == BucketSide.SELL ? state.token0IsFherc20 : state.token1IsFherc20;
if (!inputIsFherc20) revert InputTokenMustBeFherc20();
```

### Status: ✅ CORRECT

The contract correctly enforces that deposits must be in the FHERC20 token, not the ERC20 token. This is necessary because:
1. Bucket liquidity is stored encrypted
2. ERC20 amounts can't be encrypted without conversion
3. Maintaining privacy requires FHERC20 deposits

---

## LP Functions: Plaintext vs Encrypted

### Location
`addLiquidity()` lines 789-838
`removeLiquidity()` lines 841-874

### Analysis

Unlike FheatherXv8FHE which uses encrypted LP operations, Mixed uses **plaintext LP**:

```solidity
// Plaintext LP calculation
if (reserves.totalLpSupply == 0) {
    lpAmount = FheatherMath.sqrt256(amount0 * amount1);
} else {
    uint256 lpAmount0 = (amount0 * reserves.totalLpSupply) / reserves.reserve0;
    uint256 lpAmount1 = (amount1 * reserves.totalLpSupply) / reserves.reserve1;
    lpAmount = lpAmount0 < lpAmount1 ? lpAmount0 : lpAmount1;
}
```

### Status: ✅ APPROPRIATE

For mixed pairs where one token is ERC20 (plaintext), LP operations can use plaintext math. The ERC20 amounts are already visible, so encrypting LP shares provides no additional privacy.

---

## Issues Shared with FHE Version

The following issues from the FHE audit apply equally here:

### 1. Missing 100% Liquidity Cap
No check for `bucket.liquidity > original_reserve`. Orders exceeding pool size could activate.

### 2. Virtual Slicing Uses Pro-Rata
```solidity
euint128 bucketOutput = FHE.div(FHE.mul(bucket.liquidity, totalOutput), safeDenom);
```
All participants get same average price, not priority-based allocation.

### 3. Fixed Momentum Estimate
```solidity
uint256 momentumEstimate = uint256(bucketCount) * 1e18;
```
Uses fixed 1e18 per bucket instead of actual liquidity.

### 4. Limit Order Uses Tick Price
Matches at bucket's tick price, not current AMM spot price.

---

## Unique Considerations for Mixed Pairs

### Privacy Implications

In mixed pairs, one side is always visible (ERC20). This affects what can be kept private:

| Operation | Privacy Status |
|-----------|----------------|
| User swap input | Visible if ERC20 side |
| User swap output | Visible if ERC20 side |
| Limit order deposits | Private (must be FHERC20) |
| Limit order proceeds | May require decrypt for ERC20 claims |
| LP amounts | Plaintext (one side visible anyway) |

### Async Claim Pattern

The `claimErc20()` pattern introduces additional complexity:

```solidity
struct PendingErc20Claim {
    euint128 encryptedAmount;
    address token;
    uint256 requestedAt;
    bool pending;
}
```

**Potential Issue:** If user never calls `claimErc20()`, funds remain locked in contract. Consider adding:
- Timeout mechanism
- Admin rescue function
- Event for off-chain monitoring

---

## Summary of Required Changes

### Critical (Must Fix)
1. **Replace binary search with iterative expansion** - Same as FHE version

### High Priority
2. **Add 100% liquidity cap check** - Same as FHE version
3. **Fix momentum estimate** - Use actual liquidity values

### Medium Priority
4. **Add claim timeout/rescue** - Prevent stuck ERC20 claims
5. **Document privacy model** - Make clear what's visible in mixed pairs

### Low Priority
6. **Consider virtual curve slicing** - If priority-based allocation is desired

---

## Comparison: FHE vs Mixed

| Feature | FheatherXv8FHE | FheatherXv8Mixed |
|---------|----------------|------------------|
| Token Types | Both FHERC20 | One FHERC20, one ERC20 |
| LP Operations | Encrypted | Plaintext |
| Claim Process | Direct transfer | Two-step for ERC20 proceeds |
| Deposit Restriction | Any token | FHERC20 only |
| Privacy Level | Full | Partial (ERC20 visible) |
| Momentum Closure | Binary search ❌ | Binary search ❌ |
| Liquidity Cap | Missing ❌ | Missing ❌ |

Both contracts share the same core matching logic and thus have the same critical issues.

---

## Appendix: momentum.py Compliance Checklist

| Requirement | FHE | Mixed |
|-------------|-----|-------|
| Fixed-point iteration (not binary search) | ❌ | ❌ |
| Limit orders: no AMM impact | ✅ | ✅ |
| Limit orders: match at spot price | ⚠️ | ⚠️ |
| Momentum orders: trigger on tick cross | ✅ | ✅ |
| Momentum orders: 100% slippage (by design) | ✅ | ✅ |
| Single AMM execution | ✅ | ✅ |
| Virtual curve slicing priority | ❌ | ❌ |
| 100% liquidity cap | ❌ | ❌ |
| Division safety | ✅ | ✅ |
| Deterministic ordering | ⚠️ | ⚠️ |
