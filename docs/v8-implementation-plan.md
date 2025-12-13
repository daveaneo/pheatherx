# FheatherX v8 Implementation Plan

## Goal

Implement the full `better-matching.md` features:
- **Momentum Closure**: Binary search to find final tick `t*` for triggered orders
- **Virtual Slicing**: Fair pro-rata allocation to momentum buckets
- **1× AMM Invariant**: Single AMM execution per swap
- **Word-Level Bitmap**: O(1) tick scanning (already in TickBitmapLib)

**Constraint**: Stay under 24,576 byte contract size limit.

**Solution**: Split contracts by token pair type:
- `FheatherXv8FHE` - FHE:FHE pairs only (full privacy)
- `FheatherXv8Mixed` - FHE:ERC and ERC:FHE pairs (mixed)

---

## Phase 1: Shared Libraries

Create/enhance libraries that both contracts will use.

### 1.1 FheatherMath.sol (Already Created)
```
Location: src/lib/FheatherMath.sol
Functions:
- sqrt256(uint256) - Newton's method square root
- calculateTickPrice(int24) - Tick to price conversion
- estimateOutput(reserveIn, reserveOut, amountIn, feeBps) - x*y=k output
- abs(int24) - Absolute value
- getCurrentTick(reserve0, reserve1, tickSpacing) - Tick from reserves
```

### 1.2 TickBitmapLib.sol (Already Created)
```
Location: src/lib/TickBitmapLib.sol
Functions:
- compress(tick, tickSpacing) - Compress tick to bitmap coordinate
- decompress(compressed, tickSpacing) - Decompress to tick
- position(compressed) - Get wordPos and bitPos
- lsb(x), msb(x) - Bit manipulation
- findNextInitializedTick(...) - Word-level bitmap scan
- setBit, clearBit, isSet - Bitmap operations
```

### 1.3 SwapLockTransient.sol (New - Transient Storage)
```
Location: src/lib/SwapLockTransient.sol
Purpose: Use EIP-1153 transient storage for swap reentrancy lock (100 gas vs 20,000)
```

### 1.4 OrderMatchingLib.sol (New - Core Logic)
```
Location: src/lib/OrderMatchingLib.sol
Functions:
- findMomentumClosure(...) - Binary search for final tick t*
- sumMomentumBucketsEnc(...) - Sum momentum bucket liquidity
- predicateCrossesTickBuy(...) - Division-free predicate: (y0+dy)² >= k * p(tm)
- predicateCrossesTickSell(...) - Division-free predicate: k <= p(tm) * (x0+dx)²
- allocateVirtualSlicing(...) - Fair allocation to momentum buckets
```

### 1.5 BucketLib.sol (New - Bucket Operations)
```
Location: src/lib/BucketLib.sol
Functions:
- initializeBucket(bucket)
- updateBucketOnFill(bucket, fillAmount, proceedsAmount)
- calculateProceeds(position, bucket)
- calculateUnfilled(position, bucket)
```

---

## Phase 2: FheatherXv8FHE (FHE:FHE Only)

### Removals (Size Savings ~1200 bytes)
1. Remove `addLiquidity(uint256, uint256)` - plaintext version
2. Remove `removeLiquidity(uint256)` - plaintext version
3. Remove `token0IsFherc20` / `token1IsFherc20` checks (always true)
4. Remove `_isFherc20()` detection function
5. Remove mixed token transfer branches
6. Simplify `PoolState` struct (remove token type flags)

### Additions (Momentum Features ~800 bytes)
1. Add `_findMomentumClosure()` - Binary search for t*
2. Add `_sumMomentumBucketsEnc()` - Range sum of momentum liquidity
3. Add `_allocateVirtualSlicing()` - Fair allocation
4. Add momentum bitmap tracking (same-direction orders)

### Key Changes to `_processOrdersAndSwap()`
```solidity
function _processOrdersAndSwap(
    PoolId poolId,
    bool zeroForOne,
    euint128 userInputEnc,
    uint256 userInputPlaintext
) internal returns (euint128 userOutputFromLimits, euint128 userOutputFromAmm) {
    int24 prevTick = lastProcessedTick[poolId];

    // Step 1: Match opposing limits first (no AMM)
    (euint128 remainderEnc, userOutputFromLimits) = _matchOpposingLimits(
        poolId, zeroForOne, userInputEnc, prevTick
    );

    // Step 2: Find momentum closure via binary search
    int24 finalTick = _findMomentumClosure(
        poolId, zeroForOne, remainderEnc, userInputPlaintext, prevTick
    );

    // Step 3: Sum activated momentum buckets
    euint128 momentumSumEnc = _sumMomentumBucketsEnc(
        poolId, zeroForOne, prevTick, finalTick
    );

    // Step 4: Execute AMM ONCE with total input
    euint128 totalInputEnc = FHE.add(remainderEnc, momentumSumEnc);
    ebool direction = FHE.asEbool(zeroForOne);
    euint128 totalOutputEnc = _executeSwapMathForPool(poolId, direction, totalInputEnc);

    // Step 5: Allocate output fairly via virtual slicing
    _allocateVirtualSlicing(
        poolId, zeroForOne, prevTick, finalTick,
        momentumSumEnc, totalOutputEnc
    );

    // Step 6: User's share of output is from AMM (after momentum allocation)
    userOutputFromAmm = _calculateUserAmmShare(
        remainderEnc, totalInputEnc, totalOutputEnc
    );

    lastProcessedTick[poolId] = finalTick;
}
```

