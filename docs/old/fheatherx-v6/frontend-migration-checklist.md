# FheatherX v6 Frontend Migration Checklist

> **Status**: PENDING USER APPROVAL
> **Created**: 2024-12-09
> **Purpose**: Update frontend from v5 to v6 contract integration

---

## Overview

The frontend currently uses v5 contract ABIs and function signatures. This checklist covers all changes needed to fully support FheatherXv6.

### Key v6 Contract Changes
1. **deposit()** - New signature with `deadline`, `maxTickDrift` parameters
2. **swapForPool()** - New multi-pool swap function
3. **getQuoteForPool()** / **getCurrentTickForPool()** - New view functions
4. **BucketSide enum** - Used for limit orders (SELL=0, BUY=1)
5. **Mixed token pairs** - ERC20:FHERC20 combinations supported
6. **PoolId everywhere** - Multi-pool architecture

---

## Complete v6 Function Signatures (Plaintext vs Encrypted)

### Swap Functions
| Function | Type | Signature | Notes |
|----------|------|-----------|-------|
| `swap()` | Plaintext | `swap(bool zeroForOne, uint256 amountIn, uint256 minAmountOut) returns (uint256)` | Uses defaultPoolId |
| `swapForPool()` | Plaintext | `swapForPool(PoolId poolId, bool zeroForOne, uint256 amountIn, uint256 minAmountOut) returns (uint256)` | Multi-pool |
| `swapEncrypted()` | Encrypted | `swapEncrypted(PoolId poolId, InEbool direction, InEuint128 amountIn, InEuint128 minOutput) returns (euint128)` | Direction & amount hidden |

### Liquidity Functions
| Function | Type | Signature | Notes |
|----------|------|-----------|-------|
| `addLiquidity()` | Plaintext | `addLiquidity(PoolId poolId, uint256 amount0, uint256 amount1) returns (uint256 lpAmount)` | Works for any pool |
| `addLiquidityEncrypted()` | Encrypted | `addLiquidityEncrypted(PoolId poolId, InEuint128 amount0, InEuint128 amount1) returns (euint128 lpAmount)` | **Only FHE:FHE pools** |
| `removeLiquidity()` | Plaintext | `removeLiquidity(PoolId poolId, uint256 lpAmount) returns (uint256 amount0, uint256 amount1)` | Works for any pool |
| `removeLiquidityEncrypted()` | Encrypted | `removeLiquidityEncrypted(PoolId poolId, InEuint128 lpAmount) returns (euint128 amount0, euint128 amount1)` | For FHE pools |

### Limit Order Functions (All use encrypted amounts)
| Function | Type | Signature | Notes |
|----------|------|-----------|-------|
| `deposit()` | Encrypted | `deposit(PoolId poolId, int24 tick, BucketSide side, InEuint128 encryptedAmount, uint256 deadline, int24 maxTickDrift)` | Input token must be FHERC20 |
| `withdraw()` | Encrypted | `withdraw(PoolId poolId, int24 tick, BucketSide side, InEuint128 encryptedAmount)` | Withdraw unfilled orders |
| `claim()` | N/A | `claim(PoolId poolId, int24 tick, BucketSide side)` | Claims filled proceeds |
| `exit()` | N/A | `exit(PoolId poolId, int24 tick, BucketSide side)` | Withdraw + Claim combined |

### BucketSide Enum
```solidity
enum BucketSide { BUY, SELL }  // BUY=0, SELL=1
```

### Key Constraints
- `addLiquidityEncrypted()` - **Requires BOTH tokens to be FHERC20** (reverts with `BothTokensMustBeFherc20`)
- `deposit()` - **Input token must be FHERC20** (reverts with `InputTokenMustBeFherc20`)
  - SELL side: deposits token0 (must be FHERC20)
  - BUY side: deposits token1 (must be FHERC20)

---

## Phase 1: ABI Updates

### 1.1 Create v6 ABI File
- [ ] Create `/frontend/src/lib/contracts/fheatherXv6Abi.ts`
- [ ] Export from FheatherXv6 contract using `forge inspect FheatherXv6 abi`
- [ ] Add TypeScript type exports for:
  - BucketSide enum
  - PoolState struct
  - SwapParams struct

### 1.2 Update ABI Exports
- [ ] Update `/frontend/src/lib/contracts/index.ts` to export v6 ABI
- [ ] Keep v5 ABI as `FHEATHERX_V5_ABI` for reference/fallback
- [ ] Deprecate old `abi.ts` file (simple deposit ABI)

