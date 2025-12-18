# FHE Swap Gas Optimization Challenge

## Problem Statement

We have a fully-encrypted AMM swap function that costs **~3.06M gas** on Arbitrum Sepolia testnet. The swap must remain **fully private** (encrypted direction, amounts, and order matching), but we want to reduce gas costs while maintaining the same functionality.

**Goal**: Reduce gas usage while preserving full privacy guarantees.

## How FHE Gas Works

Fhenix uses a **coprocessor model** where FHE computation happens off-chain. On-chain, we pay gas for:
- Calling the TaskManager precompile
- Passing parameters (ciphertext handles)
- ACL permission management

**Critical insight**: All math operations (add, sub, mul, div) have **nearly identical on-chain gas costs** because they all call the same `createTask()` function with different `FunctionId` values. The actual cryptographic cost difference happens off-chain.

## FHE Operation Gas Costs (Measured)

| Operation | Gas Cost | Notes |
|-----------|----------|-------|
| FHE.asEuint128 | 92,634 | Trivial encryption |
| FHE.add | 118,718 | |
| FHE.sub | 115,737 | |
| FHE.mul | 124,582 | |
| FHE.div | 121,178 | Same as mul on-chain! |
| FHE.gt | 113,146 | |
| FHE.gte | 107,924 | |
| FHE.select | 132,861 | Most expensive |
| FHE.not | 77,223 | |
| FHE.allowThis | 25,846 | ACL permission |
| FHE.allow | 27,998 | ACL permission |

## Current Gas Breakdown (Simple Swap, No Orders)

| Operation | Count | Unit Cost | Total Gas | % |
|-----------|-------|-----------|-----------|---|
| FHE.select | 14 | 132,861 | 1,860,054 | **35.2%** |
| FHE.allowThis | 25 | 25,846 | 646,150 | **12.2%** |
| FHE.mul | 5 | 124,582 | 622,910 | 11.8% |
| FHE.add | 5 | 118,718 | 593,590 | 11.2% |
| FHE.div | 4 | 121,178 | 484,712 | 9.2% |
| FHE.sub | 3 | 115,737 | 347,211 | 6.6% |
| FHE.gt | 2 | 113,146 | 226,292 | 4.3% |
| FHE.not | 2 | 77,223 | 154,446 | 2.9% |
| FHE.allow | 4 | 27,998 | 111,992 | 2.1% |
| FHE.gte | 1 | 107,924 | 107,924 | 2.0% |
| FHE.asEuint128 | 1 | 92,634 | 92,634 | 1.8% |
| **TOTAL** | **66** | | **5,247,915** | 100% |

## Gas by Function

| Function | Gas | % | Description |
|----------|-----|---|-------------|
| `_executeSwapMath` | 2,029,242 | **38.7%** | AMM x*y=k calculation |
| Output Calculation | 1,696,717 | **32.3%** | User share + protocol fee |
| Maker Matching | 523,552 | 10.0% | Match opposing limit orders |
| Setup | 450,948 | 8.6% | Input token transfers |
| Transfer Output | 373,410 | 7.1% | Output token transfers |
| Taker Momentum | 210,399 | 4.0% | Find triggered taker orders |

---

## Gas-Guzzling Code #1: `_executeSwapMath` (38.7% of gas)

This function implements the constant-product AMM formula with fees.

```solidity
function _executeSwapMath(
    PoolId poolId,
    ebool direction,
    euint128 amountIn
) internal returns (euint128 amountOut) {
    PoolReserves storage r = poolReserves[poolId];

    // Fee calculation: 2 ops (mul + div)
    euint128 feeAmount = FHE.div(FHE.mul(amountIn, ENC_SWAP_FEE_BPS), ENC_TEN_THOUSAND);
    euint128 amountInAfterFee = FHE.sub(amountIn, feeAmount);  // 1 op
    FHE.allowThis(amountInAfterFee);  // 1 ACL

    // Reserve selection based on direction: 2 ops
    euint128 reserveIn = FHE.select(direction, r.encReserve0, r.encReserve1);
    euint128 reserveOut = FHE.select(direction, r.encReserve1, r.encReserve0);

    // AMM formula: amountOut = (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee)
    euint128 numerator = FHE.mul(amountInAfterFee, reserveOut);  // 1 op
    euint128 denominator = FHE.add(reserveIn, amountInAfterFee);  // 1 op

    // Safe division (avoid div-by-zero): 2 ops + 1 ACL
    euint128 safeDenominator = FHE.select(
        FHE.gt(denominator, ENC_ZERO),
        denominator,
        ENC_ONE
    );
    FHE.allowThis(safeDenominator);

    amountOut = FHE.div(numerator, safeDenominator);  // 1 op
    FHE.allowThis(amountOut);  // 1 ACL

    // Update reserves: 2 ops + 2 ACL
    euint128 newReserveIn = FHE.add(reserveIn, amountIn);
    euint128 newReserveOut = FHE.sub(reserveOut, amountOut);

    r.encReserve0 = FHE.select(direction, newReserveIn, newReserveOut);  // 1 op
    r.encReserve1 = FHE.select(direction, newReserveOut, newReserveIn);  // 1 op
    FHE.allowThis(r.encReserve0);  // 1 ACL
    FHE.allowThis(r.encReserve1);  // 1 ACL
}
```

