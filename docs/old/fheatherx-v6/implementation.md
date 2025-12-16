# FheatherX v6 - Implementation Guide

## Overview

FheatherX v6 is a Uniswap v4 Hook that combines:
- **Encrypted AMM** with FHE-protected reserves (x*y=k)
- **Private Limit Orders** with tick-based pricing
- **Full V4 Composability** via proper PoolManager settlement

### Key Improvement Over v5

v5 had a critical bug: `_beforeSwap` returned deltas but never called `poolManager.take()` / `settle()`, causing settlement failures. v6 fixes this by following the [CustomCurveHook](https://github.com/Uniswap/v4-core/blob/main/src/test/CustomCurveHook.sol) pattern.

---

## Custom Errors

```solidity
// Custom Errors for v6
error ZeroAmount();
error PoolNotInitialized();
error SlippageExceeded();
error InsufficientLiquidity();
error InvalidTick();
error InputTokenMustBeFherc20();
error BothTokensMustBeFherc20();
error InsufficientBalance();
error InvalidPoolId();
```

---

## State Variables

```solidity
/// @notice Default pool for single-pool convenience functions
/// @dev Set during first pool initialization or by owner
PoolId public defaultPoolId;

/// @notice Fee collector address
address public feeCollector;

/// @notice Whether default pool has been set
bool public defaultPoolSet;
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         User / Router                            │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       PoolManager                                │
│  - Manages all V4 pools                                          │
│  - Routes swaps to hooks                                         │
│  - Handles settlement (take/settle)                              │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      FheatherXv6 Hook                            │
│                                                                  │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │  Encrypted AMM  │    │  Limit Orders   │                     │
│  │  (x*y=k FHE)    │    │  (Tick Buckets) │                     │
│  └────────┬────────┘    └────────┬────────┘                     │
│           │                      │                               │
│           └──────────┬───────────┘                               │
│                      ▼                                           │
│           ┌─────────────────────┐                                │
│           │  Token Reserves     │                                │
│           │  (Hook holds tokens)│                                │
│           └─────────────────────┘                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Critical Fix: V4 Settlement in `_beforeSwap`

### The Problem (v5)

```solidity
// v5 _beforeSwap - BROKEN
function _beforeSwap(...) {
    // Calculate AMM output
    uint256 amountOut = _estimateOutput(...);

    // Update internal reserves
    reserves.reserve0 += amountIn;
    reserves.reserve1 -= amountOut;

    // Return delta - BUT PoolManager has no tokens to settle!
    return (selector, delta, 0);  // FAILS at settlement
}
```

### The Solution (v6)

Following the CustomCurveHook pattern:

```solidity
// v6 _beforeSwap - FIXED
function _beforeSwap(
    address sender,
    PoolKey calldata key,
    SwapParams calldata params,
    bytes calldata
) internal override returns (bytes4, BeforeSwapDelta, uint24) {
    PoolId poolId = key.toId();

    // 1. Calculate swap amounts BEFORE updating reserves
    bool zeroForOne = params.zeroForOne;
    uint256 amountIn = uint256(-params.amountSpecified);  // exact input

    // IMPORTANT: Calculate output using CURRENT reserves (before update)
    uint256 amountOut = _estimateOutput(poolId, zeroForOne, amountIn);

    // 2. Determine currencies
    Currency inputCurrency = zeroForOne ? key.currency0 : key.currency1;
    Currency outputCurrency = zeroForOne ? key.currency1 : key.currency0;

    // 3. CRITICAL: Take input tokens FROM PoolManager TO hook
    //    - User already sent tokens to Router/PoolManager
    //    - take() transfers those tokens from PoolManager to this hook
    //    - This creates a NEGATIVE delta for PoolManager (it owes less)
    poolManager.take(inputCurrency, address(this), amountIn);

    // 4. CRITICAL: Settle output tokens FROM hook TO PoolManager
    //    - Hook transfers output tokens to PoolManager
    //    - settle() clears the hook's debt for those tokens
    //    - PoolManager then forwards them to the user
    IERC20(Currency.unwrap(outputCurrency)).transfer(address(poolManager), amountOut);
    poolManager.settle(outputCurrency);

    // 5. Update encrypted reserves AFTER settlement (FHE math)
    _executeSwapMathForPool(poolId, FHE.asEbool(zeroForOne), FHE.asEuint128(amountIn));

    // 6. Update plaintext reserve cache
    PoolReserves storage reserves = poolReserves[poolId];
    if (zeroForOne) {
        reserves.reserve0 += amountIn;
        reserves.reserve1 -= amountOut;
    } else {
        reserves.reserve1 += amountIn;
        reserves.reserve0 -= amountOut;
    }

    // 7. Return delta that negates the swap (hook handled it completely)
    BeforeSwapDelta hookDelta = toBeforeSwapDelta(
        int128(-params.amountSpecified),  // specified: negate input
        int128(int256(amountOut))          // unspecified: output amount
    );

    return (this.beforeSwap.selector, hookDelta, 0);
}
```

### Token Flow Explanation

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    V4 Settlement Token Flow                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. User approves Router for input tokens                                │
│  2. User calls Router.swap()                                             │
│  3. Router transfers input tokens TO PoolManager                         │
│  4. PoolManager calls Hook._beforeSwap()                                 │
│                                                                          │
│     Inside _beforeSwap:                                                  │
│     ┌─────────────────────────────────────────────────────────────────┐ │
│     │ a. poolManager.take(inputCurrency, hook, amountIn)               │ │
│     │    → Transfers input FROM PoolManager TO Hook                    │ │
│     │    → Hook now holds the input tokens                             │ │
│     │                                                                   │ │
│     │ b. Hook calculates amountOut using AMM formula                   │ │
│     │                                                                   │ │
│     │ c. IERC20(outputToken).transfer(poolManager, amountOut)          │ │
│     │    → Transfers output FROM Hook TO PoolManager                   │ │
│     │                                                                   │ │
│     │ d. poolManager.settle(outputCurrency)                            │ │
│     │    → Clears the debt, PoolManager can now send to user           │ │
│     └─────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  5. PoolManager forwards output tokens to User                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Critical: `_afterSwap` for Limit Order Triggering

The `_afterSwap` hook is **essential** for triggering limit orders when price moves. This was present in v5 and must be preserved in v6.

```solidity
/// @notice Called after a swap completes - triggers limit orders on price movement
function _afterSwap(
    address sender,
    PoolKey calldata key,
    SwapParams calldata params,
    BalanceDelta delta,
    bytes calldata hookData
) internal override returns (bytes4, int128) {
    PoolId poolId = key.toId();
    PoolReserves storage reserves = poolReserves[poolId];

    // Calculate old tick (before swap) and new tick (after swap)
    // Old tick is approximated from delta, new tick from current reserves
    int24 oldTick = _getCurrentTick(poolId);  // Actually represents post-swap state

    // Determine tick movement direction based on swap direction
    // zeroForOne = true means selling token0 → price of token0 drops → tick decreases
    // zeroForOne = false means buying token0 → price of token0 rises → tick increases
    bool zeroForOne = params.zeroForOne;

    // Process any limit orders that were triggered by this price movement
    // This fills limit orders that are now "in the money"
    _processTriggeredOrders(poolId, zeroForOne);

    return (this.afterSwap.selector, 0);
}

/// @notice Process limit orders triggered by price movement
/// @dev Called after swaps to fill orders that crossed the current price
function _processTriggeredOrders(PoolId poolId, bool zeroForOne) internal {
    int24 currentTick = _getCurrentTick(poolId);

    if (zeroForOne) {
        // Price moved DOWN (selling token0)
        // Process BUY orders at or above current tick (they want to buy token0 cheaper)
        _processBuyOrdersDown(poolId, currentTick);
    } else {
        // Price moved UP (buying token0)
        // Process SELL orders at or below current tick (they want to sell token0 higher)
        _processSellOrdersUp(poolId, currentTick);
    }
}
```

### Limit Order Lifecycle

```
┌─────────┐  deposit()  ┌─────────┐  swap triggers  ┌─────────┐  claim()  ┌─────────┐
│  EMPTY  │ ──────────> │ ACTIVE  │ ─────────────> │ FILLED  │ ────────> │ CLAIMED │
└─────────┘             └─────────┘                └─────────┘           └─────────┘
                              │
                              │ withdraw()
                              ▼
                        ┌───────────┐
                        │ CANCELLED │
                        └───────────┘
```

---

## New Functions in v6

### 1. Simple Reserve Getters

```solidity
/// @notice Get reserve0 for the default pool
function reserve0() external view returns (uint256) {
    return poolReserves[defaultPoolId].reserve0;
}

/// @notice Get reserve1 for the default pool
function reserve1() external view returns (uint256) {
    return poolReserves[defaultPoolId].reserve1;
}

/// @notice Get reserves for a specific pool
function getReserves(PoolId poolId) external view returns (uint256 r0, uint256 r1) {
    PoolReserves storage r = poolReserves[poolId];
    return (r.reserve0, r.reserve1);
}
```

### 2. Current Tick Getter

```solidity
/// @notice Get current tick derived from reserves ratio
/// @dev Tick represents log1.006(price) where price = reserve1/reserve0
function getCurrentTick(PoolId poolId) external view returns (int24) {
    return _getCurrentTick(poolId);
}

/// @notice Internal tick calculation from reserves
function _getCurrentTick(PoolId poolId) internal view returns (int24) {
    PoolReserves storage r = poolReserves[poolId];
    if (r.reserve0 == 0) return 0;

    // price = reserve1 / reserve0
    // tick = log(price) / log(1.006)
    // Simplified: use pre-computed tick prices for lookup
    uint256 price = (r.reserve1 * PRECISION) / r.reserve0;
    return _priceToTick(price);
}

/// @notice Convert price to nearest tick
function _priceToTick(uint256 price) internal pure returns (int24) {
    // Binary search through tick prices or use logarithm approximation
    // Each tick = 0.6% price increment, tick 0 = price 1.0
    // tick = ln(price) / ln(1.006)
    if (price == 0) return MIN_TICK;
    if (price >= tickPrices[MAX_TICK]) return MAX_TICK;

    // Approximate using integer math
    int24 tick = 0;
    uint256 targetPrice = price;
    uint256 currentPrice = PRECISION; // 1.0 at tick 0

    if (targetPrice > currentPrice) {
        // Price > 1, positive tick
        while (currentPrice < targetPrice && tick < MAX_TICK) {
            currentPrice = (currentPrice * 1006) / 1000;
            tick += 1;
        }
    } else {
        // Price < 1, negative tick
        while (currentPrice > targetPrice && tick > MIN_TICK) {
            currentPrice = (currentPrice * 1000) / 1006;
            tick -= 1;
        }
    }
    return tick;
}
```

### 3. Order Query Helpers

```solidity
/// @notice Check if there are orders at a specific tick
function hasOrdersAtTick(
    PoolId poolId,
    int24 tick,
    BucketSide side
) external view returns (bool) {
    Bucket storage bucket = buckets[poolId][tick][side];
    return bucket.initialized && Common.isInitialized(bucket.totalShares);
}

/// @notice Get user's claimable proceeds for a filled order
/// @dev Returns encrypted value - user must decrypt via FHE session
function getClaimableProceeds(
    PoolId poolId,
    address user,
    int24 tick,
    BucketSide side
) external view returns (euint128) {
    UserPosition storage pos = positions[poolId][user][tick][side];
    Bucket storage bucket = buckets[poolId][tick][side];

    if (!Common.isInitialized(pos.shares)) {
        return FHE.asEuint128(0);
    }

    // Calculate unclaimed proceeds
    euint128 proceedsDelta = FHE.sub(bucket.proceedsPerShare, pos.proceedsPerShareSnapshot);
    euint128 newProceeds = FHE.div(FHE.mul(pos.shares, proceedsDelta), ENC_PRECISION);

    return FHE.add(pos.realizedProceeds, newProceeds);
}
```

### 4. Quote Function

```solidity
/// @notice Get expected output for a swap (view function for frontend)
/// @param zeroForOne Direction of swap
/// @param amountIn Input amount
/// @return amountOut Expected output amount
function getQuote(
    bool zeroForOne,
    uint256 amountIn
) external view returns (uint256 amountOut) {
    return _estimateOutput(defaultPoolId, zeroForOne, amountIn);
}

/// @notice Get quote for a specific pool
function getQuoteForPool(
    PoolId poolId,
    bool zeroForOne,
    uint256 amountIn
) external view returns (uint256 amountOut) {
    return _estimateOutput(poolId, zeroForOne, amountIn);
}
```

### 5. Direct Swap (Bypasses V4 Router)

```solidity
/// @notice Execute a swap directly through the hook
/// @dev Useful for simpler UX without V4 router
/// @param zeroForOne true = sell token0, false = sell token1
/// @param amountIn Amount of input token
/// @param minAmountOut Minimum acceptable output (slippage protection)
/// @return amountOut Actual output amount
function swap(
    bool zeroForOne,
    uint256 amountIn,
    uint256 minAmountOut
) external nonReentrant whenNotPaused returns (uint256 amountOut) {
    PoolId poolId = defaultPoolId;
    PoolState storage state = poolStates[poolId];

    if (!state.initialized) revert PoolNotInitialized();
    if (amountIn == 0) revert ZeroAmount();

    // 1. IMPORTANT: Calculate output BEFORE updating reserves
    //    This uses the current reserves to determine AMM output
    amountOut = _estimateOutput(poolId, zeroForOne, amountIn);
    if (amountOut < minAmountOut) revert SlippageExceeded();

    // 2. Transfer input from user
    IERC20 tokenIn = IERC20(address(zeroForOne ? state.token0 : state.token1));
    tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);

    // 3. Apply fee
    uint256 fee = (amountOut * state.protocolFeeBps) / 10000;
    uint256 amountOutAfterFee = amountOut - fee;

    // 4. Update reserves (plaintext cache)
    PoolReserves storage reserves = poolReserves[poolId];
    if (zeroForOne) {
        reserves.reserve0 += amountIn;
        reserves.reserve1 -= amountOut;
    } else {
        reserves.reserve1 += amountIn;
        reserves.reserve0 -= amountOut;
    }

    // 5. Update encrypted reserves (FHE math)
    euint128 encAmountIn = FHE.asEuint128(uint128(amountIn));
    ebool encDirection = FHE.asEbool(zeroForOne);
    FHE.allowThis(encAmountIn);
    _executeSwapMathForPool(poolId, encDirection, encAmountIn);

    // 6. Transfer output to user (after fee)
    IERC20 tokenOut = IERC20(address(zeroForOne ? state.token1 : state.token0));
    tokenOut.safeTransfer(msg.sender, amountOutAfterFee);

    // 7. Transfer fee to collector
    if (fee > 0 && feeCollector != address(0)) {
        tokenOut.safeTransfer(feeCollector, fee);
    }

    // 8. Trigger limit orders based on new price
    _processTriggeredOrders(poolId, zeroForOne);

    emit Swap(poolId, msg.sender, zeroForOne, amountIn, amountOutAfterFee);
}
```

---

## Functions Retained from v5

| Function | Purpose |
|----------|---------|
| `deposit()` | Deposit ERC20 tokens to hook |
| `withdraw()` | Withdraw ERC20 tokens from hook |
| `claim()` | Claim limit order proceeds |
| `addLiquidity()` | Add LP with plaintext amounts |
| `removeLiquidity()` | Remove LP with plaintext amounts |
| `addLiquidityEncrypted()` | Add LP with encrypted amounts |
| `removeLiquidityEncrypted()` | Remove LP with encrypted amounts |
| `swapEncrypted()` | Swap with encrypted amounts (FHERC20) |
| `placeOrder()` | Place limit order at tick |
| `cancelOrder()` | Cancel active limit order |
| `_processTriggeredOrders()` | Execute limit orders on price movement |

---

## Token Flow Diagrams

### V4 Router Swap (via `_beforeSwap`)

```
User → Router → PoolManager → Hook._beforeSwap()
                    │                    │
                    │     1. poolManager.take(inputCurrency)
                    │     ◄──────────────┤
                    │                    │
                    │     2. Hook executes AMM math
                    │                    │
                    │     3. Hook transfers output to poolManager
                    │     ◄──────────────┤
                    │                    │
                    │     4. poolManager.settle(outputCurrency)
                    │     ◄──────────────┤
                    │                    │
                    ▼                    │
              Settlement complete        │
                    │                    │
                    ▼                    ▼
              User receives output tokens
