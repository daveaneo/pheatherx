# Frontend v8 Migration Checklist

## Overview

This document outlines the changes required to migrate the frontend from FheatherXv6 to FheatherXv8 (FHE and Mixed variants).

### Key Architecture Changes

| Aspect | v6 | v8 |
|--------|----|----|
| Contracts | Single contract for all pool types | Two contracts: v8FHE (FHE:FHE) and v8Mixed (FHE:ERC, ERC:FHE) |
| Pool Types | ERC:ERC, FHE:FHE, ERC:FHE, FHE:ERC | FHE:FHE (v8FHE), FHE:ERC/ERC:FHE (v8Mixed) |
| Swaps | swapForPool(), swapEncrypted() | Hooks via PoolManager (no direct swap functions) |
| Liquidity | addLiquidity() + addLiquidityEncrypted() | v8FHE: addLiquidity(enc), v8Mixed: addLiquidity(mixed) |
| Limit Orders | deposit(), withdraw(), claim() | Same, but v8FHE is encrypted-only |
| Reserve Sync | Binary search with pendingDecrypts | Same mechanism |
| Momentum | No momentum in v6 | v8 has momentum closure + virtual slicing |

---

## Phase 1: Contract Infrastructure

### 1.1 Create v8 ABI Files

- [ ] Create `/lib/contracts/fheatherXv8FHE-abi.ts`
- [ ] Create `/lib/contracts/fheatherXv8Mixed-abi.ts`
- [ ] Update type definitions for new structs:
  - `PoolState` (simplified - no FHERC20 flags in v8FHE)
  - `PoolReserves` (includes nextRequestId, lastResolvedId)
  - `PendingDecrypt` struct

### 1.2 Update Address Configuration

Edit `/lib/contracts/addresses.ts`:

```typescript
// Add v8 hook addresses
export const FHEATHERX_V8_FHE_ADDRESSES: Record<number, `0x${string}`> = {
  31337: '0x...', // Local
  11155111: '0x...', // Eth Sepolia
  421614: '0x...', // Arb Sepolia
};

export const FHEATHERX_V8_MIXED_ADDRESSES: Record<number, `0x${string}`> = {
  31337: '0x...',
  11155111: '0x...',
  421614: '0x...',
};
```

### 1.3 Update Pool Store

Modify `/stores/poolStore.ts`:

- [ ] Add contract type to pool metadata: `contractType: 'v8fhe' | 'v8mixed' | 'v6'`
- [ ] Update `getSelectedPool()` to return contract type
- [ ] Add helper: `getContractAddress(poolType: string, chainId: number)`

---

## Phase 2: Hook Migrations

### 2.1 useSwap Hook

**Changes Required:**

v8 doesn't expose direct swap functions like v6's `swapForPool()`. Swaps happen through:
1. User calls PoolManager.swap()
2. Hook's beforeSwap callback processes the swap
3. Limit orders are triggered synchronously

**Migration Steps:**

- [ ] Keep `swapViaRouter()` as primary swap method (uses V4 PoolSwapTest)
- [ ] Remove `swapEncrypted()` (v8 handles privacy through encrypted reserves)
- [ ] Update `getQuote()` to call v8's `getQuote(poolId, zeroForOne, amountIn)`

```typescript
// v8 getQuote function signature
getQuote(PoolId poolId, bool zeroForOne, uint256 amountIn) returns (uint256)
```

### 2.2 usePlaceOrder Hook

**Changes Required:**

v8FHE only accepts encrypted deposits. v8Mixed accepts encrypted input token deposits.

- [ ] Add contract type detection in `placeOrder()`
- [ ] For v8FHE: Use encrypted `deposit()` (same as v6)
- [ ] For v8Mixed: Detect if input token is FHERC20, use appropriate path
- [ ] Update error handling for new v8 error types:
  - `NotFherc20Pair` (v8FHE only)
  - `PriceMoved` (same as v6)

### 2.3 useCancelOrder Hook (useWithdraw)

**Changes Required:**

Same signature as v6, but v8FHE requires encrypted withdraw amounts.

```typescript
// v8 withdraw signature (same as v6)
withdraw(PoolId poolId, int24 tick, BucketSide side, InEuint128 encryptedAmount)
```

- [ ] No changes needed if using encrypted amounts

### 2.4 useAddLiquidity Hook

**Changes Required:**

v8FHE only has encrypted liquidity functions:

```typescript
// v8FHE - encrypted only
addLiquidity(PoolId poolId, InEuint128 amount0, InEuint128 amount1) returns (euint128)

// v8Mixed - mixed (if token is ERC20, use plaintext; if FHERC20, use encrypted)
addLiquidity(PoolId poolId, uint256 amount0, uint256 amount1) returns (uint256)
addLiquidityEncrypted(PoolId poolId, InEuint128 amount0, InEuint128 amount1) returns (euint128)
```

- [ ] Add contract type detection
- [ ] v8FHE: Always use encrypted path
- [ ] v8Mixed: Detect token types, use appropriate function

### 2.5 useRemoveLiquidity Hook

**Changes Required:**

```typescript
// v8FHE - encrypted only
removeLiquidity(PoolId poolId, InEuint128 lpAmount) returns (euint128, euint128)

// v8Mixed - both variants available
removeLiquidity(PoolId poolId, uint256 lpAmount) returns (uint256, uint256)
removeLiquidityEncrypted(PoolId poolId, InEuint128 lpAmount) returns (euint128, euint128)
```