### Size Budget (FHE:FHE)
```
Current v7 baseline:           24,424 bytes
- Remove plaintext LP funcs:   -  600 bytes
- Remove mixed token code:     -  400 bytes
- Remove token detection:      -  200 bytes
- Use FheatherMath library:    -  300 bytes
- Use transient SwapLock:      -   50 bytes
+ Add momentum closure:        +  400 bytes
+ Add virtual slicing:         +  400 bytes
+ Add range sum:               +  200 bytes
----------------------------------------
Estimated total:               23,874 bytes
Margin:                           702 bytes
```

---

## Phase 3: FheatherXv8Mixed (FHE:ERC / ERC:FHE)

### Removals (Size Savings ~1500 bytes)
1. Remove `addLiquidityEncrypted()` - one token is ERC anyway
2. Remove `removeLiquidityEncrypted()` - use plaintext version
3. Remove `swapEncrypted()` direction hint complexity (direction is knowable)
4. Remove dual-path transfer logic in LP functions
5. Simplify deposit/withdraw for ERC side

### Architecture Decision
For mixed pairs, the direction of swap determines token privacy:
- FHE:ERC pool, zeroForOne=true: input is private (FHE), output is public (ERC)
- FHE:ERC pool, zeroForOne=false: input is public (ERC), output is private (FHE)

This means we can:
- Skip encrypting ERC inputs that go directly to opposing limits
- Use plaintext estimates more reliably for ERC outputs

### Key Simplification
```solidity
// In FheatherXv8Mixed, swap simplifies:
function swap(
    PoolId poolId,
    bool zeroForOne,
    uint256 amountIn,
    uint256 minAmountOut
) external {
    PoolConfig storage cfg = poolConfigs[poolId];

    // Determine which token is FHE
    bool inputIsFhe = zeroForOne ? cfg.token0IsFhe : cfg.token1IsFhe;

    if (inputIsFhe) {
        // Encrypt input, process as usual
        euint128 encInput = FHE.asEuint128(uint128(amountIn));
        // ... momentum pipeline
    } else {
        // ERC input - can use plaintext matching for opposing limits
        // Only encrypt for AMM execution
    }
}
```

### Size Budget (Mixed)
```
Current v7 baseline:           24,424 bytes
- Remove encrypted LP funcs:   -  800 bytes
- Remove dual-path transfers:  -  500 bytes
- Remove swapEncrypted:        -  600 bytes
- Use FheatherMath library:    -  300 bytes
+ Add momentum closure:        +  400 bytes
+ Add virtual slicing:         +  400 bytes
+ Add range sum:               +  200 bytes
+ Add token type routing:      +  200 bytes
----------------------------------------
Estimated total:               23,424 bytes
Margin:                         1,152 bytes
```

---

## Phase 4: Implementation Order

### Step 1: Create Shared Libraries
```
1. SwapLockTransient.sol     - Transient storage swap lock
2. BucketLib.sol             - Bucket operations
3. OrderMatchingLib.sol      - Momentum closure + virtual slicing
4. Update FheatherMath.sol   - Add any missing functions
```

### Step 2: Create FheatherXv8FHE
```
1. Copy FheatherXv7.sol → FheatherXv8FHE.sol
2. Remove plaintext LP functions
3. Remove mixed token code paths
4. Wire up libraries (FheatherMath, TickBitmapLib, etc.)
5. Implement momentum closure
6. Implement virtual slicing
7. Test and verify size
```

### Step 3: Create FheatherXv8Mixed
```
1. Copy FheatherXv7.sol → FheatherXv8Mixed.sol
2. Remove encrypted LP functions
3. Remove swapEncrypted
4. Simplify to single swap() entry point
5. Add token type routing
6. Wire up libraries
7. Implement momentum closure (simpler for ERC input)
8. Test and verify size
```

