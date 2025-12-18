# Vault & Router Implementation Audit

**Date:** 2024-12-17
**Auditor:** Claude Code
**Scope:** FheVault, VaultRouter, and frontend integration

---

## Executive Summary

This audit covers the new vault architecture implementation including:
- `FheVault.sol` - ERC-6909 vault for ERC20 → encrypted balance wrapping with async claims
- `VaultRouter.sol` - Router coordinating ERC20/FHERC20 swaps via v8FHE pools
- Frontend hooks and components for claim management

**Overall Assessment:** The implementation is well-structured with proper security patterns. Several items require attention before production deployment.

---

## 1. Contract Audit: FheVault.sol

### 1.1 Strengths

| Category | Finding |
|----------|---------|
| **Reentrancy Protection** | Uses OpenZeppelin's `ReentrancyGuard` on all state-changing functions |
| **Pausability** | Implements `Pausable` for emergency stops |
| **Safe Token Transfers** | Uses `SafeERC20` library throughout |
| **Access Control** | Clear owner-only admin functions |
| **Input Validation** | Zero address and zero amount checks present |
| **ERC-6909 Compliance** | Proper implementation of ERC-6909 interface |

### 1.2 Issues Found

#### HIGH: No Token Balance Check Before Transfer in fulfillClaim

**Location:** `FheVault.sol:341-343`

```solidity
if (plainAmount > 0) {
    IERC20(claim.erc20Token).safeTransfer(claim.recipient, plainAmount);
}
```

**Issue:** If the vault's ERC20 balance is less than `plainAmount`, this will revert. However, there's no pre-check or graceful handling.

**Recommendation:** Add a balance check and emit an event if insufficient funds:
```solidity
uint256 balance = IERC20(claim.erc20Token).balanceOf(address(this));
uint256 transferAmount = plainAmount > balance ? balance : plainAmount;
if (transferAmount > 0) {
    IERC20(claim.erc20Token).safeTransfer(claim.recipient, transferAmount);
}
if (plainAmount > balance) {
    emit InsufficientFundsForClaim(claimId, plainAmount, balance);
}
```

#### MEDIUM: Claim Holder Tracking is Limited

**Location:** `FheVault.sol:471-481`

```solidity
function _findClaimHolder(uint256 claimId) internal view returns (address) {
    address recipient = pendingClaims[claimId].recipient;
    if (balanceOf[recipient][claimId] > 0) {
        return recipient;
    }
    return address(0);
}
```

**Issue:** If a claim token is transferred, the original recipient still receives the ERC20, not the current holder. The comment acknowledges this but it could cause confusion.

**Recommendation:** Either:
1. Document this clearly as intended behavior (claim tokens are for tracking, not ownership)
2. Implement proper holder enumeration for claim transfers

#### MEDIUM: 1:1 Accounting - Incompatible with Rebasing/Reflection Tokens

**Issue:** FheVault uses 1:1 accounting (deposit X → get X balance), not share-based accounting like ERC-4626.

```solidity
// User deposits 100 tokens → gets exactly 100 encrypted balance
euint128 encAmount = FHE.asEuint128(uint128(amount));
encryptedBalances[tokenId][msg.sender] = FHE.add(currentBalance, encAmount);
```

**Incompatible Token Types:**
- **Rebasing tokens** (stETH, aTokens) - balance changes over time
- **Reflection tokens** (SafeMoon-style) - fees redistributed to holders
- **Fee-on-transfer tokens** - less received than sent

**Consequences:**
- Positive rebase: Extra tokens become unclaimable protocol surplus
- Negative rebase: Vault insolvency - user balances exceed actual holdings
- Fee-on-transfer: User credited more than actually deposited

**Recommendation:**
1. Document that only standard ERC20 tokens are supported
2. Add token validation to reject known rebasing tokens
3. Or implement share-based accounting (significant refactor)

#### LOW: Missing Event for wrapEncrypted Excess

**Location:** `FheVault.sol:206-240`

**Issue:** When `wrapEncrypted()` is called and `encryptedAmount < maxPlaintext`, the excess remains in the vault as protocol surplus, but no event is emitted for this.

**Recommendation:** Emit an event with the actual wrapped amount vs max provided.

### 1.3 Gas Optimizations

