# FheatherXv4 Audit

This document audits FheatherXv4 against the vision and FheatherXv3 reference implementation to identify gaps and required changes.

---

## Iteration 1: Structural Comparison

### Architecture Difference

| Aspect | FheatherXv3 | FheatherXv4 |
|--------|-------------|-------------|
| **Type** | Standalone DEX | Uniswap v4 Hook |
| **Swap Handling** | Custom `swap()` function | Relies on `afterSwap` callback |
| **Pool Management** | Single token pair per contract | Multiple pools via PoolId |
| **Token Storage** | `token0`, `token1` immutable | Per-pool in `PoolState` |

### Core Functions Comparison

| Function | FheatherXv3 | FheatherXv4 | Gap |
|----------|-------------|-------------|-----|
| `deposit()` | ✅ Full implementation with deadline, maxTickDrift | ✅ Basic implementation | Missing deadline, maxTickDrift params |
| `withdraw()` | ✅ Full implementation | ✅ Basic implementation | Similar |
| `claim()` | ✅ Full implementation | ✅ Basic implementation | Similar |
| `exit()` | ✅ Combined withdraw + claim | ❌ Missing | **Need to add** |
| `swap()` | ✅ Custom implementation with FHE bucket matching | ❌ **Missing** | **Critical gap** |
| Fee collection | ✅ Applied in swap, with timelock | ⚠️ Storage exists, not applied | **Need to implement** |

### Hook Implementation Analysis

**Current FheatherXv4 Hook Permissions:**
```solidity
beforeSwap: false,          // Not intercepting swaps
afterSwap: true,            // Only observing
beforeSwapReturnDelta: false,  // Not modifying swap
afterSwapReturnDelta: false,   // Not modifying swap
```

**Problem:** With these permissions, FheatherXv4 cannot implement custom swap logic. It only observes swaps that happen through Uniswap's standard AMM - which won't work with FHERC20 encrypted buckets.

**Required Change:** Must use `beforeSwap: true` with `beforeSwapReturnDelta: true` to take over swap execution.

---

## Iteration 2: Missing Swap Logic

### What FheatherXv3 `swap()` Does

1. Takes plaintext input amount from user
2. Iterates through buckets matching limit orders
3. Uses FHE math to:
   - Calculate bucket value in input token terms
   - Determine fill amounts
   - Update bucket accumulators (proceedsPerShare, filledPerShare)
   - Track remaining input and total output
4. Applies protocol fee (5 bps default)
5. Transfers output token to user
6. Updates plaintext reserves for price estimation

### What FheatherXv4 `_afterSwap` Does

1. Calls `_processLimitOrders()` which:
   - Iterates through ticks with `_findNextActiveTick()`
   - Calls `_matchBucket()` for each bucket
2. `_matchBucket()` updates accumulators but:
   - ❌ Doesn't actually transfer tokens
   - ❌ Doesn't track input/output amounts
   - ❌ Doesn't apply fees

### Critical Gap

FheatherXv4's swap logic is **non-functional**. The `_matchBucket` function updates state but:
- Never receives actual swap input
- Never sends actual swap output
- Never applies protocol fee

---

## Iteration 3: Missing Fee Implementation

### FheatherXv3 Fee System

```solidity
// Storage
uint256 public protocolFeeBps = 5;        // 0.05%
address public feeCollector;
uint256 public pendingFeeBps;
uint256 public feeChangeTimestamp;
uint256 public constant FEE_CHANGE_DELAY = 2 days;

// In swap()
uint256 fee = amountOut * protocolFeeBps / 10000;
amountOut -= fee;
if (fee > 0 && feeCollector != address(0)) {
    tokenOut.safeTransfer(feeCollector, fee);
}

// Admin functions
queueProtocolFee(uint256 _feeBps)   // Queue with timelock
applyProtocolFee()                   // Apply after timelock
setFeeCollector(address)             // Set collector
```

### FheatherXv4 Fee System

