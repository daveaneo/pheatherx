# FheatherX v6 - Comprehensive Test Specification

## Overview

Full lifecycle integration tests for FheatherXv6 covering all 4 token pair combinations on **Arbitrum Sepolia** with real Fhenix CoFHE.

### Why Arbitrum Sepolia?

| Factor | Arbitrum Sepolia | Ethereum Sepolia |
|--------|------------------|------------------|
| Transaction speed | ~1-2 seconds | ~12 seconds |
| Gas cost | Very low | Higher |
| Fhenix CoFHE | Supported | Supported |
| Production parity | High | High |

**Arbitrum Sepolia is the optimal choice** - fast iteration, cheap tests, real FHE infrastructure.

---

## Test Matrix

### Token Pair Combinations

| Pool ID | Token0 | Token1 | Pool Type |
|---------|--------|--------|-----------|
| Pool A | ERC20 (WETH) | ERC20 (USDC) | ERC20:ERC20 |
| Pool B | FHERC20 (fheWETH) | FHERC20 (fheUSDC) | FHERC20:FHERC20 |
| Pool C | ERC20 (WETH) | FHERC20 (fheUSDC) | ERC20:FHERC20 |
| Pool D | FHERC20 (fheWETH) | ERC20 (USDC) | FHERC20:ERC20 |

### Operations Per Pool

For each pool, test the complete lifecycle:

1. Create Pool
2. Add Liquidity
3. Market Swap
4. Place Limit Orders (all 4 types where allowed)
5. Execute Swaps to Hit Limit Orders
6. Withdraw Limit Order (after fill)
7. Withdraw Limit Order (before fill / cancel)
8. Remove Liquidity (partial)
9. Remove Liquidity (full)

---

## Detailed Test Cases

### Phase 1: Pool Setup

#### Test 1.1: Create Pool

**For all 4 pools:**

```solidity
// Pool creation via Uniswap V4 PoolManager
function test_CreatePool_ERC_ERC() external {
    // 1. Deploy tokens (if needed)
    // 2. Call PoolManager.initialize() with hook address
    // 3. Verify pool state initialized
    // 4. Verify token type flags set correctly
}
```

| Assertion | Pool A | Pool B | Pool C | Pool D |
|-----------|--------|--------|--------|--------|
| Pool initialized | Yes | Yes | Yes | Yes |
| token0IsFherc20 | false | true | false | true |
| token1IsFherc20 | false | true | true | false |
| Hook registered | Yes | Yes | Yes | Yes |

**dApp equivalent:**
- Pool creation is typically done by protocol admin
- Frontend queries existing pools via `getPoolState(PoolId)`

---

### Phase 2: Liquidity

#### Test 2.1: Add Liquidity (Plaintext)

**For all 4 pools:**

```solidity
function test_AddLiquidity_ERC_ERC() external {
    // Setup
    uint256 amount0 = 10 ether;      // 10 WETH
    uint256 amount1 = 10_000e6;       // 10,000 USDC (6 decimals)

    // Approve hook
    token0.approve(hookAddress, amount0);
    token1.approve(hookAddress, amount1);

    // Execute
    uint256 lpAmount = hook.addLiquidity(poolId, amount0, amount1);

    // Verify
    assertGt(lpAmount, 0, "Should receive LP tokens");
    assertEq(hook.lpBalances(poolId, user), lpAmount);
    assertEq(hook.reserve0(), amount0);
    assertEq(hook.reserve1(), amount1);
}
```

| Pool | addLiquidity() | Expected Result |
|------|----------------|-----------------|
| A (ERC:ERC) | Yes | LP tokens minted |
| B (FHE:FHE) | Yes | LP tokens minted |
| C (ERC:FHE) | Yes | LP tokens minted |
| D (FHE:ERC) | Yes | LP tokens minted |

