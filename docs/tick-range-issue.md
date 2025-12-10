# Limit Order Tick Range Issue

## Problem Statement

The FheatherXv6 contract uses an **absolute tick range** for limit orders that is not relative to the current AMM price. This creates a significant usability issue when the AMM price moves outside the valid limit order range.

## Why The Restriction Exists

The tick range was restricted for **gas efficiency through pre-computation**.

### Original Design Rationale

**From `FheatherXv6.sol` lines 1339-1342:**
```solidity
function _initializeTickPrices() internal {
    for (int24 tick = MIN_TICK; tick <= MAX_TICK; tick += TICK_SPACING) {
        tickPrices[tick] = _calculateTickPrice(tick);
    }
}
```

This function is called in the constructor and pre-computes prices for all 201 valid ticks (-6000 to +6000 in steps of 60).

**The trade-offs considered:**

1. **Storage vs Computation:** Instead of calculating `1.006^(tick/60)` on every order placement (expensive exponentiation in Solidity), the contract stores pre-computed prices in a mapping for O(1) lookup.

2. **Bounded Storage:** 201 ticks × 32 bytes = ~6.4KB of storage. This is manageable and predictable.

3. **Gas Savings:** Order placement/filling uses a simple `tickPrices[tick]` lookup instead of on-chain exponentiation.

### Why This Design Breaks Down

**The original assumption:** AMM prices would stay near tick 0 (1:1 token ratio), with the ±6000 tick range providing ~45% price movement in either direction.

**The reality:**
- Token pairs have vastly different values (e.g., WETH/USDC at ~$3000 corresponds to tick ~80,000)
- Pools can be initialized with arbitrary reserve ratios
- The "base price" of tick 0 = 1.0 has no meaningful relationship to real token pair prices

**Result:** For most real-world token pairs, the entire limit order tick range (-6000 to +6000) is nowhere near the actual AMM price, making limit orders completely unusable.

---

## How Uniswap v4 Handles This

Uniswap v4 takes a fundamentally different approach - **on-demand calculation instead of pre-computation**.

### Uniswap's Tick Range

