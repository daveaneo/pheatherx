# FheatherX Frontend Implementation Plan

**Date**: 2025-12-07
**Based On**: [Frontend Audit Report](frontend-audit.md)
**Current Status**: 70-75% Complete
**Target**: 100% VISION.md Compliance
**Scope**: Desktop MVP (mobile deferred)

---

## Overview

This plan addresses the 5 critical gaps identified in the frontend audit:

| Gap | Problem | Solution | Phase |
|-----|---------|----------|-------|
| 1 | Users cannot claim profits from filled orders | Implement "Close Position" via `exit()` | Phase 1 |
| 2 | ERC20 limit orders expose amounts on-chain | Block ERC20 input, require FHERC20 | Phase 1 |
| 3 | Only 1 pool hardcoded per chain | Query factory for all pools | Phase 2 |
| 4 | No wrap/unwrap UI for token conversion | Create WrapUnwrapCard component | Phase 2 |
| 5 | Only 2 tokens configured, need 24 pairs | Multi-pool token selection | Phase 2 |

---

## Prerequisites (Before Starting)

### Contract Interface Verification

| Function | Signature | Source | Notes |
|----------|-----------|--------|-------|
| `exit()` | `exit(PoolId, int24, BucketSide)` | FheatherXv5.sol:675 | Withdraws unfilled + claims proceeds |
| `wrap()` | `wrap(uint256 amount)` | FHERC20FaucetToken.sol:123 | Converts ERC20 balance to encrypted |
| `unwrap()` | `unwrap(uint256 amount)` | FHERC20FaucetToken.sol:139 | Requires encrypted balance exists |
| `poolCount()` | `poolCount() → uint256` | FheatherXFactory.sol:207 | Total registered pools |
| `getAllPools()` | `getAllPools() → PoolInfo[]` | FheatherXFactory.sol:183 | Returns all pools at once |
| `getActivePools()` | `getActivePools() → PoolInfo[]` | FheatherXFactory.sol:189 | Returns only active pools |
| `getPool()` | `getPool(tokenA, tokenB) → address` | FheatherXFactory.sol:149 | Get hook by token pair |

**PoolInfo struct** (from factory):
```solidity
struct PoolInfo {
    address token0;
    address token1;
    address hook;
    uint256 createdAt;
    bool active;
}
```

### Regression Testing
- [ ] Run `npm run test:e2e` and document any failures
- [ ] Snapshot current behavior before changes

---

## Phase 1: Critical (Blocking Production)

### Task 1.1: Implement Close Position Flow
**P0 | Size M | Risk Low**

**Problem**: Users cannot claim profits from filled limit orders. The audit found only a "Cancel" button exists, which calls `withdraw()` but doesn't claim proceeds.

**Solution**: Create `useClosePosition` hook that calls contract's `exit()` function, which does both withdraw + claim in one transaction.

**Contract Interface**:
```solidity
function exit(
    PoolId poolId,
    int24 tick,
    BucketSide side
) external nonReentrant whenNotPaused
// Emits: Withdraw(poolId, user, tick, side, amountHash)
// Emits: Claim(poolId, user, tick, side, amountHash)
```

**Files to Create/Modify**:
| File | Action | Purpose |
|------|--------|---------|
| `src/hooks/useClosePosition.ts` | Create | Hook to call `exit()` |
| `src/components/orders/ActiveOrdersPanel.tsx` | Modify | Add "Close Position" button |
| `src/components/portfolio/OrdersTab.tsx` | Modify | Update order row actions |
| `src/lib/contracts/abi/FheatherXv5.ts` | Modify | Add `exit` to ABI |

**Deliverables**:
- [ ] Create `useClosePosition(poolId, tick, side)` hook
- [ ] Hook returns: `{ closePosition, isClosing, error, txHash }`
- [ ] Add "Close Position" button to each order row (replaces or alongside "Cancel")
- [ ] Show transaction states: idle → pending → success/error
- [ ] Refresh order list and balances after successful close
- [ ] Handle errors with user-friendly messages:
  - `INSUFFICIENT_GAS`: "Not enough gas. Please try again with more ETH."
  - `CONTRACT_PAUSED`: "Trading is temporarily paused."
  - `USER_REJECTED`: "Transaction cancelled."
  - `TRANSACTION_REVERTED`: "Transaction failed. Position may already be closed."

**Data Test IDs**:
- `close-position-btn` - Close button on each order
- `order-row-{index}` - Order row container
- `tx-pending` - Loading state indicator
- `tx-success` - Success state indicator
- `tx-error` - Error message display

**E2E Test Criteria**:
```typescript
test('user can close position and receive tokens', async ({ page }) => {
  // Given: User has an active order (setup in beforeEach)
  await page.goto('/portfolio');
  await page.click('[data-testid="orders-tab"]');

  // When: User clicks close position
  const orderRow = page.locator('[data-testid="order-row-0"]');
  await expect(orderRow).toBeVisible();
  await orderRow.locator('[data-testid="close-position-btn"]').click();

  // Then: Transaction succeeds
  await page.waitForSelector('[data-testid="tx-pending"]');
  await page.waitForSelector('[data-testid="tx-success"]', { timeout: 30000 });

  // And: Order is removed from list
  await expect(orderRow).not.toBeVisible();
});
```

---

### Task 1.2: Add Privacy Enforcement
**P0 | Size S | Risk Medium**

**Problem**: Users can place limit orders with ERC20 tokens as input. This exposes order amounts on-chain, defeating the privacy promise. The token-pair-support.md document says this is "unsafe" but the UI doesn't block it.