**dApp equivalent:**
```typescript
// Frontend hook: useAddLiquidity
const { addLiquidity } = useAddLiquidity();
await addLiquidity(poolId, amount0, amount1);
```

#### Test 2.2: Add Liquidity Encrypted (FHERC20:FHERC20 only)

```solidity
function test_AddLiquidityEncrypted_FHE_FHE() external {
    // Only works for Pool B (both FHERC20)
    InEuint128 encAmount0 = /* encrypted 10 fheWETH */;
    InEuint128 encAmount1 = /* encrypted 10,000 fheUSDC */;

    // Must wrap plaintext -> encrypted first
    fheToken0.wrap(10 ether);
    fheToken1.wrap(10_000e6);

    euint128 lpAmount = hook.addLiquidityEncrypted(poolId, encAmount0, encAmount1);
    // LP amount is encrypted - can't read directly
}
```

| Pool | addLiquidityEncrypted() | Expected Result |
|------|-------------------------|-----------------|
| A (ERC:ERC) | Reverts | "Both tokens must be FHERC20" |
| B (FHE:FHE) | Yes | Encrypted LP tokens |
| C (ERC:FHE) | Reverts | "Both tokens must be FHERC20" |
| D (FHE:ERC) | Reverts | "Both tokens must be FHERC20" |

---

### Phase 3: Market Swaps

#### Test 3.1: Swap via V4 Router (Plaintext)

```solidity
function test_Swap_V4Router() external {
    // Setup: Pool has liquidity from Phase 2

    // Swap 1 WETH for USDC
    uint256 amountIn = 1 ether;
    bool zeroForOne = true;  // WETH -> USDC

    // Approve router
    token0.approve(swapRouter, amountIn);

    // Build swap params
    PoolKey memory key = /* pool key */;
    IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
        zeroForOne: zeroForOne,
        amountSpecified: -int256(amountIn),  // Negative = exact input
        sqrtPriceLimitX96: MIN_SQRT_RATIO + 1
    });

    // Execute via PoolSwapTest router
    int256 delta = swapRouter.swap(key, params, testSettings, hookData);

    // Verify
    assertGt(token1.balanceOf(user), balanceBefore, "Should receive output tokens");
}
```

| Pool | swap() via Router | Expected Result |
|------|-------------------|-----------------|
| A (ERC:ERC) | Yes | Tokens swapped |
| B (FHE:FHE) | Yes | Tokens swapped (plaintext balances) |
| C (ERC:FHE) | Yes | Tokens swapped |
| D (FHE:ERC) | Yes | Tokens swapped |

**dApp equivalent:**
```typescript
// Frontend hook: useSwap
const { swap } = useSwap();
await swap(zeroForOne, amountIn, minAmountOut);
```

#### Test 3.2: Swap via Direct Hook (Plaintext)

```solidity
function test_Swap_DirectHook() external {
    uint256 amountIn = 1 ether;
    uint256 minAmountOut = 900e6;  // 0.5% slippage

    token0.approve(hookAddress, amountIn);

    uint256 amountOut = hook.swap(true, amountIn, minAmountOut);

    assertGe(amountOut, minAmountOut, "Slippage check");
}
```

#### Test 3.3: Swap Encrypted (FHERC20 only)

```solidity
function test_SwapEncrypted_FHE_FHE() external {
    // Wrap tokens first
    fheToken0.wrap(1 ether);

    InEbool direction = /* encrypted true */;
    InEuint128 amount = /* encrypted 1 fheWETH */;
    InEuint128 minOut = /* encrypted 900 fheUSDC */;

    euint128 amountOut = hook.swapEncrypted(poolId, direction, amount, minOut);
    // Output is encrypted
}
```

| Pool | swapEncrypted() | Expected Result |
|------|-----------------|-----------------|
| A (ERC:ERC) | Reverts | No FHERC20 tokens |
| B (FHE:FHE) | Yes | Encrypted swap |
| C (ERC:FHE) | Partial* | Only selling FHERC20 side |
| D (FHE:ERC) | Partial* | Only selling FHERC20 side |