```

### Direct Swap (via `swap()`)

```
User → Hook.swap()
         │
         │  1. transferFrom(user, hook, amountIn)
         │
         │  2. Execute AMM math (FHE)
         │
         │  3. transfer(hook, user, amountOut)
         │
         ▼
    User receives output tokens
```

---

## Initialization Changes

### Constructor / afterInitialize

```solidity
function _afterInitialize(
    address,
    PoolKey calldata key,
    uint160,
    int24
) internal override returns (bytes4) {
    // ... existing initialization ...

    // NEW: Approve PoolManager to take tokens from hook
    IERC20(Currency.unwrap(key.currency0)).approve(address(poolManager), type(uint256).max);
    IERC20(Currency.unwrap(key.currency1)).approve(address(poolManager), type(uint256).max);

    return this.afterInitialize.selector;
}
```

---

## Gas Optimization: Unified Function Pattern

### Current Contract Size

| Contract | Runtime Size | Limit | Margin |
|----------|-------------|-------|--------|
| FheatherXv5 | 20,006 B | 24,576 B | 4,570 B |

**Target**: Keep v6 under 24,576 bytes (EIP-170 limit) with optimizer runs increased.

### Problem: Duplicate Logic

v5 has several function pairs where the plaintext version duplicates logic that's also in the encrypted version:

| Plaintext Function | Encrypted Function | Shared Logic |
|--------------------|-------------------|--------------|
| `addLiquidity()` | `addLiquidityEncrypted()` | LP calculation, reserve updates |
| `removeLiquidity()` | `removeLiquidityEncrypted()` | Proportional withdrawal, reserve updates |
| `swap()` (new) | `swapEncrypted()` | AMM math, fee calculation |

### Solution: Plaintext Calls Encrypted Core

Refactor so plaintext functions encrypt inputs and call the internal encrypted implementation:

```solidity
// ============================================
// ADD LIQUIDITY
// ============================================