**Solution**: Block limit order submission when input token is ERC20. Show clear error with link to wrap UI.

**Privacy Matrix** (from token-pair-support.md):
| Input Token | Output Token | Action | Reason |
|-------------|--------------|--------|--------|
| FHERC20 | FHERC20 | ALLOW | Full privacy - both amounts encrypted |
| FHERC20 | ERC20 | ALLOW | Input hidden, output visible (acceptable) |
| ERC20 | FHERC20 | BLOCK | Input amount visible on-chain |
| ERC20 | ERC20 | BLOCK | Both amounts visible on-chain |

**Files to Create/Modify**:
| File | Action | Purpose |
|------|--------|---------|
| `src/lib/tokens.ts` | Modify | Add `isFHERC20(token)` helper |
| `src/lib/validation/privacyRules.ts` | Create | Privacy validation logic |
| `src/components/trade/LimitOrderForm.tsx` | Modify | Add validation check |

**Deliverables**:
- [ ] Add `type: 'erc20' | 'fherc20'` to Token interface (if not present)
- [ ] Create `isFHERC20(token: Token): boolean` helper
- [ ] Create `validateLimitOrderPrivacy(inputToken: Token): { valid: boolean; error?: string }`
- [ ] In LimitOrderForm, check privacy before enabling submit
- [ ] Show inline error when ERC20 selected:
  ```
  "Privacy Warning: Limit orders with ERC20 tokens expose your order
  amount on-chain. Wrap your tokens to FHERC20 first for privacy."
  [Wrap Tokens →]
  ```
- [ ] Disable submit button when validation fails
- [ ] Link "Wrap Tokens" to portfolio wrap tab (Task 2.2)

**Data Test IDs**:
- `privacy-error` - Error message container
- `privacy-error-link` - Link to wrap UI
- `submit-order-btn` - Submit button (should be disabled)

**E2E Test Criteria**:
```typescript
test('blocks ERC20 limit orders with privacy warning', async ({ page }) => {
  await page.goto('/trade');
  await page.click('[data-testid="limit-order-tab"]');

  // Select ERC20 token (WETH) as input
  await page.click('[data-testid="input-token-selector"]');
  await page.click('[data-testid="token-WETH"]');

  // Enter amount
  await page.fill('[data-testid="amount-input"]', '1.0');

  // Verify: Error shown, button disabled
  await expect(page.locator('[data-testid="privacy-error"]')).toContainText('wrap');
  await expect(page.locator('[data-testid="submit-order-btn"]')).toBeDisabled();

  // Verify: Link to wrap exists
  await expect(page.locator('[data-testid="privacy-error-link"]')).toBeVisible();
});

test('allows FHERC20 limit orders', async ({ page }) => {
  await page.goto('/trade');
  await page.click('[data-testid="limit-order-tab"]');

  // Select FHERC20 token (fheWETH) as input
  await page.click('[data-testid="input-token-selector"]');
  await page.click('[data-testid="token-fheWETH"]');

  // Verify: No error, button enabled
  await expect(page.locator('[data-testid="privacy-error"]')).not.toBeVisible();
  await expect(page.locator('[data-testid="submit-order-btn"]')).not.toBeDisabled();
});
```

---

### Task 1.3: Fix Token Configuration
**P0 | Size S | Risk Low**

**Problem**: Only 2 tokens (TOKEN0, TOKEN1) are configured per chain. The dApp has 4 tokens (WETH, USDC, fheWETH, fheUSDC) but addresses.ts only tracks 2.

**Solution**: Expand token configuration to include all 4 tokens with type and wrapper relationships.

**Token Addresses (Ethereum Sepolia)**:
| Token | Symbol | Type | Decimals | Address |
|-------|--------|------|----------|---------|
| WETH | WETH | erc20 | 18 | `0xe9Df64F549Eb1d2778909F339B9Bd795d14cF32E` |
| USDC | USDC | erc20 | 6 | `0xF7Ff2A5E74eaA6E0463358BB26780049d3D45C56` |
| fheWETH | fheWETH | fherc20 | 18 | `0xf0F8f49b4065A1B01050Fa358d287106B676a25F` |
| fheUSDC | fheUSDC | fherc20 | 6 | `0x1D77eE754b2080B354733299A5aC678539a0D740` |

**Files to Modify**:
| File | Action | Purpose |
|------|--------|---------|
| `src/lib/contracts/addresses.ts` | Modify | Add all 4 token addresses |
| `src/lib/tokens.ts` | Modify | Update TOKEN_LIST with full metadata |
| `src/lib/faucetTokens.ts` | Verify | Ensure matches (already has all 4) |

**Deliverables**:
- [ ] Restructure addresses.ts to support 4 tokens:
  ```typescript
  export const ALL_TOKENS: Record<number, TokenConfig[]> = {
    11155111: [
      { address: '0xe9Df...', symbol: 'WETH', type: 'erc20', decimals: 18 },
      { address: '0xF7Ff...', symbol: 'USDC', type: 'erc20', decimals: 6 },
      { address: '0xf0F8...', symbol: 'fheWETH', type: 'fherc20', decimals: 18, wraps: '0xe9Df...' },
      { address: '0x1D77...', symbol: 'fheUSDC', type: 'fherc20', decimals: 6, wraps: '0xF7Ff...' },
    ]
  };
  ```
- [ ] Add `wraps` field to FHERC20 tokens (address of underlying ERC20)
- [ ] Add `wrappedBy` field to ERC20 tokens (address of FHERC20 wrapper)
- [ ] Update TOKEN_LIST to use new structure
- [ ] Verify faucetTokens.ts consistency

