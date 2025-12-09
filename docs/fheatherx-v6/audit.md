# FheatherX v6 Documentation Audit

This document identifies issues, inconsistencies, and potential improvements in the v6 implementation and testing documentation.

**Status:** All critical and medium issues have been addressed in implementation.md (updated).

---

## Critical Issues (RESOLVED)

### ISSUE-01: `_beforeSwap` Settlement Logic Error

**File:** `implementation.md` lines 76-111

**Problem:** The proposed `_beforeSwap` code has incorrect token flow:

```solidity
// 3. CRITICAL: Take input tokens from PoolManager
poolManager.take(inputCurrency, address(this), amountIn);

// 4. CRITICAL: Settle output tokens to PoolManager
IERC20(Currency.unwrap(outputCurrency)).transfer(address(poolManager), amountOut);
poolManager.settle(outputCurrency);
```

**Issue:** This takes input FROM PoolManager and sends output TO PoolManager. But:
- User sends input tokens TO the router/PoolManager
- Hook should `take()` those input tokens FROM PoolManager (correct)
- Hook should then `settle()` output tokens TO PoolManager for user (correct)

But the actual flow needs clarification:
1. Router has already received user's input tokens
2. `poolManager.take()` gives those input tokens to the hook
3. Hook must transfer output tokens to PoolManager and call `settle()`

**Recommendation:** Add comment clarifying that `take()` transfers tokens FROM PoolManager TO hook, and `settle()` clears the hook's debt to PoolManager for output tokens.

---

### ISSUE-02: Missing `afterSwap` Hook for Limit Order Triggering

**File:** `implementation.md`

**Problem:** The v6 spec focuses entirely on `_beforeSwap` but doesn't mention `_afterSwap`, which is critical for:
- Detecting price movement after the swap
- Triggering limit orders that crossed the new price
- This is the key mechanism from v5 that must be preserved

**Current v5 behavior:** `_afterSwap` calls `_processTriggeredOrders()` based on the new tick.

**Recommendation:** Add section documenting `_afterSwap` implementation:
```solidity
function _afterSwap(...) internal override returns (bytes4, int128) {
    // Calculate new tick from updated reserves
    int24 newTick = _calculateCurrentTick(poolId);

    // Process any limit orders triggered by price movement
    _processTriggeredOrders(poolId, oldTick, newTick, zeroForOne);

    return (this.afterSwap.selector, 0);
}
```

---

### ISSUE-03: Inconsistent Function Signatures

**File:** `implementation.md` vs actual v5 code

| Function | Doc Signature | v5 Actual |
|----------|---------------|-----------|
| `addLiquidity()` | `(PoolId, uint256, uint256)` | `(uint256, uint256)` (uses defaultPoolId) |
| `removeLiquidity()` | `(PoolId, uint256)` | `(uint256)` (uses defaultPoolId) |

**Issue:** The doc shows PoolId as first parameter but v5 uses implicit defaultPoolId.

**Recommendation:** Decide which pattern v6 will use:
- **Option A:** Explicit PoolId (more flexible, multi-pool ready)
- **Option B:** Implicit defaultPoolId with separate `*ForPool()` variants

---

### ISSUE-04: `swap()` Function Double-Calculates Output

**File:** `implementation.md` lines 186-192

```solidity
// Execute AMM math
_executeSwapMathForPool(poolId, encDirection, encAmountIn);

// Calculate output
amountOut = _estimateOutput(poolId, zeroForOne, amountIn);  // Called AFTER math execution
```

**Problem:** `_estimateOutput()` is called AFTER `_executeSwapMathForPool()` updates reserves. This means:
1. Reserves are updated with the swap
2. `_estimateOutput()` uses the NEW reserves (post-swap)
3. Output calculation is wrong

**Recommendation:** Calculate output BEFORE updating reserves:
```solidity
// Calculate output first (uses current reserves)
amountOut = _estimateOutput(poolId, zeroForOne, amountIn);

// Then execute AMM math (updates reserves)
_executeSwapMathForPool(poolId, encDirection, encAmountIn);
```

---

## Medium Issues (RESOLVED)

### ISSUE-05: Missing `getCurrentTick()` Function

**File:** `testing.md` lines 252, 285, 318

**Problem:** Tests reference `hook.getCurrentTick(poolId)` but this function is not documented in `implementation.md`.

**Recommendation:** Add to implementation.md:
```solidity
/// @notice Get current tick derived from reserves
function getCurrentTick(PoolId poolId) external view returns (int24) {
    PoolReserves storage r = poolReserves[poolId];
    return _reservesToTick(r.reserve0, r.reserve1);
}
```

---