### Step 4: Testing
```
1. Copy existing v7 tests
2. Adapt for v8FHE (FHE:FHE only)
3. Adapt for v8Mixed (FHE:ERC scenarios)
4. Add momentum-specific tests
5. Add virtual slicing tests
```

---

## Phase 5: Size Optimization Techniques

If size is still tight, apply these in order:

### Quick Wins (Low Risk)
1. Use transient storage for SwapLock (done in libraries)
2. Inline small modifiers
3. Remove unused view functions
4. Pack PoolState struct booleans into uint8 flags

### Medium Effort
1. Simplify reserve sync (remove binary search, keep last-pending only)
2. Use `lastProcessedTick` instead of computing `_getCurrentTick`
3. Merge buy/sell bitmaps into single mapping with side-encoded key

### Last Resort
1. Remove fee timelock (immediate fee setting)
2. Remove auto-claim in deposit (require explicit claim)
3. Reduce events to essential minimum

---

## File Structure After Implementation

```
contracts/src/
├── FheatherXv7.sol              # Original (keep for reference)
├── FheatherXv8FHE.sol           # FHE:FHE pairs
├── FheatherXv8Mixed.sol         # FHE:ERC / ERC:FHE pairs
├── lib/
│   ├── FheatherMath.sol         # Pure math functions
│   ├── TickBitmapLib.sol        # Word-level bitmap ops
│   ├── SwapLock.sol             # Original (storage-based)
│   ├── SwapLockTransient.sol    # New (transient storage)
│   ├── BucketLib.sol            # Bucket operations
│   └── OrderMatchingLib.sol     # Momentum + slicing
└── ...
```

---

## Key Algorithms to Implement

### Binary Search for Momentum Closure
```solidity
function _findMomentumClosure(
    PoolId poolId,
    bool zeroForOne,
    euint128 userRemainderEnc,
    uint256 userRemainderPlaintext,
    int24 startTick
) internal returns (int24 finalTick) {
    // Use plaintext estimate for binary search bounds
    int24 lo = startTick;
    int24 hi = zeroForOne ? startTick - MAX_TICK_MOVE : startTick + MAX_TICK_MOVE;

    // Binary search iterations (fixed count, e.g., 12-16)
    for (uint8 i = 0; i < 12; i++) {
        int24 mid = (lo + hi) / 2;

        // Sum momentum buckets in range
        euint128 momentumSum = _sumMomentumBucketsEnc(poolId, zeroForOne, startTick, mid);
        euint128 totalInput = FHE.add(userRemainderEnc, momentumSum);

        // Division-free predicate: does totalInput push price beyond mid?
        bool crossesMid = _predicateCrossesTickPlaintext(
            poolId, zeroForOne, totalInput, mid
        );

        // Narrow search
        if (crossesMid) {
            lo = mid;  // or hi = mid depending on direction
        } else {
            hi = mid;
        }
    }

    return finalTick;
}
```

### Virtual Slicing Allocation
```solidity
function _allocateVirtualSlicing(
    PoolId poolId,
    bool zeroForOne,
    int24 fromTick,
    int24 toTick,
    euint128 totalMomentumInput,
    euint128 totalOutput
) internal {
    // For each activated momentum bucket, compute virtual slice
    // using prefix sums (see better-matching.md section 5)

    // Simplified approach: pro-rata by input share
    // bucket_output = (bucket_input / total_input) * total_output

    // Iterate through activated buckets
    BucketSide side = zeroForOne ? BucketSide.SELL : BucketSide.BUY;
    mapping(int16 => uint256) storage bitmap = side == BucketSide.SELL
        ? sellBitmaps[poolId] : buyBitmaps[poolId];

    int24 current = fromTick;
    while (current != toTick) {
        (int24 next, bool found) = TickBitmapLib.findNextInitializedTick(
            bitmap, current, TICK_SPACING, zeroForOne, 2
        );

        if (!found) break;

        Bucket storage bucket = buckets[poolId][next][side];

        // Calculate bucket's share of output
        euint128 bucketShare = FHE.div(
            FHE.mul(bucket.liquidity, totalOutput),
            totalMomentumInput
        );

        // Update bucket accounting
        _updateBucketOnFill(bucket, bucket.liquidity, bucketShare);

        current = next;
    }
}
```

---

## Success Criteria

1. **Size**: Both contracts under 24,576 bytes
2. **Features**: Full momentum closure and virtual slicing
3. **Tests**: All existing tests pass (adapted for new contracts)
4. **Gas**: Transient storage reduces swap gas by ~40,000

---

## Next Steps

1. Review this plan
2. Create libraries in order (SwapLockTransient → BucketLib → OrderMatchingLib)
3. Implement FheatherXv8FHE first (simpler, no mixed logic)
4. Test and measure size
5. Implement FheatherXv8Mixed
6. Integration testing