**Data Test IDs**:
- `token-{symbol}` - Token display elements (e.g., `token-WETH`, `token-fheUSDC`)

**E2E Test Criteria**:
```typescript
test('all 4 tokens available in UI', async ({ page }) => {
  await page.goto('/portfolio');

  const tokens = ['WETH', 'USDC', 'fheWETH', 'fheUSDC'];
  for (const symbol of tokens) {
    await expect(page.locator(`[data-testid="token-${symbol}"]`)).toBeVisible();
  }
});
```

---

### Phase 1 Definition of Done
- [ ] All 3 tasks complete with deliverables checked off
- [ ] E2E tests pass: `npm run test:e2e`
- [ ] Manual QA checklist:
  - [ ] Can close a position and see balance increase
  - [ ] Cannot submit limit order with WETH/USDC input
  - [ ] Can submit limit order with fheWETH/fheUSDC input
  - [ ] All 4 tokens visible in portfolio and faucet
- [ ] No console errors in browser dev tools
- [ ] Code reviewed and merged to main

---

## Phase 2: High Priority (Core Functionality)

### Task 2.1: Implement Pool Discovery
**P1 | Size L | Risk Medium**

**Problem**: Pools are hardcoded via environment variables. The `usePoolDiscovery` hook exists but isn't connected. Factory contract has pools but frontend doesn't query them.

**Solution**: Complete pool discovery by calling factory's `getActivePools()` and caching in poolStore.

**Factory Interface** (verified from FheatherXFactory.sol):
```solidity
function poolCount() external view returns (uint256);
function getAllPools() external view returns (PoolInfo[] memory);
function getActivePools() external view returns (PoolInfo[] memory);  // Use this one
function getPool(address tokenA, address tokenB) external view returns (address);

struct PoolInfo {
    address token0;
    address token1;
    address hook;
    uint256 createdAt;
    bool active;
}
```

**Files to Create/Modify**:
| File | Action | Purpose |
|------|--------|---------|
| `src/hooks/usePoolDiscovery.ts` | Modify | Implement factory calls |
| `src/providers/PoolProvider.tsx` | Modify | Call discovery on mount |
| `src/stores/poolStore.ts` | Modify | Store discovered pools |
| `src/lib/contracts/abi/FheatherXFactory.ts` | Create | Factory ABI |

**Deliverables**:
- [ ] Add FheatherXFactory ABI with `getActivePools`, `poolCount`, `getPool`
- [ ] Implement `usePoolDiscovery()` hook:
  - Call `factory.getActivePools()` on mount and chain change
  - Parse PoolInfo[] into frontend Pool type
  - Return `{ pools, isLoading, error, refetch }`
- [ ] Update poolStore with discovered pools
- [ ] Handle edge cases:
  - Factory not deployed: Fall back to hardcoded pool
  - Zero pools: Show "No pools available" message
  - RPC error: Show error + retry button
- [ ] Add loading skeleton while discovering
- [ ] Auto-refresh when chain changes

**Error Handling**:
```typescript
type PoolDiscoveryError =
  | { type: 'FACTORY_NOT_DEPLOYED'; message: string }
  | { type: 'RPC_ERROR'; message: string }
  | { type: 'NO_POOLS'; message: string };
```

**Data Test IDs**:
- `pool-loading` - Loading skeleton
- `pool-selector` - Pool dropdown
- `pool-option` - Individual pool option
- `pool-error` - Error message
- `pool-retry-btn` - Retry button

**E2E Test Criteria**:
```typescript
test('discovers pools from factory', async ({ page }) => {
  await page.goto('/trade');

  // Wait for discovery to complete
  await page.waitForSelector('[data-testid="pool-loading"]', { state: 'detached', timeout: 10000 });

  // Open pool selector
  await page.click('[data-testid="pool-selector"]');

  // Should show at least one pool
  const poolOptions = page.locator('[data-testid="pool-option"]');
  await expect(poolOptions.first()).toBeVisible();
});

test('falls back to hardcoded pool on factory error', async ({ page }) => {
  // This test requires mocking factory to fail
  // Verify fallback pool is still usable
});
```

---

### Task 2.2: Add Wrap/Unwrap UI
**P1 | Size M | Risk Low**

**Problem**: No UI for converting ERC20 tokens to FHERC20 and back. Users need this to use private limit orders.

**Solution**: Create WrapUnwrapCard component in portfolio page.

**Contract Interface** (from FHERC20FaucetToken.sol):
```solidity
// Wrap: Convert ERC20 balance to encrypted FHERC20 balance
function wrap(uint256 amount) external;
// Requires: balanceOf(msg.sender) >= amount
// Result: Burns ERC20, adds to encrypted balance

// Unwrap: Convert encrypted balance back to ERC20
function unwrap(uint256 amount) external;
// Requires: Common.isInitialized(_encBalances[msg.sender])
// Result: Subtracts from encrypted, mints ERC20
```

**Flow**:
1. User selects token pair (e.g., WETH → fheWETH)
2. User enters amount
3. For wrap: Check ERC20 allowance, approve if needed, then wrap
4. For unwrap: Direct call (no approval needed)
5. Show success and updated balances

**Files to Create/Modify**:
| File | Action | Purpose |
|------|--------|---------|
| `src/hooks/useWrap.ts` | Create | Wrap with approval flow |
| `src/hooks/useUnwrap.ts` | Create | Unwrap hook |
| `src/components/tokens/WrapUnwrapCard.tsx` | Create | UI component |
| `src/app/portfolio/page.tsx` | Modify | Add wrap tab/section |

