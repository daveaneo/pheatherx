# FheatherXv8Mixed.sol Comprehensive Audit

**Audit Date:** 2025-12-15
**Contract:** `contracts/src/FheatherXv8Mixed.sol`
**Version:** v8
**Auditor:** Claude Code

---

## Executive Summary

| Category | Status | Severity |
|----------|--------|----------|
| Binary Search Momentum Closure | CRITICAL | Must fix before production |
| Missing 100% Liquidity Cap | HIGH | Security vulnerability |
| Fixed Momentum Estimate | HIGH | Incorrect behavior |
| Stuck ERC20 Claims | MEDIUM | User funds at risk |
| Pro-Rata vs Priority Slicing | MEDIUM | Differs from spec |
| Limit Order Price Semantics | MEDIUM | Differs from spec |
| Mixed Token Handling | PASS | Correctly implemented |
| ERC20 Claim Flow | PASS | Two-step async pattern |
| Division Safety | PASS | Correctly handled |

---

## Contract Overview

FheatherXv8Mixed is a Uniswap v4 Hook implementing:
- **Mixed privacy pools** (ERC20:FHERC20 pairs only)
- **Hybrid AMM + Limit Orders** with momentum activation
- **Dual-track reserves** (encrypted + plaintext cache)
- **Two-step ERC20 claims** (async decrypt required)
- **Plaintext LP operations** (one token visible anyway)

### Key Differences from v8FHE
| Feature | v8FHE | v8Mixed |
|---------|-------|---------|
| Token Types | Both FHERC20 | One FHERC20, one ERC20 |
| LP Operations | Encrypted | Plaintext |
| Claim Process | Direct | Two-step for ERC20 proceeds |
| Deposit Restriction | Any token | FHERC20 only |
| Privacy Level | Full | Partial |

---

## CRITICAL ISSUES

### 1. Binary Search Phantom Fixed Point Problem

**Location:** `_findMomentumClosure()` lines 438-479

**Issue:** IDENTICAL to v8FHE - Uses binary search which fails on step functions.

```solidity
for (uint8 i = 0; i < BINARY_SEARCH_ITERATIONS; i++) {
    if (lo >= hi) break;
    int24 mid = lo + (hi - lo) / 2;
    mid = (mid / TICK_SPACING) * TICK_SPACING;
    // ...
}
```

**Impact:** Same as v8FHE - over-activation, wrong price, user loss.

**Recommendation:** Replace with iterative tick expansion (see v8FHE audit).

---

### 2. Missing 100% Liquidity Cap

**Location:** `_sumMomentumBucketsEnc()` lines 520-550

**Issue:** No check prevents oversized orders from activating.

**Impact:** Same as v8FHE - griefing, extreme slippage.

**Recommendation:** Add reserve limit check.

---

### 3. Fixed Momentum Estimate

**Location:** `_findMomentumClosure()` line 463

```solidity
uint256 momentumEstimate = uint256(bucketCount) * 1e18;
```

**Issue:** Uses fixed 1e18 instead of actual liquidity.

**Recommendation:** Sum actual bucket liquidity.

---

## HIGH PRIORITY ISSUES

### 4. Stuck ERC20 Claims

**Location:** `claim()` lines 753-763, `claimErc20()` lines 768-783

**Current Flow:**
```solidity
// Step 1: claim() queues decrypt
FHE.decrypt(totalProceeds);
pendingErc20Claims[poolId][msg.sender][tick][side] = PendingErc20Claim({
    encryptedAmount: totalProceeds,
    token: proceedsToken,
    requestedAt: block.number,
    pending: true
});

// Step 2: User must call claimErc20() after decrypt resolves
```

**Issue:** If user never calls `claimErc20()`:
- Funds remain locked in contract
- No timeout mechanism
- No admin rescue function

**Impact:** User funds permanently stuck.

**Recommendation:**
```solidity
// Add timeout-based rescue
function rescueStuckClaim(
    PoolId poolId,
    address user,
    int24 tick,
    BucketSide side
) external onlyOwner {
    PendingErc20Claim storage pending = pendingErc20Claims[poolId][user][tick][side];
    require(pending.pending, "No pending claim");
    require(block.number > pending.requestedAt + RESCUE_DELAY, "Too early");

    (uint256 amount, bool ready) = FHE.getDecryptResultSafe(pending.encryptedAmount);
    require(ready, "Decrypt not ready");

    delete pendingErc20Claims[poolId][user][tick][side];
    IERC20(pending.token).safeTransfer(user, amount);
}
```

