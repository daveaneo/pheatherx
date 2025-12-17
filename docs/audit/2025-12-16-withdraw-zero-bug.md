# Withdraw Zero Bug - No Revert When Withdrawing Empty Position

**Date:** 2025-12-16
**Severity:** LOW (UX issue, no fund loss)
**Affected Contracts:** FheatherXv8FHE.sol, FheatherXv8Mixed.sol

## Summary

The `withdraw()` function allows users to withdraw from an already-empty position without reverting. This causes:
1. Successful-looking transactions that do nothing
2. UI confusion when users can repeatedly "withdraw" the same position
3. Wasted gas on no-op transactions

## Root Cause

The withdraw function calculates `withdrawAmount = min(requestedAmount, unfilledShares)`. If `unfilledShares` is 0 (already withdrawn), the function proceeds to:
- Subtract 0 from bucket totals (no-op)
- Subtract 0 from position shares (no-op)
- Transfer 0 tokens (succeeds silently)
- Emit Withdraw event (misleading)

### Current Implementation (Buggy)

```solidity
// FheatherXv8Mixed.sol:967-998
function withdraw(
    PoolId poolId,
    int24 tick,
    BucketSide side,
    InEuint128 calldata encryptedAmount
) external whenNotPaused {
    // ... validation ...

    euint128 unfilledShares = BucketLib.calculateUnfilled(position, bucket, ENC_ZERO, ENC_PRECISION);
    euint128 withdrawAmount = FHE.select(FHE.lt(amount, unfilledShares), amount, unfilledShares);
    // ^^^ If unfilledShares is 0, withdrawAmount is 0 - NO CHECK FOR THIS

    bucket.totalShares = FHE.sub(bucket.totalShares, withdrawAmount);  // 0 - 0 = 0
    bucket.liquidity = FHE.sub(bucket.liquidity, withdrawAmount);      // 0 - 0 = 0
    position.shares = FHE.sub(position.shares, withdrawAmount);        // 0 - 0 = 0

    IFHERC20(withdrawToken)._transferEncrypted(msg.sender, withdrawAmount);  // Transfer 0 tokens

    emit Withdraw(poolId, msg.sender, tick, side);  // Still emits!
}
```

## Impact

1. **User Confusion:** Transaction shows "success" but nothing happened
2. **Wasted Gas:** ~200k+ gas for a no-op
3. **UI Issues:** Position remains in "Active Orders" until we check Withdraw events
4. **Misleading Events:** Withdraw events emitted for 0-amount withdrawals

## Proof of Concept

Transaction that withdrew 0: `0x189eac05cf82bdbfa30174e243bfdda2148c64366d39629f91d60cea1e582909` (Arbitrum Sepolia)

1. User deposits 10 tokens at tick 69060
2. User withdraws full amount (success)
3. User withdraws again (also "success" but 0 tokens transferred)
4. User can repeat indefinitely

## Recommended Fix

### Option 1: Revert on Zero Withdrawal (Recommended)

```solidity
function withdraw(...) external whenNotPaused {
    // ... existing code ...

    euint128 unfilledShares = BucketLib.calculateUnfilled(position, bucket, ENC_ZERO, ENC_PRECISION);

    // NEW: Check if there's anything to withdraw
    // Since we can't directly compare encrypted values, we need to track this differently
    // Option A: Use a plaintext "hasPosition" flag
    // Option B: Require shares handle to be non-zero (but handle != 0 doesn't mean value != 0)

    euint128 withdrawAmount = FHE.select(FHE.lt(amount, unfilledShares), amount, unfilledShares);

    // Option C: Decrypt and check (expensive but accurate)
    // This would require async decrypt flow which complicates things

    // ... rest of function ...
}
```

### Option 2: Track Position Existence with Plaintext Flag

Add a plaintext `bool hasPosition` to UserPosition struct:

```solidity
struct UserPosition {
    euint128 shares;
    euint128 proceedsPerShareSnapshot;
    euint128 filledPerShareSnapshot;
    euint128 realizedProceeds;
    bool hasPosition;  // NEW: plaintext flag
}
```

Then in deposit: `position.hasPosition = true;`
And in withdraw: Check and reset `position.hasPosition = false;` when fully withdrawn.

### Option 3: Frontend-Only Fix (Current Workaround)

The UI now tracks Withdraw events and filters out positions where:
- A Withdraw event exists
- The Withdraw occurred after the last Deposit

This is implemented in `useActiveOrders.ts` as of 2025-12-16.

## Files Modified (Frontend Workaround)

1. `frontend/src/hooks/useActiveOrders.ts`
   - Added v8 Withdraw event signature
   - Query Withdraw events in parallel with Deposits
   - Filter out positions where Withdraw block >= Deposit block

## Recommendation

Option 2 (plaintext flag) was considered but **not implemented** because:
- The flag cannot be cleared after withdrawal (encrypted shares can't be compared to zero)
- Without clearing, it only prevents never-deposited users from 0-withdrawing
- The actual bug (repeated 0-withdrawal after full withdrawal) remains unfixed

## Resolution (2025-12-16)

**Frontend-only fix applied** (Option 3):
- The UI tracks Withdraw events and filters out positions where withdrawal occurred after the last deposit
- This prevents the UX issue of showing a "Withdraw" button for already-withdrawn positions
- The smart contract allows 0-withdrawals but this is harmless (no fund loss, just wasted gas)

### Why No Smart Contract Fix
A proper smart contract fix would require one of:
1. Decrypting shares after withdrawal to check if zero (expensive async operation)
2. Tracking plaintext deposit/withdraw totals (leaks privacy information)
3. Clearing `hasPosition` on every withdraw (breaks partial withdrawals)

None of these tradeoffs are acceptable for a low-severity UX issue.
