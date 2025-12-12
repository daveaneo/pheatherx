# Claim Detection Deep Research - FheatherXv6

## Executive Summary

After three iterations of deep research with self-critique, I've discovered **two critical bugs** that explain why limit orders aren't being triggered and why claimable proceeds detection fails:

1. **BUG #1: `swapEncrypted()` doesn't trigger limit orders** - Line 1085-1140 of FheatherXv6.sol is missing the call to `_processTriggeredOrders()` that exists in `swapForPool()`.

2. **BUG #2: Even if fixed, encrypted swaps won't trigger orders** - `_processTriggeredOrders` uses plaintext reserves to calculate tick, but encrypted swaps only update encrypted reserves. Plaintext sync is async.

---

# ITERATION 1: Initial Analysis

## The Detection Problem

We need to reliably detect:
1. **IF** a limit order has been triggered/filled
2. **HOW MUCH** proceeds are claimable

## Data Model Overview

### Bucket Structure (aggregated at tick)
```solidity
struct Bucket {
    euint128 totalShares;       // Sum of all depositors' shares
    euint128 liquidity;         // Remaining unfilled (ENC_ZERO after fill)
    euint128 proceedsPerShare;  // ACCUMULATOR - increases on each fill
    euint128 filledPerShare;    // ACCUMULATOR - tracks filled amount
    bool initialized;           // PUBLIC boolean
}
```

### User Position Structure
```solidity
struct UserPosition {
    euint128 shares;                    // User's share count
    euint128 proceedsPerShareSnapshot;  // SNAPSHOT at deposit time
    euint128 filledPerShareSnapshot;    // SNAPSHOT at deposit time
    euint128 realizedProceeds;          // Updated on autoClaim
}
```

### Key Insight: ABI Returns Handles as uint256

When calling `positions()` or `buckets()` from frontend, you get back **uint256 handles**:

```typescript
positions() outputs: [shares, proceedsPerShareSnapshot, filledPerShareSnapshot, realizedProceeds]
buckets() outputs: [totalShares, liquidity, proceedsPerShare, filledPerShare, initialized]
```

## Detection Method: Handle Comparison

**On deposit** (line 699-700):
```solidity
position.proceedsPerShareSnapshot = bucket.proceedsPerShare;  // SAME handle
```

**On fill** (line 573):
```solidity
bucket.proceedsPerShare = FHE.add(bucket.proceedsPerShare, proceedsInc);  // NEW handle
```

**Therefore: `bucket.proceedsPerShare` handle != `position.proceedsPerShareSnapshot` handle → proceeds exist!**

```typescript
const bucket = await contract.buckets(poolId, tick, side);
const position = await contract.positions(poolId, user, tick, side);

// Handle comparison - reliable detection method
const hasProceeds = bucket.proceedsPerShare !== position.proceedsPerShareSnapshot;
```

## ITERATION 1 CRITIQUE

### Critique 1: Handle Comparison Assumption
I assumed handle comparison would work, but this needs verification with actual on-chain data.

### Critique 2: Frontend Block Range
The frontend only queries 50,000 blocks (~3.5 hours). Deposits outside this window won't be found.

### Critique 3: Side Parsing Bug
In `useActiveOrders.ts` line 161:
```typescript
const side = parseInt(log.data.slice(2, 66), 16); // WRONG - takes 32 bytes
// Should be:
const side = parseInt(log.data.slice(64, 66), 16); // Correct - last byte of first word
```

---

# ITERATION 2: On-Chain Verification

## Live Data Analysis

Queried contract at `0x8eE2375234D0b0a50a41458a471cfa8fB490d0c8` on Arbitrum Sepolia.

### Position at tick 69060, side 1 (SELL):
```
shares handle:                  6605095055405038659043705253529640326778170425836279704052949919427371927040
proceedsPerShareSnapshot:       60183669426647975028789257285279124579157500096819578017753617009429644543488
filledPerShareSnapshot:         60183669426647975028789257285279124579157500096819578017753617009429644543488
realizedProceeds:               0
```

### Bucket at tick 69060, side 1:
```
totalShares:                    6380110206991910102268912045584896296707342352636486424120676887706050037248
liquidity:                      6380110206991910102268912045584896296707342352636486424120676887706050037248
proceedsPerShare:               60183669426647975028789257285279124579157500096819578017753617009429644543488
filledPerShare:                 60183669426647975028789257285279124579157500096819578017753617009429644543488
initialized:                    true
```

### Analysis

```
bucket.proceedsPerShare (60183...488) == position.proceedsPerShareSnapshot (60183...488)
✓ SAME HANDLE - NO FILL HAS OCCURRED
```

