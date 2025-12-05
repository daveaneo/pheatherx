# PheatherX v3 Implementation Plan - Version 2

> **Status:** NOT IMPLEMENTED - Design Document
> **Revision:** v2 - Addresses all issues from Audit v1
> **Previous:** 01-implementation-v1.md → 02-audit-v1.md

---

## Changes from v1

| Issue | Severity | Resolution |
|-------|----------|------------|
| C1: Pro-rata math broken | Critical | Adopted "proceeds per share" accumulator model |
| C2: Multiple deposits overwrite snapshot | Critical | Auto-claim on subsequent deposits |
| C3: Buy/sell buckets not separated | Critical | Separate bucket mappings with BucketSide enum |
| H1: Withdraw calculation wrong | High | Use proportional fill tracking |
| H2: No reentrancy protection | High | Added nonReentrant to all external functions |
| H3: Missing infinite allowance | High | Added isInfiniteAllowance mapping |
| H4: Exit double-calculates | High | Unified internal function for fill calculation |
| M1: Price placeholder | Medium | Fixed-point price math with 1e18 scaling |
| M2: Initialization race | Medium | Check bitmap directly, not bool |
| M3: No bucket deactivation | Medium | Accept gas waste (can't decrypt in sync) |
| M4: Missing deposit slippage | Medium | Added deadline and maxTickDrift |
| L1: Events missing info | Low | Added nonce to Transfer event |
| L2: No view for claimable | Low | Added getClaimable() view function |

---

## Executive Summary

PheatherX v3 replaces individual limit orders with **bucketed liquidity pools** using a **"proceeds per share" accumulator model**. This achieves O(1) gas scaling per bucket while correctly handling pro-rata distribution across multiple depositors.

---

## Core Data Structures

### Bucket Structure

```solidity
enum BucketSide { BUY, SELL }

struct Bucket {
    euint128 totalShares;           // Sum of all user shares in this bucket
    euint128 liquidity;             // Current unfilled liquidity
    euint128 proceedsPerShare;      // Accumulated proceeds per share (scaled by PRECISION)
    euint128 filledPerShare;        // Accumulated fills per share (for withdraw calc)
    bool initialized;
}

struct UserPosition {
    euint128 shares;                        // User's share of bucket
    euint128 proceedsPerShareSnapshot;      // proceedsPerShare at last deposit/claim
    euint128 filledPerShareSnapshot;        // filledPerShare at last deposit/claim
    euint128 pendingProceeds;               // Unclaimed proceeds (from auto-claim on deposit)
}
```

### State Variables

```solidity
// PRECISION for fixed-point math
uint256 public constant PRECISION = 1e18;

// Separate buy and sell buckets at each tick
// tick => side => bucket
mapping(int24 => mapping(BucketSide => Bucket)) public buckets;

// User positions: user => tick => side => position
mapping(address => mapping(int24 => mapping(BucketSide => UserPosition))) public positions;

// Tick bitmaps for each side
TickBitmap.State internal buyBitmap;
TickBitmap.State internal sellBitmap;

// Reentrancy guard
uint256 private _status;
uint256 private constant _NOT_ENTERED = 1;
uint256 private constant _ENTERED = 2;
```

---

## FHERC6909: Updated Implementation

### Changes from v1
- Added `isInfiniteAllowance` mapping for UX improvement
- Added nonce to Transfer event for off-chain tracking
- Added explicit zero-balance handling

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint128, ebool, InEuint128} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