/// @notice Internal encrypted LP logic
function _addLiquidityCore(
    PoolId poolId,
    euint128 amt0,
    euint128 amt1,
    address depositor
) internal returns (euint128 lpAmount) {
    PoolReserves storage reserves = poolReserves[poolId];

    // Calculate LP amount (encrypted math)
    ebool isFirstDeposit = FHE.eq(reserves.encTotalLpSupply, ENC_ZERO);

    // First deposit: LP = min(amt0, amt1) * 2
    ebool amt0Smaller = FHE.lt(amt0, amt1);
    euint128 minAmt = FHE.select(amt0Smaller, amt0, amt1);
    euint128 firstDepositLp = FHE.mul(minAmt, FHE.asEuint128(2));

    // Subsequent: LP = min(amt0 * totalLP / reserve0, amt1 * totalLP / reserve1)
    euint128 safeRes0 = FHE.select(FHE.gt(reserves.encReserve0, ENC_ZERO), reserves.encReserve0, ENC_ONE);
    euint128 safeRes1 = FHE.select(FHE.gt(reserves.encReserve1, ENC_ZERO), reserves.encReserve1, ENC_ONE);
    euint128 lpFromAmt0 = FHE.div(FHE.mul(amt0, reserves.encTotalLpSupply), safeRes0);
    euint128 lpFromAmt1 = FHE.div(FHE.mul(amt1, reserves.encTotalLpSupply), safeRes1);
    euint128 subsequentLp = FHE.select(FHE.lt(lpFromAmt0, lpFromAmt1), lpFromAmt0, lpFromAmt1);

    lpAmount = FHE.select(isFirstDeposit, firstDepositLp, subsequentLp);

    // Update reserves
    reserves.encReserve0 = FHE.add(reserves.encReserve0, amt0);
    reserves.encReserve1 = FHE.add(reserves.encReserve1, amt1);
    reserves.encTotalLpSupply = FHE.add(reserves.encTotalLpSupply, lpAmount);

    // Update user balance
    euint128 currentBalance = encLpBalances[poolId][depositor];
    encLpBalances[poolId][depositor] = Common.isInitialized(currentBalance)
        ? FHE.add(currentBalance, lpAmount)
        : lpAmount;

    // FHE permissions
    FHE.allowThis(lpAmount);
    FHE.allowThis(reserves.encReserve0);
    FHE.allowThis(reserves.encReserve1);
    FHE.allowThis(reserves.encTotalLpSupply);
    FHE.allowThis(encLpBalances[poolId][depositor]);
    FHE.allow(encLpBalances[poolId][depositor], depositor);

    return lpAmount;
}

