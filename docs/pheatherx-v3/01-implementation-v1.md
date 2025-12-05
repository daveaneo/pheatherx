# PheatherX v3 Implementation Plan

> **Status:** NOT IMPLEMENTED - Design Document
>
> This document describes the planned v3 architecture with bucketed liquidity and FHERC-6909 position tokens. PheatherX v2 (individual orders) is the current implementation.

---

## Executive Summary

PheatherX v3 replaces individual limit orders with **bucketed liquidity pools** and **encrypted position tokens (FHERC-6909)**. This architectural change achieves O(1) gas scaling per bucket regardless of user count, solving the fundamental FHE gas bottleneck.

| Version | Architecture | Gas per Tick Cross | Privacy |
|---------|--------------|-------------------|---------|
| v2 | Individual orders | O(n) per order | Full |
| v3 | Bucketed liquidity | O(1) per bucket | Full |

---

## Core Architectural Changes

### From Individual Orders to Buckets

**v2 (Current):**
```
Alice places order: "Sell 10 ETH at tick 60"
Bob places order: "Sell 5 ETH at tick 60"
→ Two separate orders, each processed individually
→ Gas scales linearly with order count
```

**v3 (Proposed):**
```
Alice deposits: 10 ETH into tick-60 bucket
Bob deposits: 5 ETH into tick-60 bucket
→ One shared bucket with 15 ETH encrypted liquidity
→ Gas is constant regardless of depositor count
```

### The Claim System

When a bucket fills, proceeds are distributed pro-rata via a claim mechanism:

1. **On Deposit:** Record user's entry snapshot of cumulative fills
2. **On Swap:** Update global bucket accumulators (no per-user state touched)
3. **On Claim:** Calculate user's share based on (current - entry) fills

This separates swap gas (paid by swapper, O(1)) from distribution gas (paid by claimer, O(1) per claim).

---

## FHERC-6909: Encrypted Multi-Token Standard

### Overview

FHERC-6909 is the encrypted version of ERC-6909 (Minimal Multi-Token Interface). It provides encrypted position tracking across multiple token IDs (buckets/ticks).

### Why FHERC-6909?

| Standard | Gas | Privacy | Use Case |
|----------|-----|---------|----------|
| ERC-1155 | High | None | NFTs, gaming |
| ERC-6909 | Low | None | DeFi accounting (Uniswap v4) |
| FHERC-6909 | Low | Full | Private DeFi positions |