contract FHERC6909 {
    // ============ Events ============

    event Transfer(
        address indexed sender,
        address indexed receiver,
        uint256 indexed id,
        uint256 nonce  // Added for off-chain tracking
    );

    event Approval(address indexed owner, address indexed spender, uint256 indexed id);
    event OperatorSet(address indexed owner, address indexed operator, bool approved);

    // ============ State ============

    mapping(address => mapping(uint256 => euint128)) internal _balances;
    mapping(address => mapping(address => mapping(uint256 => euint128))) internal _allowances;
    mapping(address => mapping(address => mapping(uint256 => bool))) public isInfiniteAllowance;
    mapping(address => mapping(address => bool)) public isOperator;

    uint256 public transferNonce;
    euint128 internal immutable ENC_ZERO;

    // ============ Constructor ============

    constructor() {
        ENC_ZERO = FHE.asEuint128(0);
        FHE.allowThis(ENC_ZERO);
    }

    // ============ Balance Queries ============

    function balanceOfEncrypted(address owner, uint256 id) external view returns (euint128) {
        euint128 balance = _balances[owner][id];
        // Return ENC_ZERO if never set (avoids null handle issues)
        if (euint128.unwrap(balance) == 0) {
            return ENC_ZERO;
        }
        return balance;
    }

    // ============ Transfers ============

    function transferEncrypted(
        address receiver,
        uint256 id,
        InEuint128 calldata amount
    ) external returns (bool) {
        euint128 amt = FHE.asEuint128(amount);
        _transfer(msg.sender, receiver, id, amt);
        return true;
    }

    function transferFromEncrypted(
        address sender,
        address receiver,
        uint256 id,
        InEuint128 calldata amount
    ) external returns (bool) {
        euint128 amt = FHE.asEuint128(amount);
        _spendAllowance(sender, msg.sender, id, amt);
        _transfer(sender, receiver, id, amt);
        return true;
    }

    function transferFromEncryptedDirect(
        address sender,
        address receiver,
        uint256 id,
        euint128 amount
    ) external returns (bool) {
        if (!isOperator[sender][msg.sender]) {
            _spendAllowance(sender, msg.sender, id, amount);
        }
        _transfer(sender, receiver, id, amount);
        return true;
    }

    // ============ Approvals ============

    function approveEncrypted(
        address spender,
        uint256 id,
        InEuint128 calldata amount
    ) external returns (bool) {
        euint128 amt = FHE.asEuint128(amount);
        _allowances[msg.sender][spender][id] = amt;
        isInfiniteAllowance[msg.sender][spender][id] = false;

        FHE.allowThis(amt);
        FHE.allow(amt, msg.sender);
        FHE.allow(amt, spender);

        emit Approval(msg.sender, spender, id);
        return true;
    }

    /// @notice Approve infinite allowance (never decrements)
    function approveInfinite(address spender, uint256 id) external returns (bool) {
        isInfiniteAllowance[msg.sender][spender][id] = true;
        emit Approval(msg.sender, spender, id);
        return true;
    }

    function allowanceEncrypted(
        address owner,
        address spender,
        uint256 id
    ) external view returns (euint128) {
        return _allowances[owner][spender][id];
    }

    // ============ Operators ============

    function setOperator(address operator, bool approved) external returns (bool) {
        isOperator[msg.sender][operator] = approved;
        emit OperatorSet(msg.sender, operator, approved);
        return true;
    }

    // ============ Internal ============

    function _transfer(
        address sender,
        address receiver,
        uint256 id,
        euint128 amount
    ) internal {
        require(receiver != address(0), "Transfer to zero address");

        // Subtract from sender
        _balances[sender][id] = FHE.sub(_balances[sender][id], amount);
        FHE.allowThis(_balances[sender][id]);
        FHE.allow(_balances[sender][id], sender);

        // Add to receiver
        _balances[receiver][id] = FHE.add(_balances[receiver][id], amount);
        FHE.allowThis(_balances[receiver][id]);
        FHE.allow(_balances[receiver][id], receiver);

        unchecked {
            transferNonce++;
        }
        emit Transfer(sender, receiver, id, transferNonce);
    }

    function _spendAllowance(
        address owner,
        address spender,
        uint256 id,
        euint128 amount
    ) internal {
        // Skip if infinite allowance
        if (isInfiniteAllowance[owner][spender][id]) {
            return;
        }

        euint128 currentAllowance = _allowances[owner][spender][id];
        _allowances[owner][spender][id] = FHE.sub(currentAllowance, amount);

        FHE.allowThis(_allowances[owner][spender][id]);
        FHE.allow(_allowances[owner][spender][id], owner);
        FHE.allow(_allowances[owner][spender][id], spender);
    }

    function _mint(address to, uint256 id, euint128 amount) internal {
        _balances[to][id] = FHE.add(_balances[to][id], amount);
        FHE.allowThis(_balances[to][id]);
        FHE.allow(_balances[to][id], to);

        unchecked {
            transferNonce++;
        }
        emit Transfer(address(0), to, id, transferNonce);
    }

    function _burn(address from, uint256 id, euint128 amount) internal {
        _balances[from][id] = FHE.sub(_balances[from][id], amount);
        FHE.allowThis(_balances[from][id]);
        FHE.allow(_balances[from][id], from);

        unchecked {
            transferNonce++;
        }
        emit Transfer(from, address(0), id, transferNonce);
    }
}
```

---

## PheatherX v3 Contract

### Constants and Modifiers

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint128, ebool, InEuint128, InEbool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IFHERC20} from "./tokens/IFHERC20.sol";
import {TickBitmap} from "./lib/TickBitmap.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PheatherXv3 is ReentrancyGuard {
    using TickBitmap for TickBitmap.State;

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant MAX_BUCKETS_PER_SWAP = 5;
    int24 public constant TICK_SPACING = 60;

    // Pre-computed encrypted constants
    euint128 internal immutable ENC_ZERO;
    euint128 internal immutable ENC_PRECISION;

    // ============ Tokens ============

    IFHERC20 public immutable token0;
    IFHERC20 public immutable token1;

    // ============ Events ============

    event Deposit(address indexed user, int24 indexed tick, BucketSide indexed side);
    event Withdraw(address indexed user, int24 indexed tick, BucketSide indexed side);
    event Claim(address indexed user, int24 indexed tick, BucketSide indexed side);
    event Swap(address indexed user, bool zeroForOne, uint256 amountIn, uint256 amountOut);
    event BucketFilled(int24 indexed tick, BucketSide indexed side);
```