```solidity
// Storage (in PoolState)
uint256 protocolFeeBps;  // Set to 5 in afterInitialize

// Admin functions
setProtocolFee(PoolId, uint256)  // No timelock!
setFeeCollector(address)

// Fee application
// ❌ MISSING - fee is never deducted or collected
```

### Gaps

1. **No fee deduction** in swap/claim
2. **No timelock** on fee changes (user protection)
3. **No events** for fee changes
4. **Per-pool fees** but never used

---

## Iteration 4: Limit Order Logic Verification

### Deposit Logic Comparison

**FheatherXv3:**
- ✅ Deadline check
- ✅ Tick spacing validation
- ✅ Tick range validation
- ✅ Tick price initialization check
- ✅ Current tick drift protection (maxTickDrift)
- ✅ Auto-claim existing proceeds
- ✅ Initialize bucket if needed
- ✅ Update bucket totals
- ✅ Update user position with snapshots
- ✅ FHE permissions
- ✅ Transfer via `transferFromEncryptedDirect`

**FheatherXv4:**
- ❌ No deadline check
- ✅ Tick spacing validation
- ✅ Tick range validation
- ❌ No tick price initialization check
- ❌ No current tick drift protection
- ✅ Auto-claim existing proceeds (simpler)
- ✅ Initialize bucket if needed
- ✅ Update bucket totals
- ✅ Update user position with snapshots
- ✅ FHE permissions
- ✅ Transfer via `transferFromEncryptedDirect`

### Claim Logic Comparison

**FheatherXv3:**
- ✅ Calculate current proceeds
- ✅ Add realized proceeds
- ✅ Reset realized proceeds
- ✅ Update snapshots
- ✅ Transfer correct token (opposite of deposit)

**FheatherXv4:**
- ✅ Calculate current proceeds (simpler calculation)
- ✅ Add realized proceeds
- ✅ Reset realized proceeds
- ✅ Update snapshots
- ✅ Transfer correct token

### Withdraw Logic Comparison

**FheatherXv3:**
- ✅ Calculate unfilled amount
- ✅ Clamp to requested amount
- ✅ Update position shares
- ✅ Update bucket totals and liquidity
- ✅ Transfer deposit token back

**FheatherXv4:**
- ✅ Calculate unfilled (using different approach)
- ✅ Clamp to requested amount
- ✅ Update position shares
- ⚠️ Updates bucket totals but calculation differs
- ✅ Transfer deposit token back

---

## Iteration 5: Final Completeness Check

### Missing Features Summary

| Feature | Priority | Notes |
|---------|----------|-------|
| Custom swap with beforeSwap hook | **Critical** | Core functionality broken without this |
| Protocol fee deduction | **High** | Revenue mechanism |
| Fee timelock | **Medium** | User protection |
| `exit()` function | **Medium** | UX convenience |
| Deadline parameter in deposit | **Low** | Nice to have |
| maxTickDrift parameter | **Low** | Price protection |
| Fee change events | **Low** | Transparency |

### Additional Observations

1. **Bitmap implementation differs** - v4 uses simpler approach, may need review
2. **Tick price calculation** - v4 uses formula vs v3's lookup table
3. **Reserve tracking** - v4 tracks per-pool, v3 global
4. **Position storage** - v4 adds PoolId dimension

### Vision Alignment Check

Per `/docs/VISION.md`:
- "FheatherX operates as a Uniswap v4 Hook" ✅
- "The `afterSwap` hook handles matching automatically" ❌ Currently broken
- "The proceeds-per-share accumulator model ensures all LPs receive fair share" ✅ Logic exists

Per `/docs/token-pair-support.md`:
- "Swap: Any token combination allowed" ❌ Swap not working
- "Place Limit Order: Input token must be FHERC20" ✅ Enforced by `InEuint128` param
- Protocol fee should be charged on swaps ❌ Not implemented

---

## Conclusion

**FheatherXv4 is approximately 60% complete.** The limit order placement, position tracking, and bucket management are functional, but the core swap mechanism is broken and fees are not collected.

The contract needs significant changes to be production-ready. See `implementation-checklist.md` for the detailed implementation plan.
