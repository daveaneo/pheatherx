# PheatherX v3 Design Audit - Version 3

> **Audit Date:** December 2024
> **Document Reviewed:** 05-implementation-v3.md
> **Auditor Persona:** Senior Solidity Engineer & Cryptographic Systems Expert
> **Status:** Design Phase - Pre-Implementation

---

## Executive Summary

v3 is substantially more robust than v2. The remainder tracking for division precision is well-designed, the zero-division guards are correct, and the auto-claim mechanism now properly uses a non-resetting accumulator. The architecture is sound.

Remaining issues are mostly edge cases, optimizations, and minor oversights.

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| FHE Operations | - | 1 | 1 | - |
| State Management | - | 1 | 1 | - |
| Token Flow | - | - | 1 | 1 |
| Gas/Efficiency | - | - | 2 | - |
| Documentation | - | - | - | 2 |

**Overall:** No critical issues. 3 high severity issues that should be fixed. Ready for implementation after addressing high/medium items.

---

## High Severity Issues

### H1: Remainder Distribution May Cause Slight Over-Distribution

**Location:** `_updateBucketOnFill()`, remainder distribution logic

**Problem:** The current remainder tracking adds +1 to proceedsPerShare when remainder >= totalShares. However, this can cause slight over-distribution in edge cases:

```solidity
// When canDistribute is true:
euint128 proceedsExtra = FHE.select(canDistributeProceeds, ENC_ONE, ENC_ZERO);
bucket.proceedsPerShare = FHE.add(bucket.proceedsPerShare, proceedsExtra);
```

Consider this scenario:
- `totalShares = 100`
- Fill 1: `proceeds = 33`, remainder = `33 * 1e18 % 100 = some_value`
- After many fills, remainder accumulates to 100
- We distribute +1, but this +1 is at PRECISION scale, not raw proceeds

The +1 added is `1` in proceedsPerShare units, which when multiplied by shares gives `shares * 1 / PRECISION`—essentially dust. This is actually correct!

**Wait, let me re-verify:**
- `proceedsPerShare` is scaled by PRECISION
- When we add `ENC_ONE` (which is 1), we're adding `1/PRECISION` per share
- If totalShares = 100, this adds `100/PRECISION` total proceeds
- But our remainder could be up to `totalShares * PRECISION - 1`

Actually, the issue is that `ENC_ONE` should not be `1`, it should be `PRECISION / totalShares` or we need to reconsider.

Let me trace through:
- `proceedsNumerator = proceeds * PRECISION = 10 * 1e18 = 10e18`
- `proceedsQuotient = 10e18 / 3 = 3.33e18` (truncated to `3333333333333333333`)
- `remainder = 10e18 - 3.33e18 * 3 = 10e18 - 9.99e18 = 0.01e18 = 1e16`

After 100 such fills: `remainder = 100e16 = 1e18`

When `remainder >= totalShares` (which is 3, not 3e18), we'd ALWAYS distribute since 1e18 > 3.

**This is a bug!** The comparison should be against `totalShares * PRECISION` or the remainder should be unscaled.

**Fix:**
```solidity
// Option A: Compare remainder to totalShares * PRECISION
euint128 thresholdForExtra = FHE.mul(safeTotalShares, ENC_PRECISION);
ebool canDistributeProceeds = FHE.gte(totalProceedsRemainder, thresholdForExtra);

// Option B: Store unscaled remainder (simpler)
// Change to track remainder in unscaled terms
// This is cleaner - let's use this approach

// Better approach: Don't scale the remainder
euint128 proceedsQuotient = FHE.div(proceedsNumerator, safeTotalShares);
// remainder = proceeds - (quotient / PRECISION * totalShares)
// This gets complicated...

// SIMPLEST FIX: Just accept the dust loss
// Remove remainder tracking entirely and document the ~1 wei per fill dust loss
```

**Impact:** With current code, `canDistribute` would always be true after first fill (since remainder is at 1e18 scale but compared to totalShares at unit scale). This would cause proceedsPerShare to increment by 1 on every fill, significantly over-distributing.

**Recommended Fix:** Remove remainder tracking (accept dust loss) OR fix the math to compare at the same scale:

