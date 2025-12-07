# FheatherX v2: Gas Bottlenecks & Optimization Strategy

## The Core Problem: The "Constant Time" Trap

FheatherX faces a fundamental tension between **Privacy (Anti-Probing)** and **Scalability (Gas Limits)**.

To prevent attackers from determining if an order was filled by measuring gas usage, the contract executes full swap mathematics for *every* limit order at a crossed tick—regardless of whether that order actually triggers.

### The Bottleneck

Inside `_processOrdersAtTick`, we iterate through an array of orders. For each order, `_fillOrderConditional` calls `_executeSwapMathConditional`, which performs **Encrypted Division** (`FHE.div`).

In Fully Homomorphic Encryption, division is the most computationally expensive operation by a massive margin—orders of magnitude more expensive than addition, and significantly more than multiplication.

### The Consequence

With a standard Ethereum block gas limit of 30M, and FHE division consuming substantial computation, the contract will likely hit Out Of Gas (OOG) with as few as **2-5 concurrent orders at a single tick**. This renders the limit order feature unusable at scale.

---

## Optimization Strategies

### 1. Replace Division with Bitwise Shifts for Fees

**Current approach:**
```solidity
reward = (amount * 1) / 100;  // 1% fee using division
```

**Optimized approach:**
```solidity
reward = FHE.shr(amount, 7);  // ~0.78% fee (1/128) using bit shift
```

| Fee Type | Current | Optimized |
|----------|---------|-----------|
| 1% fee | `div 100` | `shr 7` (1/128 ≈ 0.78%) |
| 0.5% fee | `div 200` | `shr 8` (1/256 ≈ 0.39%) |
| 0.25% fee | `div 400` | `shr 9` (1/512 ≈ 0.20%) |

**Impact:** Removes 2 expensive division operations per order (swap fee + executor reward).

---

### 2. Constant Sum Math for Limit Orders

**The insight:** Limit orders are conceptually *fixed-price fills*, not AMM curves.

**Current approach (Constant Product x·y=k):**
```solidity
// Requires division - expensive!
dx = (x * dy) / (y + dy);
```

**Optimized approach (Constant Sum):**
```solidity
// Limit order at price P: "Sell 1 ETH at 2000 USDC"
output = FHE.mul(amount, price);  // 1 * 2000 = 2000 USDC
```

**Why this works:**
- A limit order to "sell 1 ETH at $2000" should return exactly 2000 USDC
- This is simple multiplication, not AMM curve math
- Multiplication is significantly cheaper than division in FHE

**Trade-off:** Limit orders become point-fills rather than AMM liquidity. This aligns with traditional order book behavior and is arguably more intuitive for users.

---

### 3. Accumulate Transfers (Batch Settlement)

**Current approach:**
```solidity
for (uint i = 0; i < orders.length; i++) {
    // N external calls - expensive!
    fheToken.transferEncryptedDirect(orders[i].owner, output);
}
```

**Optimized approach:**
```solidity
// Accumulate outputs
euint128 totalToken0Out = ENC_ZERO;
euint128 totalToken1Out = ENC_ZERO;

for (uint i = 0; i < orders.length; i++) {
    // Cheap FHE addition
    totalToken0Out = FHE.add(totalToken0Out, orderOutput0);
    totalToken1Out = FHE.add(totalToken1Out, orderOutput1);
}

// Single transfer at the end
fheToken0.transferEncryptedDirect(recipient, totalToken0Out);
fheToken1.transferEncryptedDirect(recipient, totalToken1Out);
```

**Impact:** Replaces N external calls with N cheap `FHE.add` operations plus 1-2 transfers.

**Note:** For multiple unique owners, accumulate per-owner in a mapping, then batch transfer to each.

---

### 4. Pagination (Hard Gas Cap)

You cannot process an unbounded array in a single transaction.

**Implementation:**
```solidity
uint256 constant MAX_ORDERS_PER_SWAP = 3;

function _processOrdersAtTick(int24 tick) internal {
    uint256[] storage orderIds = tickOrders[tick];
    uint256 processed = 0;

    for (uint i = 0; i < orderIds.length && processed < MAX_ORDERS_PER_SWAP; i++) {
        _fillOrderConditional(orderIds[i]);
        processed++;
    }

    // Remaining orders wait for next swap or dedicated "crank" tx
}
```