*Partial: Can only swap when selling the FHERC20 token

---

### Phase 4: Limit Orders

#### Limit Order Types

| Order Type | Direction | You Deposit | You Receive | Tick Position |
|------------|-----------|-------------|-------------|---------------|
| Limit Buy | Buy token0 | token1 | token0 | Below current |
| Limit Sell | Sell token0 | token0 | token1 | Above current |
| Stop Loss | Sell token0 if price drops | token0 | token1 | Below current |
| Take Profit | Sell token0 if price rises | token0 | token1 | Above current |

**Privacy Rule**: Input token (what you deposit) MUST be FHERC20 for encrypted order size.

#### Test 4.1: Place Limit Buy Order

```solidity
function test_PlaceLimitBuy() external {
    // Limit Buy: Deposit token1 at tick BELOW current price
    // When price drops to tick, order fills and you receive token0

    int24 currentTick = hook.getCurrentTick(poolId);
    int24 orderTick = currentTick - 120;  // 2 tick spacings below

    // Encrypt the order amount
    InEuint128 encAmount = /* encrypted 1000 USDC */;

    // Deposit into BUY bucket
    hook.deposit(
        poolId,
        orderTick,
        BucketSide.BUY,    // BUY bucket = deposit token1
        encAmount,
        block.timestamp + 1 hours,  // deadline
        60  // maxTickDrift
    );

    // Verify order placed
    assertTrue(hook.hasOrdersAtTick(poolId, orderTick, BucketSide.BUY));
}
```

| Pool | Limit Buy (deposit token1) | Allowed? |
|------|---------------------------|----------|
| A (ERC:ERC) | token1=ERC20 | **NO** - MEV risk |
| B (FHE:FHE) | token1=FHERC20 | Yes |
| C (ERC:FHE) | token1=FHERC20 | Yes |
| D (FHE:ERC) | token1=ERC20 | **NO** - MEV risk |

#### Test 4.2: Place Limit Sell Order

```solidity
function test_PlaceLimitSell() external {
    // Limit Sell: Deposit token0 at tick ABOVE current price
    // When price rises to tick, order fills and you receive token1

    int24 currentTick = hook.getCurrentTick(poolId);
    int24 orderTick = currentTick + 120;  // 2 tick spacings above

    InEuint128 encAmount = /* encrypted 1 WETH */;

    hook.deposit(
        poolId,
        orderTick,
        BucketSide.SELL,   // SELL bucket = deposit token0
        encAmount,
        block.timestamp + 1 hours,
        60
    );
}
```

| Pool | Limit Sell (deposit token0) | Allowed? |
|------|----------------------------|----------|
| A (ERC:ERC) | token0=ERC20 | **NO** - MEV risk |
| B (FHE:FHE) | token0=FHERC20 | Yes |
| C (ERC:FHE) | token0=ERC20 | **NO** - MEV risk |
| D (FHE:ERC) | token0=FHERC20 | Yes |

#### Test 4.3: Place Stop Loss Order

```solidity
function test_PlaceStopLoss() external {
    // Stop Loss: Deposit token0 at tick BELOW current price
    // If price drops to tick, sell token0 to limit losses

    int24 currentTick = hook.getCurrentTick(poolId);
    int24 orderTick = currentTick - 120;  // Below current = stop loss

    InEuint128 encAmount = /* encrypted 1 WETH */;

    hook.deposit(
        poolId,
        orderTick,
        BucketSide.SELL,   // SELL bucket even though below price
        encAmount,
        block.timestamp + 1 hours,
        60
    );
}
```

#### Test 4.4: Place Take Profit Order

```solidity
function test_PlaceTakeProfit() external {
    // Take Profit: Deposit token0 at tick ABOVE current price
    // When price rises to tick, sell token0 to realize profit
    // (Same as Limit Sell mechanically)

    int24 currentTick = hook.getCurrentTick(poolId);
    int24 orderTick = currentTick + 120;

    // ... same as Limit Sell
}
```