### Deposit Function (with Auto-Claim)

```solidity
/// @notice Deposit tokens into a price bucket
/// @param tick The price tick for this bucket
/// @param amount Encrypted amount to deposit
/// @param side BucketSide.SELL to sell token0 at this price, BucketSide.BUY to buy token0
/// @param deadline Transaction deadline timestamp
/// @param maxTickDrift Maximum allowed tick drift from target
function deposit(
    int24 tick,
    InEuint128 calldata amount,
    BucketSide side,
    uint256 deadline,
    int24 maxTickDrift
) external nonReentrant returns (euint128 shares) {
    require(block.timestamp <= deadline, "Expired");
    require(tick % TICK_SPACING == 0, "Invalid tick");

    int24 currentTick = _getCurrentTick();
    require(_abs(currentTick - tick) <= maxTickDrift, "Price moved");

    euint128 amt = FHE.asEuint128(amount);

    // Transfer input token based on side
    if (side == BucketSide.SELL) {
        token0.transferFromEncryptedDirect(msg.sender, address(this), amt);
    } else {
        token1.transferFromEncryptedDirect(msg.sender, address(this), amt);
    }

    Bucket storage bucket = buckets[tick][side];
    UserPosition storage pos = positions[msg.sender][tick][side];

    // AUTO-CLAIM: If user has existing position, claim proceeds first
    ebool hasExisting = FHE.gt(pos.shares, ENC_ZERO);
    euint128 existingProceeds = _calculateProceeds(pos, bucket);

    // Add existing proceeds to pending (will be zero if no existing position)
    pos.pendingProceeds = FHE.add(pos.pendingProceeds, existingProceeds);
    FHE.allowThis(pos.pendingProceeds);
    FHE.allow(pos.pendingProceeds, msg.sender);

    // Initialize bucket if needed
    TickBitmap.State storage bitmap = (side == BucketSide.SELL) ? sellBitmap : buyBitmap;
    if (!bitmap.isSet(tick)) {
        bitmap.setTick(tick);
        bucket.initialized = true;
        bucket.proceedsPerShare = ENC_ZERO;
        bucket.filledPerShare = ENC_ZERO;
        bucket.totalShares = ENC_ZERO;
        bucket.liquidity = ENC_ZERO;
        FHE.allowThis(bucket.proceedsPerShare);
        FHE.allowThis(bucket.filledPerShare);
        FHE.allowThis(bucket.totalShares);
        FHE.allowThis(bucket.liquidity);
    }

    // Update bucket state
    bucket.totalShares = FHE.add(bucket.totalShares, amt);
    bucket.liquidity = FHE.add(bucket.liquidity, amt);
    FHE.allowThis(bucket.totalShares);
    FHE.allowThis(bucket.liquidity);

    // Update user position with fresh snapshot
    pos.shares = FHE.add(pos.shares, amt);
    pos.proceedsPerShareSnapshot = bucket.proceedsPerShare;
    pos.filledPerShareSnapshot = bucket.filledPerShare;

    FHE.allowThis(pos.shares);
    FHE.allow(pos.shares, msg.sender);
    FHE.allowThis(pos.proceedsPerShareSnapshot);
    FHE.allow(pos.proceedsPerShareSnapshot, msg.sender);
    FHE.allowThis(pos.filledPerShareSnapshot);
    FHE.allow(pos.filledPerShareSnapshot, msg.sender);

    shares = amt;
    emit Deposit(msg.sender, tick, side);
}
```

