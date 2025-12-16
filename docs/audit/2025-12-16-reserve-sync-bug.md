# Reserve Sync Bug - Stale Reserves Used in Swaps and View Functions

**Date:** 2025-12-16
**Severity:** HIGH
**Affected Contracts:** FheatherXv8FHE.sol, FheatherXv8Mixed.sol

## Summary

Two related bugs cause the contract to use stale reserve values:

1. **View functions** (`getReserves`, `getCurrentTick`, `getQuote`) return cached values without checking for resolved async decryptions
2. **Swap execution** uses stale reserves for calculations, only harvesting at the END instead of the START

## Root Cause

### Current Implementation (Buggy)

```solidity
// FheatherXv8FHE.sol:1214-1217
function getReserves(PoolId poolId) external view returns (uint256, uint256) {
    PoolReserves storage r = poolReserves[poolId];
    return (r.reserve0, r.reserve1);  // BUG: Returns cached values only
}
```

### The Flow

1. **`addLiquidity()`** is called:
   - Updates encrypted reserves (`encReserve0`, `encReserve1`)
   - Calls `_requestReserveSync()` which:
     - First harvests any already-resolved decrypts
     - Creates new `PendingDecrypt` entry with current encrypted reserves
     - Calls `FHE.decrypt()` to initiate async decryption
     - Increments `nextRequestId`

2. **Async decryption completes** (off-chain CoFHE resolves the ciphertext)

3. **`getReserves()` is called**:
   - Returns `r.reserve0` and `r.reserve1` from storage
   - **DOES NOT** check if new decryptions have resolved via `FHE.getDecryptResultSafe()`
   - Returns stale values (often 0 for new pools)

4. **Plaintext reserves only update when**:
   - `trySyncReserves()` is explicitly called
   - Another state-changing operation (`addLiquidity`, `removeLiquidity`, swap) triggers `_harvestResolvedDecrypts()`

## The Bug

The contract has a perfectly good binary search function `_findNewestResolvedDecrypt()` that:
- Searches pending decrypts from `lastResolvedId` to `nextRequestId - 1`
- Uses `FHE.getDecryptResultSafe()` to check if each decrypt has resolved
- Returns the newest resolved values

**But `getReserves()` doesn't use it!**

The function `_findNewestResolvedDecrypt()` is `internal view` and can be called from view functions. The fix is simple.

## Impact

1. **UI shows "No liquidity"** after adding liquidity until someone manually calls `trySyncReserves()`
2. **Price shows 0** on Trade page because price is calculated from reserves
3. **Quotes are incorrect** - `getQuote()` also uses stale reserves
4. **Poor UX** - Users think their liquidity addition failed
5. **Requires manual intervention** - Someone must call `trySyncReserves()` or do another operation

## Proof of Concept

```bash
# 1. Add liquidity via cofhejs script (succeeds)
# 2. Wait for CoFHE decryption to resolve (30+ seconds)
# 3. Check reserves
cast call $HOOK "getReserves(bytes32)(uint256,uint256)" $POOL_ID
# Returns: 0, 0  (STALE!)

# 4. Manually trigger sync
cast send $HOOK "trySyncReserves(bytes32)" $POOL_ID

# 5. Check reserves again
cast call $HOOK "getReserves(bytes32)(uint256,uint256)" $POOL_ID
# Returns: 20000000000000000000, 20000000000  (NOW CORRECT)
```

## Recommended Fix

### Option 1: Make getReserves() Use Binary Search (Recommended)

```solidity
/// @notice Get the current reserves for a pool
/// @dev Automatically checks for resolved async decrypts
function getReserves(PoolId poolId) external view returns (uint256, uint256) {
    // Use binary search to find newest resolved values
    (, uint256 val0, uint256 val1) = _findNewestResolvedDecrypt(poolId);
    return (val0, val1);
}
```

This is safe because:
- `_findNewestResolvedDecrypt()` is already `view`-compatible
- `FHE.getDecryptResultSafe()` is a view function
- No state is modified, just reading the latest resolved values

### Option 2: Add getReservesLive() Function

If backwards compatibility is needed, add a new function:

```solidity
/// @notice Get reserves with live async decrypt checking
function getReservesLive(PoolId poolId) external view returns (uint256, uint256) {
    (, uint256 val0, uint256 val1) = _findNewestResolvedDecrypt(poolId);
    return (val0, val1);
}
```

### Option 3: Auto-sync in Uniswap Hook Callbacks

Add `_harvestResolvedDecrypts()` to `_beforeSwap()` so that any swap attempt updates reserves first. This is already partially implemented but relies on swaps happening.

## Files to Modify

1. `contracts/src/FheatherXv8FHE.sol` - Lines 1214-1217
2. `contracts/src/FheatherXv8Mixed.sol` - Lines 1268-1271

## Bug #2: Swap Uses Stale Reserves

### Current Flow (Buggy)

```solidity
function _executeSwapWithMomentum(...) internal returns (uint256 amountOut) {
    PoolReserves storage reserves = poolReserves[poolId];  // Gets STALE values

    // ... uses reserves.reserve0/reserve1 throughout for:
    // - Momentum closure calculation (_findMomentumClosure)
    // - Tick calculation (_iterateOnce, _tickAfterSwapPlaintext)
    // - Output estimation (FheatherMath.estimateOutput)
    // - Reserve cap checks (_sumMomentumBucketsEnc)

    // Only NOW at the END does it harvest:
    _requestReserveSync(poolId);  // This calls _harvestResolvedDecrypts AFTER the swap
}
```

### Impact of Swap Bug

1. **Wrong momentum closure** - Tick calculations based on stale reserves
2. **Wrong output amounts** - `estimateOutput()` uses stale reserves
3. **Wrong reserve caps** - 100% liquidity cap check uses stale values
4. **Incorrect price movement** - Final tick based on stale starting reserves

### Fix for Swap

```solidity
function _executeSwapWithMomentum(...) internal returns (uint256 amountOut) {
    // HARVEST FIRST to get fresh reserves
    _harvestResolvedDecrypts(poolId);

    PoolReserves storage reserves = poolReserves[poolId];  // Now has fresh values
    // ... rest of swap logic
}
```

## Related Functions Also Affected

These functions use stale `r.reserve0` and `r.reserve1`:

1. **`getCurrentTick()`** - Returns wrong tick based on stale reserves
2. **`getQuote()`** - Returns wrong swap quote
3. **`_executeSwapWithMomentum()`** - Uses stale reserves for all calculations
4. **`_findMomentumClosure()`** - Uses stale reserves for tick projection
5. **`_iterateOnce()`** - Uses stale reserves for tick calculation
6. **`_sumMomentumBucketsEnc()`** - Uses stale reserves for cap check

All should be updated to use fresh reserves.

## Testing

After fix, verify:
1. `getReserves()` returns non-zero immediately after decryption resolves (no manual sync needed)
2. `getCurrentTick()` returns correct tick
3. `getQuote()` returns accurate quotes
4. UI shows correct liquidity and price without manual intervention

## Additional Notes

### Why ETH Sepolia Synced But ARB Sepolia Didn't

ETH Sepolia synced because we manually called `trySyncReserves()`. ARB Sepolia's decryption likely resolved too, but without the manual sync call, `getReserves()` still returns 0.

### CoFHE Decryption Timing

The async decryption typically takes 10-60 seconds depending on network conditions. The contract should handle this gracefully by always checking for resolved decrypts in view functions.
