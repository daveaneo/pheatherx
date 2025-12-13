# Slimming Down Contract Size - Strategy Document

## Current State

| Contract | Size | Margin | Notes |
|----------|------|--------|-------|
| FheatherXv6 | 24,273 B | 303 B | Full functionality |
| FheatherXv7 | 24,424 B | 152 B | Opposing limits only, no momentum |

**Goal:** Fit momentum closure + virtual slicing back in (~600-800 bytes needed)

---

## Strategy 1: Split by Token Pair Type

Instead of one monolithic contract supporting all pair types, create specialized versions:

### Pool Types Needed

| Type | Token0 | Token1 | Use Case |
|------|--------|--------|----------|
| **FHE:FHE** | FHERC20 | FHERC20 | Full privacy (fheWETH/fheUSDC) |
| **FHE:ERC** | FHERC20 | ERC20 | Mixed (fheWETH/USDC) |
| **ERC:FHE** | ERC20 | FHERC20 | Mixed (WETH/fheUSDC) |
| ~~ERC:ERC~~ | ~~ERC20~~ | ~~ERC20~~ | Not needed - use native Uniswap |

### Functions to Remove per Version

#### FheatherXv7_FheFhe (Both tokens encrypted)
Keep all encrypted functions, remove:
- `addLiquidity(uint256, uint256)` - plaintext version not needed
- `removeLiquidity(uint256)` - plaintext version not needed
- Mixed token handling code paths

**Estimated savings: ~800-1200 bytes**

#### FheatherXv7_FheErc (Token0=FHERC20, Token1=ERC20)
Remove:
- `addLiquidityEncrypted` - token1 is plaintext anyway
- `removeLiquidityEncrypted` - token1 is plaintext anyway
- `swapEncrypted` direction hint complexity (direction is knowable from which token)
- Half of the dual-path swap logic
- `depositEncrypted` for token1 side (use plaintext)

**Estimated savings: ~1500-2000 bytes**

#### FheatherXv7_ErcFhe (Token0=ERC20, Token1=FHERC20)
Mirror of FheErc with opposite optimizations.

**Estimated savings: ~1500-2000 bytes**

### Size Budget with Split

```
Current v7:           24,424 B (no momentum)
Momentum features:    +  800 B (estimate)
                      --------
Need:                 25,224 B (648 over limit)

With FHE:ERC split:   -1,500 B (removing dual-path code)
                      --------
Result:               23,724 B (852 byte margin!)
```

---

## Strategy 2: Library Extraction

Move heavy logic to libraries (internal functions with storage pointers).

### Candidate Libraries

| Library | Functions | Est. Savings |
|---------|-----------|--------------|
| **OrderMatchingLib** | `_matchOpposingLimits`, `_fillOpposingBucket`, `_findMomentumClosure`, `_allocateVirtualSlicing` | 400-600 B |
| **BucketLib** | `_updateBucketOnFill`, `_initializeBucket`, `_calculateProceeds`, `_calculateUnfilled` | 300-500 B |
| **ReserveSyncLib** | `_requestReserveSync`, `_harvestResolvedDecrypts`, `_findNewestResolvedDecrypt` | 200-400 B |
| **LiquidityLib** | `_addLiquidityCore`, `_removeLiquidityCore` | 300-400 B |
| **SwapMathLib** | `_executeSwapMathForPool`, `_estimateOutput` | 200-300 B |

### Library Implementation Notes

```solidity
// Libraries with storage pointers save space because:
// 1. Code is deployed once, reused via DELEGATECALL
// 2. Internal library functions are inlined but can be optimized better
// 3. External library functions use DELEGATECALL (gas cost but size savings)

library OrderMatchingLib {
    function matchOpposingLimits(
        mapping(PoolId => mapping(int24 => mapping(BucketSide => Bucket))) storage buckets,
        mapping(PoolId => mapping(int16 => uint256)) storage buyBitmaps,
        mapping(PoolId => mapping(int16 => uint256)) storage sellBitmaps,
        PoolId poolId,
        bool zeroForOne,
        euint128 userInputEnc,
        int24 fromTick,
        int24 toTick
    ) internal returns (euint128 remainderEnc, euint128 userOutputEnc) {
        // ... implementation
    }
}
```

---

## Strategy 3: Remove/Simplify Functions

