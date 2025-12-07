# Plan: FheatherXv2 - Private AMM with FHE

## Vision

**FheatherX is a fully homomorphic encrypted (FHE) AMM that provides MEV protection and complete trade privacy while remaining compatible with the existing DeFi ecosystem.**

### The Problem We Solve

Traditional DEXs expose everything:
- Your trade direction (buying or selling)
- Your trade size
- Your limit order prices and amounts
- Your stop-loss and take-profit levels

This information leakage enables:
- **Front-running**: Bots see your pending tx and trade ahead of you
- **Sandwich attacks**: Bots manipulate price before and after your trade
- **Order book sniping**: Traders target your visible limit orders
- **Probe attacks**: Adversaries probe the system to extract information

### How FheatherX Solves This

**All operations are encrypted on-chain using FHE:**

| What's Hidden | How |
|---------------|-----|
| Trade direction | `ebool` encrypted boolean |
| Trade amount | `euint128` encrypted integer |
| Limit order prices | Encrypted trigger tick |
| Order types | Can't tell if it's buy/sell/stop/limit |
| User balances | Encrypted in FHERC20 tokens |

**All operations are synchronous:**
- Single-transaction execution (no 2-step commit/reveal)
- Minimizes attack surface
- No MEV extraction window

**Probe attack prevention:**
- Constant-time execution paths
- `FHE.select()` ensures both branches execute
- No information leakage from gas or timing

**Ecosystem compatibility:**
- Plaintext entry path auto-encrypts data
- Other pools can arbitrage to keep prices current
- Standard ERC20 interface for routers

---

## What FheatherX Offers

### 1. Private Swaps (Two Entry Paths)

**Path A - Plaintext Entry (Router Compatible)**
```
User → swap(100 ETH for USDC) → Hook encrypts → FHE swap math → Output
```
- Works with existing DEX routers and aggregators
- Hook encrypts the trade on entry
- Privacy preserved from that point forward
- Allows arbitrageurs to keep our prices current

**Path B - Encrypted Entry (Full Privacy)**
```
User → swapEncrypted(encAmount, encDirection) → FHE swap math → Encrypted output
```
- Amount never visible, even at entry
- Uses FHERC20 tokens (wrap ERC20 → encrypted balance)
- Maximum privacy for sophisticated users

### 2. Four Types of Encrypted Limit Orders

All order parameters are encrypted - no one can see your strategy:

```
Current Price: $2,000 ETH

                         ABOVE CURRENT PRICE
              ┌─────────────────────────────────────┐
   $3,000 ────│  BUY STOP    │  SELL LIMIT         │
              │  "Breakout"  │  "Take Profit"      │
              └─────────────────────────────────────┘
                              ▲
   $2,000 ──────────────── CURRENT ────────────────
                              ▼
              ┌─────────────────────────────────────┐
   $1,600 ────│  BUY LIMIT   │  SELL STOP          │
   $1,800 ────│  "Buy Dip"   │  "Stop Loss"        │
              └─────────────────────────────────────┘
                         BELOW CURRENT PRICE
```

| Order Type | Action | Trigger | Use Case |
|------------|--------|---------|----------|
| **Buy Limit** | Buy | Price drops below | "Buy ETH at $1,600" |
| **Buy Stop** | Buy | Price rises above | "Buy breakout at $3,000" |
| **Sell Limit** | Sell | Price rises above | "Take profit at $3,000" |
| **Sell Stop** | Sell | Price drops below | "Stop loss at $1,800" |

**Privacy**: Observer cannot distinguish between order types - they all look identical on-chain.

### 3. Liquidity Provision

Standard AMM liquidity operations with encrypted amounts:
- `addLiquidity()` / `addLiquidityEncrypted()`
- `removeLiquidity()` / `removeLiquidityEncrypted()`

---

## Design Principles

1. **Preserve existing engineering** - TickBitmap, DirectionLock, encrypted swap math, reserve sync
2. **Single-transaction operations** - No deposit→action→withdraw pattern
3. **Dual-path support** - Plaintext (router-compatible) and Encrypted (full privacy)
4. **4 limit order types** - Buy/Sell × Above/Below triggers, all encrypted
5. **Probe-resistant** - Constant-time execution, no information leakage

---

## Current vs Target Architecture

### Current Implementation
```
User Flow (3 transactions for a swap):
  1. deposit(100 token0)  →  Internal Balance += 100
  2. swap() via hook      →  Internal Balance adjusted (no token movement)
  3. withdraw(95 token1)  →  Internal Balance -= 95, tokens sent

Problems:
  - Can't integrate with routers/aggregators
  - User must manage internal balances
  - Not how standard AMMs work
```