### 1.3 Verify Function Signatures
```solidity
// v6 Functions to verify in ABI:
deposit(PoolId poolId, int24 tick, BucketSide side, InEuint128 encryptedAmount, uint256 deadline, int24 maxTickDrift)
withdraw(PoolId poolId, int24 tick, BucketSide side, InEuint128 encryptedAmount)
claim(PoolId poolId, int24 tick, BucketSide side)
exit(PoolId poolId, int24 tick, BucketSide side)
addLiquidity(PoolId poolId, uint256 amount0, uint256 amount1) returns (uint256 lpAmount)
removeLiquidity(PoolId poolId, uint256 lpAmount) returns (uint256 amount0, uint256 amount1)
swapForPool(PoolId poolId, bool zeroForOne, uint256 amountIn, uint256 minAmountOut) returns (uint256 amountOut)
getQuoteForPool(PoolId poolId, bool zeroForOne, uint256 amountIn) returns (uint256)
getCurrentTickForPool(PoolId poolId) returns (int24)
getPoolState(PoolId poolId) returns (tuple)
getPoolReserves(PoolId poolId) returns (tuple)
hasActiveOrders(PoolId poolId, int24 tick, BucketSide side) returns (bool)
hasOrdersAtTick(PoolId poolId, int24 tick, BucketSide side) returns (bool)
```

---

## Phase 2: Hook Updates (CRITICAL)

### 2.1 useDeposit.ts - CRITICAL CHANGE
**File**: `/frontend/src/hooks/useDeposit.ts`

**Current v5 signature**:
```typescript
deposit(isToken0: boolean, amount: bigint)
```

**New v6 signature**:
```typescript
deposit(
  poolId: `0x${string}`,
  tick: number,
  side: 0 | 1,  // BucketSide.BUY=0, BucketSide.SELL=1
  encryptedAmount: `0x${string}`,
  deadline: bigint,
  maxTickDrift: number
)
```

**Changes required**:
- [ ] Update function call to include all new parameters
- [ ] Add deadline calculation: `BigInt(Math.floor(Date.now() / 1000) + 3600)` (1 hour)
- [ ] Add maxTickDrift parameter (use constant, e.g., 600 = 10 ticks)
- [ ] Add tick parameter for limit order price level
- [ ] Add side parameter (BucketSide enum)
- [ ] Switch from `FHEATHERX_ABI` to `FHEATHERX_V6_ABI`

### 2.2 useWithdraw.ts - CRITICAL CHANGE
**File**: `/frontend/src/hooks/useWithdraw.ts`

**Current v5 signature**:
```typescript
withdraw(isToken0: boolean, amount: bigint)
```

**New v6 signature**:
```typescript
withdraw(
  poolId: `0x${string}`,
  tick: number,
  side: 0 | 1,
  encryptedAmount: `0x${string}`
)
```

**Changes required**:
- [ ] Update function call with poolId, tick, side parameters
- [ ] Switch ABI import

### 2.3 useAddLiquidity.ts - UPDATE FOR ENCRYPTED VARIANT
**File**: `/frontend/src/hooks/useAddLiquidity.ts`

**v6 signatures**:
```typescript
// Plaintext (unchanged)
addLiquidity(poolId: bytes32, amount0: uint256, amount1: uint256) returns (uint256)

// Encrypted (v6 - Only for FHE:FHE pools!)
addLiquidityEncrypted(poolId: bytes32, amount0: InEuint128, amount1: InEuint128) returns (euint128)
```

**Changes required**:
- [ ] Verify plaintext `addLiquidity()` signature matches
- [ ] Add support for `addLiquidityEncrypted()` when both tokens are FHERC20
- [ ] Add pool type check: `if (token0IsFherc20 && token1IsFherc20)` → use encrypted
- [ ] Handle `BothTokensMustBeFherc20` revert for encrypted function on mixed pools

### 2.4 useRemoveLiquidity.ts - UPDATE FOR ENCRYPTED VARIANT
**File**: `/frontend/src/hooks/useRemoveLiquidity.ts`

**v6 signatures**:
```typescript
// Plaintext (unchanged)
removeLiquidity(poolId: bytes32, lpAmount: uint256) returns (uint256, uint256)

// Encrypted (v6)
removeLiquidityEncrypted(poolId: bytes32, lpAmount: InEuint128) returns (euint128, euint128)
```

**Changes required**:
- [ ] Verify plaintext `removeLiquidity()` signature matches
- [ ] Add support for `removeLiquidityEncrypted()` for FHE pools
- [ ] Handle encrypted return values (euint128 amounts)

### 2.5 usePlaceOrder.ts - MAY NEED UPDATE
**File**: `/frontend/src/hooks/usePlaceOrder.ts`

**Check if v6 has placeOrder or uses deposit()**:
- [ ] Review v6 contract for order placement function
- [ ] If using `deposit()`, refactor to match v6 signature
- [ ] Update ABI import

### 2.6 useClosePosition.ts - VERIFY
**File**: `/frontend/src/hooks/useClosePosition.ts`

