# Plan: Synchronous Encrypted Order Triggering Fix

## Problem Summary

`swapEncrypted()` (line 1085-1140) doesn't trigger limit orders because:
1. **BUG #1**: Missing call to `_processTriggeredOrders()`
2. **BUG #2**: Even if added, `_processTriggeredOrders()` uses `_getCurrentTick(poolId)` which reads **plaintext** reserves - but encrypted swaps only update **encrypted** reserves (async sync)

## Solution Approach

**Reverse tick calculation**: Instead of computing "what tick are we at?" (requires sqrt/log not in FHE), we check "did we cross tick X?" for each active tick.

For a tick T with price P:
```
crossedTick = (reserve1 >= P * reserve0)
```

This uses only **FHE.mul** and **FHE.gte** - both available!

### Key Insight
- We know the OLD plaintext reserves (before swap)
- We know the NEW encrypted reserves (after swap)
- We compare: was price past tick before? Is it past tick now?
- If different → crossed tick → trigger orders at that tick

### User Requirements
- Direction doesn't matter - trigger BOTH buy and sell orders at ANY crossed tick
- Include start and end ticks
- Individual orders can fail (slippage) without failing whole transaction
- Must be synchronous (no async waiting for reserve sync)

## Implementation Plan

### Step 1: Create `_processTriggeredOrdersEncrypted()` function

Add new function after `_processTriggeredOrders()` (~line 537):

```solidity
/// @notice Process limit orders triggered by encrypted swap price movement
/// @dev Uses reverse tick calculation: check if we crossed each tick using FHE
/// @param poolId The pool identifier
/// @param oldReserve0 Plaintext reserve0 before swap
/// @param oldReserve1 Plaintext reserve1 before swap
function _processTriggeredOrdersEncrypted(
    PoolId poolId,
    uint256 oldReserve0,
    uint256 oldReserve1
) internal {
    PoolReserves storage r = poolReserves[poolId];
    PoolState storage state = poolStates[poolId];
    int24 prevTick = lastProcessedTick[poolId];

    // Process both directions from the known tick
    for (uint8 s = 0; s < 2; s++) {
        BucketSide side = BucketSide(s);
        uint256 bucketsProcessed = 0;

        // Search in both directions (up and down)
        for (uint8 dir = 0; dir < 2; dir++) {
            bool searchUp = (dir == 0);
            int24 tick = prevTick;

            while (bucketsProcessed < state.maxBucketsPerSwap) {
                int24 nextTick = _findNextActiveTick(poolId, tick, side, searchUp);
                if (nextTick == type(int24).max || nextTick == type(int24).min) break;

                _tryFillBucketEncrypted(
                    poolId, nextTick, side,
                    oldReserve0, oldReserve1,
                    r.encReserve0, r.encReserve1
                );

                tick = searchUp ? nextTick + TICK_SPACING : nextTick - TICK_SPACING;
                bucketsProcessed++;
            }
        }
    }
}
```

### Step 2: Create `_tryFillBucketEncrypted()` helper