- [ ] Add contract type detection
- [ ] Handle encrypted LP balance for v8FHE

### 2.6 usePoolReserves Hook

**Changes Required:**

v8 has same reserve structure but with additional sync fields:

```typescript
// v8 poolReserves return
(encReserve0, encReserve1, encTotalLpSupply, reserve0, reserve1,
 reserveBlockNumber, nextRequestId, lastResolvedId)
```

- [ ] Update reserve parsing to handle new fields
- [ ] Add `trySyncReserves()` call option
- [ ] Track `nextRequestId` vs `lastResolvedId` for sync status display

### 2.7 usePoolInfo Hook

**Changes Required:**

v8 `poolStates` returns different structure:

```typescript
// v8FHE poolStates
(token0, token1, initialized, protocolFeeBps)

// v8Mixed poolStates
(token0, token1, token0IsFherc20, token1IsFherc20, initialized, protocolFeeBps)
```

- [ ] Update type definitions
- [ ] Handle missing `maxBuckets` field (hardcoded in v8)

### 2.8 useActiveOrders Hook

**Same as v6** - bucket structure unchanged.

- [ ] No changes required

### 2.9 useClaimableOrders Hook

**Same as v6** - position structure unchanged.

- [ ] No changes required

---

## Phase 3: New Features

### 3.1 Momentum Events UI

v8 emits `MomentumActivated` events when limit orders are triggered:

```solidity
event MomentumActivated(PoolId indexed poolId, int24 fromTick, int24 toTick, uint8 bucketsActivated);
```

- [ ] Add event listener for MomentumActivated
- [ ] Create notification component for momentum triggers
- [ ] Update order history to show momentum fills

### 3.2 Reserve Sync Status

v8 uses binary search reserve sync which can have pending decrypts:

- [ ] Create `useReserveSyncStatus` hook
- [ ] Display sync status indicator (pending vs resolved)
- [ ] Add manual `trySyncReserves()` button for stale reserves

### 3.3 Contract Type Selector

Since v8 has two contracts, users need to select the right one:

- [ ] Update pool discovery to detect contract type
- [ ] Add visual indicator for pool type (FHE:FHE vs Mixed)
- [ ] Ensure correct contract is called based on pool type

---

## Phase 4: Testing

### 4.1 E2E Tests Update

- [ ] Update Playwright tests for v8 contract addresses
- [ ] Add tests for momentum order fills
- [ ] Add tests for reserve sync status
- [ ] Update deposit/withdraw tests for v8FHE encrypted-only path

### 4.2 Mock Updates

- [ ] Update mock FHE encryption for v8 types
- [ ] Add mock data for v8 poolStates structure

---

## Phase 5: Deployment & Migration

### 5.1 Feature Flags

- [ ] Add `NEXT_PUBLIC_USE_V8=true` feature flag
- [ ] Support both v6 and v8 during transition
- [ ] Allow per-pool contract version selection

### 5.2 Address Updates

After v8 contracts are deployed:

- [ ] Update addresses.ts with v8 contract addresses
- [ ] Update deployment JSON files
- [ ] Update environment variables

### 5.3 Documentation

- [ ] Update CLAUDE.md with v8 contract references
- [ ] Update frontend README with v8 changes
- [ ] Document breaking changes for users

---

## Function Mapping: v6 → v8

| v6 Function | v8FHE Equivalent | v8Mixed Equivalent |
|-------------|-----------------|-------------------|
| `swapForPool(poolId, zeroForOne, amountIn, minOut)` | Use router swap | Use router swap |
| `swapEncrypted(poolId, dir, amt, min)` | N/A (removed) | N/A (removed) |
| `addLiquidity(poolId, amt0, amt1)` | `addLiquidity(poolId, encAmt0, encAmt1)` | Same |
| `addLiquidityEncrypted(poolId, encAmt0, encAmt1)` | Same signature | Same |
| `removeLiquidity(poolId, lpAmt)` | `removeLiquidity(poolId, encLpAmt)` | Same |
| `removeLiquidityEncrypted(poolId, encLpAmt)` | Same signature | Same |
| `deposit(poolId, tick, side, encAmt, deadline, maxDrift)` | Same signature | Same signature |
| `withdraw(poolId, tick, side, encAmt)` | Same signature | Same signature |
| `claim(poolId, tick, side)` | Same signature | Same signature |
| `getQuoteForPool(poolId, zeroForOne, amountIn)` | `getQuote(poolId, zeroForOne, amountIn)` | Same |
| `getReserves(poolId)` | Same | Same |
| `getCurrentTickForPool(poolId)` | `getCurrentTick(poolId)` | Same |
| `getPoolState(poolId)` | `poolStates(poolId)` | Same |
| `trySyncReserves(poolId)` | Same | Same |

---

## Notes

1. **No ERC:ERC pools in v8**: Native Uniswap v4 should be used for purely plaintext trading.

2. **Momentum is automatic**: Unlike v6, momentum closure happens automatically during swaps. No user action required.

3. **Binary search reserve sync**: The binary search pattern ensures we always get the newest resolved decrypt, even under high traffic.

4. **SwapLock per TX**: v8 uses transient storage for swap locks, preventing sandwich attacks (one swap per pool per transaction).

---

## Priority Order

1. **High Priority**: ABI files, address config, useSwap
2. **Medium Priority**: useAddLiquidity, useRemoveLiquidity, usePoolInfo
3. **Low Priority**: Momentum events UI, reserve sync status display
4. **Can Defer**: Feature flags, gradual migration support
