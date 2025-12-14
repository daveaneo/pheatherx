# V8 Arbitrum Sepolia E2E Test Plan

## Objective
Deploy v8 contracts to Arbitrum Sepolia and create comprehensive E2E tests for the limit order lifecycle.

## Phase 1: Deployment

### 1.1 Create DeployV8ArbSepolia.s.sol
- Adapt DeployV8Complete.s.sol for Arbitrum Sepolia addresses
- Use existing tokens from v6 deployment:
  - WETH: `0xC5EcD76Db9f00B07088DDbFbdf7BF9927F6DDE13`
  - USDC: `0x00F7DC53A57b980F839767a6C6214b4089d916b1`
  - fheWETH: `0x7Da141eeA1F3c2dD0cC41915eE0AA19bE545d3e0`
  - fheUSDC: `0x987731d456B5996E7414d79474D8aba58d4681DC`
- Use Uniswap v4 on Arb Sepolia:
  - PoolManager: `0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317`
  - SwapRouter: `0xf3A39C86dbd13C45365E57FB90fe413371F65AF8`
  - PositionManager: `0xAc631556d3d4019C95769033B5E719dD77124BAc`

### 1.2 Deploy v8 Hooks
```bash
cd contracts
source .env
forge script script/DeployV8ArbSepolia.s.sol:DeployV8ArbSepolia --rpc-url $ARB_SEPOLIA_RPC --broadcast -vvv
```

### 1.3 Output
- `contracts/deployments/v8-arb-sepolia.json`

## Phase 2: Frontend Updates

### 2.1 Update addresses.ts
- Add v8FHE and v8Mixed hook addresses for chain 421614
- Update router addresses

### 2.2 Update tokens.ts
- Verify token addresses match v8 deployment

### 2.3 Update poolStore
- Ensure pool discovery works with v8 hooks

## Phase 3: E2E Test Suite

### Test File: `frontend/e2e/tests/13-limit-order-fill-lifecycle.spec.ts`

### Test Flow for Maker (Against-Direction) Limit Orders - FHE:FHE Pool