#### Limit Order Summary by Pool

| Pool | Limit Buy | Limit Sell | Stop Loss | Take Profit |
|------|-----------|------------|-----------|-------------|
| A (ERC:ERC) | No | No | No | No |
| B (FHE:FHE) | Yes | Yes | Yes | Yes |
| C (ERC:FHE) | Yes* | No | No | No |
| D (FHE:ERC) | No | Yes* | Yes* | Yes* |

*Only the side that deposits FHERC20 is allowed

---

### Phase 5: Trigger Limit Orders via Swap

#### Test 5.1: Swap to Trigger Limit Buy

```solidity
function test_SwapTriggerLimitBuy() external {
    // Setup: Limit Buy placed at tick -120 (below current)
    // Action: Large sell (zeroForOne=true) pushes price DOWN past tick -120

    int24 orderTick = -120;

    // Place order first
    hook.deposit(poolId, orderTick, BucketSide.BUY, encAmount, deadline, drift);

    // Verify order exists
    assertTrue(hook.hasOrdersAtTick(poolId, orderTick, BucketSide.BUY));

    // Execute large swap to move price down
    uint256 largeSwapAmount = 5 ether;  // Large enough to move price
    token0.approve(swapRouter, largeSwapAmount);

    swapRouter.swap(key, params, testSettings, hookData);

    // Verify order was triggered (processed in afterSwap hook)
    // Check proceeds available for claim
    euint128 proceeds = hook.calculateProceeds(poolId, user, orderTick, BucketSide.BUY);
    // proceeds > 0 means order was filled
}
```

#### Test 5.2: Swap to Trigger Limit Sell

```solidity
function test_SwapTriggerLimitSell() external {
    // Setup: Limit Sell placed at tick +120 (above current)
    // Action: Large buy (zeroForOne=false) pushes price UP past tick +120

    int24 orderTick = 120;

    hook.deposit(poolId, orderTick, BucketSide.SELL, encAmount, deadline, drift);

    // Swap in opposite direction to push price UP
    uint256 largeSwapAmount = 5000e6;  // Large USDC buy
    token1.approve(swapRouter, largeSwapAmount);

    IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
        zeroForOne: false,  // Buy token0 with token1
        amountSpecified: -int256(largeSwapAmount),
        sqrtPriceLimitX96: MAX_SQRT_RATIO - 1
    });

    swapRouter.swap(key, params, testSettings, hookData);

    // Verify limit sell triggered
}
```

---

### Phase 6: Withdraw After Fill

#### Test 6.1: Claim Filled Order Proceeds

```solidity
function test_ClaimFilledOrder() external {
    // Setup: Order was placed and filled in Phase 5

    uint256 proceedsTokenBalanceBefore = proceedsToken.balanceOf(user);

    // Claim proceeds
    hook.claim(poolId, orderTick, BucketSide.BUY);

    uint256 proceedsTokenBalanceAfter = proceedsToken.balanceOf(user);

    assertGt(proceedsTokenBalanceAfter, proceedsTokenBalanceBefore, "Should receive proceeds");
}
```

**dApp equivalent:**
```typescript
// Frontend hook: useClaimOrder
const { claim } = useClaimOrder();
await claim(poolId, tick, side);
```

---

### Phase 7: Cancel Unfilled Order

#### Test 7.1: Withdraw Before Fill (Cancel)