| Location | Suggestion |
|----------|------------|
| `wrap()` | Consider caching `_tokenIdFromAddress(token)` to avoid recomputation |
| `_unwrap()` | FHE operations are expensive; consider batching where possible |

### 1.4 Test Coverage

**Status:** 31 tests passing

| Category | Tests | Status |
|----------|-------|--------|
| Admin Functions | 6 | PASS |
| Wrap Functions | 5 | PASS |
| Unwrap Functions | 3 | PASS |
| Claim Functions | 5 | PASS |
| Transfer Encrypted | 4 | PASS |
| ERC-6909 | 4 | PASS |
| View Functions | 4 | PASS |

---

## 2. Contract Audit: VaultRouter.sol

### 2.1 Strengths

| Category | Finding |
|----------|---------|
| **Reentrancy Protection** | Uses `ReentrancyGuard` on all swap functions |
| **Token Pair Registry** | Clean mapping between ERC20 ↔ FHERC20 |
| **Claim System** | Proper async claim tracking matching FheVault pattern |
| **Pool Validation** | `_verifyPoolToken` ensures pool contains expected token |

### 2.2 Issues Found

#### HIGH: swapErc20ToFherc20 Does Not Actually Mint FHERC20

**Location:** `VaultRouter.sol:194-230`

```solidity
// Transfer ERC20 from user
IERC20(erc20In).safeTransferFrom(msg.sender, address(this), amountIn);

// Create encrypted amount for the swap
euint128 encAmountIn = FHE.asEuint128(uint128(amountIn));
```

**Issue:** The function transfers ERC20 to the router but doesn't actually mint/wrap to FHERC20. The encrypted amount is created from plaintext but never backed by FHERC20 tokens. The swap will fail because the router doesn't have FHERC20 balance.

**Recommendation:**
1. The router needs to call FHERC20's deposit/wrap function
2. Or integrate with FheVault's wrap functionality
3. Alternative: Document that this function requires FHERC20 to have a `depositAndWrap(erc20Amount)` function

#### HIGH: swapFherc20ToErc20 Balance Check May Be Incorrect

**Location:** `VaultRouter.sol:282-292`

```solidity
euint128 balance1 = IFHERC20(token1).balanceOfEncrypted(address(this));
if (Common.isInitialized(balance1)) {
    outputBalance = balance1;
    ...
}
```

**Issue:** This assumes the router's balance changed from the swap, but encrypted swaps on v8FHE typically transfer directly to the user (msg.sender), not the router. The router would need special handling in the hook.

**Recommendation:**
1. Verify hook behavior - does it support custom recipients?
2. May need hook modifications to route output to router for unwrap flow

#### MEDIUM: No Pausability

**Issue:** Unlike FheVault, VaultRouter lacks pausability for emergency stops.

**Recommendation:** Add `Pausable` with `whenNotPaused` modifiers on swap functions.

#### MEDIUM: Missing Renounce Ownership Guard

**Issue:** `transferOwnership` allows setting any non-zero address but doesn't implement two-step transfer.

**Recommendation:** Implement two-step ownership transfer pattern:
```solidity
address public pendingOwner;

function transferOwnership(address newOwner) external onlyOwner {
    pendingOwner = newOwner;
}

function acceptOwnership() external {
    require(msg.sender == pendingOwner, "Not pending owner");
    owner = pendingOwner;
    pendingOwner = address(0);
}
```

#### LOW: ERC20 Stuck in Router

**Issue:** If `swapErc20ToFherc20` fails after the ERC20 transfer, tokens remain in the router. No recovery mechanism exists.

**Recommendation:** Add admin rescue function:
```solidity
function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
    IERC20(token).safeTransfer(to, amount);
}
```

### 2.3 Test Coverage

**Status:** 21 tests passing

| Category | Tests | Status |
|----------|-------|--------|
| Admin/Ownership | 5 | PASS |
| Token Pair Registry | 5 | PASS |
| Input Validation | 5 | PASS |
| Claim Functions | 3 | PASS |
| View Functions | 3 | PASS |

**Missing Test Coverage:**
- Actual swap execution (requires hook integration)
- Full E2E flow: ERC20 → swap → claim → ERC20
- Edge cases with encrypted amounts

---

## 3. Frontend Audit