### View Functions to Remove or Make External-Only

| Function | Current | Action | Savings |
|----------|---------|--------|---------|
| `getPoolState` | public view | Remove or external | ~50 B |
| `getPoolReserves` | public view | Remove or external | ~50 B |
| `getTickPrice` | external pure | Keep (small) | 0 |
| `getCurrentTickForPool` | external view | Merge with getPoolState | ~30 B |
| `getQuoteForPool` | external view | Keep (needed) | 0 |

### Functions to Simplify

1. **`_getCurrentTick`** - Complex sqrt calculation
   ```solidity
   // Current: Full TickMath calculation from reserves
   // Simplified: Cache tick in storage, update on swaps
   // Savings: ~200 B
   ```

2. **`_calculateTickPrice`** - Uses TickMath library
   ```solidity
   // Current: TickMath.getSqrtPriceAtTick → conversion
   // Alternative: Precomputed lookup table for common ticks
   // Savings: ~100 B (but adds storage)
   ```

3. **`_autoClaim`** - Complex proceeds calculation
   ```solidity
   // Consider: Remove auto-claim, require explicit claim
   // Savings: ~150 B
   ```

### Dead Code Removal Checklist

- [ ] Remove `maxBucketsPerSwap` if hardcoding to 2-3
- [ ] Remove `feeChangeTimelock` if not using timelocked fees
- [ ] Remove `pendingFeeInfo` struct if not using
- [ ] Simplify `PoolState` struct (combine booleans into bitmap)

---

## Strategy 4: Router Architecture

### Concept

Deploy a **FheatherXRouter** that:
1. Routes swaps to the correct pool type
2. Handles wrapping/unwrapping between FHE and ERC20
3. Enables multi-hop swaps across pool types

```
User → Router → FheatherX_FheFhe (fheWETH/fheUSDC)
                     ↓
              FheatherX_FheErc (fheUSDC/WETH)
                     ↓
                  User receives WETH
```

### Router Benefits

1. **Smaller core contracts** - Each pool type is specialized
2. **Composability** - Can route across multiple pools
3. **Upgrade path** - Replace pools without changing router interface
4. **Wrap/unwrap** - Handle FHERC20 ↔ ERC20 conversions

### Router Implementation Sketch

```solidity
contract FheatherXRouter {
    IFheatherX_FheFhe public fheFhePool;
    IFheatherX_FheErc public fheErcPool;
    IFheatherX_ErcFhe public ercFhePool;

    /// @notice Swap with automatic pool selection and wrapping
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external returns (uint256 amountOut) {
        // 1. Determine pool type needed
        // 2. Wrap tokenIn if needed (ERC20 → FHERC20)
        // 3. Execute swap on appropriate pool
        // 4. Unwrap if needed (FHERC20 → ERC20)
        // 5. Return to user
    }

    /// @notice Multi-hop swap across pool types
    function swapMultiHop(
        address[] calldata path,
        uint256 amountIn,
        uint256 minAmountOut
    ) external returns (uint256 amountOut) {
        // Execute swaps in sequence
    }
}
```

### Wrapping Considerations

For FHE:FHE pools to interact with other pairs, tokens need wrapping:

```
WETH (ERC20) → fheWETH (FHERC20) → Trade in FHE:FHE pool → fheUSDC → USDC (unwrap)
```

This could be:
1. **User-initiated** - User wraps/unwraps manually
2. **Router-assisted** - Router handles wrap/unwrap automatically
3. **Permit-based** - Use permit for gasless approvals

---

## Strategy 5: Modern EVM Features (Cancun/Prague)

We're on Solidity 0.8.26 with `evm_version = "cancun"`. Several new opcodes can help:

### MCOPY (EIP-5656) - Memory Copy

Available since Cancun, used automatically by Solidity 0.8.25+.

```solidity
// Compiler uses MCOPY for abi.encode/decode of byte arrays
// No manual action needed - just ensure via_ir = true
```

**Impact:** Modest gas savings on memory operations. The compiler handles this automatically.

### Transient Storage (EIP-1153) - TLOAD/TSTORE

**100 gas** per operation (vs 2100/20000 for SLOAD/SSTORE cold). Perfect for:

1. **Reentrancy locks** - Currently we use `SwapLock` library with storage
2. **Temporary state** - Per-transaction caching