/// @notice Add liquidity with plaintext amounts (encrypts and calls core)
function addLiquidity(
    PoolId poolId,
    uint256 amount0,
    uint256 amount1
) external nonReentrant whenNotPaused returns (uint256 lpAmount) {
    if (amount0 == 0 || amount1 == 0) revert ZeroAmount();

    PoolState storage state = poolStates[poolId];
    if (!state.initialized) revert PoolNotInitialized();

    // Transfer tokens
    IERC20(address(state.token0)).safeTransferFrom(msg.sender, address(this), amount0);
    IERC20(address(state.token1)).safeTransferFrom(msg.sender, address(this), amount1);

    // Encrypt amounts and call core
    euint128 encAmt0 = FHE.asEuint128(uint128(amount0));
    euint128 encAmt1 = FHE.asEuint128(uint128(amount1));
    FHE.allowThis(encAmt0);
    FHE.allowThis(encAmt1);

    euint128 encLpAmount = _addLiquidityCore(poolId, encAmt0, encAmt1, msg.sender);

    // Update plaintext cache
    lpAmount = amount0 < amount1 ? amount0 : amount1; // Approximation for event
    PoolReserves storage reserves = poolReserves[poolId];
    reserves.reserve0 += amount0;
    reserves.reserve1 += amount1;
    lpBalances[poolId][msg.sender] += lpAmount;
    totalLpSupply[poolId] += lpAmount;

    emit LiquidityAdded(poolId, msg.sender, amount0, amount1, lpAmount);
}