### Swap Function (Fills Buckets)

```solidity
/// @notice Execute swap, filling buckets as price crosses
/// @param zeroForOne True to sell token0 for token1
/// @param amountIn Amount of input token
/// @param minAmountOut Minimum acceptable output (slippage protection)
function swap(
    bool zeroForOne,
    uint256 amountIn,
    uint256 minAmountOut
) external nonReentrant returns (uint256 amountOut) {
    // Take input tokens
    IFHERC20 tokenIn = zeroForOne ? token0 : token1;
    tokenIn.transferFrom(msg.sender, address(this), amountIn);

    euint128 remainingInput = FHE.asEuint128(uint128(amountIn));
    euint128 totalOutput = ENC_ZERO;

    int24 currentTick = _getCurrentTick();

    // Select correct bitmap and bucket side
    // zeroForOne (selling token0) → fills BUY buckets (people wanting to buy token0)
    // !zeroForOne (selling token1) → fills SELL buckets (people wanting to sell token0 for token1)
    TickBitmap.State storage bitmap = zeroForOne ? buyBitmap : sellBitmap;
    BucketSide side = zeroForOne ? BucketSide.BUY : BucketSide.SELL;

    uint256 bucketsProcessed = 0;

    while (bucketsProcessed < MAX_BUCKETS_PER_SWAP) {
        // Find next bucket with liquidity
        int24 nextTick = _findNextTick(bitmap, currentTick, zeroForOne);
        if (nextTick == type(int24).max || nextTick == type(int24).min) break;

        Bucket storage bucket = buckets[nextTick][side];

        // Check if bucket has liquidity (constant-time)
        ebool hasLiquidity = FHE.gt(bucket.liquidity, ENC_ZERO);

        // Calculate maximum fill value at this tick's price
        uint256 tickPrice = _getTickPriceScaled(nextTick);

        // bucketValueInInput = bucket.liquidity * price (for sell buckets)
        // or bucketValueInInput = bucket.liquidity / price (for buy buckets)
        euint128 bucketValueInInput;
        if (zeroForOne) {
            // Buying from BUY bucket: they have token1, want token0
            // Value in token0 terms = liquidity (which is token1) / price
            bucketValueInInput = _divPrecision(bucket.liquidity, tickPrice);
        } else {
            // Buying from SELL bucket: they have token0, want token1
            // Value in token1 terms = liquidity (token0) * price
            bucketValueInInput = _mulPrecision(bucket.liquidity, tickPrice);
        }

        // Fill amount is min(remaining, bucket capacity)
        euint128 fillValueInInput = FHE.min(remainingInput, bucketValueInInput);

        // Apply fill only if bucket has liquidity (constant-time using select)
        fillValueInInput = FHE.select(hasLiquidity, fillValueInInput, ENC_ZERO);

        // Calculate fill amount in bucket's native token
        euint128 fillAmountNative;
        euint128 outputAmount;

        if (zeroForOne) {
            // Input is token0, bucket has token1
            // fillAmountNative (token1) = fillValueInInput (token0) * price
            fillAmountNative = _mulPrecision(fillValueInInput, tickPrice);
            outputAmount = fillAmountNative;
        } else {
            // Input is token1, bucket has token0
            // fillAmountNative (token0) = fillValueInInput (token1) / price
            fillAmountNative = _divPrecision(fillValueInInput, tickPrice);
            outputAmount = fillAmountNative;
        }

        // Update bucket accumulators
        _updateBucketOnFill(bucket, fillAmountNative, fillValueInInput);

        // Update running totals
        remainingInput = FHE.sub(remainingInput, fillValueInInput);
        totalOutput = FHE.add(totalOutput, outputAmount);

        currentTick = nextTick;
        bucketsProcessed++;

        emit BucketFilled(nextTick, side);
    }

    // Estimate output for slippage check (from public reserves)
    amountOut = _estimateOutput(zeroForOne, amountIn, bucketsProcessed);
    require(amountOut >= minAmountOut, "Slippage exceeded");

    // Transfer output
    IFHERC20 tokenOut = zeroForOne ? token1 : token0;
    tokenOut.transfer(msg.sender, amountOut);

    // Refund unused input if any
    uint256 usedInput = amountIn; // In production: decrypt remainingInput async
    if (usedInput < amountIn) {
        tokenIn.transfer(msg.sender, amountIn - usedInput);
    }

    emit Swap(msg.sender, zeroForOne, amountIn, amountOut);
}

/// @dev Update bucket state when filled
function _updateBucketOnFill(
    Bucket storage bucket,
    euint128 fillAmount,      // Amount of bucket's token consumed
    euint128 proceedsAmount   // Amount of other token received (swapper's input)
) internal {
    // Update liquidity
    bucket.liquidity = FHE.sub(bucket.liquidity, fillAmount);
    FHE.allowThis(bucket.liquidity);

    // Update proceeds per share: proceedsPerShare += proceeds / totalShares
    // proceedsAmount is scaled by PRECISION during calculation
    euint128 proceedsPerShareIncrease = FHE.div(
        FHE.mul(proceedsAmount, ENC_PRECISION),
        bucket.totalShares
    );
    bucket.proceedsPerShare = FHE.add(bucket.proceedsPerShare, proceedsPerShareIncrease);
    FHE.allowThis(bucket.proceedsPerShare);

    // Update filled per share: filledPerShare += filled / totalShares
    euint128 filledPerShareIncrease = FHE.div(
        FHE.mul(fillAmount, ENC_PRECISION),
        bucket.totalShares
    );
    bucket.filledPerShare = FHE.add(bucket.filledPerShare, filledPerShareIncrease);
    FHE.allowThis(bucket.filledPerShare);
}
```