```solidity
// Current: Storage-based lock (expensive)
library SwapLock {
    bytes32 constant LOCK_SLOT = keccak256("fheatherx.swap.lock");

    function lock(PoolId poolId) internal {
        bytes32 slot = keccak256(abi.encode(LOCK_SLOT, poolId));
        assembly { sstore(slot, 1) }  // 20,000 gas cold!
    }
}

// Better: Transient storage lock (cheap)
library SwapLockTransient {
    bytes32 constant LOCK_SLOT = keccak256("fheatherx.swap.lock");

    function lock(PoolId poolId) internal {
        bytes32 slot = keccak256(abi.encode(LOCK_SLOT, poolId));
        assembly { tstore(slot, 1) }  // 100 gas!
    }

    function unlock(PoolId poolId) internal {
        bytes32 slot = keccak256(abi.encode(LOCK_SLOT, poolId));
        assembly { tstore(slot, 0) }  // 100 gas!
    }

    function isLocked(PoolId poolId) internal view returns (bool) {
        bytes32 slot = keccak256(abi.encode(LOCK_SLOT, poolId));
        bool locked;
        assembly { locked := tload(slot) }  // 100 gas!
        return locked;
    }
}
```

**Potential uses in FheatherX:**
- Swap reentrancy lock (already have, convert to transient)
- Per-transaction reserve cache (avoid repeated FHE decrypts)
- Momentum bucket tracking during swap execution

### Prague EVM (Coming May 2025)

Solidity 0.8.30 defaults to Prague. New features:
- Additional EOF improvements
- Potential further gas optimizations

**Recommendation:** Stay on Cancun for now, upgrade after Prague stabilizes.

### Transient Storage for Momentum Tracking

Key insight: During a swap, we need to track which buckets were activated. Currently this requires storage writes. With transient storage:

```solidity
// Track activated buckets during swap (transient)
bytes32 constant ACTIVATED_BUCKETS_SLOT = keccak256("fheatherx.activated");

function _markBucketActivated(PoolId poolId, int24 tick) internal {
    bytes32 slot = keccak256(abi.encode(ACTIVATED_BUCKETS_SLOT, poolId, tick));
    assembly { tstore(slot, 1) }
}

function _isBucketActivated(PoolId poolId, int24 tick) internal view returns (bool) {
    bytes32 slot = keccak256(abi.encode(ACTIVATED_BUCKETS_SLOT, poolId, tick));
    bool activated;
    assembly { activated := tload(slot) }
    return activated;
}
// No cleanup needed - automatically cleared at end of transaction!
```

---

## Strategy 6: Code Optimizations

### Assembly Optimizations

```solidity
// Before: Multiple storage reads
function example() {
    uint256 a = someMapping[key].field1;
    uint256 b = someMapping[key].field2;
}

// After: Single SLOAD with assembly
function example() {
    uint256 a;
    uint256 b;
    assembly {
        let slot := keccak256(...)
        let packed := sload(slot)
        a := and(packed, 0xFFFFFFFF)
        b := shr(32, packed)
    }
}
```

### Storage Packing

```solidity
// Before: 3 storage slots
struct PoolState {
    bool initialized;        // slot 0 (wastes 31 bytes)
    bool token0IsFherc20;    // slot 1 (wastes 31 bytes)
    bool token1IsFherc20;    // slot 2 (wastes 31 bytes)
}

// After: 1 storage slot
struct PoolState {
    uint8 flags;  // bit 0: initialized, bit 1: token0IsFherc20, bit 2: token1IsFherc20
    // ... other fields packed
}
```

### Modifier Inlining

```solidity
// Before: Modifier adds overhead
modifier whenInitialized(PoolId poolId) {
    if (!poolStates[poolId].initialized) revert PoolNotInitialized();
    _;
}

// After: Inline check (saves ~20-30 bytes per use if used rarely)
function swap(...) {
    if (!poolStates[poolId].initialized) revert PoolNotInitialized();
    // ...
}
```

---

## Major Architectural Moves (Second Sweep Analysis)

After deep analysis of FheatherXv7, here are significant architectural changes that could save substantial bytecode:

---

### 1. Remove Uniswap v4 Hook Inheritance (~2-3KB potential savings)