/// @notice Add liquidity with encrypted amounts (calls core directly)
function addLiquidityEncrypted(
    PoolId poolId,
    InEuint128 calldata amount0,
    InEuint128 calldata amount1
) external nonReentrant whenNotPaused returns (euint128 lpAmount) {
    PoolState storage state = poolStates[poolId];
    if (!state.initialized) revert PoolNotInitialized();

    euint128 amt0 = FHE.asEuint128(amount0);
    euint128 amt1 = FHE.asEuint128(amount1);
    FHE.allowThis(amt0);
    FHE.allowThis(amt1);

    // Transfer encrypted tokens
    FHE.allow(amt0, address(state.token0));
    FHE.allow(amt1, address(state.token1));
    state.token0.transferFromEncryptedDirect(msg.sender, address(this), amt0);
    state.token1.transferFromEncryptedDirect(msg.sender, address(this), amt1);

    // Call shared core
    lpAmount = _addLiquidityCore(poolId, amt0, amt1, msg.sender);
    FHE.allow(lpAmount, msg.sender);

    _requestReserveSync(poolId);
    emit LiquidityAddedEncrypted(poolId, msg.sender);
}
```

### Functions to Refactor

| Function Pair | Core Function | Estimated Savings |
|---------------|---------------|-------------------|
| `addLiquidity` / `addLiquidityEncrypted` | `_addLiquidityCore()` | ~1.5 KB |
| `removeLiquidity` / `removeLiquidityEncrypted` | `_removeLiquidityCore()` | ~1.5 KB |
| `swap` / `swapEncrypted` | `_swapCore()` | ~1 KB |

**Total estimated savings**: ~4 KB (reduces from 20 KB to ~16 KB)

### Optimizer Settings for v6

```toml
# foundry.toml
[profile.default]
optimizer = true
optimizer_runs = 999999
via_ir = true
```

**Understanding `optimizer_runs`:**

| optimizer_runs | Deployment Size | Runtime Gas | Best For |
|----------------|-----------------|-------------|----------|
| Low (200) | Smaller | Higher | Infrequently called contracts |
| High (999999) | Larger | Lower | Frequently called contracts |

At `999999`, the optimizer assumes the contract will be called many times, so it:
- **Increases deployment bytecode** (more inline code, less jumps)
- **Reduces runtime gas** (faster execution paths)

**For FheatherX v6:** Since we're near the 24KB EIP-170 limit, if bytecode is too large, reduce to `200-1000` and accept slightly higher runtime gas.

**Current recommendation:** Start with `999999`. If contract exceeds 24KB, reduce incrementally until it fits.

### Size Budget

| Component | Current v5 | After Refactor | With New Features |
|-----------|------------|----------------|-------------------|
| Base contract | 20,006 B | ~16,000 B | - |
| + V4 settlement | - | - | +500 B |
| + `swap()` | - | - | +300 B |
| + `getQuote()` / `reserve0()` / `reserve1()` | - | - | +200 B |
| **Total** | 20,006 B | - | ~17,000 B |
| **Margin** | 4,570 B | - | ~7,500 B |

---

## Mixed Token Pair Support (ERC20 : FHERC20)

### The Problem in v5

v5 stores both tokens as `IFHERC20` and assumes the caller knows which function to use:

```solidity
struct PoolState {
    IFHERC20 token0;  // Could be ERC20 or FHERC20
    IFHERC20 token1;  // Could be ERC20 or FHERC20
}
```

| Function | Token0 Assumed | Token1 Assumed | Works for Mixed? |
|----------|----------------|----------------|------------------|
| `addLiquidity()` | ERC20 | ERC20 | Partial (FHERC20 has ERC20 interface) |
| `addLiquidityEncrypted()` | FHERC20 | FHERC20 | **NO** - fails if token is plain ERC20 |
| `removeLiquidity()` | ERC20 | ERC20 | Partial |
| `removeLiquidityEncrypted()` | FHERC20 | FHERC20 | **NO** |

### v6 Solution: Token Type Detection

Add a flag per token to indicate its type:

```solidity
struct PoolState {
    address token0;           // Token address (agnostic)
    address token1;           // Token address (agnostic)
    bool token0IsFherc20;     // true if FHERC20, false if plain ERC20
    bool token1IsFherc20;     // true if FHERC20, false if plain ERC20
    // ... other fields
}
```

### Detection Method

Use interface detection during pool initialization:

```solidity
/// @notice Check if a token is FHERC20 by attempting to call a unique function
/// @dev FHERC20 tokens have wrap() which plain ERC20s don't have
function _isFherc20(address token) internal view returns (bool) {
    // Method 1: Check for wrap(uint256) function
    // This is unique to FHERC20 - plain ERC20 doesn't have it
    (bool success, ) = token.staticcall(
        abi.encodeWithSelector(
            bytes4(keccak256("wrap(uint256)")),
            uint256(0)
        )
    );

    // If the call succeeds (doesn't revert), it's likely FHERC20
    // Note: We're checking if the function EXISTS, not if it succeeds with 0
    return success;
}

