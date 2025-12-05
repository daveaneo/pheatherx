# FHERC20 Token Implementation Plan

## Overview

Implement real FHERC20 tokens following Fhenix's standard pattern where **ALL balances are stored encrypted** using `euint128` instead of having both plaintext and encrypted balances.

## Current State Analysis

### Current FheFaucetToken.sol (Hybrid - NOT True FHERC20)

The current implementation is a **hybrid** that stores:
- Plaintext ERC20 balance (`balanceOf`)
- Optional encrypted balance (`encryptedBalances`)

This is NOT a true FHERC20 because users can still see plaintext balances.

### Fhenix FHERC20 Standard

The official [FHERC20.sol](https://github.com/FhenixProtocol/fhenix-contracts/blob/main/contracts/experimental/token/FHERC20/FHERC20.sol) stores:
- **ALL balances encrypted** via `mapping(address => euint128) internal _encBalances`
- Uses `wrap()`/`unwrap()` to convert between plaintext ERC20 and encrypted balances
- `balanceOfEncrypted()` returns sealed encrypted balance with permit verification
- `transferEncrypted()` for private transfers

---

## Implementation Plan

### Task 0: Update Foundry Tests for Token Combinations

Before implementing new tokens, ensure PheatherX hook works with all 4 token type combinations.

**Test Matrix:**

| Pool Config | Token0 | Token1 | Description |
|-------------|--------|--------|-------------|
| ERC20-ERC20 | FaucetToken | FaucetToken | Standard tokens |
| ERC20-FHERC20 | FaucetToken | FHERC20FaucetToken | Hybrid pool |
| FHERC20-ERC20 | FHERC20FaucetToken | FaucetToken | Hybrid pool (reversed) |
| FHERC20-FHERC20 | FHERC20FaucetToken | FHERC20FaucetToken | Full privacy pool |

**Files to Create/Modify:**
- `contracts/test/tokens/FHERC20FaucetToken.t.sol` - Unit tests for new token
- `contracts/test/PheatherX.TokenCombinations.t.sol` - Pool tests with all 4 combos

---

### Task 1: Create True FHERC20FaucetToken Contract

Replace the current hybrid `FheFaucetToken.sol` with a true FHERC20 implementation.

**File:** `contracts/src/tokens/FHERC20FaucetToken.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import {
    FHE,
    euint128,
    ebool,
    InEuint128,
    Common
} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {Permissioned, Permission} from "@fhenixprotocol/cofhe-contracts/access/Permissioned.sol";

/// @title FHERC20FaucetToken
/// @notice True FHERC20 token where ALL balances are encrypted
/// @dev Follows Fhenix FHERC20 standard with wrap/unwrap pattern
contract FHERC20FaucetToken is ERC20, Ownable, Permissioned {
    uint8 private immutable _tokenDecimals;

    // === FHERC20 Storage ===
    /// @notice Encrypted balances (source of truth)
    mapping(address => euint128) internal _encBalances;

    /// @notice Encrypted allowances
    mapping(address => mapping(address => euint128)) internal _encAllowances;

    /// @notice Total encrypted supply
    euint128 internal _encTotalSupply;

    // === Faucet Storage ===
    uint256 public constant FAUCET_AMOUNT = 100;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;
    mapping(address => uint256) public lastFaucetCall;

    // === Events ===
    event FaucetDispensed(address indexed to, uint256 amount);
    event Wrap(address indexed account, uint256 amount);
    event Unwrap(address indexed account, uint256 amount);
    event TransferEncrypted(address indexed from, address indexed to);
    event ApprovalEncrypted(address indexed owner, address indexed spender);

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        _tokenDecimals = decimals_;
        _encTotalSupply = FHE.asEuint128(0);
    }

    function decimals() public view virtual override returns (uint8) {
        return _tokenDecimals;
    }

    // === Faucet Functions ===

    /// @notice Request tokens from faucet (mints to encrypted balance directly)
    function faucet() external {
        require(
            block.timestamp >= lastFaucetCall[msg.sender] + FAUCET_COOLDOWN,
            "Faucet: cooldown not elapsed"
        );

        lastFaucetCall[msg.sender] = block.timestamp;
        uint256 amount = FAUCET_AMOUNT * (10 ** _tokenDecimals);

        // Mint directly to encrypted balance
        _mintEncrypted(msg.sender, amount);

        emit FaucetDispensed(msg.sender, amount);
    }

    /// @notice Mint to encrypted balance (owner only)
    function mintEncrypted(address to, uint256 amount) external onlyOwner {
        _mintEncrypted(to, amount);
    }

    function _mintEncrypted(address to, uint256 amount) internal {
        euint128 encAmount = FHE.asEuint128(uint128(amount));

        if (Common.isInitialized(_encBalances[to])) {
            _encBalances[to] = FHE.add(_encBalances[to], encAmount);
        } else {
            _encBalances[to] = encAmount;
        }

        _encTotalSupply = FHE.add(_encTotalSupply, encAmount);

        // Allow the user to access their balance
        FHE.allowThis(_encBalances[to]);
        FHE.allow(_encBalances[to], to);
    }

    // === Wrap/Unwrap (Convert between ERC20 and FHERC20) ===

    /// @notice Convert plaintext ERC20 tokens to encrypted balance
    /// @param amount Amount to wrap
    function wrap(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");

        // Burn plaintext tokens
        _burn(msg.sender, amount);

        // Add to encrypted balance
        _mintEncrypted(msg.sender, amount);

        emit Wrap(msg.sender, amount);
    }

    /// @notice Convert encrypted balance to plaintext ERC20 tokens
    /// @param amount Plaintext amount to unwrap (user knows their balance)
    function unwrap(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");

        euint128 encAmount = FHE.asEuint128(uint128(amount));

        // Subtract from encrypted balance (will fail if insufficient)
        _encBalances[msg.sender] = FHE.sub(_encBalances[msg.sender], encAmount);
        _encTotalSupply = FHE.sub(_encTotalSupply, encAmount);

        FHE.allowThis(_encBalances[msg.sender]);
        FHE.allow(_encBalances[msg.sender], msg.sender);

        // Mint plaintext tokens
        _mint(msg.sender, amount);

        emit Unwrap(msg.sender, amount);
    }

    // === FHERC20 Balance Functions ===

    /// @notice Get encrypted balance (requires permit)
    /// @param account Address to query
    /// @param permission Permission from cofhejs
    /// @return Sealed encrypted balance
    function balanceOfEncrypted(
        address account,
        Permission calldata permission
    ) external view onlyPermitted(permission, account) returns (string memory) {
        return FHE.sealoutput(_encBalances[account], permission.publicKey);
    }

    /// @notice Get raw encrypted balance handle (for contract-to-contract)
    function getEncryptedBalance(address account) external view returns (euint128) {
        return _encBalances[account];
    }

    /// @notice Check if account has encrypted balance
    function hasEncryptedBalance(address account) external view returns (bool) {
        return Common.isInitialized(_encBalances[account]);
    }

    // === FHERC20 Transfer Functions ===

    /// @notice Transfer encrypted tokens
    /// @param to Recipient
    /// @param encryptedAmount Encrypted amount to transfer
    function transferEncrypted(address to, InEuint128 calldata encryptedAmount) external returns (bool) {
        euint128 amount = FHE.asEuint128(encryptedAmount);
        _transferEncrypted(msg.sender, to, amount);
        return true;
    }

    /// @notice Transfer encrypted tokens (for contract-to-contract with euint128)
    function transferEncrypted(address to, euint128 amount) external returns (bool) {
        _transferEncrypted(msg.sender, to, amount);
        return true;
    }

    function _transferEncrypted(address from, address to, euint128 amount) internal {
        require(to != address(0), "Transfer to zero address");

        // Subtract from sender (will fail if insufficient)
        _encBalances[from] = FHE.sub(_encBalances[from], amount);

        // Add to recipient
        if (Common.isInitialized(_encBalances[to])) {
            _encBalances[to] = FHE.add(_encBalances[to], amount);
        } else {
            _encBalances[to] = amount;
        }

        // Allow access
        FHE.allowThis(_encBalances[from]);
        FHE.allow(_encBalances[from], from);
        FHE.allowThis(_encBalances[to]);
        FHE.allow(_encBalances[to], to);

        emit TransferEncrypted(from, to);
    }

    // === FHERC20 Approval Functions ===

    /// @notice Approve encrypted spending allowance
    function approveEncrypted(address spender, InEuint128 calldata encryptedAmount) external returns (bool) {
        euint128 amount = FHE.asEuint128(encryptedAmount);
        _encAllowances[msg.sender][spender] = amount;

        FHE.allowThis(_encAllowances[msg.sender][spender]);
        FHE.allow(_encAllowances[msg.sender][spender], msg.sender);
        FHE.allow(_encAllowances[msg.sender][spender], spender);

        emit ApprovalEncrypted(msg.sender, spender);
        return true;
    }

    /// @notice Get encrypted allowance (requires permit)
    function allowanceEncrypted(
        address owner,
        address spender,
        Permission calldata permission
    ) external view onlyPermitted(permission, owner) returns (string memory) {
        return FHE.sealoutput(_encAllowances[owner][spender], permission.publicKey);
    }

    /// @notice Transfer from encrypted allowance
    function transferFromEncrypted(
        address from,
        address to,
        InEuint128 calldata encryptedAmount
    ) external returns (bool) {
        euint128 amount = FHE.asEuint128(encryptedAmount);

        // Subtract from allowance
        _encAllowances[from][msg.sender] = FHE.sub(_encAllowances[from][msg.sender], amount);

        // Transfer
        _transferEncrypted(from, to, amount);

        return true;
    }
}
```

---

### Task 2: PheatherX Hook - NO CHANGES NEEDED

**Analysis:** The hook does NOT need any changes for FHERC20 support.

**Why:**
1. The hook's internal accounting is **already fully encrypted** (`userBalanceToken0`, `userBalanceToken1` are `euint128`)
2. FHERC20 tokens inherit from ERC20, so they have standard `transfer()`, `balanceOf()`, `approve()`
3. Users use `unwrap()` to get plaintext ERC20 before depositing, `wrap()` after withdrawing

**User Flow with FHERC20:**
```
FHERC20 (wallet)  →  unwrap()  →  ERC20  →  deposit()  →  Hook (euint128)
                                                              ↓
Hook (euint128)  →  withdraw()  →  ERC20  →  wrap()  →  FHERC20 (wallet)
```

**Benefits of this design:**
1. **Router compatibility** - 1inch, Paraswap, etc. can route to us with standard ERC20 transfers
2. **No FHERC20-specific code paths** - Simpler hook, less attack surface
3. **Privacy preserved** - Users hold FHERC20 privately in wallet, only unwrap what they trade
4. **Single hook works for all token types** - ERC20, FHERC20, or mixed pairs

**Conclusion:** Skip this task. The hook is already compatible.

---

### Task 3: Deploy New Tokens

1. Deploy FHERC20FaucetToken for fheUSDC and fheWETH
2. Keep existing FaucetToken for tUSDC and tWETH
3. Update addresses in frontend config

---

### Task 4: Frontend Updates

1. **Portfolio page**: Query `balanceOfEncrypted()` for FHERC20 tokens with permit
2. **Faucet**: Works unchanged (calls `faucet()` on each token)
3. **Balance display**: Show lock icon + decrypt button for FHERC20 tokens

---

## Test Plan

### Unit Tests (`contracts/test/tokens/FHERC20FaucetToken.t.sol`)

```solidity
// Test faucet mints to encrypted balance
function testFaucetMintsEncrypted() public {
    vm.prank(user);
    token.faucet();

    euint128 balance = token.getEncryptedBalance(user);
    assertHashValue(balance, 100e18);
}

// Test wrap/unwrap
function testWrapUnwrap() public {
    // Mint plaintext
    token.mint(user, 1000e18);

    vm.startPrank(user);
    // Wrap to encrypted
    token.wrap(500e18);
    assertEq(token.balanceOf(user), 500e18);

    // Unwrap back
    token.unwrap(200e18);
    assertEq(token.balanceOf(user), 700e18);
    vm.stopPrank();
}

// Test encrypted transfer
function testTransferEncrypted() public {
    token.mintEncrypted(user, 1000e18);

    vm.startPrank(user);
    euint128 amount = FHE.asEuint128(200e18);
    FHE.allow(amount, address(token));
    token.transferEncrypted(user2, amount);
    vm.stopPrank();

    euint128 balance1 = token.getEncryptedBalance(user);
    euint128 balance2 = token.getEncryptedBalance(user2);
    assertHashValue(balance1, 800e18);
    assertHashValue(balance2, 200e18);
}
```

### Integration Tests (`contracts/test/PheatherX.TokenCombinations.t.sol`)

```solidity
// Test all 4 token combinations
function testPoolWithERC20_ERC20() public { ... }
function testPoolWithERC20_FHERC20() public { ... }
function testPoolWithFHERC20_ERC20() public { ... }
function testPoolWithFHERC20_FHERC20() public { ... }
```

---

## Migration Path

1. Keep existing FheFaucetToken.sol as-is (don't break deployed contracts)
2. Create new FHERC20FaucetToken.sol following Fhenix standard
3. Deploy new tokens alongside old ones
4. Update frontend to use new token addresses
5. Old tokens can be deprecated after testing

---

## Success Criteria

- [ ] FHERC20FaucetToken passes all unit tests
- [ ] PheatherX hook works with all 4 token combinations
- [ ] Faucet mints directly to encrypted balances
- [ ] Frontend can query and decrypt FHERC20 balances
- [ ] No plaintext balance visible for FHERC20 tokens (unless unwrapped)

---

## Dependencies

- `@fhenixprotocol/cofhe-contracts` (already installed)
- CoFHE coprocessor availability (for balance reveal)
- cofhejs frontend library (for permit generation)

---

## Timeline

This is a **foundational change**. Recommend executing in order:
1. **Task 0** - Tests first (ensure hook compatibility)
2. **Task 1** - New token contract
3. **Task 2** - Hook updates (if needed)
4. **Task 3** - Deploy
5. **Task 4** - Frontend integration