**Deliverables**:
- [ ] Create `useWrap(fherc20Address)` hook:
  - Check current allowance
  - If insufficient: call `erc20.approve(fherc20Address, amount)`
  - Wait for approval tx
  - Call `fherc20.wrap(amount)`
  - Return `{ wrap, isApproving, isWrapping, error }`
- [ ] Create `useUnwrap(fherc20Address)` hook:
  - Call `fherc20.unwrap(amount)` directly
  - Return `{ unwrap, isUnwrapping, error }`
- [ ] Create WrapUnwrapCard component:
  - Toggle between Wrap and Unwrap modes
  - Token pair selector (only show valid pairs: WETH↔fheWETH, USDC↔fheUSDC)
  - Amount input with "Max" button
  - Show conversion rate (1:1)
  - Show current balances for both tokens
  - FHE session check before wrap (show "Initialize FHE Session" if needed)
- [ ] Add to portfolio page as new tab or section

**Data Test IDs**:
- `wrap-unwrap-card` - Main container
- `wrap-mode-btn` - Switch to wrap mode
- `unwrap-mode-btn` - Switch to unwrap mode
- `wrap-token-selector` - Token pair dropdown
- `wrap-amount-input` - Amount input
- `wrap-max-btn` - Max amount button
- `wrap-submit-btn` - Submit button
- `wrap-balance-from` - Source token balance
- `wrap-balance-to` - Destination token balance

**E2E Test Criteria**:
```typescript
test('wrap WETH to fheWETH', async ({ page }) => {
  await page.goto('/portfolio');

  // Navigate to wrap section
  await page.click('[data-testid="wrap-mode-btn"]');

  // Select WETH → fheWETH pair
  await page.click('[data-testid="wrap-token-selector"]');
  await page.click('text=WETH → fheWETH');

  // Enter amount
  await page.fill('[data-testid="wrap-amount-input"]', '10');

  // Submit (may trigger approval first)
  await page.click('[data-testid="wrap-submit-btn"]');

  // Wait for completion
  await page.waitForSelector('[data-testid="tx-success"]', { timeout: 60000 });

  // Verify balance changed
  const fheWethBalance = await page.locator('[data-testid="balance-fheWETH"]').textContent();
  expect(parseFloat(fheWethBalance || '0')).toBeGreaterThan(0);
});

test('unwrap fheUSDC to USDC', async ({ page }) => {
  await page.goto('/portfolio');

  await page.click('[data-testid="unwrap-mode-btn"]');
  await page.click('[data-testid="wrap-token-selector"]');
  await page.click('text=fheUSDC → USDC');
  await page.fill('[data-testid="wrap-amount-input"]', '50');
  await page.click('[data-testid="wrap-submit-btn"]');

  await page.waitForSelector('[data-testid="tx-success"]', { timeout: 30000 });
});
```

---

### Task 2.3: Multi-Pool Token Selection
**P1 | Size M | Risk Medium**

**Problem**: Trading UI assumes a single token pair. When pools are discovered, users need to select which pool/pair to trade.

**Solution**: Update token selectors to filter by available pools and auto-select the correct pool.

**Files to Create/Modify**:
| File | Action | Purpose |
|------|--------|---------|
| `src/hooks/usePoolForPair.ts` | Create | Find pool for token pair |
| `src/components/trade/SwapCard.tsx` | Modify | Use pool lookup |
| `src/components/trade/LimitOrderForm.tsx` | Modify | Use pool lookup |
| `src/stores/poolStore.ts` | Modify | Add pair→pool lookup |

**Deliverables**:
- [ ] Create `usePoolForPair(token0, token1)` hook:
  - Look up pool in poolStore by token addresses
  - Handle token order (factory sorts by address)
  - Return `{ pool, exists }` or null
- [ ] Update token selectors:
  - Show all 4 tokens
  - When both tokens selected, look up pool
  - If pool exists: proceed normally
  - If no pool: show warning "No pool for this pair"
- [ ] Auto-update selected pool when tokens change
- [ ] Show pool address in "Advanced" section (optional)

**Data Test IDs**:
- `input-token-selector` - Input token dropdown
- `output-token-selector` - Output token dropdown
- `selected-pool` - Display of current pool
- `no-pool-warning` - Warning when no pool exists

**E2E Test Criteria**:
```typescript
test('auto-selects pool for token pair', async ({ page }) => {
  await page.goto('/trade');

  // Select fheWETH as input
  await page.click('[data-testid="input-token-selector"]');
  await page.click('[data-testid="token-fheWETH"]');

  // Select fheUSDC as output
  await page.click('[data-testid="output-token-selector"]');
  await page.click('[data-testid="token-fheUSDC"]');

  // Verify pool is selected
  const poolInfo = page.locator('[data-testid="selected-pool"]');
  await expect(poolInfo).toContainText('fheWETH');
  await expect(poolInfo).toContainText('fheUSDC');
});

test('shows warning for unavailable pair', async ({ page }) => {
  await page.goto('/trade');

  // Select a pair that has no pool (if any)
  // This depends on which pools are actually deployed
  // If all pairs have pools, skip this test
});
```

---

### Phase 2 Definition of Done
- [ ] All 3 tasks complete with deliverables checked off
- [ ] E2E tests pass: `npm run test:e2e`
- [ ] Manual QA checklist:
  - [ ] Pools load from factory on page load
  - [ ] Can wrap WETH → fheWETH
  - [ ] Can unwrap fheUSDC → USDC
  - [ ] Token selection updates pool automatically
  - [ ] Warning shows for unavailable pairs