/// @notice Alternative: Check for transferEncrypted function
function _isFherc20Alt(address token) internal view returns (bool) {
    // Try to get the code size and check for known selectors
    bytes4 wrapSelector = bytes4(keccak256("wrap(uint256)"));

    // Low-level call to check if function exists
    (bool success, bytes memory data) = token.staticcall(
        abi.encodeWithSelector(wrapSelector, 0)
    );

    // Success could mean:
    // 1. Function exists and executed (even if reverted internally)
    // 2. We need to verify it's not just a fallback

    // More robust: check if contract has significant code
    uint256 size;
    assembly {
        size := extcodesize(token)
    }

    // FHERC20 contracts are typically larger due to FHE logic
    // Plain ERC20 is usually < 3KB, FHERC20 > 5KB
    // This is a heuristic, not guaranteed
    return success && size > 3000;
}
```

**Recommended approach:** Set token type flags explicitly during pool creation rather than auto-detection:

```solidity
function initializePool(
    PoolKey calldata key,
    bool token0IsFherc20,
    bool token1IsFherc20
) external {
    // Explicitly set by pool creator - most reliable
    PoolState storage state = poolStates[key.toId()];
    state.token0IsFherc20 = token0IsFherc20;
    state.token1IsFherc20 = token1IsFherc20;
}
```

### Unified Transfer Helpers

```solidity
/// @notice Transfer tokens from user to hook (handles both ERC20 and FHERC20)
function _transferIn(
    address token,
    bool isFherc20,
    address from,
    uint256 plaintextAmount,
    euint128 encryptedAmount
) internal {
    if (isFherc20) {
        FHE.allow(encryptedAmount, token);
        IFHERC20(token).transferFromEncryptedDirect(from, address(this), encryptedAmount);
    } else {
        IERC20(token).safeTransferFrom(from, address(this), plaintextAmount);
    }
}