---

## MEDIUM PRIORITY ISSUES

### 5. Pro-Rata vs Priority Slicing

**Location:** `_allocateVirtualSlicing()` lines 552-590

**Issue:** Same as v8FHE - uses pro-rata instead of priority-based allocation.

### 6. Limit Order Price Semantics

**Location:** `_fillOpposingBucket()` lines 402-436

**Issue:** Same as v8FHE - matches at tick price instead of AMM spot price.

---

## PASSING CHECKS

### Mixed Token Handling
**Status:** PASS

Correctly detects and handles token type asymmetry:
```solidity
bool t0IsFhe = _isFherc20(token0Addr);
bool t1IsFhe = _isFherc20(token1Addr);
if (t0IsFhe == t1IsFhe) revert NotMixedPair();
```

### Deposit Token Validation
**Status:** PASS

Enforces FHERC20 deposits only:
```solidity
bool inputIsFherc20 = side == BucketSide.SELL ? state.token0IsFherc20 : state.token1IsFherc20;
if (!inputIsFherc20) revert InputTokenMustBeFherc20();
```

### ERC20 Claim Flow
**Status:** PASS (with stuck claim caveat)

Two-step pattern is correct for FHE→plaintext boundary:
1. `claim()` queues decrypt
2. `claimErc20()` transfers after decrypt

### Plaintext LP Operations
**Status:** PASS

Appropriate for mixed pairs since one side is visible:
```solidity
lpAmount = FheatherMath.sqrt256(amount0 * amount1);  // First deposit
lpAmount = min(amt0/res0, amt1/res1) * supply;       // Subsequent
```

### Division Safety
**Status:** PASS

Same safeDenominator pattern as v8FHE.

---

## Privacy Analysis

| Operation | Privacy Status | Reason |
|-----------|----------------|--------|
| Swap input (ERC20 side) | Visible | ERC20 transfers public |
| Swap input (FHERC20 side) | Private | Encrypted |
| Swap output | Visible | Calculated from plaintext |
| Limit order deposits | Private | Must be FHERC20 |
| Limit order proceeds | May need decrypt | If ERC20 proceeds |
| LP amounts | Plaintext | One side visible anyway |

**Key Insight:** Privacy is limited by the ERC20 side, but limit order amounts remain encrypted - this protects against MEV even without full privacy.

---

## Architecture Analysis

### Claim Flow Diagram

```
User places FHERC20 limit order
         ↓
Order fills, proceeds in ERC20
         ↓
User calls claim()
         ↓
Contract queues FHE.decrypt()
         ↓
Emits Erc20ClaimQueued event
         ↓
[Wait for CoFHE async decrypt ~1-2 blocks]
         ↓
User calls claimErc20()
         ↓
Contract reads decrypted value
         ↓
Transfers ERC20 to user
         ↓
Emits Erc20ClaimCompleted event
```

### Token Type Detection

```solidity
function _isFherc20(address token) internal view returns (bool) {
    (bool success, ) = token.staticcall(
        abi.encodeWithSelector(bytes4(keccak256("balanceOfEncrypted(address)")), address(0))
    );
    return success;
}
```

**Note:** Checks for `balanceOfEncrypted` selector existence.

---

## Data Structures

### PendingErc20Claim (NEW in v8Mixed)
```solidity
struct PendingErc20Claim {
    euint128 encryptedAmount;
    address token;
    uint256 requestedAt;
    bool pending;
}
```

### PoolState (Extended)
```solidity
struct PoolState {
    address token0;
    address token1;
    bool token0IsFherc20;  // NEW
    bool token1IsFherc20;  // NEW
    bool initialized;
    uint256 protocolFeeBps;
}
```

---

## Recommendations Summary

| Priority | Issue | Action |
|----------|-------|--------|
| CRITICAL | Binary search | Replace with iterative expansion |
| HIGH | Liquidity cap | Add 100% reserve check |
| HIGH | Momentum estimate | Use actual liquidity values |
| MEDIUM | Stuck claims | Add timeout/rescue mechanism |
| MEDIUM | Virtual slicing | Document or implement priority |
| MEDIUM | Limit price | Consider AMM spot price |
| LOW | Privacy docs | Document partial privacy model |

---

## Related Audits

- `docs/audit/matching_audit_mixed.md` - Detailed matching algorithm analysis
- `docs/audit/2025-12-15-v8FHE-audit.md` - Full FHE variant
- `docs/audit/2025-12-15-v8-tests-audit.md` - Test coverage analysis