**Operation count**: 3 mul, 2 div, 2 sub, 2 add, 4 select, 1 gt, 5 allowThis = **~2.03M gas**

---

## Gas-Guzzling Code #2: Protocol Fee Calculation (inside swap, ~700k gas)

```solidity
// STEP 5b: Apply protocol fee (encrypted)
uint256 feeBps = poolStates[poolId].protocolFeeBps;
euint128 encFeeBps = FHE.asEuint128(uint128(feeBps));  // 1 trivial encrypt (93k!)
FHE.allowThis(encFeeBps);  // 1 ACL

// fee = userTotalOutput * feeBps / 10000
euint128 feeNumerator = FHE.mul(userTotalOutput, encFeeBps);  // 1 mul
FHE.allowThis(feeNumerator);  // 1 ACL
euint128 fee = FHE.div(feeNumerator, ENC_TEN_THOUSAND);  // 1 div
FHE.allowThis(fee);  // 1 ACL

// outputAfterFee = userTotalOutput - fee
euint128 outputAfterFee = FHE.sub(userTotalOutput, fee);  // 1 sub
FHE.allowThis(outputAfterFee);  // 1 ACL

// Slippage check (on output AFTER fee)
ebool slippageOk = FHE.gte(outputAfterFee, minOutput);  // 1 gte
euint128 finalOutput = FHE.select(slippageOk, outputAfterFee, ENC_ZERO);  // 1 select
euint128 finalFee = FHE.select(slippageOk, fee, ENC_ZERO);  // 1 select
FHE.allowThis(finalOutput);  // 1 ACL
FHE.allowThis(finalFee);  // 1 ACL
```

**Quick win**: `FHE.asEuint128(feeBps)` is called every swap. Could be a constant.

---

## Gas-Guzzling Code #3: Direction-Based Transfers (~450k gas each direction)

The swap is fully private, so we don't know which token is input/output. We use `FHE.select` to conditionally transfer.

```solidity
// STEP 0: Transfer input tokens (conditional on encrypted direction)
euint128 token0InputAmount = FHE.select(direction, amountIn, ENC_ZERO);  // 1 select
euint128 token1InputAmount = FHE.select(direction, ENC_ZERO, amountIn);  // 1 select
FHE.allowThis(token0InputAmount);  // 1 ACL
FHE.allowThis(token1InputAmount);  // 1 ACL
FHE.allow(token0InputAmount, token0);  // 1 ACL
FHE.allow(token1InputAmount, token1);  // 1 ACL

IFHERC20(token0)._transferFromEncrypted(sender, address(this), token0InputAmount);
IFHERC20(token1)._transferFromEncrypted(sender, address(this), token1InputAmount);

// ... later ...

// STEP 6: Transfer output to user
euint128 token0OutputAmount = FHE.select(direction, ENC_ZERO, finalOutput);  // 1 select
euint128 token1OutputAmount = FHE.select(direction, finalOutput, ENC_ZERO);  // 1 select
FHE.allowThis(token0OutputAmount);  // 1 ACL
FHE.allowThis(token1OutputAmount);  // 1 ACL
FHE.allow(token0OutputAmount, token0);  // 1 ACL
FHE.allow(token1OutputAmount, token1);  // 1 ACL
```

**Issue**: 4 select + 8 ACL ops just for transfers = ~825k gas