**Current State:**
```solidity
contract FheatherXv7 is BaseHook, Pausable, Ownable {
```

**Problem:** BaseHook brings significant overhead:
- Hook permission system (~500 bytes)
- `_beforeSwap` callback that doesn't even trigger limit orders anymore
- `_afterSwap` callback that does nothing
- V4 settlement logic (`take`/`settle`/`sync`)
- PoolManager integration code

**Observation:** The `_afterSwap` hook is now empty (line 434-436):
```solidity
// Note: Limit order processing happens in swapForPool/swapEncrypted
// External Pool Manager swaps don't trigger our encrypted limit orders
```

**Proposed Change:** Create a **standalone contract** that doesn't inherit BaseHook:
```solidity
contract FheatherXv7Standalone is Pausable, Ownable {
    // No hook callbacks
    // Direct swaps only via swapForPool() and swapEncrypted()
    // Remove: _beforeSwap, _afterSwap, _executeBeforeSwap, BeforeSwapDelta logic
    // Remove: poolManager.take(), poolManager.settle(), poolManager.sync()
}
```

**Trade-off:** Loses composability with Uniswap v4 ecosystem, but:
- Most users use direct swaps anyway
- Can add a thin "adapter hook" later if needed
- Saves ~2-3KB of bytecode

---

### 2. Unified Token Path (Remove Dual LP/Swap Functions) (~1.5KB savings)

**Current State:** Every operation has dual implementations:
```
addLiquidity()           - plaintext path
addLiquidityEncrypted()  - encrypted path

removeLiquidity()        - plaintext path
removeLiquidityEncrypted() - encrypted path

swapForPool()           - plaintext direction
swapEncrypted()         - encrypted direction
```

**Problem:** Code duplication. Each pair shares ~80% logic.

**Proposed Change:** Single entry point with type detection:

```solidity
/// @notice Unified addLiquidity - detects token types automatically
function addLiquidity(
    PoolId poolId,
    uint256 amount0,      // Plaintext for ERC20, ignored for FHERC20
    uint256 amount1,      // Plaintext for ERC20, ignored for FHERC20
    InEuint128 calldata encAmount0,  // For FHERC20 token0
    InEuint128 calldata encAmount1   // For FHERC20 token1
) external {
    PoolState storage state = poolStates[poolId];

    euint128 amt0 = state.token0IsFherc20
        ? FHE.asEuint128(encAmount0)
        : FHE.asEuint128(uint128(amount0));

    euint128 amt1 = state.token1IsFherc20
        ? FHE.asEuint128(encAmount1)
        : FHE.asEuint128(uint128(amount1));

    // Single code path from here
    _addLiquidityCore(poolId, amt0, amt1, msg.sender);
}
```

**Savings:** Remove `addLiquidityEncrypted`, `removeLiquidityEncrypted` as separate functions.

---

### 3. Remove Fee Timelock System (~400 bytes)

**Current State:**
```solidity
uint256 public constant FEE_CHANGE_DELAY = 2 days;
struct PendingFee { uint256 feeBps; uint256 effectiveTimestamp; }
mapping(PoolId => PendingFee) public pendingFees;

function queueProtocolFee(...)  // ~100 bytes
function applyProtocolFee(...)  // ~100 bytes
error FeeChangeNotReady();
event ProtocolFeeQueued(...);
```

**Question:** Is this feature essential for MVP?

**Proposed Change:** Simple immediate fee setting (owner-only):
```solidity
function setProtocolFee(PoolId poolId, uint256 _feeBps) external onlyOwner {
    if (_feeBps > 100) revert FeeTooHigh();
    poolStates[poolId].protocolFeeBps = _feeBps;
}
```

**Savings:** ~400 bytes by removing timelock complexity.

---

### 4. Simplify Reserve Sync (Remove Binary Search) (~500 bytes)

**Current State:**
```solidity
function _findNewestResolvedDecrypt(...)  // ~80 lines, complex binary search
function _harvestResolvedDecrypts(...)    // Calls above
mapping(PoolId => mapping(uint256 => PendingDecrypt)) public pendingDecrypts;
```

**Problem:** Binary search through pending decrypts is complex and rarely needed.