- [ ] Factory contract verified deployed on Sepolia
- [ ] Code reviewed and merged

---

## Phase 3: Medium Priority (UX Improvements)

### Task 3.1: Trade History Display
**P2 | Size M | Risk Low**

**Problem**: Trade history section shows "Coming soon" placeholder. Users cannot see their past trades.

**Solution**: Query on-chain events and display in portfolio history tab.

**Contract Events** (from FheatherXv5.sol):
```solidity
event Swap(PoolId indexed poolId, address indexed user, bool indexed zeroForOne, uint256 amountIn, uint256 amountOut);
event SwapEncrypted(PoolId indexed poolId, address indexed user);
event Claim(PoolId indexed poolId, address indexed user, int24 indexed tick, BucketSide side, bytes32 amountHash);
event Deposit(PoolId indexed poolId, address indexed user, int24 indexed tick, BucketSide side, bytes32 amountHash);
event Withdraw(PoolId indexed poolId, address indexed user, int24 indexed tick, BucketSide side, bytes32 amountHash);
```

**Note**: Encrypted operations (SwapEncrypted, Deposit with amountHash) don't reveal amounts. Display as "Encrypted" or show hash.

**Files to Create/Modify**:
| File | Action | Purpose |
|------|--------|---------|
| `src/hooks/useTradeHistory.ts` | Create | Fetch and parse events |
| `src/components/portfolio/TradeHistoryTab.tsx` | Create | Display component |
| `src/app/portfolio/page.tsx` | Modify | Add history tab |

**Deliverables**:
- [ ] Create `useTradeHistory(userAddress, poolIds?)` hook:
  - Fetch events via `getLogs` for last 10,000 blocks (RPC limit)
  - Filter by user address
  - Parse into TradeHistoryItem type:
    ```typescript
    type TradeHistoryItem = {
      id: string;
      type: 'swap' | 'swap_encrypted' | 'deposit' | 'withdraw' | 'claim';
      poolId: string;
      timestamp: Date;
      txHash: string;
      // For plaintext swaps:
      amountIn?: string;
      amountOut?: string;
      // For encrypted operations:
      encrypted: boolean;
    };
    ```
  - Return `{ trades, isLoading, error, hasMore, loadMore }`
- [ ] Create TradeHistoryTab component:
  - Table with columns: Date, Type, Pool, Amount, Tx
  - Show "Encrypted" badge for encrypted operations
  - Link tx hash to block explorer
  - Pagination: 20 items per page
  - Loading skeleton
  - Empty state: "No trades yet"
- [ ] Add tab to portfolio page

**Data Test IDs**:
- `trade-history-tab` - Tab button
- `trade-history-table` - Table container
- `trade-row-{index}` - Individual trade row
- `trade-type-badge` - Type indicator
- `trade-tx-link` - Transaction link
- `pagination-prev` - Previous page button
- `pagination-next` - Next page button
- `trade-history-empty` - Empty state

**E2E Test Criteria**:
```typescript
test('shows trade history with pagination', async ({ page }) => {
  // Requires user to have past trades
  await page.goto('/portfolio');
  await page.click('[data-testid="trade-history-tab"]');

  // Wait for trades to load
  await page.waitForSelector('[data-testid="trade-history-table"]');

  // Should show at least one trade (if user has history)
  const rows = page.locator('[data-testid^="trade-row-"]');
  const count = await rows.count();

  if (count > 0) {
    // Verify row has expected elements
    const firstRow = rows.first();
    await expect(firstRow.locator('[data-testid="trade-type-badge"]')).toBeVisible();
    await expect(firstRow.locator('[data-testid="trade-tx-link"]')).toBeVisible();
  } else {
    // Empty state
    await expect(page.locator('[data-testid="trade-history-empty"]')).toBeVisible();
  }
});
```

---

### Task 3.2: Order Fill Status
**P2 | Size S | Risk Low**

**Problem**: Active orders don't show if they've been partially or fully filled. Users can't tell when to close positions.

**Solution**: Query bucket state and calculate fill percentage for each order.

**Calculation** (from FheatherXv5 bucket/position logic):
```
User's filled amount = (bucket.filledPerShare - position.filledPerShareSnapshot) * position.shares / PRECISION
Fill percentage = filled amount / position.shares * 100
```

**Note**: These are encrypted values. We may need to request decryption or use estimates based on bucket state.

**Files to Create/Modify**:
| File | Action | Purpose |
|------|--------|---------|
| `src/hooks/useOrderFillStatus.ts` | Create | Calculate fill % |
| `src/components/orders/OrderFillProgress.tsx` | Create | Progress bar component |
| `src/components/orders/ActiveOrdersPanel.tsx` | Modify | Add progress to rows |

**Deliverables**:
- [ ] Create `useOrderFillStatus(poolId, tick, side, userAddress)` hook:
  - Query bucket state: `buckets[poolId][tick][side]`
  - Query user position: `positions[poolId][user][tick][side]`
  - Calculate fill percentage (handle encrypted values)
  - Return `{ fillPercent, isLoading }`
- [ ] Create OrderFillProgress component:
  - Progress bar visualization
  - Color coding: 0% = gray, 1-99% = blue, 100% = green
  - Show percentage text
- [ ] Add to each active order row
- [ ] Refresh on new swaps (poll or event subscription)