---

## Gas-Guzzling Code #4: Maker Order Matching (~524k gas even with 0 orders)

Even when there are NO limit orders, we still pay for the setup:

```solidity
// STEP 1: Match MAKER orders (opposing limit orders)
// Run matching on BOTH sides, use FHE.select to pick correct results
(euint128 remainderIfZeroForOne, euint128 makerOutputIfZeroForOne) =
    _matchMakerOrdersEncrypted(poolId, true, amountIn, startTick, direction);
(euint128 remainderIfOneForZero, euint128 makerOutputIfOneForZero) =
    _matchMakerOrdersEncrypted(poolId, false, amountIn, startTick, direction);

euint128 userRemainder = FHE.select(direction, remainderIfZeroForOne, remainderIfOneForZero);
euint128 outputFromMakers = FHE.select(direction, makerOutputIfZeroForOne, makerOutputIfOneForZero);
FHE.allowThis(userRemainder);
FHE.allowThis(outputFromMakers);
```

Inside `_matchMakerOrdersEncrypted` (when 0 buckets):
```solidity
// Even with 0 orders, we execute:
ebool shouldApply = FHE.not(direction);  // or just direction
FHE.allowThis(shouldApply);
// ... returns (amountIn, ENC_ZERO)
```

**Issue**: We call `_matchMakerOrdersEncrypted` TWICE (both directions) even when bitmaps show no orders exist.

---

## User's Share Calculation (~400k gas)

```solidity
// User output = maker fills + their share of AMM output
euint128 userAmmShare;
ebool hasAmmInput = FHE.gt(totalAmmInput, ENC_ZERO);  // 1 gt
euint128 safeTotalInput = FHE.select(hasAmmInput, totalAmmInput, ENC_ONE);  // 1 select
FHE.allowThis(safeTotalInput);  // 1 ACL

// userAmmShare = (userRemainder / totalAmmInput) * totalAmmOutput
euint128 userShareNumerator = FHE.mul(userRemainder, totalAmmOutput);  // 1 mul
FHE.allowThis(userShareNumerator);  // 1 ACL
userAmmShare = FHE.div(userShareNumerator, safeTotalInput);  // 1 div
FHE.allowThis(userAmmShare);  // 1 ACL

euint128 userTotalOutput = FHE.add(outputFromMakers, userAmmShare);  // 1 add
FHE.allowThis(userTotalOutput);  // 1 ACL
```

---

## Optimization Questions

### 1. Can we reduce `FHE.select` calls? (35% of gas)

The current design evaluates BOTH directions to preserve privacy. Is there a way to:
- Batch multiple selects together?
- Cache direction-based values?
- Restructure to need fewer conditional branches?

### 2. Can we reduce `FHE.allowThis` calls? (12% of gas)

Currently every intermediate value gets `allowThis()`. Questions:
- Which values actually need ACL permissions?
- Only stored values and values passed to external contracts?
- Can intermediate computation results skip ACL?

### 3. Can we simplify the AMM formula? (38% of gas)

Current formula:
```
feeAmount = amountIn * feeBps / 10000
amountInAfterFee = amountIn - feeAmount
amountOut = (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee)
```

Is there a mathematically equivalent formula with fewer operations?

### 4. Can we skip maker matching when no orders exist?

The bitmap is plaintext. Can we check it BEFORE doing FHE operations?
```solidity
// Potential optimization:
if (orderBitmaps[poolId][SELL] == 0 && orderBitmaps[poolId][BUY] == 0) {
    // Skip _matchMakerOrdersEncrypted entirely
    userRemainder = amountIn;
    outputFromMakers = ENC_ZERO;
} else {
    // ... existing logic
}
```

But does this leak information about order book state?

### 5. Can we pre-compute encrypted constants?

Current code does `FHE.asEuint128(feeBps)` every swap (93k gas). Could store as immutable.

---

## Constraints

1. **Direction must remain encrypted** - Cannot branch on direction in plaintext
2. **Amounts must remain encrypted** - Cannot use plaintext amounts
3. **Order fills must remain encrypted** - Cannot leak which orders were matched
4. **Slippage check must be encrypted** - Cannot leak if slippage check passed

## Success Criteria

- Reduce from 3.06M gas to under 2.5M gas (18% reduction)
- Maintain full privacy guarantees
- No changes to external interface