### Target Implementation
```
User Flow (1 transaction):

Path A - Plaintext ERC20 (router-compatible):
  User: swap(100 token0)
    → Hook takes 100 token0 from user (transferFrom)
    → Encrypts: encAmount = FHE.asEuint128(100)
    → Executes encrypted AMM math
    → Estimates output from public reserves
    → Verifies encOutput >= encMinOutput (encrypted slippage check)
    → Sends ~95 token1 to user (transfer)
  Done in 1 tx

Path B - Encrypted FHERC20 (full privacy):
  User: swapEncrypted(encAmount, encDirection, encMinOutput)
    → Hook takes encrypted tokens via FHERC20.transferFromEncrypted
    → Executes encrypted AMM math
    → Sends encrypted output via FHERC20.transferEncryptedDirect
    → Amount never revealed
  Done in 1 tx
```

---

## Preserved Engineering (From Original FheatherX)

These existing solutions will be kept and reused:

| Component | File | Purpose |
|-----------|------|---------|
| **TickBitmap** | `src/lib/TickBitmap.sol` | Efficient O(1) lookup of ticks with orders |
| **DirectionLock** | `src/lib/DirectionLock.sol` | Encrypted direction enforcement |
| **Encrypted Swap Math** | `_executeSwapMath()` | x*y=k with FHE operations |
| **Reserve Sync** | `_requestReserveSync()`, `_trySyncReserves()` | Async encrypted→plaintext reserve updates |
| **Tick Calculation** | `_getCurrentTick()` | Price to tick conversion from reserves |
| **Order Processing** | `_processOrdersInRange()`, `_processOrdersAtTick()` | Limit order execution on tick cross |
| **Encrypted Constants** | `ENC_ZERO`, `ENC_ONE`, etc. | Pre-computed encrypted values for gas |

---

## Plaintext Output Estimation (Your Approach)

For plaintext swaps, we estimate output from public reserves:

```
┌─────────────────────────────────────────────────────────────┐
│              RESERVE SYNC & OUTPUT ESTIMATION               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  encReserve0, encReserve1  ←──  Source of truth (FHE)       │
│         │                                                   │
│         ├── FHE.decrypt() ──→  Async request                │
│         │                                                   │
│         └── After decryption ready:                         │
│              reserve0 = decrypted value                     │
│              reserve1 = decrypted value                     │
│                                                             │
│  Swap Output Calculation:                                   │
│  ────────────────────────                                   │
│  1. Estimate from public reserves (reserve0, reserve1)      │
│  2. Check if reserves are "fresh" (lastSyncBlock recent)    │
│  3. If fresh → output is accurate                           │
│  4. If stale → output might be off, slippage protects       │
│                                                             │
│  Slippage Protection:                                       │
│  ───────────────────                                        │
│  - User provides minAmountOut                               │
│  - On-chain: verify estimatedOutput >= minAmountOut         │
│  - If fails → revert, user can retry with more slippage     │
│                                                             │
│  Key: We can KNOW if reserves are accurate by checking:     │
│  - pendingReserve0/1 decryption status                      │
│  - Block distance from lastSyncBlock                        │
│  - Frontend can show "reserves may be stale" warning        │
└─────────────────────────────────────────────────────────────┘
```

---

## 4 Limit Order Types - Implementation

### Order Structure

```solidity
struct Order {
    address owner;
    int24 triggerTick;        // The price point (plaintext - needed for bitmap)
    ebool isSell;             // true = selling token0, false = buying token0
    ebool triggerAbove;       // true = trigger when price goes ABOVE tick
    euint128 amount;          // Encrypted amount
    euint128 minOutput;       // Encrypted slippage protection
    bool active;
}
```

The combination of `isSell` × `triggerAbove` gives us 4 order types:

| isSell | triggerAbove | Order Type | Example |
|--------|--------------|------------|---------|
| false | false | **Buy Limit** | Buy ETH when price drops to $1,600 |
| false | true | **Buy Stop** | Buy ETH when price breaks $3,000 |
| true | true | **Sell Limit** | Sell ETH when price hits $3,000 |
| true | false | **Sell Stop** | Stop loss: sell if price drops to $1,800 |

### Order Trigger Logic

