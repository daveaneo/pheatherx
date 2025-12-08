# FheatherXv5 Contract Summary

**File:** `contracts/src/FheatherXv5.sol`
**Lines:** 1316
**License:** MIT
**Solidity:** ^0.8.24

---

## Overview

FheatherXv5 is a **Uniswap v4 Hook** that implements a **Hybrid Encrypted AMM + Private Limit Orders** system. It combines:

- **From V2:** Encrypted AMM reserves (`x*y=k` with FHE math), always-available liquidity, dual swap paths
- **From V4:** Gas-optimized limit orders with tick bitmaps, bucketed orders with proceeds-per-share accumulators

**Key Architecture Change from V4:** V4 routed all swaps through limit order buckets (failed if no orders). V5 routes swaps through the encrypted AMM first (always succeeds), then triggers limit orders on price movement.

---

## Inheritance Chain

```
FheatherXv5
├── BaseHook (Uniswap v4)
├── ReentrancyGuard (OpenZeppelin)
├── Pausable (OpenZeppelin)
└── Ownable (OpenZeppelin)
```

---

## Constants

| Name | Type | Value | Description |
|------|------|-------|-------------|
| `PRECISION` | uint256 | 1e18 | Fixed-point precision for share calculations |
| `TICK_SPACING` | int24 | 60 | Each tick = 0.6% price increment |
| `MIN_TICK` | int24 | -6000 | ~0.55x price |
| `MAX_TICK` | int24 | 6000 | ~1.8x price |
| `FEE_CHANGE_DELAY` | uint256 | 2 days | Timelock for fee changes |
| `SYNC_COOLDOWN_BLOCKS` | uint256 | 5 | Minimum blocks between reserve syncs |

---

## Types

### BucketSide (enum)
```solidity
enum BucketSide { BUY, SELL }
```

### Bucket (struct)
Represents a price bucket containing aggregated liquidity at a specific tick.

| Field | Type | Description |
|-------|------|-------------|
| `totalShares` | euint128 | Total shares in bucket |
| `liquidity` | euint128 | Available liquidity (unfilled) |
| `proceedsPerShare` | euint128 | Accumulator for proceeds distribution |
| `filledPerShare` | euint128 | Accumulator for fill tracking |
| `initialized` | bool | Whether bucket is initialized |

### UserPosition (struct)
User's position in a specific bucket.

| Field | Type | Description |
|-------|------|-------------|
| `shares` | euint128 | User's shares in bucket |
| `proceedsPerShareSnapshot` | euint128 | Snapshot at deposit/claim |
| `filledPerShareSnapshot` | euint128 | Snapshot at deposit |
| `realizedProceeds` | euint128 | Accumulated unclaimed proceeds |

### PoolState (struct)
Pool-specific configuration.

| Field | Type | Description |
|-------|------|-------------|
| `token0` | IFHERC20 | First token (FHERC20 interface) |
| `token1` | IFHERC20 | Second token (FHERC20 interface) |
| `initialized` | bool | Whether pool is initialized |
| `maxBucketsPerSwap` | uint256 | Max buckets to process per swap (default: 5) |
| `protocolFeeBps` | uint256 | Protocol fee in basis points (default: 5) |

### PoolReserves (struct)
Pool-specific encrypted AMM reserves.

| Field | Type | Description |
|-------|------|-------------|
| `encReserve0` | euint128 | Encrypted reserve of token0 (source of truth) |
| `encReserve1` | euint128 | Encrypted reserve of token1 (source of truth) |
| `encTotalLpSupply` | euint128 | Encrypted total LP supply (source of truth) |
| `reserve0` | uint256 | Plaintext cache for display/estimation |
| `reserve1` | uint256 | Plaintext cache for display/estimation |
| `lastSyncBlock` | uint256 | Last block when sync was requested |
| `pendingReserve0` | euint128 | Pending decryption result |
| `pendingReserve1` | euint128 | Pending decryption result |

### PendingFee (struct)
```solidity
struct PendingFee {
    uint256 feeBps;
    uint256 effectiveTimestamp;
}
```

---

## State Variables

### Immutable Encrypted Constants
| Name | Type | Description |
|------|------|-------------|
| `ENC_ZERO` | euint128 | Encrypted 0 |
| `ENC_PRECISION` | euint128 | Encrypted 1e18 |
| `ENC_ONE` | euint128 | Encrypted 1 |
| `ENC_SWAP_FEE_BPS` | euint128 | Encrypted swap fee (basis points) |
| `ENC_TEN_THOUSAND` | euint128 | Encrypted 10000 |