**Data Test IDs**:
- `fill-progress` - Progress bar container
- `fill-percent` - Percentage text
- `fill-bar` - The actual progress bar element

**E2E Test Criteria**:
```typescript
test('shows fill progress on active orders', async ({ page }) => {
  await page.goto('/portfolio');
  await page.click('[data-testid="orders-tab"]');

  // If user has orders
  const orderRow = page.locator('[data-testid="order-row-0"]');
  if (await orderRow.isVisible()) {
    const progress = orderRow.locator('[data-testid="fill-progress"]');
    await expect(progress).toBeVisible();

    const percent = orderRow.locator('[data-testid="fill-percent"]');
    await expect(percent).toHaveText(/\d+%/);
  }
});
```

---

### Task 3.3: Gas Estimation Display
**P2 | Size S | Risk Low**

**Problem**: Users don't see gas costs before transactions. FHE operations are expensive (~500k+ gas) and users may be surprised.

**Solution**: Show estimated gas cost before transaction submission.

**Files to Create/Modify**:
| File | Action | Purpose |
|------|--------|---------|
| `src/hooks/useGasEstimate.ts` | Modify | Complete implementation |
| `src/components/common/GasEstimate.tsx` | Create | Display component |
| `src/components/trade/SwapCard.tsx` | Modify | Add gas display |
| `src/components/trade/LimitOrderForm.tsx` | Modify | Add gas display |

**Deliverables**:
- [ ] Update `useGasEstimate(tx)` hook:
  - Call `estimateGas` with transaction params
  - Convert to ETH value using gas price
  - Return `{ gasEstimate, ethCost, isHigh, isLoading }`
  - `isHigh` = true if > 1M gas or > 0.05 ETH
- [ ] Create GasEstimate component:
  - Show: "Est. gas: ~0.012 ETH"
  - Warning icon + tooltip if `isHigh`
  - Tooltip explains: "FHE operations require more gas than standard transactions"
- [ ] Add to swap and limit order forms
- [ ] Update estimate when amount/tokens change

**Data Test IDs**:
- `gas-estimate` - Main container
- `gas-value` - The gas cost value
- `gas-warning` - Warning indicator (when high)
- `gas-tooltip` - Explanation tooltip

**E2E Test Criteria**:
```typescript
test('shows gas estimate on swap form', async ({ page }) => {
  await page.goto('/trade');

  // Enter swap amount
  await page.fill('[data-testid="amount-input"]', '1.0');

  // Wait for estimate
  await page.waitForSelector('[data-testid="gas-estimate"]');

  // Should show ETH value
  const gasValue = page.locator('[data-testid="gas-value"]');
  await expect(gasValue).toContainText('ETH');
});

test('shows warning for high gas operations', async ({ page }) => {
  await page.goto('/trade');
  await page.click('[data-testid="limit-order-tab"]');

  // Large encrypted operation
  await page.fill('[data-testid="amount-input"]', '100');

  // May show warning (depends on actual gas)
  const warning = page.locator('[data-testid="gas-warning"]');
  // This is conditional - FHE ops may or may not trigger warning
});
```

---

### Phase 3 Definition of Done
- [ ] All 3 tasks complete
- [ ] E2E tests pass
- [ ] Manual QA checklist:
  - [ ] Trade history shows past swaps and orders
  - [ ] Active orders show fill percentage
  - [ ] Gas estimate appears before transactions
  - [ ] High gas warning shows for large FHE operations
- [ ] Code reviewed and merged

---

## Phase 4: Polish (Production Ready)

### Task 4.1: Fix Liquidity UI
**P3 | Size L | Risk Medium**

**Problem**: Liquidity page uses old v3 components that don't work with FheatherXv5.

**Solution**: Update to use v5 LP functions.

**Contract Interface** (from FheatherXv5.sol):
```solidity
// Plaintext LP
function addLiquidity(PoolId poolId, uint256 amount0, uint256 amount1)
    external returns (uint256 lpAmount);
function removeLiquidity(PoolId poolId, uint256 lpAmount)
    external returns (uint256 amount0, uint256 amount1);

// Encrypted LP
function addLiquidityEncrypted(PoolId poolId, InEuint128 calldata amount0, InEuint128 calldata amount1)
    external returns (euint128 lpAmount);
function removeLiquidityEncrypted(PoolId poolId, InEuint128 calldata lpAmount)
    external returns (euint128 amount0, euint128 amount1);

// View functions
function getPoolReserves(PoolId poolId) external view returns (uint256 reserve0, uint256 reserve1, uint256 lpSupply);
```

**Files to Create/Modify**:
| File | Action | Purpose |
|------|--------|---------|
| `src/hooks/useAddLiquidity.ts` | Create | Add liquidity hook |
| `src/hooks/useRemoveLiquidity.ts` | Create | Remove liquidity hook |
| `src/hooks/useLPBalance.ts` | Create | Query LP balance |
| `src/components/liquidity/AddLiquidityForm.tsx` | Modify | Update for v5 |
| `src/components/liquidity/RemoveLiquidityForm.tsx` | Modify | Update for v5 |
| `src/components/liquidity/LPPositionCard.tsx` | Create | Show LP position |
| `src/app/liquidity/page.tsx` | Modify | Update layout |

**Deliverables**:
- [ ] Create `useAddLiquidity(poolId)` hook:
  - Support both plaintext and encrypted modes
  - Handle dual token approvals
  - Return `{ addLiquidity, isApproving, isAdding, error }`
- [ ] Create `useRemoveLiquidity(poolId)` hook:
  - Support both modes
  - Return `{ removeLiquidity, isRemoving, error }`