```solidity
function test_CancelUnfilledOrder() external {
    // Setup: Place order at price that won't be reached
    int24 farTick = 6000;  // Max tick - very high price

    InEuint128 encAmount = /* encrypted 1 WETH */;
    hook.deposit(poolId, farTick, BucketSide.SELL, encAmount, deadline, drift);

    // Verify order exists
    uint256 depositTokenBalanceBefore = token0.balanceOf(user);

    // Cancel by withdrawing
    InEuint128 withdrawAmount = encAmount;  // Withdraw full amount
    hook.withdraw(poolId, farTick, BucketSide.SELL, withdrawAmount);

    // Verify tokens returned
    uint256 depositTokenBalanceAfter = token0.balanceOf(user);
    assertGt(depositTokenBalanceAfter, depositTokenBalanceBefore, "Should receive deposit back");
}
```

**dApp equivalent:**
```typescript
// Frontend hook: useCancelOrder
const { cancel } = useCancelOrder();
await cancel(poolId, tick, side, amount);
```

---

### Phase 8: Remove Liquidity

#### Test 8.1: Remove Liquidity Partial

```solidity
function test_RemoveLiquidityPartial() external {
    // Setup: User has LP tokens from Phase 2
    uint256 totalLp = hook.lpBalances(poolId, user);
    uint256 removeAmount = totalLp / 2;  // Remove half

    (uint256 amount0, uint256 amount1) = hook.removeLiquidity(poolId, removeAmount);

    // Verify
    assertGt(amount0, 0);
    assertGt(amount1, 0);
    assertEq(hook.lpBalances(poolId, user), totalLp - removeAmount);
}
```

#### Test 8.2: Remove Liquidity Full

```solidity
function test_RemoveLiquidityFull() external {
    uint256 totalLp = hook.lpBalances(poolId, user);

    (uint256 amount0, uint256 amount1) = hook.removeLiquidity(poolId, totalLp);

    assertEq(hook.lpBalances(poolId, user), 0, "Should have no LP left");
}
```

| Pool | removeLiquidity() | removeLiquidityEncrypted() |
|------|-------------------|---------------------------|
| A (ERC:ERC) | Yes | No |
| B (FHE:FHE) | Yes | Yes |
| C (ERC:FHE) | Yes | No |
| D (FHE:ERC) | Yes | No |

---

## Test Execution

### Running Tests

```bash
# Set environment
cd contracts
source .env

# Run all v6 integration tests on Arbitrum Sepolia
forge test --match-path test/integration/FheatherXv6Integration.t.sol \
    --fork-url $ARB_SEPOLIA_RPC \
    -vvv

# Run specific pool type
forge test --match-test "ERC_ERC" --fork-url $ARB_SEPOLIA_RPC -vvv
forge test --match-test "FHE_FHE" --fork-url $ARB_SEPOLIA_RPC -vvv
forge test --match-test "ERC_FHE" --fork-url $ARB_SEPOLIA_RPC -vvv
forge test --match-test "FHE_ERC" --fork-url $ARB_SEPOLIA_RPC -vvv
```

### Test Contract Structure

```
contracts/test/integration/
├── FheatherXv6Integration.t.sol     # Main test file
├── BaseV6Test.sol                   # Shared setup & helpers
├── pools/
│   ├── ERC_ERC_PoolTest.t.sol       # Pool A tests
│   ├── FHE_FHE_PoolTest.t.sol       # Pool B tests
│   ├── ERC_FHE_PoolTest.t.sol       # Pool C tests
│   └── FHE_ERC_PoolTest.t.sol       # Pool D tests
└── scenarios/
    ├── FullLifecycleTest.t.sol      # End-to-end for each pool
    └── EdgeCasesTest.t.sol          # Boundary conditions
```

---

## dApp Integration Reference

### Hook to Contract Mapping

| dApp Hook | Contract Function | Params |
|-----------|-------------------|--------|
| `useAddLiquidity` | `addLiquidity()` | poolId, amount0, amount1 |
| `useRemoveLiquidity` | `removeLiquidity()` | poolId, lpAmount |
| `useSwap` | `swap()` via router | key, params, testSettings, hookData |
| `usePlaceOrder` | `deposit()` | poolId, tick, side, encAmount, deadline, drift |
| `useCancelOrder` | `withdraw()` | poolId, tick, side, encAmount |
| `useClaimOrder` | `claim()` | poolId, tick, side |
| `useCurrentPrice` | `getReserves()` / `getCurrentTick()` | poolId |
| `useActiveOrders` | `getActiveOrders()` | user |