**v6 signature**:
```typescript
exit(poolId: bytes32, tick: int24, side: uint8)
```

**Changes required**:
- [ ] Verify signature matches
- [ ] Update ABI if needed

### 2.7 useSwap.ts - ADD ALL SWAP VARIANTS
**File**: `/frontend/src/hooks/useSwap.ts`

**v6 signatures**:
```typescript
// Plaintext (default pool)
swap(bool zeroForOne, uint256 amountIn, uint256 minAmountOut) returns (uint256)

// Plaintext (specific pool)
swapForPool(PoolId poolId, bool zeroForOne, uint256 amountIn, uint256 minAmountOut) returns (uint256)

// Encrypted (direction, amount, and min output ALL hidden!)
swapEncrypted(PoolId poolId, InEbool direction, InEuint128 amountIn, InEuint128 minOutput) returns (euint128)
```

**Changes required**:
- [ ] Add option to use direct `swap()` or `swapForPool()` instead of V4 router
- [ ] Keep router-based swap as option
- [ ] Add support for `swapEncrypted()` for full privacy (hides direction!)
- [ ] Add `getQuoteForPool()` for better quote estimation
- [ ] For `swapEncrypted()`: encrypt direction as `InEbool`, amounts as `InEuint128`

### 2.8 useCurrentPrice.ts - ADD NEW FUNCTIONS
**File**: `/frontend/src/hooks/useCurrentPrice.ts`

**New v6 functions**:
```typescript
getQuoteForPool(poolId, zeroForOne, amountIn) returns (uint256)
getCurrentTickForPool(poolId) returns (int24)
```

**Changes required**:
- [ ] Add `useQuote` hook or integrate into existing
- [ ] Use `getCurrentTickForPool()` for tick display
- [ ] Keep `getPoolReserves()` for reserve display

### 2.9 View Function Hooks - VERIFY
- [ ] `usePoolInfo.ts` - Verify `getPoolState()` signature
- [ ] `useUserLPPositions.ts` - Verify `lpBalances()`, `encLpBalances()`
- [ ] `useActiveOrders.ts` - Verify order query functions
- [ ] `useOrderHistory.ts` - Verify historical order queries

---

## Phase 3: Component Updates

### 3.1 Deposit/Withdraw Forms
**Files**:
- `/frontend/src/components/portfolio/DepositForm.tsx`
- Withdraw form (if exists)

**Changes required**:
- [ ] Add tick selection UI for limit order price
- [ ] Add side selection (Buy/Sell) UI
- [ ] Pass new parameters to `useDeposit()` hook

### 3.2 Limit Order Form
**File**: `/frontend/src/components/trade/LimitOrderForm.tsx`

**Changes required**:
- [ ] Ensure tick selection works with v6
- [ ] Ensure side enum is passed correctly
- [ ] Add deadline display/configuration (optional)

### 3.3 Liquidity Forms
**Files**:
- `/frontend/src/components/liquidity/AddLiquidityForm.tsx`
- `/frontend/src/components/liquidity/RemoveLiquidityForm.tsx`

**Changes required**:
- [ ] Verify forms work with v6 hooks
- [ ] No major changes expected

### 3.4 Swap Form
**File**: `/frontend/src/components/trade/MarketSwapForm.tsx`

**Changes required**:
- [ ] Optionally add toggle for direct swap vs router swap
- [ ] Use `getQuoteForPool()` for better quote display

---

## Phase 4: Constants & Configuration

### 4.1 Update constants.ts
**File**: `/frontend/src/lib/constants.ts`

**Add**:
- [ ] `DEFAULT_DEADLINE_SECONDS = 3600` (1 hour)
- [ ] `DEFAULT_MAX_TICK_DRIFT = 600` (10 ticks of 60 spacing)
- [ ] `BucketSide` enum if not in ABI
```typescript
export const BucketSide = {
  BUY: 0,
  SELL: 1
} as const;
```

### 4.2 Verify addresses.ts
**File**: `/frontend/src/lib/contracts/addresses.ts`

**Status**: Already updated for v6!
- [x] Hook addresses configured
- [x] Factory addresses zeroed (not used in v6)

---

## Phase 5: Types & Stores

### 5.1 Update Type Definitions
**File**: `/frontend/src/types/` (various)

**Add/Update**:
- [ ] `BucketSide` type
- [ ] Updated deposit parameters type
- [ ] Updated withdraw parameters type

### 5.2 Pool Store - VERIFY
**File**: `/frontend/src/stores/poolStore.ts`

**Status**: Already supports multi-pool architecture
- [ ] Verify no breaking changes

---

## Phase 6: Testing

### 6.1 Unit Test Updates
- [ ] Update mock contract responses for new signatures
- [ ] Add tests for deadline/maxTickDrift handling

### 6.2 E2E Test Updates
**Files**: `/frontend/e2e/tests/`