### Claim Function

```solidity
/// @notice Claim filled proceeds from a bucket position
/// @param tick The bucket tick
/// @param side The bucket side (BUY or SELL)
/// @return proceeds The encrypted amount of output tokens claimed
function claim(
    int24 tick,
    BucketSide side
) external nonReentrant returns (euint128 proceeds) {
    UserPosition storage pos = positions[msg.sender][tick][side];
    Bucket storage bucket = buckets[tick][side];

    // Calculate claimable proceeds
    proceeds = _calculateProceeds(pos, bucket);

    // Add any pending proceeds from auto-claim during deposit
    proceeds = FHE.add(proceeds, pos.pendingProceeds);

    // Reset pending
    pos.pendingProceeds = ENC_ZERO;
    FHE.allowThis(pos.pendingProceeds);
    FHE.allow(pos.pendingProceeds, msg.sender);

    // Update snapshot to current (prevents double-claim)
    pos.proceedsPerShareSnapshot = bucket.proceedsPerShare;
    pos.filledPerShareSnapshot = bucket.filledPerShare;

    FHE.allowThis(pos.proceedsPerShareSnapshot);
    FHE.allow(pos.proceedsPerShareSnapshot, msg.sender);
    FHE.allowThis(pos.filledPerShareSnapshot);
    FHE.allow(pos.filledPerShareSnapshot, msg.sender);

    // Transfer proceeds (opposite token to what was deposited)
    IFHERC20 proceedsToken = (side == BucketSide.SELL) ? token1 : token0;
    proceedsToken.transferEncryptedDirect(address(this), msg.sender, proceeds);

    emit Claim(msg.sender, tick, side);
}

/// @dev Calculate proceeds for a position
function _calculateProceeds(
    UserPosition storage pos,
    Bucket storage bucket
) internal view returns (euint128) {
    // proceeds = shares * (currentProceedsPerShare - snapshotProceedsPerShare) / PRECISION
    euint128 proceedsPerShareDelta = FHE.sub(
        bucket.proceedsPerShare,
        pos.proceedsPerShareSnapshot
    );

    euint128 grossProceeds = FHE.mul(pos.shares, proceedsPerShareDelta);
    return FHE.div(grossProceeds, ENC_PRECISION);
}
```