### Frontend Flow Reference

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Journey                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Connect Wallet                                               │
│     └── useAccount() from wagmi                                  │
│                                                                  │
│  2. Select Pool                                                  │
│     └── PoolSelector component                                   │
│     └── useSelectedPool() from poolStore                         │
│                                                                  │
│  3. Add Liquidity                                                │
│     └── LiquidityForm component                                  │
│     └── useAddLiquidity() hook                                   │
│     └── Contract: addLiquidity(poolId, amt0, amt1)               │
│                                                                  │
│  4. Market Swap                                                  │
│     └── MarketSwapForm component                                 │
│     └── useSwap() hook                                           │
│     └── Contract: router.swap(key, params, settings, data)       │
│                                                                  │
│  5. Place Limit Order                                            │
│     └── LimitOrderForm component                                 │
│     └── usePlaceOrder() hook                                     │
│     └── Must wrap ERC20 -> FHERC20 if needed                     │
│     └── Contract: deposit(poolId, tick, side, encAmt, ...)       │
│                                                                  │
│  6. Monitor Orders                                               │
│     └── ActiveOrders component                                   │
│     └── useActiveOrders() hook                                   │
│     └── Contract: getActiveOrders(user)                          │
│                                                                  │
│  7. Claim Filled Orders                                          │
│     └── OrderRow component "Claim" button                        │
│     └── useClaimOrder() hook                                     │
│     └── Contract: claim(poolId, tick, side)                      │
│                                                                  │
│  8. Cancel Unfilled Orders                                       │
│     └── OrderRow component "Cancel" button                       │
│     └── useCancelOrder() hook                                    │
│     └── Contract: withdraw(poolId, tick, side, encAmt)           │
│                                                                  │
│  9. Remove Liquidity                                             │
│     └── LiquidityForm component (remove mode)                    │
│     └── useRemoveLiquidity() hook                                │
│     └── Contract: removeLiquidity(poolId, lpAmount)              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Pre-Test Deployment Checklist

Before running tests:

- [ ] Deploy FheatherXv6 to Arb Sepolia
- [ ] Deploy 4 test tokens: WETH, USDC, fheWETH, fheUSDC
- [ ] Create 4 pools (A, B, C, D)
- [ ] Fund test wallet with:
  - [ ] ARB Sepolia ETH for gas
  - [ ] Test tokens (use faucet)
- [ ] Update `deployments/arb-sepolia.json` with addresses
- [ ] Verify CoFHE coprocessor is responsive

---

## Success Criteria

All tests must pass for each pool type:

| Test | Pool A | Pool B | Pool C | Pool D |
|------|--------|--------|--------|--------|
| Create Pool | Pass | Pass | Pass | Pass |
| Add Liquidity | Pass | Pass | Pass | Pass |
| Market Swap (router) | Pass | Pass | Pass | Pass |
| Market Swap (direct) | Pass | Pass | Pass | Pass |
| Swap Encrypted | N/A | Pass | Partial | Partial |
| Limit Buy | N/A | Pass | Pass | N/A |
| Limit Sell | N/A | Pass | N/A | Pass |
| Stop Loss | N/A | Pass | N/A | Pass |
| Take Profit | N/A | Pass | N/A | Pass |
| Trigger + Claim | N/A | Pass | Pass | Pass |
| Cancel Order | N/A | Pass | Pass | Pass |
| Remove LP (partial) | Pass | Pass | Pass | Pass |
| Remove LP (full) | Pass | Pass | Pass | Pass |

**N/A** = Operation not supported for that pool type (by design)
**Partial** = Only works for FHERC20 side of mixed pool