- [ ] Create `useLPBalance(poolId, userAddress)` hook:
  - Query `encLpBalances` for encrypted balance
  - Query `lpBalances` for plaintext cache
  - Return `{ balance, isEncrypted }`
- [ ] Update AddLiquidityForm:
  - Pool selector (from discovered pools)
  - Dual amount inputs for token0 and token1
  - Show current reserves and pool share preview
  - Toggle for encrypted mode
- [ ] Update RemoveLiquidityForm:
  - LP amount input with "Max" button
  - Show estimated token output
  - Toggle for encrypted mode
- [ ] Create LPPositionCard:
  - Show LP balance
  - Show pool share percentage
  - Show value in underlying tokens

**Data Test IDs**:
- `add-liquidity-form` - Add form container
- `remove-liquidity-form` - Remove form container
- `lp-amount0-input` - Token0 amount
- `lp-amount1-input` - Token1 amount
- `lp-amount-input` - LP token amount for removal
- `add-liquidity-btn` - Add button
- `remove-liquidity-btn` - Remove button
- `lp-position-card` - Position display
- `lp-balance` - LP balance value
- `lp-share-percent` - Pool share %

**E2E Test Criteria**:
```typescript
test('add liquidity to pool', async ({ page }) => {
  await page.goto('/liquidity');

  // Enter amounts
  await page.fill('[data-testid="lp-amount0-input"]', '10');
  await page.fill('[data-testid="lp-amount1-input"]', '10');

  // Add liquidity (may require approvals)
  await page.click('[data-testid="add-liquidity-btn"]');
  await page.waitForSelector('[data-testid="tx-success"]', { timeout: 60000 });

  // Verify LP balance increased
  const lpBalance = page.locator('[data-testid="lp-balance"]');
  await expect(lpBalance).not.toContainText('0');
});

test('remove liquidity from pool', async ({ page }) => {
  // Requires existing LP position
  await page.goto('/liquidity');

  // Click max to remove all
  await page.click('[data-testid="lp-max-btn"]');
  await page.click('[data-testid="remove-liquidity-btn"]');
  await page.waitForSelector('[data-testid="tx-success"]', { timeout: 30000 });
});
```

---

### Task 4.2: Onboarding Tutorial
**P3 | Size M | Risk Low**

**Problem**: New users have no guidance on how to use the dApp. The flow (faucet → wrap → FHE session → trade) isn't obvious.

**Solution**: Interactive tutorial overlay that guides users through first-time setup.

**Tutorial Steps**:
1. **Welcome**: "Trade in Silence with FheatherX" - explain privacy benefits
2. **Get Tokens**: "First, get testnet tokens" → highlight faucet section
3. **Wrap Tokens**: "Convert to private tokens" → highlight wrap tab
4. **FHE Session**: "Initialize encryption" → highlight session button
5. **Place Order**: "Create your first limit order" → highlight order form
6. **Close Position**: "Claim profits when filled" → highlight close button

**Files to Create/Modify**:
| File | Action | Purpose |
|------|--------|---------|
| `src/components/onboarding/Tutorial.tsx` | Create | Main tutorial wrapper |
| `src/components/onboarding/TutorialStep.tsx` | Create | Individual step with spotlight |
| `src/stores/userStore.ts` | Modify | Track tutorial completion |
| `src/app/layout.tsx` | Modify | Mount tutorial provider |

**Deliverables**:
- [ ] Create Tutorial component:
  - Overlay with semi-transparent background
  - Spotlight effect on target element
  - Step content with title and description
  - Progress indicator (1/6, 2/6, etc.)
  - "Next" and "Skip" buttons
  - "Don't show again" checkbox on last step
- [ ] Create TutorialStep component:
  - Accept target selector
  - Position tooltip near target
  - Highlight target with spotlight
- [ ] Store completion in localStorage:
  - Key: `fheatherx-tutorial-completed`
  - Note: In incognito, localStorage may not persist - show tutorial each time (acceptable)
- [ ] Add "Restart Tutorial" option in settings/menu
- [ ] Trigger tutorial on first visit (no completion record)

**Data Test IDs**:
- `tutorial-overlay` - Main overlay
- `tutorial-step` - Current step container
- `tutorial-title` - Step title
- `tutorial-description` - Step description
- `tutorial-progress` - Progress indicator
- `tutorial-next-btn` - Next button
- `tutorial-skip-btn` - Skip button
- `tutorial-dont-show` - Don't show again checkbox
- `tutorial-restart-btn` - Restart button (in settings)

**E2E Test Criteria**:
```typescript
test('tutorial shows on first visit', async ({ page, context }) => {
  // Clear storage to simulate first visit
  await context.clearCookies();
  await page.goto('/');

  // Tutorial should appear
  await expect(page.locator('[data-testid="tutorial-overlay"]')).toBeVisible();
  await expect(page.locator('[data-testid="tutorial-step"]')).toBeVisible();
});

test('tutorial can be skipped', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/');

  await page.click('[data-testid="tutorial-skip-btn"]');
  await expect(page.locator('[data-testid="tutorial-overlay"]')).not.toBeVisible();
});

test('tutorial completion persists', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/');

  // Complete tutorial
  for (let i = 0; i < 6; i++) {
    await page.click('[data-testid="tutorial-next-btn"]');
  }

  // Reload - should not show
  await page.reload();
  await expect(page.locator('[data-testid="tutorial-overlay"]')).not.toBeVisible();
});
```

---