```solidity
/// @notice Attempt to fill a bucket if the tick was crossed during encrypted swap
/// @dev Uses FHE.select for conditional fill without revealing if tick was crossed
function _tryFillBucketEncrypted(
    PoolId poolId,
    int24 tick,
    BucketSide side,
    uint256 oldReserve0,
    uint256 oldReserve1,
    euint128 newReserve0,
    euint128 newReserve1
) internal {
    Bucket storage bucket = buckets[poolId][tick][side];
    if (!bucket.initialized) return;

    uint256 tickPrice = _calculateTickPrice(tick);

    // Was price past this tick BEFORE swap? (plaintext - safe to reveal)
    // price >= tickPrice means: reserve1 * PRECISION >= tickPrice * reserve0
    bool wasPast = (oldReserve1 * PRECISION >= tickPrice * oldReserve0);

    // Is price past this tick NOW? (encrypted check)
    // Scale down to prevent overflow: divide by 1e9
    uint256 SCALE = 1e9;
    euint128 encScale = FHE.asEuint128(uint128(SCALE));
    FHE.allowThis(encScale);

    euint128 scaledNew1 = FHE.div(newReserve1, encScale);
    euint128 scaledNew0 = FHE.div(newReserve0, encScale);
    FHE.allowThis(scaledNew1);
    FHE.allowThis(scaledNew0);

    uint256 scaledTickPrice = tickPrice / SCALE;
    euint128 threshold = FHE.mul(FHE.asEuint128(uint128(scaledTickPrice)), scaledNew0);
    FHE.allowThis(threshold);

    ebool isNowPast = FHE.gte(scaledNew1, threshold);
    FHE.allowThis(isNowPast);

    // Crossed if: wasPast status changed (XOR detects difference)
    ebool wasPastEnc = FHE.asEbool(wasPast);
    FHE.allowThis(wasPastEnc);
    ebool crossed = FHE.xor(wasPastEnc, isNowPast);
    FHE.allowThis(crossed);

    // Conditional fill amount - zero if we didn't cross
    euint128 fillAmount = FHE.select(crossed, bucket.liquidity, ENC_ZERO);
    FHE.allowThis(fillAmount);

    // Execute swap for fill amount (will be zero-op if no fill)
    ebool direction = FHE.asEbool(side == BucketSide.SELL);
    euint128 swapOutput = _executeSwapMathForPool(poolId, direction, fillAmount);

    // Update bucket accumulators (handles zero amounts gracefully)
    _updateBucketOnFill(bucket, fillAmount, swapOutput);

    // Conditionally clear liquidity
    bucket.liquidity = FHE.select(crossed, ENC_ZERO, bucket.liquidity);
    FHE.allowThis(bucket.liquidity);

    // Emit event for any potential fill (even if amount is encrypted)
    // Note: Can't clear bitmap here - need async cleanup or public state
}
```

### Step 3: Use FHE Boolean Operations

`FHE.not()`, `FHE.and()`, and `FHE.xor()` are available (used in FheatherXv2.sol lines 771, 789).

Cleaner crossed-tick detection using XOR:
```solidity
// Crossed if: wasPast status changed (XOR)
ebool wasPastEnc = FHE.asEbool(wasPast);  // Convert plaintext bool to ebool
ebool crossed = FHE.xor(wasPastEnc, isNowPast);  // true if different
FHE.allowThis(crossed);

// Conditionally fill
euint128 fillAmount = FHE.select(crossed, bucket.liquidity, ENC_ZERO);
```

### Step 4: Modify `swapEncrypted()` to call encrypted order processing

In `swapEncrypted()` at line ~1137, after the swap math but before `_requestReserveSync`:

```solidity
function swapEncrypted(...) external whenNotPaused returns (euint128 amountOut) {
    // ... existing code until line 1116 ...

    // Execute encrypted swap
    amountOut = _executeSwapMathForPool(poolId, dir, amt);

    // ====== NEW: Trigger limit orders synchronously ======
    PoolReserves storage reserves = poolReserves[poolId];
    _processTriggeredOrdersEncrypted(
        poolId,
        reserves.reserve0,   // Old plaintext reserves (before this swap)
        reserves.reserve1
    );
    // ====== END NEW ======

    // Slippage check
    // ... rest of existing code ...
}
```

### Step 5: Understanding Stale Plaintext Reserves

The plaintext reserves (`reserve0`, `reserve1`) may be stale from async decryption. However, this is **correct behavior**:

- Plaintext reserves represent the last **synced** state
- `lastProcessedTick[poolId]` was set when plaintext was accurate
- Orders that should have triggered between sync and now haven't been processed yet
- Using stale plaintext as "old" state ensures we trigger all missed orders

This means multiple encrypted swaps between syncs will all check against the same "old" plaintext state, which correctly triggers all orders that should have been crossed during that period.

### Step 6: Handling Already-Filled Buckets

Two safeguards prevent re-triggering already-filled orders:

1. **Zero liquidity no-op**: If `bucket.liquidity = ENC_ZERO` (already filled), `FHE.select(crossed, ENC_ZERO, ENC_ZERO)` = zero fill. The swap math handles zero input gracefully.

2. **Bitmap cleanup** (optimization): Since bitmap bits can't be cleared in encrypted swaps, filled buckets stay in bitmap until plaintext sync. This wastes gas iterating through empty ticks.

**Cleanup strategy**: Add to `trySyncReserves()`:
```solidity
function trySyncReserves(PoolId poolId) external {
    _harvestResolvedDecrypts(poolId);

    // After sync, process orders with plaintext tick (clears bitmap bits)
    _processTriggeredOrders(poolId, true);
}
```

This ensures bitmap cleanup happens when plaintext reserves become available.

