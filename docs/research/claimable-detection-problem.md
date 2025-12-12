# Claimable Position Detection Problem

## Status: Research Needed

## Problem Statement

The frontend cannot reliably detect when a user has claimable proceeds from limit orders. The current approach relies on `BucketFilled` events, but these only emit when a bucket is **completely** filled (liquidity = 0). Partial fills are not detectable.

## Current Detection Approach (Frontend)

```typescript
// useAllPositions.ts lines 200-202
const hasClaimableProceeds =
  realizedProceedsHandle > 0n ||    // Encrypted handle check (unreliable)
  hasUnclaimedFilledBucket;          // BucketFilled event && !Claimed event
```

### Why This Fails

1. **`realizedProceedsHandle > 0n`** - This checks if an encrypted handle exists, NOT if the value is > 0. Encrypted zeros (ENC_ZERO) have non-zero handles.

2. **`hasUnclaimedFilledBucket`** - Only works for COMPLETE fills. If a bucket is partially filled, no `BucketFilled` event is emitted.

## Contract State (All Encrypted - euint128)

### Bucket Structure
```solidity
struct Bucket {
    euint128 totalShares;       // Total shares from all depositors
    euint128 liquidity;         // Remaining unfilled liquidity
    euint128 proceedsPerShare;  // Accumulator - increases on fills
    euint128 filledPerShare;    // Accumulator - increases on fills
    bool initialized;
}
```

### User Position Structure
```solidity
struct UserPosition {
    euint128 shares;                    // User's share of the bucket
    euint128 proceedsPerShareSnapshot;  // Snapshot at deposit time
    euint128 filledPerShareSnapshot;    // Snapshot at deposit time
    euint128 realizedProceeds;          // Only updated on claim/autoClaim
}
```

### Claimable Calculation (On-Chain)
```
claimable = shares * (bucket.proceedsPerShare - position.proceedsPerShareSnapshot)
```

This formula works for ANY fill amount (partial or complete). The problem is the frontend can't read these encrypted values.

## What Information is Publicly Available?

| Data | Accessible? | Notes |
|------|-------------|-------|
| Deposit events | Yes | Indexed by poolId, user, tick |
| BucketFilled events | Yes | Only emits on COMPLETE fill |
| Claim events | Yes | Indexed by poolId, user, tick |
| bucket.initialized | Yes | Boolean |
| bucket.proceedsPerShare | Handle only | Can't read actual value |
| position.shares | Handle only | Can't read actual value |
| position.realizedProceeds | Handle only | Can't read actual value |

## Research Questions

1. **How can we detect partial fills?**
   - Emit a new event on any fill (not just complete)?
   - Store a public "fill count" or "last fill block"?
   - Compare bucket.proceedsPerShare handle to position snapshot handle?

2. **How can the user know their claimable amount?**
   - They can always call `claim()` - it will transfer whatever is available
   - But UI should show estimated amount before claiming
   - Requires FHE decryption flow

3. **What changes are needed?**
   - Contract: New events? Public state?
   - Frontend: New detection logic
   - UX: Show "may have claimable" vs "definitely has claimable"?

## Files Involved

- `contracts/src/FheatherXv6.sol` - `_fillBucketAgainstAMM`, `_updateBucketOnFill`
- `frontend/src/hooks/useAllPositions.ts` - Position detection
- `frontend/src/hooks/useActiveOrders.ts` - Similar logic

## Next Steps

1. Analyze swap flow to understand when/how buckets get filled
2. Determine if partial fills are possible in current design
3. Design solution for reliable claimable detection
4. Implement and test
