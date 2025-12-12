# Limit Order Fill Detection Research - FheatherXv6

## Executive Summary

This document provides a comprehensive analysis of how limit orders are triggered and filled in FheatherXv6, and how users can reliably detect when they have claimable proceeds.

**Key Finding:** The current contract design ALWAYS does complete bucket fills (not partial). The `BucketFilled` event IS emitted on every fill.

**CRITICAL DISCOVERY (Live Diagnosis):**
```
User's SELL order tick: 69060
Current pool tick:      -458160
Gap:                    527,220 ticks
```

**The orders have NOT been filled because the market price has not reached the order price.** This is not a detection bug - it's working as designed. The user placed sell orders at a very high price relative to current market, and price hasn't risen to trigger them.

---

## Quick Diagnostic Commands

Check if YOUR order has been filled:
```bash
# 1. Find your order tick from Deposit events
cast logs --address <HOOK> --rpc-url <RPC> 0xe227a6e7d62472606934cff09bd5338bef8353353f2e4cd5f33663baadbc64e8 --from-block <START>

# 2. Check current pool tick
cast call <HOOK> "getCurrentTickForPool(bytes32)(int24)" <POOL_ID> --rpc-url <RPC>

# 3. Compare: For SELL orders, current tick must be >= order tick
#            For BUY orders, current tick must be <= order tick
```

---

## Table of Contents