/// @notice Transfer tokens from hook to user (handles both ERC20 and FHERC20)
function _transferOut(
    address token,
    bool isFherc20,
    address to,
    uint256 plaintextAmount,
    euint128 encryptedAmount
) internal {
    if (isFherc20) {
        FHE.allow(encryptedAmount, token);
        IFHERC20(token).transferEncryptedDirect(to, encryptedAmount);
    } else {
        IERC20(token).safeTransfer(to, plaintextAmount);
    }
}
```

### Mixed Pair Liquidity Functions

```solidity
/// @notice Add liquidity - handles any token combination
function addLiquidity(
    PoolId poolId,
    uint256 amount0,
    uint256 amount1
) external nonReentrant whenNotPaused returns (uint256 lpAmount) {
    PoolState storage state = poolStates[poolId];

    // Encrypt amounts for core logic
    euint128 encAmt0 = FHE.asEuint128(uint128(amount0));
    euint128 encAmt1 = FHE.asEuint128(uint128(amount1));

    // Transfer in - each token handled according to its type
    _transferIn(state.token0, state.token0IsFherc20, msg.sender, amount0, encAmt0);
    _transferIn(state.token1, state.token1IsFherc20, msg.sender, amount1, encAmt1);

    // Core encrypted LP math
    euint128 encLpAmount = _addLiquidityCore(poolId, encAmt0, encAmt1, msg.sender);

    // Update plaintext cache
    // ...
}