**Proposed Change:** Simple latest-only tracking:
```solidity
struct PoolReserves {
    // ... existing fields ...
    euint128 pendingReserve0;  // Most recent pending
    euint128 pendingReserve1;  // Most recent pending
}

function _requestReserveSync(PoolId poolId) internal {
    PoolReserves storage r = poolReserves[poolId];

    // Try to harvest previous pending
    if (Common.isInitialized(r.pendingReserve0)) {
        (uint256 v0, bool ready0) = FHE.getDecryptResultSafe(r.pendingReserve0);
        (uint256 v1, bool ready1) = FHE.getDecryptResultSafe(r.pendingReserve1);
        if (ready0 && ready1) {
            r.reserve0 = v0;
            r.reserve1 = v1;
        }
    }

    // Store new pending
    r.pendingReserve0 = r.encReserve0;
    r.pendingReserve1 = r.encReserve1;
    FHE.decrypt(r.encReserve0);
    FHE.decrypt(r.encReserve1);
}
```

**Savings:** Remove `pendingDecrypts` mapping, binary search logic (~500 bytes).

---

### 5. Cache Current Tick in Storage (~200 bytes)

**Current State:**
```solidity
function _getCurrentTick(PoolId poolId) internal view returns (int24) {
    // ~50 lines of complex sqrt math
    // Called on every operation
}
```

**Proposed Change:** Store tick directly, update on reserves change:
```solidity
mapping(PoolId => int24) public currentTick;  // Already have lastProcessedTick!

// In swap/liquidity functions:
currentTick[poolId] = _estimateTickFromReserves(r.reserve0, r.reserve1);
```