From [Uniswap v4 TickMath.sol](https://github.com/Uniswap/v4-core/blob/main/src/libraries/TickMath.sol):

```solidity
int24 internal constant MIN_TICK = -887272;
int24 internal constant MAX_TICK = 887272;
```

This is **~148x larger** than our ±6000 range, covering price ratios from `2^-128` to `2^128`.

### Uniswap's On-Demand Calculation

Instead of pre-computing prices, Uniswap's `getSqrtPriceAtTick()` calculates prices on-demand using **bit decomposition**:

1. Decomposes the tick into binary representation
2. For each set bit, multiplies by pre-computed constants representing `1/sqrt(1.0001^(2^i))`
3. Uses assembly-optimized operations to minimize gas

**Key insight:** Uniswap stores ~20 pre-computed constants (one per bit position), not 200+ tick prices. The actual price is computed from these constants at runtime.

### Why This Works for Uniswap But Is Harder for Us

| Aspect | Uniswap v4 | FheatherX |
|--------|-----------|-----------|
| Price representation | `sqrtPriceX96` (Q64.96) | `uint256` (1e18 precision) |
| Tick base | 1.0001 (0.01% per tick) | 1.006 (0.6% per 60-tick spacing) |
| Calculation | Bit decomposition + assembly | Iterative `ratio * 10060 / 10000` |
| Storage | ~20 constants | 201 pre-computed prices |

Our `_calculateTickPrice()` uses a simple loop that multiplies by 1.006 for each tick spacing unit. This is more expensive than Uniswap's bit decomposition approach but easier to understand and audit.

---

## Current Implementation

**Contract Constants** (`FheatherXv6.sol` lines 42-48):
```solidity
int24 public constant TICK_SPACING = 60;
int24 public constant MIN_TICK = -6000;   // ~0.55x base price
int24 public constant MAX_TICK = 6000;    // ~1.82x base price
```

**Validation** (`FheatherXv6.sol` line 629):
```solidity
if (tick < MIN_TICK || tick > MAX_TICK || tick % TICK_SPACING != 0) revert InvalidTick();
```

### Price Range Calculation

The tick-to-price formula is: `price = 1.006^(tick/60)` (each 60 ticks = ~0.6% price change)

| Tick | Price Multiplier | Description |
|------|------------------|-------------|
| -6000 | ~0.55x | Minimum limit order price |
| 0 | 1.0x | Base price (1:1 ratio) |
| +6000 | ~1.82x | Maximum limit order price |

This means limit orders can only be placed within **55% to 182%** of the base price (tick 0 = 1.0).

---

## Impact

### Scenario: High Price Ratio Pool

When a pool has reserves that produce a price ratio significantly different from 1:1, the AMM tick will be outside the limit order range.

**Example from Testing:**
- AMM reserves produce tick ~68880 (price ratio ~980 USDC per WETH)
- Limit order range: -6000 to +6000
- **Result:** Cannot place any limit orders near current price

### Affected Use Cases

1. **Token Pairs with Large Price Differences** (e.g., WETH/USDC at ~$3000)
2. **Pools After Significant Price Movement**
3. **Newly Created Pools with Non-1:1 Initial Liquidity**

---

## Proposed Solutions

### Option A: Uniswap-Style Bit Decomposition (Recommended)

Adopt Uniswap's approach: use bit decomposition with pre-computed constants instead of pre-computed tick prices.

**Contract Changes:**
```solidity
// Remove tickPrices mapping
// Remove _initializeTickPrices() from constructor

// Add ~20 pre-computed constants for bit positions
uint256 private constant MAGIC_0 = ...; // 1.006^1
uint256 private constant MAGIC_1 = ...; // 1.006^2
uint256 private constant MAGIC_2 = ...; // 1.006^4
// ... etc for each power of 2

function _calculateTickPrice(int24 tick) internal pure returns (uint256) {
    // Bit decomposition approach similar to Uniswap
    uint256 absTick = tick < 0 ? uint256(-int256(tick)) : uint256(int256(tick));
    uint256 ratio = PRECISION;

    if (absTick & 0x1 != 0) ratio = (ratio * MAGIC_0) / PRECISION;
    if (absTick & 0x2 != 0) ratio = (ratio * MAGIC_1) / PRECISION;
    if (absTick & 0x4 != 0) ratio = (ratio * MAGIC_2) / PRECISION;
    // ... continue for all bit positions

    if (tick < 0) ratio = (PRECISION * PRECISION) / ratio;
    return ratio;
}

// Expand to Uniswap-compatible range
int24 public constant MIN_TICK = -887272;
int24 public constant MAX_TICK = 887272;
```

**Pros:**
- Full Uniswap tick range compatibility
- O(1) calculation with ~20 multiplications (vs 100+ in current loop)
- No deployment gas for pre-computation
- No storage cost for tick prices

**Cons:**
- More complex implementation
- Need to pre-compute and verify ~20 magic constants
- Slightly higher gas per calculation than mapping lookup

---

### Option B: Dynamic Tick Range (Simpler Alternative)

Center the valid tick range around the current AMM tick, allowing orders within ±6000 ticks of the current price.

**Contract Changes:**
```solidity
function deposit(..., int24 tick, ...) external {
    int24 currentTick = _getCurrentTick(poolId);
    int24 minAllowed = currentTick - 6000;
    int24 maxAllowed = currentTick + 6000;

    if (tick < minAllowed || tick > maxAllowed || tick % TICK_SPACING != 0)
        revert InvalidTick();

    // Calculate price on-demand instead of lookup
    uint256 price = _calculateTickPrice(tick);
    // ... rest of deposit logic
}
```

**Pros:**
- Limit orders always work relative to current price
- Same tick range width (12001 ticks)
- Minimal code changes

**Cons:**
- Still uses expensive iterative calculation
- Orders at extreme ticks may become invalid after large price moves
- Need to handle order cleanup when ticks fall out of range

---

### Option C: Larger Absolute Range

Expand MIN_TICK/MAX_TICK to cover more price ratios.

**Example:** Expand to ±60000 ticks (~0.003x to ~330x price range)

**Contract Changes:**
```solidity
int24 public constant MIN_TICK = -60000;
int24 public constant MAX_TICK = 60000;
```

**Pros:**
- Simple change
- Pre-computation still possible
- Covers most realistic price ratios

**Cons:**
- 10x more tick prices to pre-compute (gas cost at deployment)
- Larger bitmap storage requirements
- Still an arbitrary limit

---

### Option D: Relative Tick System

Orders specify offset from current tick rather than absolute tick.

**Contract Changes:**
```solidity
function depositRelative(
    PoolId poolId,
    int24 tickOffset,  // e.g., -5 means "5 ticks below current"
    BucketSide side,
    ...
) external {
    int24 currentTick = _getCurrentTick(poolId);
    int24 absoluteTick = currentTick + (tickOffset * TICK_SPACING);
    // ... store at absoluteTick
}
```

**Pros:**
- Intuitive UX ("place order 5% below current price")
- Always relative to current market

**Cons:**
- Breaking API change
- Order fills become more complex (tracking absolute vs relative)
- Existing integrations need updates

---

## Trade-off Analysis

| Solution | Gas (Deploy) | Gas (Per Order) | Complexity | Breaking Change | Tick Range |
|----------|--------------|-----------------|------------|-----------------|------------|
| A: Bit Decomposition | -Lower (no precompute) | ~Similar | Medium | No | Full (±887k) |
| B: Dynamic Range | Same | +Small | Low | No | ±6000 relative |
| C: Larger Absolute | +High | Same | Low | No | ±60000 |
| D: Relative Ticks | Same | +Small | High | Yes | Unlimited |

---

## Recommendation

**Option A (Uniswap-Style Bit Decomposition)** is recommended because:

1. **Full Uniswap Compatibility:** Same tick range (±887272) as Uniswap v4
2. **Gas Efficient:** ~20 multiplications is comparable to a mapping lookup
3. **No Storage Overhead:** Removes `tickPrices` mapping entirely
4. **No Breaking Changes:** Same API, just expanded valid range
5. **Battle-Tested:** Uniswap's approach is proven at scale

### Implementation Steps

1. Pre-compute ~20 magic constants for `1.006^(2^i)` where i = 0..19
2. Implement `_calculateTickPrice()` using bit decomposition (see code above)
3. Remove `tickPrices` mapping and `_initializeTickPrices()`
4. Update `MIN_TICK = -887272` and `MAX_TICK = 887272`
5. Update bitmap storage to handle larger tick range (may need multiple words)
6. Update `_getCurrentTick()` to binary search or use log calculation

### Alternative: Option B for Quick Fix

If time is limited, **Option B (Dynamic Range)** provides a simpler fix:
- Keep existing tick calculation logic
- Just change validation to be relative to current price
- Can be implemented faster with less testing required

---

## Frontend Implications

Until the contract is updated, the frontend should:

1. **Display Warning:** Show message when current AMM tick is outside -6000 to +6000
2. **Disable Limit Orders:** Prevent users from attempting invalid orders
3. **Show Valid Range:** If orders are possible, show the valid tick range
4. **Guide Users:** Suggest using market orders instead when limit orders unavailable

---

## Related Files

- `contracts/src/FheatherXv6.sol` - Main contract with tick constants
- `frontend/src/lib/constants.ts` - Frontend tick constants (MIN_TICK_V3, MAX_TICK_V3)
- `frontend/src/hooks/useCurrentPrice.ts` - Tick calculation from reserves
- `frontend/src/components/trade/OrderBookPanel.tsx` - Quick limit order UI
- `frontend/src/components/trade/LimitOrderForm.tsx` - Limit order form