```solidity
function _updateBucketOnFill(...) internal {
    // ... guards ...

    // SIMPLER APPROACH: Just accept dust loss
    euint128 proceedsNumerator = FHE.mul(proceedsAmount, ENC_PRECISION);
    euint128 proceedsQuotient = FHE.div(proceedsNumerator, safeTotalShares);
    proceedsQuotient = FHE.select(hasShares, proceedsQuotient, ENC_ZERO);
    bucket.proceedsPerShare = FHE.add(bucket.proceedsPerShare, proceedsQuotient);

    // No remainder tracking - dust is negligible
    // Max dust per fill: totalShares - 1 wei (scaled)
    // For 1000 users, 10000 fills: ~10M wei dust = 0.00001 ETH

    // ... same for filled ...
}
```

---

### H2: _findNextTick Uses Non-Existent TickBitmap Function

**Location:** `_findNextTick()` function

**Problem:** The code references:
```solidity
(nextTick, found) = bitmap.nextInitializedTickWithinOneWord(...);
(nextTick, found) = bitmap.nextInitializedTick(..., 256);
```

The v2 TickBitmap library may not have these exact function signatures. Need to verify the actual interface.

**From v2 TickBitmap.sol:**
```solidity
function nextInitializedTickWithinOneWord(...) returns (int24, bool);
```

This likely exists. But the second call with `256` parameter might not match.

**Fix:** Verify TickBitmap interface and adjust:
```solidity
function _findNextTick(
    TickBitmap.State storage bitmap,
    int24 currentTick,
    bool searchUp
) internal view returns (int24) {
    // Use the actual v2 TickBitmap interface
    (int24 nextTick, bool found) = bitmap.nextInitializedTickWithinOneWord(
        currentTick,
        TICK_SPACING,
        searchUp
    );

    // If not found in current word, need to search further
    // This may require iterating through multiple words
    if (!found) {
        // Implement multi-word search or use a different approach
        for (uint256 i = 0; i < 4; i++) {  // Search up to 4 words
            int24 searchStart = currentTick + (searchUp ? int24(256 * int256(i + 1)) : -int24(256 * int256(i + 1)));
            (nextTick, found) = bitmap.nextInitializedTickWithinOneWord(
                searchStart,
                TICK_SPACING,
                searchUp
            );
            if (found) break;
        }
    }

    if (!found) {
        return searchUp ? type(int24).max : type(int24).min;
    }

    return nextTick;
}
```

---

### H3: Swap Direction Search Is Inverted

**Location:** `swap()` function, line calling `_findNextTick`

**Problem:**
```solidity
int24 nextTick = _findNextTick(bitmap, currentTick, !zeroForOne);
```

The `!zeroForOne` inversion seems wrong. Let's trace through:

- `zeroForOne = true` (selling token0)
- We want to fill BUY buckets (people buying token0)
- BUY buckets are at prices BELOW current (they want cheaper token0)
- So we should search DOWN (lower ticks)
- `searchUp = !true = false` → search down ✓

- `zeroForOne = false` (selling token1)
- We want to fill SELL buckets (people selling token0 for token1)
- SELL buckets are at prices ABOVE current (sellers want higher price)
- So we should search UP (higher ticks)
- `searchUp = !false = true` → search up ✓

Actually, this depends on how ticks map to prices and the bucket semantics. Let me reconsider:

For Uniswap-style ticks:
- Higher tick = higher price of token0 in token1 terms
- BUY bucket at tick 60: wants to buy token0 at price 1.006
- This fills when market price drops TO 1.006 (price goes DOWN)
- To find this bucket when selling token0, we look at buckets BELOW current price

The logic `!zeroForOne` works IF:
- Current tick represents market price
- We search in the direction of trade impact

Actually, I think the issue is more subtle—what is `currentTick` at the start of the swap? It should be the market price tick, and then we search for the first bucket that can fill.

**This needs careful analysis of the tick semantics in the full codebase.** Mark as potential issue.

**Fix:** Add detailed comments explaining the direction logic and verify with tests:
```solidity
// When selling token0 (zeroForOne = true):
// - We fill BUY buckets (users who deposited token1 to buy token0)
// - BUY buckets are limit orders to buy token0 at or below a certain price
// - As we sell token0, price drops, so we search DOWNWARD (lower ticks)
// - searchUp = false
//
// When selling token1 (zeroForOne = false):
// - We fill SELL buckets (users who deposited token0 to sell for token1)
// - SELL buckets are limit orders to sell token0 at or above a certain price
// - As we sell token1, token0 price rises, so we search UPWARD (higher ticks)
// - searchUp = true
int24 nextTick = _findNextTick(bitmap, currentTick, !zeroForOne);
```