### ISSUE-06: `_isFherc20()` Detection Method Unreliable

**File:** `implementation.md` lines 510-527

```solidity
function _isFherc20(address token) internal view returns (bool) {
    try IFHERC20(token).transferEncryptedDirect.selector returns (bytes4) {
        return true;
    } catch {
        return false;
    }
}
```

**Problem:**
1. `.selector` is not a function call - it's a compile-time constant
2. This will always return the selector without calling the contract
3. The second approach using `staticcall` is better but `encBalanceOf()` may not exist

**Recommendation:** Use ERC165 `supportsInterface()` if FHERC20 implements it, or check for a unique function:
```solidity
function _isFherc20(address token) internal view returns (bool) {
    // Check if token has wrap() function (unique to FHERC20)
    (bool success,) = token.staticcall(
        abi.encodeWithSelector(bytes4(keccak256("wrap(uint256)")), 0)
    );
    return success;
}
```

---

### ISSUE-07: Test Spec Missing `hasOrdersAtTick()` Function

**File:** `testing.md` line 269, 376

**Problem:** Tests use `hook.hasOrdersAtTick(poolId, orderTick, BucketSide.BUY)` but this function doesn't exist in v5 and isn't documented in v6 implementation.

**Recommendation:** Add helper function or use bitmap check:
```solidity
function hasOrdersAtTick(PoolId poolId, int24 tick, BucketSide side) external view returns (bool) {
    Bucket storage bucket = buckets[poolId][tick][side];
    return bucket.initialized && Common.isInitialized(bucket.totalShares);
}
```

---

### ISSUE-08: Optimizer Runs Explanation Incorrect

**File:** `implementation.md` lines 452-456

> Higher `optimizer_runs` tells the optimizer to prioritize runtime gas efficiency for functions that are called frequently. At `999999`, the optimizer assumes functions will be called many times, so it optimizes for smaller deployment size and faster runtime execution.

**Issue:** This is backwards. Higher optimizer_runs = **larger** deployment size but **cheaper** runtime. Lower runs = smaller deployment, more expensive runtime.

**Recommendation:** Correct the explanation:
> `optimizer_runs = 999999` tells the optimizer the contract will be called many times. This produces **larger bytecode** but **cheaper runtime gas**. For contracts near the 24KB limit, consider lower values (200-1000) to reduce deployment size at the cost of slightly higher runtime gas.

---

### ISSUE-09: Missing Error Definitions

**File:** `implementation.md` lines 379, 414

Code uses `revert ZeroAmount()` and `revert PoolNotInitialized()` but these custom errors aren't defined.

**Recommendation:** Add error definitions section:
```solidity
// Custom Errors
error ZeroAmount();
error PoolNotInitialized();
error SlippageExceeded();
error InsufficientLiquidity();
error InvalidTick();
error InputTokenMustBeFherc20();
```

---

### ISSUE-10: Test Spec `calculateProceeds()` Function Undefined

**File:** `testing.md` line 386

```solidity
euint128 proceeds = hook.calculateProceeds(poolId, user, orderTick, BucketSide.BUY);
```

**Problem:** This function doesn't exist in v5. Users claim proceeds via `claim()`, not a separate calculation function.

**Recommendation:** Either:
- Document the new `calculateProceeds()` view function in implementation.md
- Change test to verify proceeds via balance changes after `claim()`

---

## Minor Issues (PARTIALLY RESOLVED)

### ISSUE-11: Inconsistent Pool Type Naming

| Document | Pool C | Pool D |
|----------|--------|--------|
| testing.md | ERC20:FHERC20 | FHERC20:ERC20 |
| token-pair-support.md | ERC20:FHERC20 | (not mentioned) |

**Recommendation:** Standardize naming: always list token0 first, token1 second.

---

### ISSUE-12: Missing Gas Estimates

**File:** Both documents

**Problem:** No gas estimates for FHE operations. This is important for:
- Setting appropriate gas limits in frontend
- User expectations
- Choosing between plaintext vs encrypted paths

**Recommendation:** Add gas estimate table:

| Operation | Estimated Gas | Notes |
|-----------|---------------|-------|
| `addLiquidity()` | ~150k | Plaintext path |
| `addLiquidityEncrypted()` | ~500k+ | FHE math heavy |
| `swap()` via router | ~200k | V4 router overhead |
| `swap()` direct | ~180k | Direct hook call |
| `deposit()` (limit order) | ~300k | Encrypted amount |
| `claim()` | ~100k | |

---

### ISSUE-13: Arbitrum Sepolia CoFHE Support Unverified

**File:** `testing.md` lines 5-16