- [ ] Update deposit test scenarios
- [ ] Update limit order test scenarios
- [ ] Verify swap tests work with v6

### 6.3 Manual Testing Checklist
- [ ] Connect wallet
- [ ] Initialize FHE session
- [ ] Deposit tokens (with new params)
- [ ] Place limit order
- [ ] Execute market swap
- [ ] Add liquidity
- [ ] Remove liquidity
- [ ] Withdraw from limit order
- [ ] Claim filled order proceeds

---

## Phase 7: Cleanup

### 7.1 Remove Deprecated Code
- [ ] Remove references to old `abi.ts` if fully migrated
- [ ] Remove v5-specific comments
- [ ] Clean up unused imports

### 7.2 Documentation
- [ ] Update CLAUDE.md with v6 changes
- [ ] Update component comments
- [ ] Update hook docstrings

---

## Implementation Order (Recommended)

1. **ABI First** - Create v6 ABI file
2. **Constants** - Add deadline, maxTickDrift constants
3. **Core Hooks** - useDeposit, useWithdraw (most critical)
4. **View Hooks** - useCurrentPrice, usePoolInfo
5. **Components** - Update forms to pass new params
6. **Testing** - Verify all flows work
7. **Cleanup** - Remove deprecated code

---

## Risk Assessment

| Change | Risk Level | Notes |
|--------|------------|-------|
| deposit() signature | HIGH | Breaking change, core functionality |
| withdraw() signature | HIGH | Breaking change |
| addLiquidity() | LOW | Signature unchanged |
| removeLiquidity() | LOW | Signature unchanged |
| swap via router | LOW | Router interface unchanged |
| swapForPool() | MEDIUM | New function, optional |
| View functions | LOW | Additive changes |

---

## Rollback Plan

If issues arise during migration:
1. Keep v5 ABI exported as fallback
2. Add feature flag for v6 functions
3. Can switch between v5/v6 via environment variable

---

## E2E Test Cross-Reference

### Current E2E Test Coverage (from frontend/e2e/tests/)

| Test File | Operations Tested | Hook Used |
|-----------|-------------------|-----------|
| `09-liquidity-functional.spec.ts` | Add liquidity to 3 pool types | `useAddLiquidity` |
| `10-swap-functional.spec.ts` | Market swaps (both directions) | `useSwap` |
| `11-limit-order-functional.spec.ts` | All 4 order types | `usePlaceOrder` |

### V6 Coverage Gap Analysis

| Function | Currently Tested | V6 Action Required |
|----------|------------------|-------------------|
| `addLiquidity()` | Yes (3 pool types) | Verify signature unchanged |
| `addLiquidityEncrypted()` | No | Add test for FHE:FHE pool |
| `removeLiquidity()` | No | Add removal test |
| `removeLiquidityEncrypted()` | No | Add encrypted removal test |
| `swap()` | Yes (via router) | Add direct swap test |
| `swapForPool()` | No | Add multi-pool swap test |
| `swapEncrypted()` | No | Add encrypted swap test (full privacy) |
| `deposit()` | Indirectly via `placeLimitOrder` | Update signature (deadline, maxTickDrift) |
| `withdraw()` | No | Add withdrawal test |
| `claim()` | No | Add claim test |
| `exit()` | No | Add exit test |

### E2E Test Updates Required for V6

**`09-liquidity-functional.spec.ts`**:
- [ ] Add `removeLiquidity` test after adding liquidity
- [ ] Add `addLiquidityEncrypted` test on FHE:FHE pool (if frontend supports it)
- [ ] Add `removeLiquidityEncrypted` test

**`10-swap-functional.spec.ts`**:
- [ ] Test direct `swap()` (default pool) vs `swapForPool()` (specific pool)
- [ ] Add `swapEncrypted()` test (encrypted direction, amount, minOutput)

**`11-limit-order-functional.spec.ts`**:
- [ ] Update `placeLimitOrder` helper for v6 `deposit()` signature (deadline, maxTickDrift)
- [ ] Add `withdraw()` test (withdraw unfilled orders)
- [ ] Add `claim()` test (claim filled proceeds)
- [ ] Add `exit()` test (withdraw + claim combined)

### New E2E Test File Needed: `12-encrypted-operations.spec.ts`

Test fully private operations:
- [ ] `swapEncrypted()` - hidden direction and amount
- [ ] `addLiquidityEncrypted()` - on FHE:FHE pool only
- [ ] `removeLiquidityEncrypted()` - encrypted LP token redemption
- [ ] Verify `BothTokensMustBeFherc20` error on mixed pools

---

## Approval Required

Before implementing:
- [ ] User confirms this checklist covers all required changes
- [ ] User approves implementation order
- [ ] User confirms target deployment (Eth Sepolia / Arb Sepolia)