The bucket has NOT been filled. But the user said they traded from $1000 to $800... why didn't the order trigger?

## Event Investigation

### Deposit Event Found:
- Block: 223851586
- User: 0x60B9be2A29a02F49e8D6ba535303caD1Ddcb9659
- Tick: 69060 (0x10dc4)
- Side: 1 (SELL)

### SwapEncrypted Event Found:
- Block: 223851700 (AFTER deposit)
- User: 0x60B9be2A29a02F49e8D6ba535303caD1Ddcb9659
- **NO BucketFilled event in this transaction!**

### Critical Discovery: Missing BucketFilled Event

A swap occurred after the deposit, but no `BucketFilled` event was emitted. This means limit orders were NOT processed.

---

# ITERATION 3: Root Cause Analysis

## BUG #1: swapEncrypted() Missing Order Trigger

### swapForPool() (line 588-643):
```solidity
function swapForPool(...) public {
    // ... swap logic ...

    // 8. Trigger limit orders ✓
    _processTriggeredOrders(poolId, zeroForOne);

    emit Swap(...);
}
```

### swapEncrypted() (line 1085-1140):
```solidity
function swapEncrypted(...) external returns (euint128 amountOut) {
    // ... swap logic ...

    _requestReserveSync(poolId);

    emit SwapEncrypted(poolId, msg.sender);

    // ⚠️ MISSING: _processTriggeredOrders(poolId, zeroForOne);
}
```

**`swapEncrypted()` NEVER calls `_processTriggeredOrders()`!**

## BUG #2: Architectural Mismatch

Even if we add `_processTriggeredOrders()` to `swapEncrypted()`, it won't work:

### _processTriggeredOrders() Flow:
```solidity
function _processTriggeredOrders(...) internal {
    int24 currentTick = _getCurrentTick(poolId);  // Uses PLAINTEXT reserves
    int24 prevTick = lastProcessedTick[poolId];

    if (currentTick == prevTick) return;  // No change detected
    // ... process orders ...
}
```

### _getCurrentTick() Implementation:
```solidity
function _getCurrentTick(PoolId poolId) internal view returns (int24) {
    PoolReserves storage reserves = poolReserves[poolId];
    // Uses reserves.reserve0 and reserves.reserve1 - PLAINTEXT values!
    // ...
}
```

### The Problem:

1. `swapEncrypted()` updates **encrypted** reserves (`encReserve0`, `encReserve1`)
2. `_getCurrentTick()` reads **plaintext** reserves (`reserve0`, `reserve1`)
3. Plaintext reserves are synced **asynchronously** via `_requestReserveSync()`
4. Therefore, at the time `_processTriggeredOrders()` runs, plaintext reserves are STALE

**Limit orders can only trigger on plaintext swaps (`swapForPool`) or after async reserve sync.**

## Current State Confirmation

```
lastProcessedTick:  -458160
getCurrentTick:     -458160  (same - no movement detected)
hasOrdersAtTick(69060, SELL): true  (orders still exist)
```

The tick hasn't moved because:
1. The swap was encrypted
2. Encrypted reserves were updated
3. But plaintext reserves weren't synced yet
4. So `_getCurrentTick()` returns the old value

---

# RELIABLE CLAIM DETECTION METHODS

## Method 1: Handle Comparison (Works When Fills Occur)

```typescript
async function hasClaimableProceeds(
  contract: Contract,
  poolId: string,
  user: string,
  tick: number,
  side: number
): Promise<boolean> {
  const bucket = await contract.buckets(poolId, tick, side);
  const position = await contract.positions(poolId, user, tick, side);

  // If handles differ, fill has occurred
  const proceedsHandleDiffers = bucket.proceedsPerShare !== position.proceedsPerShareSnapshot;
  const filledHandleDiffers = bucket.filledPerShare !== position.filledPerShareSnapshot;

  return proceedsHandleDiffers || filledHandleDiffers;
}
```

## Method 2: BucketFilled Event Detection (Current Approach - Has Issues)

```typescript
// Issues:
// 1. Block range too short (50k blocks = ~3.5 hours)
// 2. Events might not be emitted if swapEncrypted is used
// 3. Side parsing bug in current implementation

// Fix block range:
const fromBlock = currentBlock - 500000n; // ~35 hours

// Fix side parsing:
const side = parseInt(log.data.slice(64, 66), 16);
```

## Method 3: Bitmap Check (For Complete Fills)

```typescript
async function wasBucketFilled(
  contract: Contract,
  poolId: string,
  tick: number,
  side: number
): Promise<boolean> {
  const hasOrders = await contract.hasOrdersAtTick(poolId, tick, side);
  const bucket = await contract.buckets(poolId, tick, side);

  // Bucket was filled if: initialized but no active orders
  return bucket.initialized && !hasOrders;
}
```