**Impact:** Guarantees the contract never exceeds block gas limit, ensuring protocol liveness even with deep order queues.

---

### 5. Branchless Partial Fill Logic

When processing orders, we need to handle cases where:
- The swapper's input exceeds order size (partial consumption)
- The order size exceeds swapper's remaining input (partial fill)

**The problem:** We can't use `if/else` (leaks data via gas profiling).

**The solution:** Use `FHE.min` for branchless selection:

```solidity
// Calculate how much of the swap input this order can consume
euint128 orderCapacity = FHE.mul(order.amount, order.price);
euint128 amountUsed = FHE.min(remainingInput, orderCapacity);

// Calculate fill amount
euint128 amountFilled = FHE.div(amountUsed, order.price);
// Or better: use inverse multiplication if price is known
// euint128 amountFilled = FHE.mul(amountUsed, order.inversePrice);

// Update state
remainingInput = FHE.sub(remainingInput, amountUsed);
```

**Why this works:** `FHE.min` handles both partial fills and full sweeps with identical gas cost, maintaining constant-time execution.

---

## Stress Test Protocol

Before deploying optimizations, establish baseline metrics.

### Test: LimitOrderGasStressTest

**Setup:**
1. Deploy FheatherXv2 with two mock FHERC20 tokens
2. Add initial liquidity

**Measurements:**

| Step | Action | Metric |
|------|--------|--------|
| 1 | Swap with 0 orders in range | G_base |
| 2 | Place 1 order at tick 100, swap across | G_1 |
| 3 | Calculate per-order cost | C_order = G_1 - G_base |
| 4 | Place 3 orders at tick 100, swap | G_3 |
| 5 | Verify linearity | G_3 ≈ G_base + (3 × C_order) |
| 6 | Calculate theoretical max | N_max = (BlockLimit - G_base) / C_order |
| 7 | Attempt N_max + 1 orders | Should OOG |

**Expected Result:** With current FHE gas costs, N_max is likely in single digits. After implementing optimizations 2 and 3, this should increase significantly.

---

## Future Architecture Considerations

The following ideas represent a fundamentally different architecture—aggregated liquidity buckets rather than individual orders. These are documented for potential v3 development.

### Wide Tick Bucketing

**Concept:** Instead of tracking individual orders at precise prices, aggregate liquidity into wide price ranges (buckets).

```
Current: Order at tick 1001, order at tick 1002, order at tick 1003
Bucketed: All liquidity aggregated in bucket [1000-1050]
```

**Benefits:**
- Privacy: Observers see liquidity in a 2-5% range, not exact stop-loss levels
- Gas: Reduces bitmap traversal by 60-200x
- Simplicity: One encrypted variable per bucket vs. array of orders

**Why not now:**
- Requires complete redesign of order placement/cancellation
- Changes user mental model (no precise limit prices)
- Current 4-order-type system (buy/sell × limit/stop) doesn't map cleanly
- Would need new UI/UX for "price range" orders

**When to consider:** If stress tests show N_max < 3 even after optimizations, or for a future "FheatherX Pro" product targeting institutional liquidity.

---

### ERC-1155 Claim Tickets

**Concept:** Tokenize bucket positions. When users deposit into a bucket, mint share tokens. Track global fill state, let users claim proportionally later.

```solidity
// On deposit
_mint(user, bucketId, shares);
userEntrySnapshot[user][bucketId] = cumulativeFilled[bucketId];

// On claim
payout = shares * (cumulativeFilled[bucketId] - userEntrySnapshot[user][bucketId]);
_burn(user, bucketId, shares);
```

**Benefits:**
- Swap transaction only updates global accumulator, never touches user balances
- Distribution complexity offloaded to claim transaction
- Users can transfer/trade their bucket positions

**Why not now:**
- Only makes sense with bucketed liquidity model
- Adds complexity (ERC-1155 integration, claim flow)
- Current individual order model has clearer UX

**When to consider:** If implementing wide tick bucketing for v3.

---

## Implementation Priority

1. **Immediate:** Implement stress test to measure current N_max
2. **High:** Replace division with bitwise shifts (Optimization 1)
3. **High:** Implement constant sum math for limit orders (Optimization 2)
4. **Medium:** Batch transfer accumulation (Optimization 3)
5. **Already done:** Pagination exists via `maxOrdersPerTick`
6. **Future:** Evaluate bucket architecture if N_max remains too low