### Withdraw Function

```solidity
/// @notice Withdraw unfilled liquidity from a bucket
/// @param tick The bucket tick
/// @param side The bucket side
/// @param amount Encrypted amount to withdraw
function withdraw(
    int24 tick,
    BucketSide side,
    InEuint128 calldata amount
) external nonReentrant returns (euint128 withdrawn) {
    euint128 amt = FHE.asEuint128(amount);
    UserPosition storage pos = positions[msg.sender][tick][side];
    Bucket storage bucket = buckets[tick][side];

    // Calculate user's unfilled shares
    euint128 userUnfilled = _calculateUnfilled(pos, bucket);

    // Can only withdraw up to unfilled amount
    withdrawn = FHE.min(amt, userUnfilled);

    // Update user position
    pos.shares = FHE.sub(pos.shares, withdrawn);
    FHE.allowThis(pos.shares);
    FHE.allow(pos.shares, msg.sender);

    // Update bucket
    bucket.totalShares = FHE.sub(bucket.totalShares, withdrawn);
    bucket.liquidity = FHE.sub(bucket.liquidity, withdrawn);
    FHE.allowThis(bucket.totalShares);
    FHE.allowThis(bucket.liquidity);

    // Return tokens (same token they deposited)
    IFHERC20 depositToken = (side == BucketSide.SELL) ? token0 : token1;
    depositToken.transferEncryptedDirect(address(this), msg.sender, withdrawn);

    emit Withdraw(msg.sender, tick, side);
}

/// @dev Calculate unfilled portion of user's position
function _calculateUnfilled(
    UserPosition storage pos,
    Bucket storage bucket
) internal view returns (euint128) {
    // userFilled = shares * (currentFilledPerShare - snapshotFilledPerShare) / PRECISION
    euint128 filledPerShareDelta = FHE.sub(
        bucket.filledPerShare,
        pos.filledPerShareSnapshot
    );

    euint128 userFilled = FHE.div(
        FHE.mul(pos.shares, filledPerShareDelta),
        ENC_PRECISION
    );

    // Unfilled = shares - filled (capped at 0)
    // Use select to prevent underflow if filled > shares due to rounding
    ebool hasUnfilled = FHE.gte(pos.shares, userFilled);
    euint128 unfilled = FHE.sub(pos.shares, userFilled);
    return FHE.select(hasUnfilled, unfilled, ENC_ZERO);
}
```