```solidity
function _shouldOrderTrigger(
    Order storage order,
    int24 prevTick,
    int24 currentTick
) internal view returns (ebool) {
    // Determine if price crossed the trigger tick
    bool crossedUp = prevTick < order.triggerTick && currentTick >= order.triggerTick;
    bool crossedDown = prevTick > order.triggerTick && currentTick <= order.triggerTick;

    ebool encCrossedUp = FHE.asEbool(crossedUp);
    ebool encCrossedDown = FHE.asEbool(crossedDown);

    // triggerAbove=true → trigger on crossedUp
    // triggerAbove=false → trigger on crossedDown
    return FHE.select(order.triggerAbove, encCrossedUp, encCrossedDown);
}
```

### Place Order - Locks FHERC20 Tokens

```solidity
function placeOrder(
    int24 triggerTick,
    InEbool calldata isSell,
    InEbool calldata triggerAbove,
    InEuint128 calldata amount,
    InEuint128 calldata minOutput
) external payable returns (uint256 orderId) {
    ebool sell = FHE.asEbool(isSell);
    euint128 amt = FHE.asEuint128(amount);

    // Lock the INPUT token:
    // - If selling (isSell=true), lock token0
    // - If buying (isSell=false), lock token1 (paying with token1)
    euint128 token0Lock = FHE.select(sell, amt, ENC_ZERO);
    euint128 token1Lock = FHE.select(sell, ENC_ZERO, amt);

    fheToken0.transferFromEncrypted(msg.sender, address(this), token0Lock);
    fheToken1.transferFromEncrypted(msg.sender, address(this), token1Lock);

    // Store order
    orders[orderId] = Order({
        owner: msg.sender,
        triggerTick: triggerTick,
        isSell: sell,
        triggerAbove: FHE.asEbool(triggerAbove),
        amount: amt,
        minOutput: FHE.asEuint128(minOutput),
        active: true
    });

    orderBitmap.setTick(triggerTick);
}
```

### Cancel Order - Returns FHERC20 Tokens

```solidity
function cancelOrder(uint256 orderId) external {
    Order storage order = orders[orderId];
    require(order.owner == msg.sender);
    require(order.active);

    order.active = false;

    // Return locked tokens
    euint128 token0Return = FHE.select(order.isSell, order.amount, ENC_ZERO);
    euint128 token1Return = FHE.select(order.isSell, ENC_ZERO, order.amount);

    fheToken0.transferEncryptedDirect(msg.sender, token0Return);
    fheToken1.transferEncryptedDirect(msg.sender, token1Return);
}
```

### Fill Order - Execute Trade & Send Output

```solidity
function _fillOrder(Order storage order, ebool shouldFill) internal {
    // Execute swap math (always computed for constant-time)
    euint128 output = _executeSwapMathConditional(order.isSell, order.amount, shouldFill);

    // Slippage check
    ebool slippageOk = FHE.gte(output, order.minOutput);
    ebool actuallyFill = FHE.and(shouldFill, slippageOk);

    // Final output (0 if not filling or slippage failed)
    euint128 finalOutput = FHE.select(actuallyFill, output, ENC_ZERO);

    // Send OUTPUT token (opposite of input):
    // - If selling token0 (isSell=true), output is token1
    // - If buying token0 (isSell=false), output is token0
    euint128 token0Out = FHE.select(order.isSell, ENC_ZERO, finalOutput);
    euint128 token1Out = FHE.select(order.isSell, finalOutput, ENC_ZERO);

    fheToken0.transferEncryptedDirect(order.owner, token0Out);
    fheToken1.transferEncryptedDirect(order.owner, token1Out);

    // If slippage failed, return input
    ebool slippageFailed = FHE.and(shouldFill, FHE.not(slippageOk));
    euint128 refund = FHE.select(slippageFailed, order.amount, ENC_ZERO);

    euint128 token0Refund = FHE.select(order.isSell, refund, ENC_ZERO);
    euint128 token1Refund = FHE.select(order.isSell, ENC_ZERO, refund);

    fheToken0.transferEncryptedDirect(order.owner, token0Refund);
    fheToken1.transferEncryptedDirect(order.owner, token1Refund);

    order.active = false;
}
```

---

## New Contract Functions

### FheatherXv2.sol