### Interface

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {euint128, ebool, InEuint128, InEbool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

interface IFHERC6909 {
    // ============ Events ============

    /// @notice Emitted on any transfer (amount is encrypted, not logged)
    event Transfer(
        address indexed sender,
        address indexed receiver,
        uint256 indexed id
    );

    /// @notice Emitted on approval change
    event Approval(
        address indexed owner,
        address indexed spender,
        uint256 indexed id
    );

    /// @notice Emitted on operator status change
    event OperatorSet(
        address indexed owner,
        address indexed operator,
        bool approved
    );

    // ============ Encrypted Balance Queries ============

    /// @notice Get encrypted balance for owner and token ID
    /// @dev Only owner can decrypt the result
    function balanceOfEncrypted(
        address owner,
        uint256 id
    ) external view returns (euint128);

    // ============ Encrypted Transfers ============

    /// @notice Transfer encrypted amount to receiver
    function transferEncrypted(
        address receiver,
        uint256 id,
        InEuint128 calldata amount
    ) external returns (bool);

    /// @notice Transfer encrypted amount from sender to receiver (requires allowance)
    function transferFromEncrypted(
        address sender,
        address receiver,
        uint256 id,
        InEuint128 calldata amount
    ) external returns (bool);

    /// @notice Transfer using already-converted euint128 (for contract-to-contract)
    function transferFromEncryptedDirect(
        address sender,
        address receiver,
        uint256 id,
        euint128 amount
    ) external returns (bool);

    // ============ Encrypted Approvals ============

    /// @notice Approve spender for encrypted amount on token ID
    function approveEncrypted(
        address spender,
        uint256 id,
        InEuint128 calldata amount
    ) external returns (bool);

    /// @notice Get encrypted allowance
    function allowanceEncrypted(
        address owner,
        address spender,
        uint256 id
    ) external view returns (euint128);

    // ============ Operators (Plaintext - No Amount) ============

    /// @notice Set operator status (can transfer any amount of any ID)
    function setOperator(
        address operator,
        bool approved
    ) external returns (bool);

    /// @notice Check if operator is approved
    function isOperator(
        address owner,
        address operator
    ) external view returns (bool);
}
```

### Implementation

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint128, ebool, InEuint128} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IFHERC6909} from "./IFHERC6909.sol";

contract FHERC6909 is IFHERC6909 {
    // ============ State ============

    /// @notice Encrypted balances: owner => id => encrypted balance
    mapping(address => mapping(uint256 => euint128)) internal _balances;

    /// @notice Encrypted allowances: owner => spender => id => encrypted allowance
    mapping(address => mapping(address => mapping(uint256 => euint128))) internal _allowances;

    /// @notice Operator approvals: owner => operator => approved
    mapping(address => mapping(address => bool)) public isOperator;

    /// @notice Encrypted zero constant
    euint128 internal immutable ENC_ZERO;

    // ============ Constructor ============

    constructor() {
        ENC_ZERO = FHE.asEuint128(0);
        FHE.allowThis(ENC_ZERO);
    }

    // ============ Balance Queries ============

    function balanceOfEncrypted(
        address owner,
        uint256 id
    ) external view returns (euint128) {
        return _balances[owner][id];
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

        FHE.allowThis(amt);
        FHE.allow(amt, msg.sender);
        FHE.allow(amt, spender);

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

    function setOperator(
        address operator,
        bool approved
    ) external returns (bool) {
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
        // Subtract from sender
        _balances[sender][id] = FHE.sub(_balances[sender][id], amount);
        FHE.allowThis(_balances[sender][id]);
        FHE.allow(_balances[sender][id], sender);

        // Add to receiver
        _balances[receiver][id] = FHE.add(_balances[receiver][id], amount);
        FHE.allowThis(_balances[receiver][id]);
        FHE.allow(_balances[receiver][id], receiver);

        emit Transfer(sender, receiver, id);
    }

    function _spendAllowance(
        address owner,
        address spender,
        uint256 id,
        euint128 amount
    ) internal {
        euint128 currentAllowance = _allowances[owner][spender][id];
        _allowances[owner][spender][id] = FHE.sub(currentAllowance, amount);

        FHE.allowThis(_allowances[owner][spender][id]);
        FHE.allow(_allowances[owner][spender][id], owner);
        FHE.allow(_allowances[owner][spender][id], spender);
    }

    function _mint(
        address to,
        uint256 id,
        euint128 amount
    ) internal {
        _balances[to][id] = FHE.add(_balances[to][id], amount);
        FHE.allowThis(_balances[to][id]);
        FHE.allow(_balances[to][id], to);

        emit Transfer(address(0), to, id);
    }

    function _burn(
        address from,
        uint256 id,
        euint128 amount
    ) internal {
        _balances[from][id] = FHE.sub(_balances[from][id], amount);
        FHE.allowThis(_balances[from][id]);
        FHE.allow(_balances[from][id], from);

        emit Transfer(from, address(0), id);
    }
}
```

---

## PheatherX v3 Contract Design

### Bucket State

```solidity
struct Bucket {
    euint128 liquidity;           // Total encrypted liquidity in bucket
    euint128 cumulativeFilled;    // Running total of fills (for pro-rata calc)
    euint128 cumulativeProceeds;  // Running total of output tokens received
    bool initialized;             // Whether bucket has any liquidity
}

struct UserPosition {
    euint128 shares;              // User's share of bucket (= deposit amount)
    euint128 entryFilled;         // cumulativeFilled at deposit time
    euint128 entryProceeds;       // cumulativeProceeds at deposit time
    euint128 claimedProceeds;     // What user has claimed so far
}

// Bucket state per tick
mapping(int24 => Bucket) public buckets;

// User positions: user => tick => position
mapping(address => mapping(int24 => UserPosition)) public positions;
```

### Core Functions

#### Deposit into Bucket

```solidity
/// @notice Deposit tokens into a price bucket
/// @param tick The price tick for this bucket
/// @param amount Encrypted amount to deposit
/// @param isSell True if depositing token0 (sell orders), false for token1 (buy orders)
function deposit(
    int24 tick,
    InEuint128 calldata amount,
    InEbool calldata isSell
) external returns (euint128 shares) {
    euint128 amt = FHE.asEuint128(amount);
    ebool sell = FHE.asEbool(isSell);

    // Transfer input token from user
    euint128 token0Amt = FHE.select(sell, amt, ENC_ZERO);
    euint128 token1Amt = FHE.select(sell, ENC_ZERO, amt);

    fheToken0.transferFromEncryptedDirect(msg.sender, address(this), token0Amt);
    fheToken1.transferFromEncryptedDirect(msg.sender, address(this), token1Amt);

    // Update bucket
    Bucket storage bucket = buckets[tick];
    bucket.liquidity = FHE.add(bucket.liquidity, amt);
    FHE.allowThis(bucket.liquidity);

    if (!bucket.initialized) {
        bucket.initialized = true;
        tickBitmap.setTick(tick);
    }

    // Record user position
    UserPosition storage pos = positions[msg.sender][tick];
    pos.shares = FHE.add(pos.shares, amt);
    pos.entryFilled = bucket.cumulativeFilled;
    pos.entryProceeds = bucket.cumulativeProceeds;

    FHE.allowThis(pos.shares);
    FHE.allow(pos.shares, msg.sender);
    FHE.allowThis(pos.entryFilled);
    FHE.allow(pos.entryFilled, msg.sender);
    FHE.allowThis(pos.entryProceeds);
    FHE.allow(pos.entryProceeds, msg.sender);

    shares = amt; // 1:1 shares for simplicity
}
```

#### Swap (Fills Buckets)

```solidity
/// @notice Execute swap, filling buckets as price crosses
/// @dev O(1) per bucket regardless of depositor count
function swap(
    bool zeroForOne,
    uint256 amountIn,
    uint256 minAmountOut
) external returns (uint256 amountOut) {
    // ... standard swap setup ...

    euint128 remainingInput = FHE.asEuint128(uint128(amountIn));
    euint128 totalOutput = ENC_ZERO;

    int24 currentTick = _getCurrentTick();
    uint256 bucketsProcessed = 0;

    // Process buckets in price order
    while (bucketsProcessed < MAX_BUCKETS_PER_SWAP) {
        int24 nextTick = _findNextBucketTick(currentTick, zeroForOne);
        if (nextTick == type(int24).max) break;

        Bucket storage bucket = buckets[nextTick];

        // Calculate fill amount using FHE.min (branchless)
        euint128 bucketValue = FHE.mul(bucket.liquidity, _getTickPrice(nextTick));
        euint128 fillValue = FHE.min(remainingInput, bucketValue);

        // Calculate output (constant sum: output = fillValue / price)
        // Using multiplication by inverse for gas efficiency
        euint128 fillAmount = FHE.mul(fillValue, _getTickPriceInverse(nextTick));
        euint128 output = fillValue; // 1:1 for simplicity, adjust for actual price

        // Update bucket accumulators (O(1) - no per-user iteration!)
        bucket.liquidity = FHE.sub(bucket.liquidity, fillAmount);
        bucket.cumulativeFilled = FHE.add(bucket.cumulativeFilled, fillAmount);
        bucket.cumulativeProceeds = FHE.add(bucket.cumulativeProceeds, output);

        FHE.allowThis(bucket.liquidity);
        FHE.allowThis(bucket.cumulativeFilled);
        FHE.allowThis(bucket.cumulativeProceeds);

        // Update remaining input
        remainingInput = FHE.sub(remainingInput, fillValue);
        totalOutput = FHE.add(totalOutput, output);

        currentTick = nextTick;
        bucketsProcessed++;
    }

    // ... transfer output, handle remaining input ...
}
```

#### Claim Proceeds

```solidity
/// @notice Claim filled proceeds from a bucket position
/// @param tick The bucket tick
/// @return proceeds The encrypted amount of output tokens claimed
function claim(int24 tick) external returns (euint128 proceeds) {
    UserPosition storage pos = positions[msg.sender][tick];
    Bucket storage bucket = buckets[tick];

    // Calculate user's share of fills since entry
    // userFills = (cumulativeFilled - entryFilled) * shares / totalSharesAtEntry
    // Simplified: shares = deposit amount, so ratio is direct
    euint128 totalFillsSinceEntry = FHE.sub(bucket.cumulativeFilled, pos.entryFilled);
    euint128 totalProceedsSinceEntry = FHE.sub(bucket.cumulativeProceeds, pos.entryProceeds);

    // User's pro-rata share (simplified: assuming shares track 1:1 with deposits)
    // In production: needs totalShares tracking for proper pro-rata
    euint128 userProceeds = totalProceedsSinceEntry; // Simplified for single user

    // Subtract already claimed
    euint128 availableToClaim = FHE.sub(userProceeds, pos.claimedSoFar);

    // Update claimed amount
    pos.claimedSoFar = FHE.add(pos.claimedSoFar, availableToClaim);
    FHE.allowThis(pos.claimedSoFar);
    FHE.allow(pos.claimedSoFar, msg.sender);

    // Transfer proceeds to user
    // Note: Need to determine which token based on bucket direction
    fheToken1.transferEncryptedDirect(msg.sender, availableToClaim);

    proceeds = availableToClaim;
}
```

#### Withdraw Unfilled Liquidity

```solidity
/// @notice Withdraw unfilled liquidity from a bucket
/// @param tick The bucket tick
/// @param amount Encrypted amount to withdraw (must be <= unfilled shares)
function withdraw(
    int24 tick,
    InEuint128 calldata amount
) external returns (euint128 withdrawn) {
    euint128 amt = FHE.asEuint128(amount);
    UserPosition storage pos = positions[msg.sender][tick];
    Bucket storage bucket = buckets[tick];

    // Calculate how much of user's position is unfilled
    euint128 filledShares = FHE.sub(bucket.cumulativeFilled, pos.entryFilled);
    euint128 unfilledShares = FHE.sub(pos.shares, filledShares);

    // Can only withdraw up to unfilled amount
    withdrawn = FHE.min(amt, unfilledShares);

    // Update user position
    pos.shares = FHE.sub(pos.shares, withdrawn);
    FHE.allowThis(pos.shares);
    FHE.allow(pos.shares, msg.sender);

    // Update bucket liquidity
    bucket.liquidity = FHE.sub(bucket.liquidity, withdrawn);
    FHE.allowThis(bucket.liquidity);

    // Return tokens to user
    fheToken0.transferEncryptedDirect(msg.sender, withdrawn);
}
```

#### Exit (Withdraw + Claim Combined)

```solidity
/// @notice Exit entire position: withdraw unfilled + claim proceeds
/// @param tick The bucket tick
function exit(int24 tick) external returns (euint128 unfilled, euint128 proceeds) {
    // Claim all available proceeds first
    proceeds = claim(tick);

    // Then withdraw all unfilled liquidity
    UserPosition storage pos = positions[msg.sender][tick];
    Bucket storage bucket = buckets[tick];

    euint128 filledShares = FHE.sub(bucket.cumulativeFilled, pos.entryFilled);
    unfilled = FHE.sub(pos.shares, filledShares);

    // Update state
    pos.shares = ENC_ZERO;
    bucket.liquidity = FHE.sub(bucket.liquidity, unfilled);

    FHE.allowThis(pos.shares);
    FHE.allowThis(bucket.liquidity);

    // Return unfilled tokens
    fheToken0.transferEncryptedDirect(msg.sender, unfilled);
}
```

---

## Gas Optimizations Retained from v2 Analysis

### 1. Bitwise Shifts for Fees

```solidity
// Instead of: fee = amount * 30 / 10000 (0.3%)
// Use: fee = amount >> 9 (~0.2%, close enough)
euint128 fee = FHE.shr(amount, 9);
```

### 2. Constant Sum Math for Bucket Fills

Buckets execute at fixed prices (the tick boundary), not AMM curves:

```solidity
// Bucket at tick 60 = price 1.0060
// Fill 100 tokens → output = 100 * 1.0060 = 100.60
euint128 output = FHE.mul(fillAmount, tickPrice);
```

No division required.

### 3. Accumulated Transfers

Swap function accumulates outputs, does single transfer at end:

```solidity
euint128 totalOutput = ENC_ZERO;
for (uint i = 0; i < bucketsProcessed; i++) {
    totalOutput = FHE.add(totalOutput, bucketOutput);
}
// Single transfer
fheToken.transferEncryptedDirect(msg.sender, totalOutput);
```

### 4. Hard Bucket Limit

```solidity
uint256 constant MAX_BUCKETS_PER_SWAP = 5;
```

Guarantees bounded gas regardless of price movement.

---

## Test Plan

### FHERC6909 Tests

```solidity
// test/FHERC6909.t.sol

contract FHERC6909Test is Test, CoFheTest {
    FHERC6909 token;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        token = new FHERC6909();
        // Mint initial balances for testing
    }

    // ============ Balance Tests ============

    function testBalanceOfEncryptedReturnsZeroForNewAccount() public {
        euint128 balance = token.balanceOfEncrypted(alice, 1);
        assertEq(mockStorage(euint128.unwrap(balance)), 0);
    }

    function testBalanceOfEncryptedAfterMint() public {
        // Internal mint for testing
        _mintTo(alice, 1, 100 ether);

        euint128 balance = token.balanceOfEncrypted(alice, 1);
        assertEq(mockStorage(euint128.unwrap(balance)), 100 ether);
    }

    // ============ Transfer Tests ============

    function testTransferEncrypted() public {
        _mintTo(alice, 1, 100 ether);

        vm.startPrank(alice);
        InEuint128 memory amount = createInEuint128(uint128(30 ether), alice);
        token.transferEncrypted(bob, 1, amount);
        vm.stopPrank();

        // Check balances
        assertEq(mockStorage(euint128.unwrap(token.balanceOfEncrypted(alice, 1))), 70 ether);
        assertEq(mockStorage(euint128.unwrap(token.balanceOfEncrypted(bob, 1))), 30 ether);
    }

    function testTransferEncryptedInsufficientBalance() public {
        _mintTo(alice, 1, 10 ether);

        vm.startPrank(alice);
        InEuint128 memory amount = createInEuint128(uint128(100 ether), alice);

        // Should underflow (FHE.sub behavior)
        vm.expectRevert();
        token.transferEncrypted(bob, 1, amount);
        vm.stopPrank();
    }

    function testTransferEncryptedMultipleIds() public {
        _mintTo(alice, 1, 100 ether);
        _mintTo(alice, 2, 50 ether);

        vm.startPrank(alice);
        InEuint128 memory amount1 = createInEuint128(uint128(30 ether), alice);
        InEuint128 memory amount2 = createInEuint128(uint128(20 ether), alice);

        token.transferEncrypted(bob, 1, amount1);
        token.transferEncrypted(bob, 2, amount2);
        vm.stopPrank();

        // ID 1 balances
        assertEq(mockStorage(euint128.unwrap(token.balanceOfEncrypted(alice, 1))), 70 ether);
        assertEq(mockStorage(euint128.unwrap(token.balanceOfEncrypted(bob, 1))), 30 ether);

        // ID 2 balances
        assertEq(mockStorage(euint128.unwrap(token.balanceOfEncrypted(alice, 2))), 30 ether);
        assertEq(mockStorage(euint128.unwrap(token.balanceOfEncrypted(bob, 2))), 20 ether);
    }

    // ============ Approval Tests ============

    function testApproveEncrypted() public {
        vm.startPrank(alice);
        InEuint128 memory amount = createInEuint128(uint128(50 ether), alice);
        token.approveEncrypted(bob, 1, amount);
        vm.stopPrank();

        euint128 allowance = token.allowanceEncrypted(alice, bob, 1);
        assertEq(mockStorage(euint128.unwrap(allowance)), 50 ether);
    }

    function testTransferFromEncrypted() public {
        _mintTo(alice, 1, 100 ether);

        // Alice approves Bob
        vm.startPrank(alice);
        InEuint128 memory approval = createInEuint128(uint128(50 ether), alice);
        token.approveEncrypted(bob, 1, approval);
        vm.stopPrank();

        // Bob transfers from Alice to himself
        vm.startPrank(bob);
        InEuint128 memory amount = createInEuint128(uint128(30 ether), bob);
        token.transferFromEncrypted(alice, bob, 1, amount);
        vm.stopPrank();

        // Check balances
        assertEq(mockStorage(euint128.unwrap(token.balanceOfEncrypted(alice, 1))), 70 ether);
        assertEq(mockStorage(euint128.unwrap(token.balanceOfEncrypted(bob, 1))), 30 ether);

        // Check remaining allowance
        euint128 remaining = token.allowanceEncrypted(alice, bob, 1);
        assertEq(mockStorage(euint128.unwrap(remaining)), 20 ether);
    }

    function testTransferFromEncryptedExceedsAllowance() public {
        _mintTo(alice, 1, 100 ether);

        vm.startPrank(alice);
        InEuint128 memory approval = createInEuint128(uint128(10 ether), alice);
        token.approveEncrypted(bob, 1, approval);
        vm.stopPrank();

        vm.startPrank(bob);
        InEuint128 memory amount = createInEuint128(uint128(50 ether), bob);

        vm.expectRevert(); // Allowance underflow
        token.transferFromEncrypted(alice, bob, 1, amount);
        vm.stopPrank();
    }

    // ============ Operator Tests ============

    function testSetOperator() public {
        vm.prank(alice);
        token.setOperator(bob, true);

        assertTrue(token.isOperator(alice, bob));
    }

    function testOperatorCanTransferWithoutAllowance() public {
        _mintTo(alice, 1, 100 ether);

        vm.prank(alice);
        token.setOperator(bob, true);

        vm.startPrank(bob);
        // Bob is operator, doesn't need allowance
        euint128 amount = FHE.asEuint128(30 ether);
        token.transferFromEncryptedDirect(alice, bob, 1, amount);
        vm.stopPrank();

        assertEq(mockStorage(euint128.unwrap(token.balanceOfEncrypted(bob, 1))), 30 ether);
    }

    function testRevokeOperator() public {
        vm.startPrank(alice);
        token.setOperator(bob, true);
        assertTrue(token.isOperator(alice, bob));

        token.setOperator(bob, false);
        assertFalse(token.isOperator(alice, bob));
        vm.stopPrank();
    }
}
```

### PheatherX v3 Tests

```solidity
// test/PheatherXv3.t.sol

contract PheatherXv3Test is Test, CoFheTest {
    PheatherXv3 hook;
    FHERC20FaucetToken token0;
    FHERC20FaucetToken token1;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address swapper = makeAddr("swapper");

    int24 constant TICK_60 = 60;
    int24 constant TICK_120 = 120;

    function setUp() public {
        // Deploy tokens and hook
        // ... similar to v2 setup ...

        // Give users encrypted balances
        token0.mintEncrypted(alice, 1000 ether);
        token1.mintEncrypted(alice, 1000 ether);
        token0.mintEncrypted(bob, 1000 ether);
        token1.mintEncrypted(bob, 1000 ether);
        token0.mintEncrypted(swapper, 1000 ether);
        token1.mintEncrypted(swapper, 1000 ether);
    }

    // ============ Deposit Tests ============

    function testDepositIntoBucket() public {
        vm.startPrank(alice);
        _approveHook(100 ether);

        InEuint128 memory amount = createInEuint128(uint128(10 ether), alice);
        InEbool memory isSell = createInEbool(true, alice); // Selling token0

        euint128 shares = hook.deposit(TICK_60, amount, isSell);
        vm.stopPrank();

        assertEq(mockStorage(euint128.unwrap(shares)), 10 ether);

        // Check bucket has liquidity
        (euint128 liquidity,,) = hook.getBucket(TICK_60);
        assertEq(mockStorage(euint128.unwrap(liquidity)), 10 ether);
    }

    function testMultipleDepositsIntoBucket() public {
        // Alice deposits
        vm.startPrank(alice);
        _approveHook(100 ether);
        InEuint128 memory amount1 = createInEuint128(uint128(10 ether), alice);
        InEbool memory isSell = createInEbool(true, alice);
        hook.deposit(TICK_60, amount1, isSell);
        vm.stopPrank();

        // Bob deposits into same bucket
        vm.startPrank(bob);
        _approveHookAs(bob, 100 ether);
        InEuint128 memory amount2 = createInEuint128(uint128(5 ether), bob);
        InEbool memory isSell2 = createInEbool(true, bob);
        hook.deposit(TICK_60, amount2, isSell2);
        vm.stopPrank();

        // Bucket should have 15 ether total
        (euint128 liquidity,,) = hook.getBucket(TICK_60);
        assertEq(mockStorage(euint128.unwrap(liquidity)), 15 ether);
    }

    // ============ Swap Tests ============

    function testSwapFillsBucket() public {
        // Setup: Alice deposits into bucket
        vm.startPrank(alice);
        _approveHook(100 ether);
        InEuint128 memory amount = createInEuint128(uint128(10 ether), alice);
        InEbool memory isSell = createInEbool(true, alice);
        hook.deposit(TICK_60, amount, isSell);
        vm.stopPrank();

        // Swapper swaps through the bucket
        vm.startPrank(swapper);
        _approveHookAs(swapper, 100 ether);

        uint256 amountOut = hook.swap(true, 5 ether, 0);
        vm.stopPrank();

        assertGt(amountOut, 0, "Should receive output");

        // Check bucket liquidity decreased
        (euint128 liquidity, euint128 filled,) = hook.getBucket(TICK_60);
        assertEq(mockStorage(euint128.unwrap(filled)), 5 ether);
    }

    function testSwapMultipleBuckets() public {
        // Setup: Deposits at multiple ticks
        vm.startPrank(alice);
        _approveHook(100 ether);

        InEuint128 memory amount1 = createInEuint128(uint128(10 ether), alice);
        InEuint128 memory amount2 = createInEuint128(uint128(10 ether), alice);
        InEbool memory isSell = createInEbool(true, alice);

        hook.deposit(TICK_60, amount1, isSell);
        hook.deposit(TICK_120, amount2, isSell);
        vm.stopPrank();

        // Large swap crosses both buckets
        vm.startPrank(swapper);
        _approveHookAs(swapper, 100 ether);

        uint256 amountOut = hook.swap(true, 25 ether, 0);
        vm.stopPrank();

        assertGt(amountOut, 0);
    }

    function testSwapRespectsBucketLimit() public {
        // Setup: Many buckets
        vm.startPrank(alice);
        _approveHook(1000 ether);

        for (int24 tick = 60; tick <= 600; tick += 60) {
            InEuint128 memory amount = createInEuint128(uint128(10 ether), alice);
            InEbool memory isSell = createInEbool(true, alice);
            hook.deposit(tick, amount, isSell);
        }
        vm.stopPrank();

        // Huge swap - should only process MAX_BUCKETS_PER_SWAP
        vm.startPrank(swapper);
        _approveHookAs(swapper, 1000 ether);

        // Should not revert, just process limited buckets
        uint256 amountOut = hook.swap(true, 500 ether, 0);
        vm.stopPrank();

        assertGt(amountOut, 0);
    }

    // ============ Claim Tests ============

    function testClaimAfterFill() public {
        // Alice deposits
        vm.startPrank(alice);
        _approveHook(100 ether);
        InEuint128 memory amount = createInEuint128(uint128(10 ether), alice);
        InEbool memory isSell = createInEbool(true, alice);
        hook.deposit(TICK_60, amount, isSell);
        vm.stopPrank();

        // Swapper fills bucket
        vm.startPrank(swapper);
        _approveHookAs(swapper, 100 ether);
        hook.swap(true, 10 ether, 0);
        vm.stopPrank();

        // Alice claims proceeds
        vm.startPrank(alice);
        euint128 proceeds = hook.claim(TICK_60);
        vm.stopPrank();

        assertGt(mockStorage(euint128.unwrap(proceeds)), 0, "Should receive proceeds");
    }

    function testClaimPartialFill() public {
        // Alice deposits 10
        vm.startPrank(alice);
        _approveHook(100 ether);
        InEuint128 memory amount = createInEuint128(uint128(10 ether), alice);
        InEbool memory isSell = createInEbool(true, alice);
        hook.deposit(TICK_60, amount, isSell);
        vm.stopPrank();

        // Swapper only fills 3
        vm.startPrank(swapper);
        _approveHookAs(swapper, 100 ether);
        hook.swap(true, 3 ether, 0);
        vm.stopPrank();

        // Alice claims - should get proceeds for 3
        vm.startPrank(alice);
        euint128 proceeds = hook.claim(TICK_60);
        vm.stopPrank();

        // Proceeds should be ~3 ether worth
        uint256 proceedsValue = mockStorage(euint128.unwrap(proceeds));
        assertGt(proceedsValue, 0);
        assertLt(proceedsValue, 10 ether); // Less than full deposit
    }

    function testCannotClaimTwice() public {
        // Setup and fill
        vm.startPrank(alice);
        _approveHook(100 ether);
        InEuint128 memory amount = createInEuint128(uint128(10 ether), alice);
        InEbool memory isSell = createInEbool(true, alice);
        hook.deposit(TICK_60, amount, isSell);
        vm.stopPrank();

        vm.startPrank(swapper);
        _approveHookAs(swapper, 100 ether);
        hook.swap(true, 10 ether, 0);
        vm.stopPrank();

        // First claim
        vm.startPrank(alice);
        euint128 proceeds1 = hook.claim(TICK_60);
        uint256 value1 = mockStorage(euint128.unwrap(proceeds1));
        assertGt(value1, 0);

        // Second claim - should get 0
        euint128 proceeds2 = hook.claim(TICK_60);
        uint256 value2 = mockStorage(euint128.unwrap(proceeds2));
        assertEq(value2, 0, "Should not double-claim");
        vm.stopPrank();
    }

    // ============ Withdraw Tests ============

    function testWithdrawUnfilled() public {
        // Alice deposits 10
        vm.startPrank(alice);
        _approveHook(100 ether);
        InEuint128 memory amount = createInEuint128(uint128(10 ether), alice);
        InEbool memory isSell = createInEbool(true, alice);
        hook.deposit(TICK_60, amount, isSell);

        // No swaps - withdraw all
        InEuint128 memory withdrawAmt = createInEuint128(uint128(10 ether), alice);
        euint128 withdrawn = hook.withdraw(TICK_60, withdrawAmt);
        vm.stopPrank();

        assertEq(mockStorage(euint128.unwrap(withdrawn)), 10 ether);
    }

    function testWithdrawAfterPartialFill() public {
        // Alice deposits 10
        vm.startPrank(alice);
        _approveHook(100 ether);
        InEuint128 memory amount = createInEuint128(uint128(10 ether), alice);
        InEbool memory isSell = createInEbool(true, alice);
        hook.deposit(TICK_60, amount, isSell);
        vm.stopPrank();

        // Swap fills 3
        vm.startPrank(swapper);
        _approveHookAs(swapper, 100 ether);
        hook.swap(true, 3 ether, 0);
        vm.stopPrank();

        // Alice tries to withdraw 10 - should only get 7 (unfilled)
        vm.startPrank(alice);
        InEuint128 memory withdrawAmt = createInEuint128(uint128(10 ether), alice);
        euint128 withdrawn = hook.withdraw(TICK_60, withdrawAmt);
        vm.stopPrank();

        assertEq(mockStorage(euint128.unwrap(withdrawn)), 7 ether);
    }

    // ============ Exit Tests ============

    function testExitPosition() public {
        // Alice deposits 10
        vm.startPrank(alice);
        _approveHook(100 ether);
        InEuint128 memory amount = createInEuint128(uint128(10 ether), alice);
        InEbool memory isSell = createInEbool(true, alice);
        hook.deposit(TICK_60, amount, isSell);
        vm.stopPrank();

        // Swap fills 4
        vm.startPrank(swapper);
        _approveHookAs(swapper, 100 ether);
        hook.swap(true, 4 ether, 0);
        vm.stopPrank();

        // Alice exits - gets unfilled (6) + proceeds from filled (4)
        vm.startPrank(alice);
        (euint128 unfilled, euint128 proceeds) = hook.exit(TICK_60);
        vm.stopPrank();

        assertEq(mockStorage(euint128.unwrap(unfilled)), 6 ether);
        assertGt(mockStorage(euint128.unwrap(proceeds)), 0);
    }

    // ============ Pro-Rata Distribution Tests ============

    function testProRataDistribution() public {
        // Alice deposits 10
        vm.startPrank(alice);
        _approveHook(100 ether);
        InEuint128 memory amount1 = createInEuint128(uint128(10 ether), alice);
        InEbool memory isSell = createInEbool(true, alice);
        hook.deposit(TICK_60, amount1, isSell);
        vm.stopPrank();

        // Bob deposits 5 (half of Alice)
        vm.startPrank(bob);
        _approveHookAs(bob, 100 ether);
        InEuint128 memory amount2 = createInEuint128(uint128(5 ether), bob);
        InEbool memory isSell2 = createInEbool(true, bob);
        hook.deposit(TICK_60, amount2, isSell2);
        vm.stopPrank();

        // Swap fills 9 (60% of bucket)
        vm.startPrank(swapper);
        _approveHookAs(swapper, 100 ether);
        hook.swap(true, 9 ether, 0);
        vm.stopPrank();

        // Alice claims - should get 2/3 of proceeds (10/15 of bucket)
        vm.startPrank(alice);
        euint128 aliceProceeds = hook.claim(TICK_60);
        vm.stopPrank();

        // Bob claims - should get 1/3 of proceeds (5/15 of bucket)
        vm.startPrank(bob);
        euint128 bobProceeds = hook.claim(TICK_60);
        vm.stopPrank();

        uint256 aliceValue = mockStorage(euint128.unwrap(aliceProceeds));
        uint256 bobValue = mockStorage(euint128.unwrap(bobProceeds));

        // Alice should have ~2x Bob's proceeds
        assertApproxEqRel(aliceValue, bobValue * 2, 0.1e18); // 10% tolerance
    }

    function testLateDepositorDoesNotGetPriorFills() public {
        // Alice deposits first
        vm.startPrank(alice);
        _approveHook(100 ether);
        InEuint128 memory amount1 = createInEuint128(uint128(10 ether), alice);
        InEbool memory isSell = createInEbool(true, alice);
        hook.deposit(TICK_60, amount1, isSell);
        vm.stopPrank();

        // First swap fills 5
        vm.startPrank(swapper);
        _approveHookAs(swapper, 100 ether);
        hook.swap(true, 5 ether, 0);
        vm.stopPrank();

        // Bob deposits AFTER first fill
        vm.startPrank(bob);
        _approveHookAs(bob, 100 ether);
        InEuint128 memory amount2 = createInEuint128(uint128(10 ether), bob);
        InEbool memory isSell2 = createInEbool(true, bob);
        hook.deposit(TICK_60, amount2, isSell2);
        vm.stopPrank();

        // Bob tries to claim - should get 0 (no fills since his entry)
        vm.startPrank(bob);
        euint128 bobProceeds = hook.claim(TICK_60);
        vm.stopPrank();

        assertEq(mockStorage(euint128.unwrap(bobProceeds)), 0, "Bob should not get prior fills");

        // Alice claims - should get proceeds from the 5
        vm.startPrank(alice);
        euint128 aliceProceeds = hook.claim(TICK_60);
        vm.stopPrank();

        assertGt(mockStorage(euint128.unwrap(aliceProceeds)), 0, "Alice should get her fills");
    }

    // ============ Helper Functions ============

    function _approveHook(uint256 amount) internal {
        InEuint128 memory enc = createInEuint128(uint128(amount), msg.sender);
        token0.approveEncrypted(address(hook), enc);
        token1.approveEncrypted(address(hook), enc);
    }

    function _approveHookAs(address user, uint256 amount) internal {
        InEuint128 memory enc = createInEuint128(uint128(amount), user);
        token0.approveEncrypted(address(hook), enc);
        token1.approveEncrypted(address(hook), enc);
    }
}
```

---

## Migration Path: v2 → v3

### Phase 1: Parallel Deployment
- Deploy v3 alongside v2
- Same token pair, separate liquidity
- Users can choose which version to use

### Phase 2: UI Migration
- Update frontend to default to v3
- v2 available as "legacy" option
- Documentation on differences

### Phase 3: v2 Deprecation
- Announce deprecation timeline
- Users withdraw from v2
- v2 eventually disabled

### No Automatic Migration
User positions are fundamentally different:
- v2: Individual orders with specific parameters
- v3: Bucket shares with pro-rata fills

Users must manually:
1. Cancel v2 orders
2. Withdraw v2 liquidity
3. Deposit into v3 buckets

---

## Files to Create

| File | Description |
|------|-------------|
| `src/tokens/IFHERC6909.sol` | Interface |
| `src/tokens/FHERC6909.sol` | Implementation |
| `src/PheatherXv3.sol` | Main contract |
| `src/interface/IPheatherXv3.sol` | Interface |
| `test/FHERC6909.t.sol` | Token tests |
| `test/PheatherXv3.t.sol` | Hook tests |
| `script/DeployPheatherXv3.s.sol` | Deployment |

---

## Open Questions

1. **Tick spacing:** Keep v2's 60 or go wider for more privacy (200+)?

2. **Buy vs Sell buckets:** Are they separate buckets at the same tick, or unified?

3. **Price representation:** How to handle tick → price conversion efficiently for fill calculations?

4. **Executor incentives:** Who triggers bucket fills? Does swapper get a bonus for processing buckets?

5. **Partial bucket sweep:** If a swap partially fills a bucket, how is the pro-rata calculation affected for claims?
