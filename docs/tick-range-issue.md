# Limit Order Tick Range Issue

## Problem Statement

The FheatherXv6 contract uses an **absolute tick range** for limit orders that is not relative to the current AMM price. This creates a significant usability issue when the AMM price moves outside the valid limit order range.

### Current Implementation

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

### Option A: Dynamic Tick Range (Recommended)

Center the valid tick range around the current AMM tick, allowing orders within ±6000 ticks of the current price.

**Contract Changes:**
```solidity
function deposit(..., int24 tick, ...) external {
    int24 currentTick = _getCurrentTick(poolId);
    int24 minAllowed = currentTick - 6000;
    int24 maxAllowed = currentTick + 6000;

    if (tick < minAllowed || tick > maxAllowed || tick % TICK_SPACING != 0)
        revert InvalidTick();

    // ... rest of deposit logic
}
```

**Pros:**
- Limit orders always work relative to current price
- Same tick range width (12001 ticks)
- Minimal storage impact

**Cons:**
- Tick prices must be calculated on-demand (no pre-computation)
- Orders at extreme ticks may become invalid after large price moves
- Need to handle order cleanup when ticks fall out of range

---

### Option B: Larger Absolute Range

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

### Option C: On-Demand Tick Price Calculation

Remove pre-computation entirely. Calculate tick prices when needed.

**Contract Changes:**
```solidity
// Remove _initializeTickPrices() from constructor
// Remove tickPrices mapping

function _getTickPrice(int24 tick) internal pure returns (uint256) {
    return _calculateTickPrice(tick);
}
```

**Pros:**
- No deployment gas cost for pre-computation
- Any tick is valid
- More flexible

**Cons:**
- Higher gas per order placement (calculate vs lookup)
- More complex gas estimation for users

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

| Solution | Gas (Deploy) | Gas (Per Order) | Complexity | Breaking Change |
|----------|--------------|-----------------|------------|-----------------|
| A: Dynamic Range | Same | +Small | Medium | No |
| B: Larger Range | +High | Same | Low | No |
| C: On-Demand Calc | -Lower | +Medium | Low | No |
| D: Relative Ticks | Same | +Small | High | Yes |

---

## Recommendation

**Option A (Dynamic Tick Range)** is recommended because:

1. **Maintains Familiarity:** Users still work with tick values
2. **No Breaking Changes:** Existing API and events remain compatible
3. **Reasonable Gas:** One additional read + arithmetic vs pre-computed lookup
4. **Full Coverage:** Works for any AMM price ratio

### Implementation Steps

1. Remove `_initializeTickPrices()` call from constructor
2. Keep `tickPrices` mapping as a cache (optional optimization)
3. Modify tick validation in `deposit()` to use dynamic bounds
4. Update `_getCurrentTick()` to handle unbounded range
5. Add view function `getValidTickRange(poolId)` for frontend
6. Consider order expiration mechanism for extreme price moves

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