```
┌─────────────────────────────────────────────────────────────────┐
│ TEST SUITE: Maker Limit Order Lifecycle (fheWETH/fheUSDC)       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ SETUP:                                                          │
│ 1. Connect wallet (Test Mode)                                   │
│ 2. Initialize FHE session                                       │
│ 3. Get tokens from faucet if needed                             │
│ 4. Record initial balances (with encrypted reveal)              │
│                                                                 │
│ TEST 1: Place Maker Limit-Buy Order                             │
│ - Select fheWETH/fheUSDC pool                                   │
│ - Switch to Limit tab                                           │
│ - Select "Limit Buy" order type (maker/against-direction)       │
│ - Enter order amount: 0.001 fheWETH                             │
│ - Select target tick (below current price)                      │
│ - Place order                                                   │
│ - Verify order appears in Active Orders                         │
│                                                                 │
│ TEST 2: Partial Fill via Small Swap                             │
│ - Switch to Market tab                                          │
│ - Execute SELL swap (0.0005 fheWETH) to move price down         │
│ - Wait for transaction confirmation                             │
│ - This should partially fill the limit-buy order                │
│                                                                 │
│ TEST 3: Claim Partial Proceeds                                  │
│ - Navigate to Claims page                                       │
│ - Verify partial proceeds available                             │
│ - Claim proceeds                                                │
│ - Record balance after partial claim                            │
│ - Verify: balance increased (with ~5% fee margin)               │
│                                                                 │
│ TEST 4: Full Fill via Larger Swap                               │
│ - Navigate back to Trade page                                   │
│ - Execute larger SELL swap (0.002 fheWETH)                      │
│ - This should fully exhaust the remaining limit order           │
│                                                                 │
│ TEST 5: Claim Full Remaining Proceeds                           │
│ - Navigate to Claims page                                       │
│ - Verify remaining proceeds available                           │
│ - Claim all proceeds                                            │
│ - Record final balance                                          │
│ - Verify: total claimed ≈ order amount (within fee margin)      │
│                                                                 │
│ TEST 6: Verify Order No Longer Active                           │
│ - Navigate to Active Orders                                     │
│ - Verify the order is no longer listed (fully filled)           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Test Flow for Taker (Momentum) Limit Orders - FHE:FHE Pool

```
┌─────────────────────────────────────────────────────────────────┐
│ TEST SUITE: Taker Limit Order Lifecycle (fheWETH/fheUSDC)       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ SETUP:                                                          │
│ 1. Record initial balances                                      │
│                                                                 │
│ TEST 7: Place Taker Stop-Loss Order                             │
│ - Select fheWETH/fheUSDC pool                                   │
│ - Switch to Limit tab                                           │
│ - Select "Stop Loss" order type (taker/momentum)                │
│ - Enter order amount: 0.001 fheWETH                             │
│ - Select target tick (above current price for sell trigger)     │
│ - Place order                                                   │
│ - Verify order appears in Active Orders                         │
│                                                                 │
│ TEST 8: Partial Trigger via Small Swap                          │
│ - Switch to Market tab                                          │
│ - Execute BUY swap to move price UP (toward stop-loss trigger)  │
│ - Wait for transaction confirmation                             │
│ - This should partially trigger the stop-loss                   │
│                                                                 │
│ TEST 9: Claim Partial Stop-Loss Proceeds                        │
│ - Navigate to Claims page                                       │
│ - Verify partial proceeds available                             │
│ - Claim proceeds                                                │
│ - Record balance after partial claim                            │
│                                                                 │
│ TEST 10: Fully Trigger Stop-Loss via Larger Swap                │
│ - Execute larger BUY swap to push price further                 │
│ - This should fully trigger remaining stop-loss                 │
│                                                                 │
│ TEST 11: Claim Full Stop-Loss Proceeds                          │
│ - Navigate to Claims page                                       │
│ - Claim all remaining proceeds                                  │
│ - Verify final balance                                          │
│                                                                 │
│ TEST 12: Place and Test Take-Profit Order                       │
│ - Similar flow for Take-Profit (sell at higher price)           │
│ - Place order above current price                               │
│ - Execute BUY swap to trigger                                   │
│ - Claim proceeds                                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Balance Verification Strategy

### Fee Margin
- Swap fee: 0.3% (30 bps)
- FHE processing overhead: potential rounding
- **Acceptable margin: 5%** (to account for fees + rounding)

### Balance Check Formula
```typescript
const ACCEPTABLE_FEE_MARGIN = 0.05; // 5%

function verifyBalanceWithMargin(
  expected: bigint,
  actual: bigint,
  margin: number = ACCEPTABLE_FEE_MARGIN
): boolean {
  const minAcceptable = expected * BigInt(Math.floor((1 - margin) * 1000)) / 1000n;
  const maxAcceptable = expected * BigInt(Math.ceil((1 + margin) * 1000)) / 1000n;
  return actual >= minAcceptable && actual <= maxAcceptable;
}
```

## Test Data

### Order Amounts
- Maker order size: 0.001 fheWETH (small for testing)
- Partial fill swap: 0.0005 fheWETH (50% of order)
- Full fill swap: 0.002 fheWETH (more than remaining)

### Expected Token Flow (Maker Limit-Buy)
1. User deposits fheUSDC to buy fheWETH at lower price
2. Swap moves price down, triggering limit-buy
3. User claims fheWETH proceeds

### Expected Token Flow (Taker Stop-Loss)
1. User deposits fheWETH to sell if price drops
2. Swap moves price down, triggering stop-loss
3. User claims fheUSDC proceeds

## Running the Tests

```bash
cd frontend
NEXT_PUBLIC_TEST_MODE=true npx playwright test e2e/tests/13-limit-order-fill-lifecycle.spec.ts --headed
```

Or headless:
```bash
NEXT_PUBLIC_TEST_MODE=true npx playwright test e2e/tests/13-limit-order-fill-lifecycle.spec.ts
```

## Success Criteria

1. All orders place successfully
2. Partial fills work correctly
3. Full fills exhaust the order
4. Claimed balances match expected (within 5% margin)
5. Orders disappear from Active Orders when fully filled
6. Both maker and taker order types work