### Task 4.3: Privacy Documentation in UI
**P3 | Size S | Risk Low**

**Problem**: Users don't understand the difference between ERC20 and FHERC20 tokens or why privacy matters.

**Solution**: Add info icons, tooltips, and a help modal explaining the privacy model.

**Files to Create/Modify**:
| File | Action | Purpose |
|------|--------|---------|
| `src/components/common/PrivacyInfo.tsx` | Create | Info icon + tooltip |
| `src/components/common/PrivacyModal.tsx` | Create | Detailed explanation modal |
| `src/components/tokens/TokenSelector.tsx` | Modify | Add privacy icons |
| `src/components/trade/LimitOrderForm.tsx` | Modify | Add privacy info |

**Deliverables**:
- [ ] Create PrivacyInfo component:
  - Shield icon (🛡️) next to FHERC20 tokens
  - Tooltip on hover: "FHE-encrypted token - amounts are hidden on-chain"
  - Click opens PrivacyModal
- [ ] Create PrivacyModal:
  - Title: "Understanding Privacy in FheatherX"
  - Sections:
    - "What is FHERC20?" - explanation of encrypted tokens
    - "Token Comparison" - table showing ERC20 vs FHERC20 visibility
    - "Privacy Matrix" - which operations are private
    - "Learn More" - link to docs/VISION.md
- [ ] Add shield icons to FHERC20 tokens in selectors
- [ ] Add "Why FHERC20?" link in LimitOrderForm near token selector

**Content for PrivacyModal**:
```markdown
# Understanding Privacy in FheatherX

## What is FHERC20?
FHERC20 tokens use Fully Homomorphic Encryption (FHE) to keep your balance hidden.
Unlike regular ERC20 tokens where anyone can see your balance, FHERC20 balances are
encrypted on-chain.

## Token Comparison
| | ERC20 | FHERC20 |
|-|-------|---------|
| Balance visibility | Public | Encrypted |
| Transfer amounts | Visible | Hidden |
| Limit order amounts | Exposed | Private |

## When to Use FHERC20
- **Limit Orders**: Always use FHERC20 for limit orders to hide your order size
- **Privacy**: Wrap tokens to FHERC20 when you don't want others to see your holdings
- **Market Swaps**: Can use either (swaps are processed through encrypted reserves)

[Read full documentation →](docs/VISION.md)
```

**Data Test IDs**:
- `privacy-icon` - Shield icon on FHERC20 tokens
- `privacy-tooltip` - Hover tooltip
- `privacy-modal` - The modal component
- `privacy-modal-close` - Close button
- `privacy-learn-more` - Link to docs

**E2E Test Criteria**:
```typescript
test('privacy icon shows on FHERC20 tokens', async ({ page }) => {
  await page.goto('/trade');
  await page.click('[data-testid="input-token-selector"]');

  // FHERC20 tokens should have shield icon
  const fheWethOption = page.locator('[data-testid="token-fheWETH"]');
  await expect(fheWethOption.locator('[data-testid="privacy-icon"]')).toBeVisible();

  // ERC20 tokens should not
  const wethOption = page.locator('[data-testid="token-WETH"]');
  await expect(wethOption.locator('[data-testid="privacy-icon"]')).not.toBeVisible();
});

test('privacy modal opens on click', async ({ page }) => {
  await page.goto('/trade');
  await page.click('[data-testid="input-token-selector"]');

  // Click privacy icon
  await page.click('[data-testid="token-fheWETH"] [data-testid="privacy-icon"]');

  // Modal should open
  await expect(page.locator('[data-testid="privacy-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="privacy-modal"]')).toContainText('FHERC20');
});
```

---

### Phase 4 Definition of Done
- [ ] All 3 tasks complete
- [ ] E2E tests pass
- [ ] Manual QA checklist:
  - [ ] Can add and remove liquidity
  - [ ] Tutorial runs on first visit
  - [ ] Tutorial can be skipped and restarted
  - [ ] Privacy icons appear on FHERC20 tokens
  - [ ] Privacy modal explains the encryption model
- [ ] Documentation updated:
  - [ ] CLAUDE.md reflects new features
  - [ ] Any API changes documented
- [ ] Code reviewed and merged

---

## Summary

| Phase | Tasks | Size | Priority | Addresses |
|-------|-------|------|----------|-----------|
| 1 | 3 | M | P0 Critical | Claim proceeds, Privacy enforcement |
| 2 | 3 | L | P1 High | Pool discovery, Wrap/Unwrap, Multi-pool |
| 3 | 3 | M | P2 Medium | Trade history, Fill status, Gas |
| 4 | 3 | L | P3 Polish | LP UI, Onboarding, Privacy docs |

**Total**: 12 tasks across 4 phases

**Dependencies**:
```
Prerequisites (verify contracts)
        ↓
    Phase 1 ──────────────────────────────────────────┐
        ↓                                              │
    Phase 2 ← Factory contract must be deployed       │
        ↓                                              │
    Phase 3                                            │
        ↓                                              │
    Phase 4 ──────────────────────────────────────────┘
```

**Success Metrics (5 Audit Gaps)**:
1. ✅ Phase 1: **Claim proceeds** - Users can close positions via `exit()`
2. ✅ Phase 1: **Privacy enforcement** - ERC20 limit orders blocked with clear error
3. ✅ Phase 2: **Pool discovery** - All active pools fetched from factory
4. ✅ Phase 2: **Wrap/Unwrap** - Full token conversion UI in portfolio
5. ✅ Phase 2: **24 pairs** - Multi-pool selection with any token combination