## Method 4: Just Claim (Safest)

The safest approach is to attempt `claim()` for any position where the user deposited:

```typescript
// claim() calculates proceeds on-chain and transfers whatever is available
// If no proceeds, the transfer amount is zero (cheap transaction)
await contract.claim(poolId, tick, side);
```

---

# HOW TO DETERMINE CLAIMABLE AMOUNT

## On-Chain Calculation (in claim()):

```solidity
function _calculateProceeds(UserPosition pos, Bucket bucket) internal returns (euint128) {
    euint128 delta = FHE.sub(bucket.proceedsPerShare, pos.proceedsPerShareSnapshot);
    return FHE.div(FHE.mul(pos.shares, delta), ENC_PRECISION);
}

// Total = calculated proceeds + realized proceeds
totalProceeds = _calculateProceeds(position, bucket) + position.realizedProceeds;
```

## Frontend Estimation (Approximate)

Since we can't read encrypted values, we can estimate:

1. **From events**: Track input/output amounts from `Swap` events
2. **From reserves**: Calculate price change and estimate fill amount
3. **Via decryption**: Request CoFHE decryption of claimable amount (requires async flow)

## Recommended UX Flow

```
1. User clicks "Check Claimable"
2. Frontend calls hasClaimableProceeds() using handle comparison
3. If true, show "You have claimable proceeds"
4. User clicks "Claim"
5. claim() executes, transferring actual proceeds
6. Update UI with claimed amount from transaction events
```

---

# RECOMMENDED FIXES

## Critical: Contract Fixes Required

### Fix #1: Add order triggering to swapEncrypted

```solidity
// In swapEncrypted(), after line 1137:
_requestReserveSync(poolId);

// Add this line:
// Note: This won't work immediately due to async reserve sync
// Need architectural fix below
```

### Fix #2: Architectural Solution for Encrypted Swaps

**Option A: Trigger orders after reserve sync completes**
```solidity
function trySyncReserves(PoolId poolId) public {
    // ... existing sync logic ...

    // After reserves are synced:
    _processTriggeredOrders(poolId, true);  // Check both directions
    _processTriggeredOrders(poolId, false);
}
```

**Option B: Estimate tick from encrypted reserves**
- Complex: Would need encrypted comparison without decryption
- May require new CoFHE primitives

**Option C: Use plaintext amount for tick estimation**
- `swapEncrypted` could estimate tick change from input amount
- Less privacy but simpler implementation

## Frontend Fixes Required

### Fix #1: Extend block range
```typescript
// useActiveOrders.ts line 77
const fromBlock = currentBlock - 500000n; // Was 50000n
```

### Fix #2: Fix side parsing
```typescript
// useActiveOrders.ts line 161
const side = parseInt(log.data.slice(64, 66), 16); // Was slice(2, 66)
```

### Fix #3: Use handle comparison for detection
```typescript
// Add to hasClaimableProceeds check:
const bucketData = await contract.buckets(poolId, tick, side);
const positionData = await contract.positions(poolId, user, tick, side);
const handlesDiffer = bucketData[2] !== positionData[1]; // proceedsPerShare handles
```

### Fix #4: Remove false handle > 0 checks
```typescript
// This is WRONG - handles are always non-zero for initialized values
// REMOVE: const hasClaimable = realizedProceedsHandle > 0n;
```

---

# SUMMARY

| Issue | Severity | Location | Status |
|-------|----------|----------|--------|
| `swapEncrypted` missing `_processTriggeredOrders` | CRITICAL | FheatherXv6.sol:1085-1140 | Needs fix |
| Encrypted swaps use stale plaintext tick | CRITICAL | Architectural | Needs design |
| Block range too short | HIGH | useActiveOrders.ts:77 | Easy fix |
| Side parsing bug | HIGH | useActiveOrders.ts:161 | Easy fix |
| Handle > 0 check meaningless | MEDIUM | Multiple files | Easy fix |

## Next Steps

1. **Immediate**: Fix contract bug in `swapEncrypted()` (add order triggering)
2. **Short-term**: Fix frontend detection bugs
3. **Medium-term**: Design proper solution for encrypted swap order triggering
4. **Long-term**: Consider adding on-chain `hasClaimable(user, tick, side)` view function

---

*Research completed: 2025-12-11*
*Contract: FheatherXv6 at 0x8eE2375234D0b0a50a41458a471cfa8fB490d0c8*
*Network: Arbitrum Sepolia*