### 3.1 useVaultClaims.ts

#### Strengths
- Clean separation of vault vs router claims
- Proper error handling with user feedback
- Auto-refresh on wallet change
- Polling for claim status updates

#### Issues

**MEDIUM: Event Log Query May Be Expensive**

**Location:** `useVaultClaims.ts:194-215`

```typescript
const logs = await publicClient.getLogs({
    fromBlock: 'earliest',
    toBlock: 'latest',
});
```

**Issue:** Querying from 'earliest' block is expensive and may timeout on some RPCs.

**Recommendation:** Track the last processed block and only query new blocks, or use a subgraph for historical data.

**LOW: No Pagination for Claims**

**Issue:** If a user has many claims, all are fetched and displayed.

**Recommendation:** Add pagination or limit to recent N claims.

### 3.2 PendingClaimsPanel.tsx

#### Strengths
- Clean UI with status indicators
- Auto-hide when no claims
- Ready/pending state differentiation
- Transaction modal integration

#### Issues

**LOW: Token Symbol Lookup is Incomplete**

**Location:** `PendingClaimsPanel.tsx:29-33`

```typescript
const TOKEN_SYMBOLS: Record<string, string> = {
  // Add known token addresses and their symbols
};
```

**Issue:** Token symbols are not populated, showing truncated addresses instead.

**Recommendation:** Populate with known token addresses or fetch from token contracts.

### 3.3 Addresses Configuration

**Location:** `addresses.ts:55-69`

```typescript
export const FHE_VAULT_ADDRESSES: Record<number, `0x${string}`> = {
  11155111: '0x0000000000000000000000000000000000000000', // TODO: Deploy
  ...
};
```

**Status:** Addresses are placeholders - contracts not yet deployed to testnets.

---

## 4. Recommendations Summary

### Critical (Must Fix Before Deployment)

1. **VaultRouter.swapErc20ToFherc20:** Implement actual ERC20 → FHERC20 wrapping flow
2. **VaultRouter.swapFherc20ToErc20:** Verify hook recipient handling or modify approach

### High Priority

3. **FheVault:** Add balance check in `fulfillClaim` to handle insufficient funds gracefully
4. **VaultRouter:** Add pausability
5. **Both contracts:** Deploy to testnets and update frontend addresses

### Medium Priority

6. **VaultRouter:** Implement two-step ownership transfer
7. **VaultRouter:** Add token rescue function
8. **Frontend:** Optimize event log queries with block range limits
9. **FheVault:** Emit event for wrapEncrypted excess

### Low Priority

10. **Frontend:** Populate TOKEN_SYMBOLS mapping
11. **Frontend:** Add claim pagination
12. **Documentation:** Add migration guide for existing v8Mixed users

---

## 5. Files Reviewed

| File | Type | Status |
|------|------|--------|
| `contracts/src/FheVault.sol` | Contract | Reviewed |
| `contracts/src/VaultRouter.sol` | Contract | Reviewed |
| `contracts/test/FheVault.t.sol` | Test | 31/31 passing |
| `contracts/test/VaultRouter.t.sol` | Test | 21/21 passing |
| `contracts/script/DeployVaultRouter.s.sol` | Deploy Script | Reviewed |
| `frontend/src/hooks/useVaultClaims.ts` | Hook | Reviewed |
| `frontend/src/components/portfolio/PendingClaimsPanel.tsx` | Component | Reviewed |
| `frontend/src/lib/contracts/fheVault-abi.ts` | ABI | Reviewed |
| `frontend/src/lib/contracts/vaultRouter-abi.ts` | ABI | Reviewed |
| `frontend/src/lib/contracts/addresses.ts` | Config | Reviewed |

---

## 6. Conclusion

The vault architecture provides a solid foundation for ERC20 ↔ FHERC20 bridging with async claims. The main concerns are:

1. **VaultRouter swap functions need completion** - The ERC20→FHERC20 wrapping flow is incomplete
2. **Integration testing required** - Full E2E testing with actual v8FHE hooks needed
3. **Deployment pending** - Contracts need testnet deployment before frontend is usable

Once the swap function implementations are completed and integration tests pass, the architecture should be ready for testnet deployment.

---

*Audit performed by Claude Code on 2024-12-17*