```solidity
// ============ Swap Functions ============

/// @notice Swap with plaintext ERC20 tokens (router-compatible)
function swap(
    bool zeroForOne,
    uint256 amountIn,
    uint256 minAmountOut
) external nonReentrant returns (uint256 amountOut) {
    // 1. Take input tokens
    IERC20 tokenIn = zeroForOne ? token0 : token1;
    tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);

    // 2. Encrypt and execute swap math
    euint128 encAmountIn = FHE.asEuint128(uint128(amountIn));
    ebool encDirection = FHE.asEbool(zeroForOne);
    euint128 encOutput = _executeSwapMath(encDirection, encAmountIn);

    // 3. Estimate output from public reserves
    amountOut = _estimateOutput(zeroForOne, amountIn);
    require(amountOut >= minAmountOut, "Slippage exceeded");

    // 4. Send output tokens
    IERC20 tokenOut = zeroForOne ? token1 : token0;
    tokenOut.safeTransfer(msg.sender, amountOut);

    // 5. Update public reserve cache
    if (zeroForOne) {
        reserve0 += amountIn;
        reserve1 -= amountOut;
    } else {
        reserve1 += amountIn;
        reserve0 -= amountOut;
    }

    // 6. Request async reserve sync for accuracy
    _requestReserveSync();
}

/// @notice Swap with FHERC20 tokens (full privacy)
function swapEncrypted(
    InEbool calldata direction,
    InEuint128 calldata amountIn,
    InEuint128 calldata minOutput
) external nonReentrant returns (euint128 amountOut) {
    ebool dir = FHE.asEbool(direction);
    euint128 amt = FHE.asEuint128(amountIn);

    // 1. Take input (both transfers, one is zero)
    euint128 token0Amt = FHE.select(dir, amt, ENC_ZERO);
    euint128 token1Amt = FHE.select(dir, ENC_ZERO, amt);
    fheToken0.transferFromEncrypted(msg.sender, address(this), token0Amt);
    fheToken1.transferFromEncrypted(msg.sender, address(this), token1Amt);

    // 2. Execute encrypted swap math
    amountOut = _executeSwapMath(dir, amt);

    // 3. Slippage check (encrypted)
    euint128 encMinOut = FHE.asEuint128(minOutput);
    ebool slippageOk = FHE.gte(amountOut, encMinOut);
    // If slippage fails, output becomes zero (user gets nothing)
    // Could also revert, but this preserves privacy
    amountOut = FHE.select(slippageOk, amountOut, ENC_ZERO);

    // 4. Send output (opposite token)
    euint128 out0 = FHE.select(dir, ENC_ZERO, amountOut);
    euint128 out1 = FHE.select(dir, amountOut, ENC_ZERO);
    fheToken0.transferEncryptedDirect(msg.sender, out0);
    fheToken1.transferEncryptedDirect(msg.sender, out1);

    // 5. Request async reserve sync
    _requestReserveSync();
}

// ============ Liquidity Functions ============

function addLiquidity(uint256 amount0, uint256 amount1) external returns (uint256 lpAmount);
function removeLiquidity(uint256 lpAmount) external returns (uint256 amount0, uint256 amount1);
function addLiquidityEncrypted(InEuint128 calldata, InEuint128 calldata) external returns (euint128);
function removeLiquidityEncrypted(InEuint128 calldata) external returns (euint128, euint128);
```

---

## Files to Create/Modify

| File | Action | Notes |
|------|--------|-------|
| `src/FheatherXv2.sol` | **CREATE** | New contract with target architecture |
| `src/interface/IFheatherXv2.sol` | **CREATE** | New interface |
| `src/lib/TickBitmap.sol` | KEEP | Already correct |
| `src/lib/DirectionLock.sol` | KEEP | Already correct |
| `src/tokens/FHERC20FaucetToken.sol` | KEEP | Already has dual overloads |
| `test/FheatherXv2.t.sol` | **CREATE** | New test suite |
| `script/DeployFheatherXv2.s.sol` | **CREATE** | New deployment script |

Keep existing `FheatherX.sol` for reference until v2 is proven.

---

## Implementation Order

1. **Create FheatherXv2.sol**
   - Copy TickBitmap, DirectionLock, encrypted math from v1
   - Add `swap()` and `swapEncrypted()` functions
   - Add liquidity functions
   - Modify `placeOrder()` and `cancelOrder()` for direct FHERC20 transfers

2. **Create IFheatherXv2.sol**
   - Define new interface

3. **Write Tests**
   - Plaintext swap tests
   - Encrypted swap tests
   - Limit order with FHERC20 tests
   - Slippage protection tests
   - Reserve sync tests

4. **Deploy and Test on Testnet**

5. **Update Frontend**
   - Remove deposit/withdraw UI
   - Direct swap integration

---

## Success Criteria

- [ ] `swap()` works in single tx (plaintext path)
- [ ] `swapEncrypted()` works in single tx (encrypted path)
- [ ] Limit orders lock/unlock FHERC20 tokens directly
- [ ] Reserve estimation provides accurate outputs when synced
- [ ] Slippage protection works for both paths
- [ ] TickBitmap efficiently finds orders
- [ ] All existing encrypted math preserved
- [ ] Frontend can swap without deposit/withdraw steps