## Files to Modify

1. **`/home/david/PycharmProjects/fheatherx/contracts/src/FheatherXv6.sol`**
   - Add `_processTriggeredOrdersEncrypted()` (~line 537)
   - Add `_tryFillBucketEncrypted()` helper
   - Modify `swapEncrypted()` (lines 1085-1140)
   - Optionally: Add bitmap cleanup to `trySyncReserves()`

## Gas Considerations

- Each tick check requires 2 `FHE.div` + 1 `FHE.mul` + 1 `FHE.gte` + 1 `FHE.select`
- Limited by `maxBucketsPerSwap` (existing parameter)
- FHE operations are already gas-intensive; this adds ~6 FHE ops per tick checked

## Testing Plan

1. Deploy updated contract to testnet
2. Add liquidity to AMM
3. Place limit orders at various ticks
4. Execute `swapEncrypted()` that should cross order ticks
5. Verify `BucketFilled` events or check bucket state
6. Verify claim works for triggered orders

## Resolved Questions

1. **FHE.not() availability**: Confirmed available (used in FheatherXv2.sol lines 771, 789)
2. **Stale reserves**: Using stale plaintext as "old" state is correct - ensures all missed orders trigger

## Remaining Considerations

1. **Privacy**: `BucketFilled` event for encrypted fills? Consider emitting `BucketPotentiallyFilled` without revealing if actually filled
2. **Gas limits**: Limited by `maxBucketsPerSwap` - each tick ~6 FHE ops. May need testing to determine practical limit
3. **Scaling precision**: 1e9 scale-down loses some precision in tick boundary detection - acceptable tradeoff

---

## Frontend Claim Detection - SOLVED (No Contract Changes Needed!)

### Key Insight

The contract already handles partial fills correctly via the shares + accumulator pattern:
- `claim()` → gets proceeds from filled portion
- `withdraw()` → gets back unfilled portion

### Detection Method: Handle Comparison + BucketFilled Event

**On deposit**, user's snapshot is assigned the SAME handle as bucket accumulator:
```solidity
position.proceedsPerShareSnapshot = bucket.proceedsPerShare;  // SAME handle
```

**On fill**, bucket accumulator gets a NEW handle:
```solidity
bucket.proceedsPerShare = FHE.add(bucket.proceedsPerShare, proceedsInc);  // NEW handle
```

**Therefore**: Different handles = fill occurred!

### Three States

| State | Detection | User Actions |
|-------|-----------|--------------|
| **Full fill** | `BucketFilled` event exists | `claim()` |
| **No fill** | Handles SAME | `withdraw()` |
| **Partial fill** | Handles DIFFERENT, no BucketFilled | `claim()` + `withdraw()` |

### Frontend Implementation

```typescript
async function getOrderStatus(poolId, user, tick, side, depositBlock) {
  // 1. Check for full fill event
  const bucketFilledEvents = await getBucketFilledEvents(poolId, tick, side);
  const fullFill = bucketFilledEvents.some(e => e.blockNumber > depositBlock);

  if (fullFill) {
    return { status: 'FILLED', actions: ['claim'] };
  }

  // 2. Compare handles
  const bucket = await contract.buckets(poolId, tick, side);
  const position = await contract.positions(poolId, user, tick, side);

  if (bucket.proceedsPerShare === position.proceedsPerShareSnapshot) {
    return { status: 'PENDING', actions: ['withdraw'] };  // Cancel order
  } else {
    return { status: 'PARTIAL', actions: ['claim', 'withdraw'] };
  }
}
```

### Contract Functions (Already Exist!)

**`withdraw()` (line 721)** - Returns unfilled liquidity:
```solidity
euint128 unfilledShares = _calculateUnfilled(position, bucket);
// Calculates: shares - (shares * filledPerShare delta)
```

**`claim()` (line 763)** - Returns proceeds from fills:
```solidity
euint128 currentProceeds = _calculateProceeds(position, bucket);
// Calculates: shares * proceedsPerShare delta
```

**Note (line 809)**: `exit()` was removed for size optimization. Frontend can batch `withdraw() + claim()` via multicall.

### Why This Works

- Handle comparison detects ANY fill (partial or full)
- `BucketFilled` event distinguishes full fills
- Contract math naturally separates filled vs unfilled portions
- **No new state or events needed!**

---

*Created: 2025-12-11*
*Related: claim-detection-deep-research.md*