### Mappings
| Name | Key(s) | Value | Description |
|------|--------|-------|-------------|
| `poolStates` | PoolId | PoolState | Pool configuration |
| `pendingFees` | PoolId | PendingFee | Pending fee changes |
| `poolReserves` | PoolId | PoolReserves | Encrypted AMM reserves |
| `lpBalances` | PoolId, address | uint256 | Plaintext LP balance cache |
| `totalLpSupply` | PoolId | uint256 | Plaintext total LP cache |
| `encLpBalances` | PoolId, address | euint128 | Encrypted LP balances (source of truth) |
| `buckets` | PoolId, tick, side | Bucket | Limit order buckets |
| `positions` | PoolId, user, tick, side | UserPosition | User positions |
| `buyBitmaps` | PoolId, wordPos | uint256 | Bitmap for active buy ticks |
| `sellBitmaps` | PoolId, wordPos | uint256 | Bitmap for active sell ticks |
| `tickPrices` | tick | uint256 | Pre-computed tick prices |
| `lastProcessedTick` | PoolId | int24 | Last processed tick for order triggering |

### Other State
| Name | Type | Description |
|------|------|-------------|
| `feeCollector` | address | Address receiving protocol fees |
| `swapFeeBps` | uint256 | Swap fee in basis points |

---

## Events

| Event | Parameters | Description |
|-------|------------|-------------|
| `PoolInitialized` | poolId, token0, token1 | Pool created |
| `Swap` | poolId, user, zeroForOne, amountIn, amountOut | Swap executed |
| `SwapEncrypted` | poolId, user | Encrypted swap executed |
| `BucketFilled` | poolId, tick, side | Limit orders filled at tick |
| `Deposit` | poolId, user, tick, side, amountHash | Limit order deposited |
| `Withdraw` | poolId, user, tick, side, amountHash | Limit order withdrawn |
| `Claim` | poolId, user, tick, side, amountHash | Proceeds claimed |
| `LiquidityAdded` | poolId, user, amount0, amount1, lpAmount | Plaintext LP added |
| `LiquidityRemoved` | poolId, user, amount0, amount1, lpAmount | Plaintext LP removed |
| `LiquidityAddedEncrypted` | poolId, user | Encrypted LP added |
| `LiquidityRemovedEncrypted` | poolId, user | Encrypted LP removed |
| `ReserveSyncRequested` | poolId, blockNumber | Async decryption requested |
| `ReservesSynced` | poolId, reserve0, reserve1 | Reserves updated from decryption |
| `ProtocolFeeQueued` | poolId, newFeeBps, effectiveTimestamp | Fee change queued |
| `ProtocolFeeApplied` | poolId, newFeeBps | Fee change applied |
| `FeeCollectorUpdated` | newCollector | Fee collector changed |

---

## Errors

| Error | Description |
|-------|-------------|
| `InvalidTick()` | Tick out of range or not aligned to spacing |
| `PoolNotInitialized()` | Pool not yet initialized |
| `ZeroAmount()` | Amount cannot be zero |
| `InsufficientBalance()` | User has insufficient balance |
| `InsufficientLiquidity()` | Pool has insufficient liquidity |
| `DeadlineExpired()` | Transaction deadline passed |
| `PriceMoved()` | Price moved beyond maxTickDrift |
| `SlippageExceeded()` | Output below minimum |
| `FeeTooHigh()` | Protocol fee > 100 bps |
| `FeeChangeNotReady()` | Fee timelock not expired |

---

## Functions

### Constructor

```solidity
constructor(
    IPoolManager _poolManager,
    address _owner,
    uint256 _swapFeeBps
)
```

Initializes:
- Encrypted constants (ENC_ZERO, ENC_PRECISION, etc.)
- Swap fee
- Pre-computed tick prices

---

### Hook Callbacks

#### getHookPermissions
```solidity
function getHookPermissions() public pure override returns (Hooks.Permissions memory)
```
Returns hook permissions:
- `afterInitialize: true` - Sets up encrypted pool state
- `beforeSwap: true` - Executes against encrypted AMM
- `afterSwap: true` - Triggers limit orders
- `beforeSwapReturnDelta: true` - Returns delta for settlement

#### _afterInitialize
```solidity
function _afterInitialize(
    address,
    PoolKey calldata key,
    uint160,
    int24
) internal override returns (bytes4)
```
Initializes pool state and encrypted reserves when pool is created.