> **Arbitrum Sepolia is the optimal choice** - fast iteration, cheap tests, real FHE infrastructure.

**Problem:** Claims Fhenix CoFHE is "supported" on Arbitrum Sepolia but this should be verified. The main deployment has been on Ethereum Sepolia.

**Recommendation:**
1. Verify CoFHE coprocessor contract exists on Arbitrum Sepolia
2. If not, either deploy it or revise to use Ethereum Sepolia
3. Add actual CoFHE contract address to checklist

---

### ISSUE-14: `defaultPoolId` Not Defined

**File:** `implementation.md` lines 122, 148

References `defaultPoolId` but it's never declared or explained how it's set.

**Recommendation:** Add to state variables section:
```solidity
/// @notice Default pool for single-pool convenience functions
PoolId public defaultPoolId;

/// @notice Set by first pool initialization or owner
function setDefaultPool(PoolId poolId) external onlyOwner {
    defaultPoolId = poolId;
}
```

---

### ISSUE-15: Remove Liquidity Returns Missing in Testing

**File:** `testing.md` lines 492, 507

```solidity
(uint256 amount0, uint256 amount1) = hook.removeLiquidity(poolId, removeAmount);
```

**Problem:** v5's `removeLiquidity()` may not return amounts - need to verify and align docs.

**Recommendation:** Check v5 signature and update either the doc or plan to add return values in v6.

---

## Documentation Improvements (IMPLEMENTED)

### IMPROVE-01: Add State Diagram for Limit Order Lifecycle - DONE

```
┌─────────┐  deposit()  ┌─────────┐  swap triggers  ┌─────────┐  claim()  ┌─────────┐
│  EMPTY  │ ──────────> │ ACTIVE  │ ─────────────> │ FILLED  │ ────────> │ CLAIMED │
└─────────┘             └─────────┘                └─────────┘           └─────────┘
                              │
                              │ withdraw()
                              ▼
                        ┌───────────┐
                        │ CANCELLED │
                        └───────────┘
```

---

### IMPROVE-02: Add Sequence Diagram for V4 Settlement

Visual showing the token flow between User → Router → PoolManager → Hook → User would clarify the settlement mechanism.

---

### IMPROVE-03: Add Frontend Hook Updates Required

Document which frontend hooks need modification for v6:

| Hook | Change Required |
|------|-----------------|
| `useSwap` | Add direct swap option bypassing router |
| `useCurrentPrice` | Use new `getReserves()` / `getCurrentTick()` |
| `usePlaceOrder` | Add token type validation |
| `useAddLiquidity` | Support mixed pairs |

---

### IMPROVE-04: Add Deployment Script Template

Include a deployment script outline for v6:

```solidity
// script/DeployV6.s.sol
1. Deploy FheatherXv6 with PoolManager address
2. Deploy test tokens (or use existing)
3. Initialize pools via PoolManager.initialize()
4. Seed initial liquidity
5. Export addresses to deployments/arb-sepolia.json
```

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 4 | **RESOLVED** |
| Medium | 6 | **RESOLVED** |
| Minor | 5 | Partially resolved |
| Improvements | 4 | **IMPLEMENTED** |

### Fixes Applied to implementation.md

1. **ISSUE-04**: Fixed `swap()` to calculate output BEFORE updating reserves
2. **ISSUE-02**: Added `_afterSwap` hook with `_processTriggeredOrders()`
3. **ISSUE-01**: Added detailed token flow explanation for V4 settlement
4. **ISSUE-03**: Documented explicit PoolId parameter pattern
5. **ISSUE-05**: Added `getCurrentTick()` and `_getCurrentTick()` functions
6. **ISSUE-06**: Fixed `_isFherc20()` with proper staticcall approach + recommended explicit flags
7. **ISSUE-07**: Added `hasOrdersAtTick()` helper function
8. **ISSUE-08**: Corrected optimizer_runs explanation (higher = larger bytecode, lower runtime gas)
9. **ISSUE-09**: Added custom error definitions section
10. **ISSUE-10**: Added `getClaimableProceeds()` function
11. **ISSUE-12**: Added gas estimates table
12. **ISSUE-14**: Added `defaultPoolId` state variable definition
13. **IMPROVE-01**: Added limit order lifecycle state diagram
14. **IMPROVE-02**: Added V4 settlement token flow diagram
15. **IMPROVE-03**: Added frontend hook updates section
16. **IMPROVE-04**: Added deployment script template

### Remaining Minor Items

- ISSUE-11: Pool naming consistency (testing.md)
- ISSUE-13: Arbitrum Sepolia CoFHE verification (needs real check)
- ISSUE-15: `removeLiquidity()` return values (needs v5 verification)
