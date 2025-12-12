# Partial Fill Detection for Limit Orders

## Overview

When a swap moves price through limit order ticks, buckets at those ticks are filled. Currently, the `BucketFilled` event only emits when a bucket is **completely** emptied. This document explores how fills work and how to detect partial fills.

## Current Fill Flow

### 1. Swap Triggers Order Processing
```solidity
// In swapForPool() or _afterSwap()
_processTriggeredOrders(poolId, zeroForOne);
```

### 2. Process Triggered Orders
```solidity
function _processTriggeredOrders(PoolId poolId, bool zeroForOne) internal {
    int24 currentTick = _getCurrentTick(poolId);
    int24 prevTick = lastProcessedTick[poolId];

    // Process BOTH sides for ticks in range [prevTick, currentTick]
    for (uint8 s = 0; s < 2; s++) {
        BucketSide side = BucketSide(s);

        // Check prevTick first
        if (hasBitmapBit) {
            _fillBucketAgainstAMM(poolId, prevTick, side);
        }

        // Then search for orders in price range
        while (bucketsProcessed < maxBucketsPerSwap) {
            int24 nextTick = _findNextActiveTick(...);
            if (inRange) {
                _fillBucketAgainstAMM(poolId, nextTick, side);
            }
        }
    }

    lastProcessedTick[poolId] = currentTick;
}
```

### 3. Fill Bucket Against AMM
```solidity
function _fillBucketAgainstAMM(PoolId poolId, int24 tick, BucketSide side) internal {
    Bucket storage bucket = buckets[poolId][tick][side];
    if (!bucket.initialized) return;

    // Swap ALL bucket liquidity against AMM
    euint128 swapInput = bucket.liquidity;  // <-- Takes entire liquidity
    euint128 swapOutput = _executeSwapMathForPool(poolId, direction, swapInput);

    // Update accumulators
    _updateBucketOnFill(bucket, swapInput, swapOutput);

    // Clear bucket
    bucket.liquidity = ENC_ZERO;  // <-- Complete fill
    _clearBit(poolId, tick, side);

    emit BucketFilled(poolId, tick, side);  // <-- Only event
}
```

## Key Observation

**Current design always does COMPLETE fills.** When `_fillBucketAgainstAMM` is called, it:
1. Takes ALL liquidity from the bucket
2. Swaps it against the AMM
3. Sets liquidity to zero
4. Emits `BucketFilled`

There is no concept of "partial bucket fill" in the current implementation.

## What "Partial Fill" Actually Means

In the context of this system, "partial" could mean:

### Scenario A: Price Crosses Some But Not All Ticks
- User has orders at ticks 100, 200, 300
- Price moves from 50 to 150
- Only tick 100 is filled
- Ticks 200, 300 are NOT filled

**Detection:** `BucketFilled` at tick 100 works correctly.

### Scenario B: Max Buckets Per Swap Limit
- Many orders exist in the price range
- `maxBucketsPerSwap` limits how many are processed
- Some buckets in range are NOT filled

**Detection:** `BucketFilled` events work for filled buckets, but unfilled ones have no indicator.

### Scenario C: AMM Liquidity Insufficient (Hypothetical)
- Bucket has 100 tokens to sell
- AMM can only absorb 50 tokens
- Bucket partially filled

**Current code:** This doesn't happen - entire bucket is always swapped.

## The Real Problem

The `BucketFilled` event IS emitted when orders are filled. The issue is:

1. **Frontend doesn't find the event** - Wrong poolId? Block range?
2. **Event parsing fails** - Tick/side not extracted correctly?
3. **Order wasn't actually filled** - Price didn't cross the tick?

## Investigation Needed

### Check 1: Was BucketFilled Emitted?
```bash
cast logs --address 0x8eE2375234D0b0a50a41458a471cfa8fB490d0c8 \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  'BucketFilled(bytes32,int24,uint8)'
```

### Check 2: What Tick Was the Order At?
```bash
cast logs --address 0x8eE2375234D0b0a50a41458a471cfa8fB490d0c8 \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  'Deposit(bytes32,address,int24,uint8,bytes32)'
```

### Check 3: Did Price Cross That Tick?
- Check `lastProcessedTick` before and after swap
- Verify the order tick was in the crossed range

## Potential Improvements

### Option 1: Add Fill Event with Amount
```solidity
event BucketPartialFill(
    bytes32 indexed poolId,
    int24 indexed tick,
    uint8 side,
    bytes32 fillAmountHash,
    bytes32 proceedsAmountHash
);
```

### Option 2: Add Public Fill Counter
```solidity
mapping(PoolId => mapping(int24 => mapping(BucketSide => uint256))) public fillCount;
```
Increment on each fill. Frontend checks if `fillCount > 0`.

### Option 3: Add Last Fill Block
```solidity
mapping(PoolId => mapping(int24 => mapping(BucketSide => uint256))) public lastFillBlock;
```
Frontend checks if `lastFillBlock > depositBlock`.

## Next Steps

1. First: Debug why current `BucketFilled` events aren't being detected
2. Then: If partial fills are needed, implement Option 2 or 3
3. Update frontend detection logic accordingly