#### _beforeSwap
```solidity
function _beforeSwap(
    address sender,
    PoolKey calldata key,
    SwapParams calldata params,
    bytes calldata
) internal override returns (bytes4, BeforeSwapDelta, uint24)
```
**Key change from V4:** Executes swap against encrypted AMM reserves using x*y=k formula. Returns delta for PoolManager settlement.

#### _afterSwap
```solidity
function _afterSwap(
    address,
    PoolKey calldata key,
    SwapParams calldata params,
    BalanceDelta,
    bytes calldata
) internal override returns (bytes4, int128)
```
Processes limit orders triggered by price movement.

---

### Encrypted AMM Math

#### _executeSwapMathForPool
```solidity
function _executeSwapMathForPool(
    PoolId poolId,
    ebool direction,
    euint128 amountIn
) internal returns (euint128 amountOut)
```
Executes encrypted x*y=k swap math:
1. Applies swap fee
2. Calculates output: `amountOut = (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee)`
3. Updates encrypted reserves

---

### Limit Order Functions

#### deposit
```solidity
function deposit(
    PoolId poolId,
    int24 tick,
    BucketSide side,
    InEuint128 calldata encryptedAmount,
    uint256 deadline,
    int24 maxTickDrift
) external nonReentrant whenNotPaused
```
Deposits tokens into a limit order bucket. Auto-claims existing proceeds.

#### withdraw
```solidity
function withdraw(
    PoolId poolId,
    int24 tick,
    BucketSide side,
    InEuint128 calldata encryptedAmount
) external nonReentrant whenNotPaused
```
Withdraws unfilled tokens from a limit order bucket.

#### claim
```solidity
function claim(
    PoolId poolId,
    int24 tick,
    BucketSide side
) external nonReentrant whenNotPaused
```
Claims proceeds from filled orders.

#### exit
```solidity
function exit(
    PoolId poolId,
    int24 tick,
    BucketSide side
) external nonReentrant whenNotPaused
```
Exits entire position - withdraws unfilled and claims proceeds in one transaction.

---

### LP Functions (from V2)

#### addLiquidity
```solidity
function addLiquidity(
    PoolId poolId,
    uint256 amount0,
    uint256 amount1
) external nonReentrant whenNotPaused returns (uint256 lpAmount)
```
Adds liquidity using plaintext amounts. Updates both plaintext cache and encrypted source of truth.

**LP Calculation:**
- First deposit: `lpAmount = sqrt(amount0 * amount1)`
- Subsequent: `lpAmount = min(amount0 * totalLP / reserve0, amount1 * totalLP / reserve1)`

#### removeLiquidity
```solidity
function removeLiquidity(
    PoolId poolId,
    uint256 lpAmount
) external nonReentrant returns (uint256 amount0, uint256 amount1)
```
Removes liquidity proportionally.

#### addLiquidityEncrypted
```solidity
function addLiquidityEncrypted(
    PoolId poolId,
    InEuint128 calldata amount0,
    InEuint128 calldata amount1
) external nonReentrant whenNotPaused returns (euint128 lpAmount)
```
Adds liquidity with encrypted amounts.

**LP Calculation:**
- First deposit: `lpAmount = min(amt0, amt1) * 2` (approximates sqrt, prevents manipulation)
- Subsequent: `lpAmount = min(amt0 * totalLP / reserve0, amt1 * totalLP / reserve1)`

#### removeLiquidityEncrypted
```solidity
function removeLiquidityEncrypted(
    PoolId poolId,
    InEuint128 calldata lpAmount
) external nonReentrant returns (euint128 amount0, euint128 amount1)
```
Removes liquidity with encrypted LP amount. Clamped to user's actual balance.

---

### Direct Encrypted Swap

#### swapEncrypted
```solidity
function swapEncrypted(
    PoolId poolId,
    InEbool calldata direction,
    InEuint128 calldata amountIn,
    InEuint128 calldata minOutput
) external nonReentrant whenNotPaused returns (euint128 amountOut)
```
Fully encrypted swap - direction and amount are hidden. Includes slippage check.

---

### Reserve Sync Functions

#### _requestReserveSync
```solidity
function _requestReserveSync(PoolId poolId) internal
```
Requests async decryption of reserves (with cooldown).

#### trySyncReserves
```solidity
function trySyncReserves(PoolId poolId) external
```
Tries to update plaintext cache from decrypted values.

