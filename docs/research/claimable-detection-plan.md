# Claimable Position Detection - Research Required

## Status: RESEARCH IN PROGRESS

## Problem

User placed a limit order, traded to trigger it, pool reserves changed, but "Your Positions" doesn't show claimable tokens.

## Key Issue Identified

**`BucketFilled` events only emit when a bucket is COMPLETELY filled.** Partial fills are not detectable with current approach.

## Research Documents Created

1. **`docs/research/claimable-detection-problem.md`**
   - Full problem statement
   - Current detection approach and why it fails
   - Contract state analysis (all encrypted values)
   - Research questions to answer

2. **`docs/research/partial-fill-detection.md`**
   - How the fill flow works
   - What "partial fill" means in this context
   - Investigation steps
   - Potential solutions (fill counter, last fill block, etc.)

## Core Challenge

All bucket/position values are **encrypted (euint128)**:
- `bucket.proceedsPerShare` - accumulator, increases on fills
- `position.shares` - user's share of bucket
- `position.proceedsPerShareSnapshot` - snapshot at deposit time

**Claimable = shares × (bucket.proceedsPerShare - snapshot)**

Frontend can't read these values - only encrypted handles. Checking `handle > 0n` tells you a value EXISTS, not that it's non-zero.

## Next Steps

1. Debug current issue: Is `BucketFilled` being emitted? Is frontend finding it?
2. Design solution for partial fill detection
3. Consider adding public state (fill counter or last fill block)
4. Update frontend detection logic

## Files to Modify (TBD after research)

- `contracts/src/FheatherXv6.sol` - May need new events/state
- `frontend/src/hooks/useAllPositions.ts` - Detection logic
- `frontend/src/hooks/useActiveOrders.ts` - Similar logic