/// @notice Add liquidity with encrypted amounts
/// @dev Only works if BOTH tokens are FHERC20
function addLiquidityEncrypted(
    PoolId poolId,
    InEuint128 calldata amount0,
    InEuint128 calldata amount1
) external nonReentrant whenNotPaused returns (euint128 lpAmount) {
    PoolState storage state = poolStates[poolId];

    // Require both tokens to be FHERC20 for fully encrypted path
    require(state.token0IsFherc20 && state.token1IsFherc20, "Both tokens must be FHERC20");

    // ... existing encrypted logic
}
```

### Token Pair Matrix for v6

| Pool Type | `addLiquidity()` | `addLiquidityEncrypted()` | `swap()` | `swapEncrypted()` |
|-----------|------------------|---------------------------|----------|-------------------|
| ERC20 : ERC20 | Yes | No | Yes | No |
| FHERC20 : FHERC20 | Yes | Yes | Yes | Yes |
| ERC20 : FHERC20 | Yes | No | Yes | Partial* |

*Partial: `swapEncrypted` only works when selling the FHERC20 token

### Limit Order Rules (Unchanged)

From `token-pair-support.md`:
- **Input token must be FHERC20** for limit orders (order size encryption)
- Plain ERC20 input → order size visible → MEV risk → rejected

```solidity
function deposit(
    PoolId poolId,
    int24 tick,
    BucketSide side,
    InEuint128 calldata encryptedAmount,
    // ...
) external {
    PoolState storage state = poolStates[poolId];

    // Determine input token based on side
    bool inputIsFherc20 = side == BucketSide.SELL
        ? state.token0IsFherc20
        : state.token1IsFherc20;

    require(inputIsFherc20, "Input token must be FHERC20 for limit orders");

    // ... rest of deposit logic
}
```

---

## Migration from v5

1. Deploy new FheatherXv6 contract
2. Initialize pool with same tokens
3. Users migrate liquidity:
   - Remove from v5 via `removeLiquidity()`
   - Add to v6 via `addLiquidity()`
4. Update frontend to point to v6 addresses
5. Update router ABI if needed (should be compatible)

---

## Testing Checklist

- [ ] V4 router swap works (via PoolSwapTest)
- [ ] Direct swap works (via `swap()`)
- [ ] `getQuote()` returns accurate estimates
- [ ] `reserve0()` / `reserve1()` return correct values
- [ ] Limit orders trigger on price movement
- [ ] LP functions work correctly
- [ ] Encrypted swaps work (FHERC20)
- [ ] Fee collection works
- [ ] Multi-pool support works

---

## Gas Estimates

FHE operations are significantly more expensive than standard EVM operations. Use these estimates for frontend gas limits:

| Operation | Estimated Gas | Notes |
|-----------|---------------|-------|
| `addLiquidity()` | ~150,000 | Plaintext path |
| `addLiquidityEncrypted()` | ~500,000+ | FHE math heavy |
| `removeLiquidity()` | ~120,000 | Plaintext path |
| `removeLiquidityEncrypted()` | ~450,000+ | FHE math heavy |
| `swap()` direct | ~180,000 | Direct hook call |
| `swap()` via V4 router | ~220,000 | V4 router overhead |
| `swapEncrypted()` | ~400,000+ | Encrypted amounts |
| `deposit()` (limit order) | ~300,000 | Encrypted amount |
| `withdraw()` (cancel order) | ~250,000 | |
| `claim()` (filled order) | ~100,000 | |
| `getQuote()` | ~30,000 | View function |

**Notes:**
- Gas costs vary with CoFHE coprocessor load
- First FHE operation in a session may cost more (initialization)
- Always use `eth_estimateGas` for accurate estimates

---

## Frontend Hook Updates for v6

The following frontend hooks need modifications for v6 compatibility:

| Hook | Change Required |
|------|-----------------|
| `useSwap` | Add direct swap option bypassing router; use new `swap()` function |
| `useCurrentPrice` | Use new `getReserves()` / `getCurrentTick()` functions |
| `usePlaceOrder` | Add token type validation (input must be FHERC20) |
| `useAddLiquidity` | Support mixed pairs; detect token types |
| `useClaimOrder` | Use new `getClaimableProceeds()` for preview |

### New Hook: `usePoolInfo`

```typescript
function usePoolInfo(poolId: PoolId) {
  // Fetch from new v6 functions
  const reserves = useContractRead({
    address: hookAddress,
    abi: FHEATHERX_V6_ABI,
    functionName: 'getReserves',
    args: [poolId],
  });

  const currentTick = useContractRead({
    address: hookAddress,
    abi: FHEATHERX_V6_ABI,
    functionName: 'getCurrentTick',
    args: [poolId],
  });

  return { reserves, currentTick };
}
```

---

## Deployment Script Template

```solidity
// script/DeployV6.s.sol
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {FheatherXv6} from "../src/FheatherXv6.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

contract DeployV6 is Script {
    function run() external {
        vm.startBroadcast();

        // 1. Deploy FheatherXv6
        address poolManager = 0x...; // V4 PoolManager address
        FheatherXv6 hook = new FheatherXv6(IPoolManager(poolManager));

        // 2. Initialize pool via PoolManager
        // See Uniswap v4 docs for pool initialization

        // 3. Set default pool and fee collector
        hook.setDefaultPool(poolId);
        hook.setFeeCollector(feeCollectorAddress);

        // 4. Seed initial liquidity
        // ...

        vm.stopBroadcast();

        // 5. Export addresses
        console.log("FheatherXv6:", address(hook));
    }
}
```

---

## References

- [Uniswap v4 CustomCurveHook](https://github.com/Uniswap/v4-core/blob/main/src/test/CustomCurveHook.sol)
- [Uniswap v4 Hooks Documentation](https://docs.uniswap.org/contracts/v4/concepts/hooks)
- [FheatherXv5 Source](../contracts/src/FheatherXv5.sol)
- [Fhenix CoFHE Documentation](https://docs.fhenix.zone)