---

## Medium Severity Issues

### M1: Tick Price Lookup Gaps

**Location:** `_getTickPriceScaled()` and `_initializeTickPrices()`

**Problem:** The lookup table only has prices for specific ticks (0, ±60, ±120, etc.). For ticks not in the table, the fallback is:
```solidity
int24 nearestTick = (tick / 60) * 60;
```

But if `nearestTick` is also not in the table (e.g., tick 180), we fall back to the linear approximation which is inaccurate for large ticks.

**Fix:** Either:
1. Pre-populate all tick multiples of 60 up to reasonable range (±6000)
2. Use a formula that's more accurate than linear approximation
3. Require all valid ticks to be in the lookup table and revert otherwise

```solidity
function _getTickPriceScaled(int24 tick) internal view returns (uint256) {
    require(tick % TICK_SPACING == 0, "Invalid tick spacing");
    uint256 price = tickPrices[tick];
    require(price > 0, "Tick not initialized");  // Force all ticks to be in table
    return price;
}
```

---

### M2: ENC_ONE Usage Inconsistency

**Location:** Constructor and `_updateBucketOnFill()`

**Problem:** `ENC_ONE` is declared but its usage in remainder distribution (if kept) would be problematic as discussed in H1. Even if remainder tracking is removed, having `ENC_ONE` without clear documentation of what "1" means in different contexts is confusing.

**Fix:** Either remove `ENC_ONE` or clearly document its purpose:
```solidity
// ENC_ONE represents 1 in raw units (not scaled by PRECISION)
// Use only for:
// - Safe denominator fallback (division by zero guard)
// - Counter increments
// DO NOT use for proceeds/filled calculations (those need PRECISION scaling)
euint128 internal immutable ENC_ONE;  // = FHE.asEuint128(1)
```

---

### M3: Token Transfer Without Checking Success

**Location:** `swap()` function, plaintext token transfers

**Problem:**
```solidity
tokenIn.transferFrom(msg.sender, address(this), amountIn);
// ...
tokenOut.transfer(msg.sender, amountOut);
```

These don't check return values. While most tokens revert on failure, some don't (USDT).

**Fix:** Use SafeERC20 or check returns:
```solidity
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

using SafeERC20 for IERC20;

// In swap():
IERC20(address(tokenIn)).safeTransferFrom(msg.sender, address(this), amountIn);
IERC20(address(tokenOut)).safeTransfer(msg.sender, amountOut);
```

Note: This only applies to plaintext path. Encrypted transfers use FHERC20 which has different semantics.

---

### M4: Gas-Heavy Bucket Initialization

**Location:** `deposit()` bucket initialization

**Problem:** Initializing a new bucket creates 6 fresh encrypted zeros:
```solidity
bucket.proceedsPerShare = FHE.asEuint128(0);
bucket.filledPerShare = FHE.asEuint128(0);
bucket.totalShares = FHE.asEuint128(0);
bucket.liquidity = FHE.asEuint128(0);
bucket.proceedsRemainder = FHE.asEuint128(0);
bucket.filledRemainder = FHE.asEuint128(0);
```

Each `FHE.asEuint128()` is expensive. First depositor pays significantly more gas.

**Fix:** Consider lazy initialization or subsidizing first deposit:
```solidity
// Option A: Document the cost clearly
/// @notice First deposit into a tick pays ~50% more gas for bucket initialization

// Option B: Use constructor-initialized immutable zero for all (same handle, might cause issues)
// Not recommended due to potential handle sharing issues

// Option C: Protocol seeds common tick buckets at deployment
function seedBuckets(int24[] calldata ticks) external onlyOwner {
    for (uint i = 0; i < ticks.length; i++) {
        // Initialize both BUY and SELL buckets
        _initializeBucket(ticks[i], BucketSide.BUY);
        _initializeBucket(ticks[i], BucketSide.SELL);
    }
}
```

---

### M5: Missing Tick Validation in Withdraw

**Location:** `withdraw()` function

**Problem:** No validation that the tick is valid or initialized:
```solidity
function withdraw(int24 tick, BucketSide side, InEuint128 calldata amount) external nonReentrant returns (euint128 withdrawn) {
    // No require(tick % TICK_SPACING == 0)
    // No require(bucket.initialized)
```

User could withdraw from non-existent bucket and get zero (harmless but wastes gas).