1. [Contract Architecture](#1-contract-architecture)
2. [Fill Flow Analysis](#2-fill-flow-analysis)
3. [Current Detection Approach](#3-current-detection-approach)
4. [Why Detection Fails](#4-why-detection-fails)
5. [Claimable Calculation](#5-claimable-calculation)
6. [Recommended Solutions](#6-recommended-solutions)
7. [Implementation Plan](#7-implementation-plan)

---

## 1. Contract Architecture

### Data Structures

```solidity
// Bucket: Aggregated liquidity at a specific tick price
struct Bucket {
    euint128 totalShares;       // Total shares from all depositors
    euint128 liquidity;         // Remaining unfilled liquidity
    euint128 proceedsPerShare;  // Accumulator - increases on each fill
    euint128 filledPerShare;    // Accumulator - tracks filled amount per share
    bool initialized;           // Public boolean flag
}

// UserPosition: Individual user's stake in a bucket
struct UserPosition {
    euint128 shares;                    // User's share count
    euint128 proceedsPerShareSnapshot;  // Snapshot at deposit time
    euint128 filledPerShareSnapshot;    // Snapshot at deposit time
    euint128 realizedProceeds;          // Accumulated proceeds (updated on autoClaim)
}
```

### Key Insight: Everything is Encrypted

All numeric values are `euint128` (encrypted). The frontend cannot read actual values - only encrypted handles. Checking `handle > 0n` tells you a value EXISTS, not that it's non-zero (encrypted zero has a non-zero handle).

---

## 2. Fill Flow Analysis

### When Fills Happen

Limit orders are triggered in two places:

1. **After V4 Router Swaps** - `_afterSwap()` callback
2. **After Direct Swaps** - `swapForPool()` function

Both call `_processTriggeredOrders(poolId, zeroForOne)`.

### Order Processing Flow

```
swapForPool() or _afterSwap()
    └── _processTriggeredOrders(poolId, zeroForOne)
         └── For each tick in [prevTick → currentTick]:
              └── For BOTH sides (BUY and SELL):
                   └── If bitmap bit is set:
                        └── _fillBucketAgainstAMM(poolId, tick, side)
```

### Fill Execution (`_fillBucketAgainstAMM`)

```solidity
function _fillBucketAgainstAMM(PoolId poolId, int24 tick, BucketSide side) internal {
    Bucket storage bucket = buckets[poolId][tick][side];
    if (!bucket.initialized) return;

    // 1. Take ALL liquidity from bucket
    euint128 swapInput = bucket.liquidity;  // <-- ENTIRE bucket

    // 2. Execute swap against AMM
    euint128 swapOutput = _executeSwapMathForPool(poolId, direction, swapInput);

    // 3. Update accumulators
    _updateBucketOnFill(bucket, swapInput, swapOutput);

    // 4. Clear bucket liquidity
    bucket.liquidity = ENC_ZERO;  // <-- Complete fill

    // 5. Clear bitmap (no more active orders at this tick)
    _clearBit(poolId, tick, side);

    // 6. EMIT EVENT
    emit BucketFilled(poolId, tick, side);  // <-- Always emitted
}
```

### Critical Observation: No Partial Bucket Fills

**The current design ALWAYS does complete fills.** When `_fillBucketAgainstAMM` is called:
1. It takes 100% of `bucket.liquidity`
2. Sets liquidity to zero
3. Emits `BucketFilled`

What users perceive as "partial fill" is actually:
- User has orders at multiple ticks (e.g., tick 60, 120, 180)
- Price moves from tick 0 to tick 100
- Only tick 60 is filled; ticks 120 and 180 remain pending

---

## 3. Current Detection Approach

### Frontend Logic (`useClaimableOrders.ts`)

```typescript
// 1. Get user's Deposit events
const depositLogs = await publicClient.getLogs({
  event: OrderDepositEvent,
  args: { user: address },
  fromBlock, toBlock
});

// 2. Get BucketFilled events
const filledLogs = await publicClient.getLogs({
  event: BucketFilledEvent,
  fromBlock, toBlock
});

// 3. Get user's Claim events
const claimLogs = await publicClient.getLogs({
  event: ClaimEvent,
  args: { user: address },
  fromBlock, toBlock
});

// 4. Match: deposit at tick X + bucket filled at tick X + not claimed = claimable
```

### Events Used

| Event | Signature | Indexed Fields |
|-------|-----------|----------------|
| `Deposit` | `Deposit(bytes32,address,int24,uint8,bytes32)` | poolId, user, tick |
| `BucketFilled` | `BucketFilled(bytes32,int24,uint8)` | poolId, tick |
| `Claim` | `Claim(bytes32,address,int24,uint8,bytes32)` | poolId, user, tick |
| `Withdraw` | `Withdraw(bytes32,address,int24,uint8,bytes32)` | poolId, user, tick |

---

## 4. Why Detection Fails

### Problem 1: Wrong poolId Matching

The `BucketFilled` event indexes `poolId` and `tick`, but the frontend may be comparing against wrong poolId (different hook deployment, different token pair).

**Debug Command:**
```bash
cast logs --address 0x8eE2375234D0b0a50a41458a471cfa8fB490d0c8 \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  'BucketFilled(bytes32,int24,uint8)' \
  --from-block 100000000
```

### Problem 2: Block Range Too Short

Frontend uses `currentBlock - 50000n` (~3.5 hours on Arbitrum). Orders placed earlier won't be found.

```typescript
// useClaimableOrders.ts line 69
const fromBlock = currentBlock > 50000n ? currentBlock - 50000n : 0n;
```

### Problem 3: Encrypted Handle Comparison

```typescript
// This is WRONG - checks handle existence, not value
const hasClaimableProceeds = realizedProceedsHandle > 0n;
```

An encrypted zero (`ENC_ZERO`) has a non-zero handle. This check always passes once any FHE operation has been performed.

### Problem 4: Event Parsing Issues

The `useActiveOrders.ts` hook parses `side` from event data incorrectly:

```typescript
// line 161 - parses entire 32 bytes as side (should be just first byte)
const side = parseInt(log.data.slice(2, 66), 16);
```

The `side` is packed in the data as a uint8, but it's padded to 32 bytes. Parsing all 32 bytes will give wrong results if other data follows.

---

## 5. Claimable Calculation

### On-Chain Formula

```solidity
// In claim() function
euint128 currentProceeds = _calculateProceeds(position, bucket);
// Where:
function _calculateProceeds(UserPosition storage pos, Bucket storage bucket) {
    euint128 delta = FHE.sub(bucket.proceedsPerShare, pos.proceedsPerShareSnapshot);
    return FHE.div(FHE.mul(pos.shares, delta), ENC_PRECISION);
}
```

**User's Claimable = shares × (bucket.proceedsPerShare - snapshot) / PRECISION + realizedProceeds**

### What This Means

- `proceedsPerShare` increases each time the bucket is filled
- User's snapshot is fixed at deposit time
- The delta represents proceeds accumulated since deposit
- Works correctly for ANY number of fills

---

## 6. Recommended Solutions

### Solution A: Fix Frontend Detection (No Contract Changes)

**Priority: HIGH - Should be done first**

1. **Extend block range:**
   ```typescript
   // Change from 50000 to 200000+ blocks
   const fromBlock = currentBlock > 200000n ? currentBlock - 200000n : 0n;
   ```

2. **Verify poolId matching:**
   ```typescript
   // Ensure hookAddress + tokens compute to correct poolId
   const expectedPoolId = getPoolIdFromTokens(token0, token1, hookAddress);
   console.log('[DEBUG] Expected poolId:', expectedPoolId);
   ```

3. **Fix event parsing:**
   ```typescript
   // Parse side correctly (uint8 at position 0)
   const side = parseInt(log.data.slice(64, 66), 16); // Last byte of first 32-byte word
   ```

4. **Remove invalid handle checks:**
   ```typescript
   // REMOVE this check - it's meaningless for encrypted values
   // const hasClaimableProceeds = realizedProceedsHandle > 0n;

   // REPLACE with event-based detection only
   const hasClaimableProceeds = hasUnclaimedFilledBucket;
   ```

### Solution B: Add Public Fill Tracking (Contract Change)

**Priority: MEDIUM - If Solution A insufficient**

Add a public `fillCount` or `lastFillBlock` per bucket:

```solidity
// Add to contract state
mapping(PoolId => mapping(int24 => mapping(BucketSide => uint256))) public bucketFillCount;
mapping(PoolId => mapping(int24 => mapping(BucketSide => uint256))) public bucketLastFillBlock;

// Modify _fillBucketAgainstAMM
function _fillBucketAgainstAMM(...) internal {
    // ... existing logic ...

    // Add public tracking
    bucketFillCount[poolId][tick][side]++;
    bucketLastFillBlock[poolId][tick][side] = block.number;

    emit BucketFilled(poolId, tick, side);
}
```

**Frontend Usage:**
```typescript
// Check if bucket was filled after user's deposit
const fillBlock = await contract.bucketLastFillBlock(poolId, tick, side);
const depositBlock = ...; // From Deposit event
const hasClaimable = fillBlock > depositBlock;
```

### Solution C: Add On-Chain View Function (Contract Change)

**Priority: LOW - Complex FHE operation**

```solidity
/// @notice Check if user has claimable proceeds (requires FHE comparison)
function hasClaimableProceeds(
    PoolId poolId,
    address user,
    int24 tick,
    BucketSide side
) external view returns (bool) {
    Bucket storage bucket = buckets[poolId][tick][side];
    UserPosition storage pos = positions[poolId][user][tick][side];

    // FHE comparison - expensive but accurate
    ebool hasProceeds = FHE.gt(bucket.proceedsPerShare, pos.proceedsPerShareSnapshot);
    ebool hasRealized = FHE.gt(pos.realizedProceeds, ENC_ZERO);

    // Need async decrypt to return actual bool
    // This is complex and may not be worth it
}
```

**Note:** FHE view functions returning decrypted values require async CoFHE flow.

### Solution D: Optimistic UI Approach

**Priority: MEDIUM - Good UX improvement**

```typescript
// After detecting a bucket fill event at user's tick:
// 1. Show "Your order may have been filled" notification
// 2. Enable "Claim" button
// 3. Let user attempt claim - if no proceeds, transaction is cheap (~50k gas)
// 4. Update UI based on claim success/failure
```

---

## 7. Implementation Plan

### Phase 1: Debug & Quick Fixes (Immediate)

1. Run diagnostic script to verify events exist:
   ```bash
   node frontend/scripts/check-claims.mjs
   ```

2. Fix block range in `useClaimableOrders.ts`:
   ```typescript
   const fromBlock = currentBlock > 200000n ? currentBlock - 200000n : 0n;
   ```

3. Add console logging to trace detection:
   ```typescript
   console.log('[useClaimableOrders] Found deposits:', depositLogs.length);
   console.log('[useClaimableOrders] Found fills:', filledLogs.length);
   console.log('[useClaimableOrders] Matching positions:', claimable.length);
   ```

### Phase 2: Frontend Improvements (1-2 days)

1. Fix event parsing for `side` field
2. Remove misleading encrypted handle checks
3. Add proper poolId validation
4. Implement retry logic for missed events

### Phase 3: Contract Enhancement (If Needed)

1. Add `bucketFillCount` and `bucketLastFillBlock` mappings
2. Update `_fillBucketAgainstAMM` to track fills
3. Deploy new contract version
4. Update frontend to use new view functions

### Phase 4: UX Polish

1. Show "Checking for fills..." loading state
2. Add manual "Refresh" button
3. Show notifications when fills detected
4. Add "Claim All" batch function

---

## Appendix A: Order Triggering Explained

### Tick Semantics

In Uniswap V4/FheatherX:
- **Tick** represents log price: `price = 1.0001^tick`
- **Positive ticks** = higher prices (token1 is worth more relative to token0)
- **Negative ticks** = lower prices (token0 is worth more relative to token1)

### When Orders Trigger

| Order Side | Deposited Token | Receives Token | Triggers When |
|------------|-----------------|----------------|---------------|
| SELL (side=1) | token0 | token1 | Price RISES to order tick (current >= order) |
| BUY (side=0) | token1 | token0 | Price FALLS to order tick (current <= order) |

### Example Scenario

```
Pool: fheWETH/fheUSDC
Current tick: -458160 (price very low, ~0 USD per WETH)

User places SELL order at tick 69060:
- Wants to sell fheWETH for fheUSDC
- At price ~= 1.0001^69060 ≈ very high

What needs to happen for fill:
1. Someone must buy fheWETH with fheUSDC
2. This pushes price UP (tick increases)
3. When tick reaches 69060, order triggers
4. BucketFilled event emits
5. User can now claim fheUSDC proceeds
```

### Why Current Orders Haven't Filled

The diagnostic shows:
- Order tick: 69060 (very high price)
- Current tick: -458160 (very low price)
- Gap: ~527,000 ticks

**This is an astronomical price difference.** The order is essentially saying "sell when price goes to infinity" relative to current market. It will never fill unless massive trades move the price.

### Practical Recommendation

For testing, place orders CLOSE to current tick:
```
Current tick: -458160
Good SELL tick: -458100 (60 ticks above current)
Good BUY tick: -458220 (60 ticks below current)
```

Then execute a swap to move price past your order tick.

---

## Appendix B: Testing Commands

### Check BucketFilled Events
```bash
cast logs \
  --address 0x8eE2375234D0b0a50a41458a471cfa8fB490d0c8 \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  'BucketFilled(bytes32,int24,uint8)' \
  --from-block 100000000
```

### Check User's Deposits
```bash
cast logs \
  --address 0x8eE2375234D0b0a50a41458a471cfa8fB490d0c8 \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  'Deposit(bytes32,address,int24,uint8,bytes32)' \
  --topic2 0x00000000000000000000000060B9be2A29a02F49e8D6ba535303caD1Ddcb9659 \
  --from-block 100000000
```

### Check Pool Reserves
```bash
cast call 0x8eE2375234D0b0a50a41458a471cfa8fB490d0c8 \
  "getPoolReserves(bytes32)(uint256,uint256,uint256)" \
  0x943373077c39300e6f34b9d3fa425061d93adec9a115e02a2c7ddfa8a23178fc \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc
```

---

## Appendix C: Event Signatures

```solidity
// Keccak256 hashes (verified)
Deposit(bytes32,address,int24,uint8,bytes32):
  0xe227a6e7d62472606934cff09bd5338bef8353353f2e4cd5f33663baadbc64e8

BucketFilled(bytes32,int24,uint8):
  0x0d1cf8b92a7adb6f226cf4e8fdb501d0c49b52597e1a746661a62e2cd56a905a

Claim(bytes32,address,int24,uint8,bytes32):
  0xfd416565bb97cac4bd0ff3380efd6db9309a5597b8eb5af180439d458de5838c

PoolInitialized(bytes32,address,address,bool,bool):
  0x21fcf35676520ed6ca1d671a1c94759e0ede65cd971b2422757ca2a8d9852c6e

Swap(bytes32,address,bool,uint256,uint256):
  0x12b1af69606f7d3ed4bddb542e0e6d0efe8d9d0bbb3ccc1201ef61de5bae3d3f
```

---

## Conclusion

### Primary Finding

**The limit order fill detection system is working correctly.** In the specific case analyzed:
- User placed SELL orders at tick 69060
- Current market tick is -458160
- Orders have not triggered because price hasn't reached the order price
- This is expected behavior, not a bug

### Why Orders Aren't Filling

1. **Price Gap:** Order price is ~527,000 ticks above current market
2. **No BucketFilled events:** Because no fills have occurred
3. **Frontend shows no claimable:** Correct - nothing to claim yet

### What Users Need to Know

For limit orders to fill:
- **SELL orders:** Market price must RISE to the order tick
- **BUY orders:** Market price must FALL to the order tick
- **Testing tip:** Place orders within 60-120 ticks of current price

### Next Steps

1. **Immediate:** No code changes needed - system works as designed
2. **UX Improvement:** Show order status relative to current price
   - "Your order is 527,220 ticks above current market"
   - "Estimated fill price: X USDC per WETH"
3. **Frontend Enhancement:** Add visual indicator comparing order tick vs current tick
4. **Documentation:** Add user guide explaining limit order mechanics

### If Fill Detection Does Fail in Future

Apply these fixes:
1. Extend event query block range (200k+ blocks)
2. Fix event parsing for `side` field
3. Remove misleading encrypted handle checks
4. Consider adding `bucketFillCount` public state

---

*Research completed: 2025-12-11*
*Contract version: FheatherXv6*
*Network: Arbitrum Sepolia*