**Alternative:** Just use `lastProcessedTick` as the current tick (it's already being updated).

**Savings:** Remove `_getCurrentTick` function body, use stored value (~200 bytes).

---

### 6. Merge Dual Bitmap Mappings (~100 bytes + gas savings)

**Current State:**
```solidity
mapping(PoolId => mapping(int16 => uint256)) internal buyBitmaps;
mapping(PoolId => mapping(int16 => uint256)) internal sellBitmaps;
```

**Proposed Change:** Single mapping with side encoded:
```solidity
// Encode side in the key
mapping(PoolId => mapping(bytes32 => uint256)) internal bitmaps;

function _getBitmapKey(int16 wordPos, BucketSide side) internal pure returns (bytes32) {
    return keccak256(abi.encodePacked(wordPos, side));
}
```

**Alternative:** Use high bit of wordPos for side:
```solidity
mapping(PoolId => mapping(int24 => uint256)) internal bitmaps;
// BUY: wordPos as-is, SELL: wordPos | 0x8000
```

---

### 7. Remove Plaintext Reserve Cache (Controversial) (~300 bytes)

**Current State:** Dual tracking of reserves:
```solidity
struct PoolReserves {
    euint128 encReserve0;       // Encrypted (source of truth)
    euint128 encReserve1;       // Encrypted (source of truth)
    uint256 reserve0;           // Plaintext cache
    uint256 reserve1;           // Plaintext cache
    // ...
}
```

**Problem:** Maintaining two sources creates complexity and potential inconsistency.

**Proposed Change:** Only encrypted reserves, async decrypt for views:
```solidity
struct PoolReserves {
    euint128 encReserve0;
    euint128 encReserve1;
    euint128 encTotalLpSupply;
    // Plaintext cache populated by async decrypt callbacks only
    uint256 cachedReserve0;
    uint256 cachedReserve1;
    uint256 cacheTimestamp;
}
```

**Trade-off:** Views return potentially stale data. But this is already true!

---

### 8. Use Transient Storage for SwapLock + Intermediate State

**Current:** SwapLock uses storage (expensive writes).

**Proposed:** Convert to transient storage:
```solidity
library SwapLockTransient {
    bytes32 constant SLOT = keccak256("fheatherx.swaplock");

    function enforceOnce(PoolId poolId) internal {
        bytes32 key = keccak256(abi.encode(SLOT, poolId));
        bool locked;
        assembly { locked := tload(key) }
        require(!locked, "SwapLock: locked");
        assembly { tstore(key, 1) }
    }
}
```

**Additional:** Use transient storage for momentum tracking during swap execution.

---

### 9. Extract Core Math to Library (~500+ bytes)

Move heavy math functions to a library:

```solidity
library FheatherMath {
    function calculateTickPrice(int24 tick) internal pure returns (uint256);
    function sqrt256(uint256 x) internal pure returns (uint256);
    function estimateOutput(uint256 reserveIn, uint256 reserveOut, uint256 amountIn, uint256 feeBps)
        internal pure returns (uint256);
}
```

**Why it helps:** Library functions with `internal` visibility are inlined, but the optimizer can deduplicate identical sequences across the codebase.

---

### 10. Remove Unused/Redundant Events (~100-200 bytes)

**Current:** Many events with overlapping information:
```solidity
event Swap(poolId, user, zeroForOne, amountIn, amountOut);
event SwapEncrypted(poolId, user);  // Redundant?
event BucketFilled(poolId, tick, side);  // Already removed from _fillOpposingBucket
```

**Proposed:** Consolidate to fewer events, emit only essential data.

---

## Size Impact Summary

| Change | Est. Savings | Difficulty | Risk |
|--------|-------------|------------|------|
| Remove Hook inheritance | 2-3 KB | High | Loses V4 composability |
| Unified token paths | 1-1.5 KB | Medium | API change |
| Remove fee timelock | 400 B | Low | Feature removal |
| Simplify reserve sync | 500 B | Medium | Possible edge cases |
| Cache current tick | 200 B | Low | None |
| Merge bitmap mappings | 100 B | Low | None |
| Transient SwapLock | 50-100 B | Low | None |
| Extract math library | 500 B | Medium | None |
| Remove redundant events | 100-200 B | Low | Less observability |

**Conservative total: ~3-4 KB savings**
**Aggressive total: ~5-6 KB savings**

With 152 byte margin currently, we need ~650 bytes for momentum. Conservative changes should be sufficient.

---

## Recommended Approach

### Phase 1: Quick Wins (Do First)
1. Convert `SwapLock` to transient storage (saves gas, small size reduction)
2. Extract `OrderMatchingLib` with momentum functions
3. Remove unused view function variants
4. Simplify `_getCurrentTick` with cached storage

**Expected result:** Enough space for momentum in single contract

### Phase 2: If Phase 1 Insufficient
1. Split into FHE:FHE and FHE:ERC variants
2. Create basic router for cross-pool swaps
3. Use transient storage for momentum tracking

### Phase 3: Production Ready
1. Full router with multi-hop support
2. Wrap/unwrap integration
3. Gas optimizations with transient storage throughout

---

## Size Budget Projection

| Item | Bytes |
|------|-------|
| Current v7 (no momentum) | 24,424 |
| + Momentum closure | +400 |
| + Virtual slicing | +400 |
| - OrderMatchingLib extraction | -300 |
| - Remove redundant views | -150 |
| - Simplify getCurrentTick | -200 |
| - Storage packing | -100 |
| **Projected Total** | **24,474** |
| **Margin** | **102 B** |

This is tight but potentially achievable without splitting the contract.

---

## Next Steps

1. [ ] Try Phase 1 optimizations on v7
2. [ ] If successful, add momentum back
3. [ ] If not, implement FHE:ERC split
4. [ ] Create router contract for cross-pool trading
5. [ ] Update frontend to use router

---

## Questions to Consider

1. **Do we need all pool types?** If most users use FHE:FHE, optimize for that.
2. **Is auto-claim essential?** Removing it saves significant space.
3. **How many buckets per swap?** Hardcoding to 2 saves space vs configurable.
4. **Timelock fees needed?** Removing the fee change timelock saves ~200 bytes.

---

## References

- [Solidity 0.8.24 Release - Transient Storage](https://www.soliditylang.org/blog/2024/01/26/transient-storage/)
- [Solidity 0.8.25 Release - MCOPY Support](https://soliditylang.org/blog/2024/03/14/solidity-0.8.25-release-announcement/)
- [EIP-1153: Transient Storage Opcodes](https://eips.ethereum.org/EIPS/eip-1153)
- [EIP-5656: MCOPY Instruction](https://eips.ethereum.org/EIPS/eip-5656)
- [Downsizing Contracts Guide](https://soliditydeveloper.com/max-contract-size)
- [Uniswap V4 Transient Storage](https://hacken.io/discover/uniswap-v4-transient-storage-security/)
- [TSTORE Reentrancy Considerations](https://www.chainsecurity.com/blog/tstore-low-gas-reentrancy)