---

### Admin Functions

| Function | Description |
|----------|-------------|
| `pause()` | Pause contract (onlyOwner) |
| `unpause()` | Unpause contract (onlyOwner) |
| `setFeeCollector(address)` | Set fee collector address |
| `setMaxBucketsPerSwap(PoolId, uint256)` | Set max buckets per swap (1-20) |
| `queueProtocolFee(PoolId, uint256)` | Queue fee change (max 100 bps, 2-day delay) |
| `applyProtocolFee(PoolId)` | Apply queued fee change |

---

### View Functions

#### getPoolState
```solidity
function getPoolState(PoolId poolId) external view returns (
    address token0,
    address token1,
    bool initialized,
    uint256 maxBucketsPerSwap,
    uint256 protocolFeeBps
)
```

#### getPoolReserves
```solidity
function getPoolReserves(PoolId poolId) external view returns (
    uint256 reserve0,
    uint256 reserve1,
    uint256 lpSupply
)
```

#### getTickPrice
```solidity
function getTickPrice(int24 tick) external view returns (uint256)
```

#### hasActiveOrders
```solidity
function hasActiveOrders(PoolId poolId, int24 tick, BucketSide side) external view returns (bool)
```

---

## Internal Helper Functions

| Function | Description |
|----------|-------------|
| `_calculateProceeds(pos, bucket)` | Calculate pending proceeds for position |
| `_calculateUnfilled(pos, bucket)` | Calculate unfilled shares for position |
| `_autoClaim(poolId, tick, side, bucket, position)` | Auto-claim proceeds on deposit |
| `_initializeBucket(bucket)` | Initialize bucket with zeros |
| `_getCurrentTick(poolId)` | Get current tick from price |
| `_findNextActiveTick(poolId, tick, side, up)` | Find next active tick in bitmap |
| `_setBit(poolId, tick, side)` | Set bit in tick bitmap |
| `_initializeTickPrices()` | Pre-compute all tick prices |
| `_calculateTickPrice(tick)` | Calculate price for tick (1.006^tick) |
| `_abs(int24)` | Absolute value |
| `_sqrt(uint256)` | Integer square root |
| `_estimateOutput(poolId, zeroForOne, amountIn)` | Estimate output from public cache |
| `_processTriggeredOrders(poolId, zeroForOne)` | Process limit orders after swap |
| `_fillBucketAgainstAMM(poolId, tick, side)` | Fill bucket by swapping against AMM |
| `_updateBucketOnFill(bucket, fillAmt, proceeds)` | Update accumulators on fill |

---

## FHE Operations Summary

The contract uses Fhenix CoFHE with these encrypted types:
- `euint128` - 128-bit encrypted unsigned integer
- `ebool` - Encrypted boolean
- `InEuint128` - Input encrypted value (from user)
- `InEbool` - Input encrypted boolean (from user)

**Key FHE functions used:**
- `FHE.asEuint128(value)` - Encrypt plaintext
- `FHE.add/sub/mul/div` - Arithmetic
- `FHE.select(condition, a, b)` - Conditional select
- `FHE.gt/lt/gte/eq` - Comparisons
- `FHE.allowThis(value)` - Grant contract permission
- `FHE.allow(value, address)` - Grant address permission
- `FHE.decrypt(value)` - Request async decryption
- `FHE.getDecryptResultSafe(value)` - Get decryption result
- `Common.isInitialized(value)` - Check if value exists

**FHE.div usage:** 11 calls (expensive, see docs/future-features.md for optimization plans)

---

## Security Features

1. **ReentrancyGuard** - Prevents reentrancy attacks
2. **Pausable** - Emergency pause functionality
3. **Ownable** - Admin access control
4. **Fee Timelock** - 2-day delay for fee changes (max 100 bps)
5. **Tick Drift Protection** - `maxTickDrift` parameter prevents stale orders
6. **Deadline Protection** - Orders expire after deadline
7. **Slippage Protection** - Encrypted swaps have `minOutput` check
8. **Safe Division** - Division by zero prevented with safe denominators

---

## Gas Optimizations

1. **Tick Bitmap** - O(1) lookup for active ticks
2. **Pre-computed Tick Prices** - Stored in constructor
3. **Reserve Sync Cooldown** - 5 block minimum between syncs
4. **Max Buckets Per Swap** - Limits gas per transaction (default: 5)
5. **Plaintext Cache** - Public reserve cache for estimation