### Exit Function (Unified)

```solidity
/// @notice Exit entire position: withdraw unfilled + claim proceeds
/// @param tick The bucket tick
/// @param side The bucket side
function exit(
    int24 tick,
    BucketSide side
) external nonReentrant returns (euint128 unfilled, euint128 proceeds) {
    UserPosition storage pos = positions[msg.sender][tick][side];
    Bucket storage bucket = buckets[tick][side];

    // Calculate both values ONCE (avoids double-read and reentrancy issues)
    unfilled = _calculateUnfilled(pos, bucket);
    proceeds = _calculateProceeds(pos, bucket);
    proceeds = FHE.add(proceeds, pos.pendingProceeds);

    // Update bucket state
    bucket.totalShares = FHE.sub(bucket.totalShares, pos.shares);
    bucket.liquidity = FHE.sub(bucket.liquidity, unfilled);
    FHE.allowThis(bucket.totalShares);
    FHE.allowThis(bucket.liquidity);

    // Clear user position
    pos.shares = ENC_ZERO;
    pos.pendingProceeds = ENC_ZERO;
    pos.proceedsPerShareSnapshot = bucket.proceedsPerShare;
    pos.filledPerShareSnapshot = bucket.filledPerShare;

    FHE.allowThis(pos.shares);
    FHE.allow(pos.shares, msg.sender);
    FHE.allowThis(pos.pendingProceeds);
    FHE.allow(pos.pendingProceeds, msg.sender);

    // Transfer both unfilled (deposit token) and proceeds (other token)
    IFHERC20 depositToken = (side == BucketSide.SELL) ? token0 : token1;
    IFHERC20 proceedsToken = (side == BucketSide.SELL) ? token1 : token0;

    depositToken.transferEncryptedDirect(address(this), msg.sender, unfilled);
    proceedsToken.transferEncryptedDirect(address(this), msg.sender, proceeds);

    emit Withdraw(msg.sender, tick, side);
    emit Claim(msg.sender, tick, side);
}
```

### View Functions

```solidity
/// @notice Get user's claimable proceeds (for UI)
function getClaimable(
    address user,
    int24 tick,
    BucketSide side
) external view returns (euint128) {
    UserPosition storage pos = positions[user][tick][side];
    Bucket storage bucket = buckets[tick][side];

    euint128 calculated = _calculateProceeds(pos, bucket);
    return FHE.add(calculated, pos.pendingProceeds);
}

/// @notice Get user's withdrawable unfilled amount
function getWithdrawable(
    address user,
    int24 tick,
    BucketSide side
) external view returns (euint128) {
    UserPosition storage pos = positions[user][tick][side];
    Bucket storage bucket = buckets[tick][side];

    return _calculateUnfilled(pos, bucket);
}

/// @notice Get bucket state
function getBucket(
    int24 tick,
    BucketSide side
) external view returns (
    euint128 totalShares,
    euint128 liquidity,
    euint128 proceedsPerShare,
    euint128 filledPerShare,
    bool initialized
) {
    Bucket storage bucket = buckets[tick][side];
    return (
        bucket.totalShares,
        bucket.liquidity,
        bucket.proceedsPerShare,
        bucket.filledPerShare,
        bucket.initialized
    );
}
```

### Price Math Helpers