**Fix:**
```solidity
function withdraw(...) external nonReentrant returns (euint128 withdrawn) {
    require(tick % TICK_SPACING == 0, "Invalid tick");

    Bucket storage bucket = buckets[tick][side];
    // No need to check initialized - will just return 0 if no position
    // ...
}
```

---

## Low Severity Issues

### L1: Missing NatSpec on Internal Functions

**Location:** `_calculateProceeds()`, `_calculateUnfilled()`, `_mulPrecision()`, `_divPrecision()`

**Problem:** Internal functions lack NatSpec documentation explaining their math.

**Fix:** Add documentation:
```solidity
/// @dev Calculate user's claimable proceeds based on share of bucket fills
/// @param pos User's position in the bucket
/// @param bucket The bucket state
/// @return Encrypted proceeds amount (in output token units)
///
/// Formula: proceeds = shares * (currentProceedsPerShare - snapshotProceedsPerShare) / PRECISION
/// This gives the user their proportional share of all proceeds since their last snapshot
function _calculateProceeds(...) internal view returns (euint128) { ... }
```

---

### L2: Event Indexing Could Be Better

**Location:** Event definitions

**Problem:** `Swap` event doesn't index `zeroForOne`:
```solidity
event Swap(
    address indexed user,
    bool zeroForOne,        // Not indexed
    uint256 amountIn,
    uint256 amountOut
);
```

This makes filtering by trade direction harder.

**Fix:**
```solidity
event Swap(
    address indexed user,
    bool indexed zeroForOne,
    uint256 amountIn,
    uint256 amountOut
);
```

---

### L3: Hardcoded MAX_BUCKETS_PER_SWAP

**Location:** Constant declaration

**Problem:** `MAX_BUCKETS_PER_SWAP = 5` is hardcoded. This might be too low or too high depending on gas costs and FHE operation costs.

**Fix:** Make it configurable by owner:
```solidity
uint256 public maxBucketsPerSwap = 5;

function setMaxBucketsPerSwap(uint256 _max) external onlyOwner {
    require(_max >= 1 && _max <= 20, "Invalid range");
    maxBucketsPerSwap = _max;
}
```

Or at minimum, document why 5 was chosen.

---

### L4: No Getter for Tick Prices

**Location:** Missing from interface

**Problem:** `tickPrices` is public mapping, but no explicit getter for batch reading.

**Fix:** Add batch getter for UI:
```solidity
function getTickPrices(int24[] calldata ticks) external view returns (uint256[] memory prices) {
    prices = new uint256[](ticks.length);
    for (uint i = 0; i < ticks.length; i++) {
        prices[i] = tickPrices[ticks[i]];
    }
}
```

---

## Recommendations

### R1: Add Comprehensive Test Suite

The test plan should include:
- Unit tests for each function
- Integration tests for full flows
- Invariant tests (totalShares consistency, etc.)
- Fuzzing tests for math operations
- Gas benchmarks

### R2: Consider Emergency Pause

Add pausable functionality:
```solidity
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract PheatherXv3 is ReentrancyGuard, Pausable {
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function deposit(...) external nonReentrant whenNotPaused { ... }
    function swap(...) external nonReentrant whenNotPaused { ... }
}
```

### R3: Add Protocol Fee Mechanism

For sustainability:
```solidity
uint256 public protocolFeeBps = 5;  // 0.05%
address public feeCollector;

// In swap:
uint256 fee = amountOut * protocolFeeBps / 10000;
amountOut -= fee;
// Accumulate fee for collection
```

---

## Verification Checklist

- [ ] H1: Fix remainder distribution math (or remove)
- [ ] H2: Verify TickBitmap interface compatibility
- [ ] H3: Verify swap direction logic with tests
- [ ] M1: Complete tick price lookup table
- [ ] M2: Document or remove ENC_ONE
- [ ] M3: Use SafeERC20 for plaintext transfers
- [ ] M4: Document first-depositor gas cost
- [ ] M5: Add tick validation to withdraw
- [ ] L1-L4: Documentation and minor improvements

---

## Conclusion

v3 is well-designed and addresses the critical issues from v2. The remaining issues are:
- 1 significant math bug (H1: remainder distribution)
- 2 integration concerns (H2, H3: need to verify with actual codebase)
- Minor improvements and documentation

After fixing H1 (recommend removing remainder tracking for simplicity), and verifying H2/H3 against actual TickBitmap implementation, v3 is ready for implementation.

**Estimated work:** 0.5 days to fix remaining issues.