```solidity
/// @dev Get tick price scaled by PRECISION
/// @param tick The tick value
/// @return price Price scaled by 1e18
function _getTickPriceScaled(int24 tick) internal pure returns (uint256) {
    // price = 1.0001^tick
    // For efficiency, use a lookup table for common ticks
    // This is a simplified version - production should use proper math

    if (tick == 0) return PRECISION;

    // Approximate: price ≈ PRECISION * (1 + tick * 0.0001)
    // More accurate: use pre-computed values or Taylor series

    int256 tickInt = int256(tick);
    if (tickInt > 0) {
        // price > 1
        return PRECISION + uint256(tickInt) * PRECISION / 10000;
    } else {
        // price < 1
        return PRECISION - uint256(-tickInt) * PRECISION / 10000;
    }
}

/// @dev Multiply by price (scaled)
function _mulPrecision(euint128 amount, uint256 priceScaled) internal view returns (euint128) {
    return FHE.div(
        FHE.mul(amount, FHE.asEuint128(priceScaled)),
        ENC_PRECISION
    );
}

/// @dev Divide by price (scaled)
function _divPrecision(euint128 amount, uint256 priceScaled) internal view returns (euint128) {
    return FHE.div(
        FHE.mul(amount, ENC_PRECISION),
        FHE.asEuint128(priceScaled)
    );
}

/// @dev Absolute value of tick difference
function _abs(int24 x) internal pure returns (int24) {
    return x >= 0 ? x : -x;
}
```

---

## Key Invariants

The following invariants must hold at all times:

```solidity
// 1. Total shares consistency
// sum(positions[*][tick][side].shares) == buckets[tick][side].totalShares

// 2. Liquidity bounds
// bucket.liquidity <= bucket.totalShares (can't have more liquidity than shares)

// 3. No over-claim
// For any user: totalClaimed <= entitled proceeds based on their share proportion

// 4. Late depositor protection
// User depositing after a fill cannot claim proceeds from that fill

// 5. Fill accounting
// sum(all fills) == initial_liquidity - current_liquidity
```

---

## Test Plan Updates

### New Tests for v2 Changes

```solidity
// Test auto-claim on deposit
function testAutoClaimOnSecondDeposit() public {
    // Alice deposits 10
    // Bucket fills 5 (50%)
    // Alice deposits 5 more
    // Alice should have pending proceeds from first 5
    // Alice's new snapshot should be current
}

// Test separate buy/sell buckets
function testSeparateBuySellBuckets() public {
    // Alice deposits into SELL bucket at tick 60
    // Bob deposits into BUY bucket at tick 60
    // Verify they are separate
    // Verify correct token flows
}

// Test proceeds per share accuracy
function testProceedsPerShareMultiUser() public {
    // Alice deposits 10
    // Bob deposits 5
    // Bucket fills 9
    // Alice claims → gets 6 (10/15 of 9)
    // Bob claims → gets 3 (5/15 of 9)
}

// Test infinite allowance
function testInfiniteAllowance() public {
    // Set infinite allowance
    // Multiple transfers
    // Verify allowance not decremented
}

// Test reentrancy protection
function testReentrancyProtection() public {
    // Attempt reentrant call
    // Verify revert
}
```

---

## Open Questions Resolved

| Question | Resolution |
|----------|------------|
| Tick spacing | 60 (same as v2) |
| Buy vs Sell buckets | Separate mappings with BucketSide enum |
| Price representation | Fixed-point with 1e18 scaling |
| Executor incentives | Swapper gets output, no extra reward |
| Partial fills | Handled by proceedsPerShare accumulator |

---

## Files to Create

| File | Description |
|------|-------------|
| `src/tokens/IFHERC6909.sol` | Interface |
| `src/tokens/FHERC6909.sol` | Implementation (updated) |
| `src/PheatherXv3.sol` | Main contract |
| `src/interface/IPheatherXv3.sol` | Interface |
| `src/lib/TickBitmap.sol` | Reuse from v2 |
| `test/FHERC6909.t.sol` | Token tests |
| `test/PheatherXv3.t.sol` | Hook tests |
| `script/DeployPheatherXv3.s.sol` | Deployment |
