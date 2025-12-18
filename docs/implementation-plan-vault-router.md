# Implementation Plan: Vault, Router, and Frontend Updates

## Overview
This plan covers the complete implementation of the vault architecture, VaultRouter contract, deprecation of v8Mixed, and frontend updates to support the new flow.

---

## Phase 1: Vault Tests

### 1.1 Create FheVault.t.sol
**File:** `contracts/test/FheVault.t.sol`

**Test Categories:**
1. **Admin Functions**
   - `test_transferOwnership_Success`
   - `test_transferOwnership_Unauthorized_Reverts`
   - `test_transferOwnership_ZeroAddress_Reverts`
   - `test_setTokenSupport_AddRemove`
   - `test_addSupportedTokens_Batch`
   - `test_pause_Unpause`

2. **Wrap Functions**
   - `test_wrap_Success`
   - `test_wrap_TokenNotSupported_Reverts`
   - `test_wrap_ZeroAmount_Reverts`
   - `test_wrap_AmountTooLarge_Reverts`
   - `test_wrap_MultipleDeposits_Accumulate`
   - `test_wrapEncrypted_Success`
   - `test_wrapEncrypted_CappedAtMax`

3. **Unwrap Functions**
   - `test_unwrap_Success`
   - `test_unwrap_CappedAtBalance`
   - `test_unwrap_InsufficientBalance_Reverts`
   - `test_unwrapEncrypted_Success`

4. **Claim Functions**
   - `test_fulfillClaim_Success`
   - `test_fulfillClaim_NotReady_Reverts`
   - `test_fulfillClaim_AlreadyFulfilled_Reverts`
   - `test_fulfillClaim_InvalidId_Reverts`
   - `test_isClaimReady_Pending`
   - `test_isClaimReady_Fulfilled`

5. **Transfer Functions**
   - `test_transferEncrypted_Success`
   - `test_transferEncrypted_TokenNotSupported_Reverts`
   - `test_transferEncrypted_ZeroAddress_Reverts`
   - `test_transferEncrypted_InsufficientBalance_Reverts`

6. **ERC-6909 Functions**
   - `test_transfer_ClaimToken`
   - `test_transferFrom_ClaimToken`
   - `test_approve_ClaimToken`
   - `test_setOperator_ClaimToken`
   - `test_supportsInterface`

7. **View Functions**
   - `test_getEncryptedBalance`
   - `test_getTokenId`
   - `test_isTokenSupported`
   - `test_getClaim`

---

## Phase 2: VaultRouter Contract

### 2.1 Architecture Clarification

**Key Insight**: The FheVault holds encrypted ERC20 balances. But v8FHE hooks interact with FHERC20 token contracts, not vault balances.

**Solution**: The VaultRouter coordinates between:
- ERC20 tokens (plaintext)
- Existing FHERC20 tokens (encrypted, already deployed)
- FheVault (for async unwrap claims)

**The vault's primary role is handling async unwraps** - not wrapping. Wrapping is handled by existing FHERC20 `wrap()` functions.

### 2.2 Simplified FheVault Role

Update the FheVault to work with EXISTING FHERC20 tokens:
```solidity
// User deposits FHERC20, vault tracks for async unwrap
function depositForUnwrap(address fherc20Token, euint128 amount) external;

// Initiate unwrap - vault calls FHERC20.unwrap() and tracks claim
function initiateUnwrap(address fherc20Token, euint128 amount) external returns (uint256 claimId);

// Fulfill when decrypt is ready
function fulfillClaim(uint256 claimId) external;
```

### 2.3 VaultRouter Design
**File:** `contracts/src/VaultRouter.sol`

**Key Functions:**
```solidity
// Swap ERC20 → FHERC20 output (stays encrypted)
function swapErc20ToFhe(
    PoolKey calldata key,
    address erc20In,
    uint256 amountIn,
    InEuint128 calldata minOutput
) external;

// Swap FHERC20 → ERC20 with async claim
function swapFheToErc20(
    PoolKey calldata key,
    InEuint128 calldata amountIn,
    InEuint128 calldata minOutput
) external returns (uint256 claimId);

// Full journey: ERC20 → swap → ERC20 (two async steps)
function swapErc20ToErc20(
    PoolKey calldata key,
    address erc20In,
    uint256 amountIn,
    InEuint128 calldata minOutput
) external returns (uint256 claimId);
```

### 2.4 Implementation Flow

**ERC20 → FHERC20 Swap:**
1. User approves router for ERC20
2. Router wraps ERC20 → FHERC20 via `FHERC20.wrap()`
3. Router initiates encrypted swap via PrivateSwapRouter
4. Output (FHERC20) transferred to user

**FHERC20 → ERC20 Swap:**
1. User approves router for FHERC20 encrypted transfer
2. Router swaps FHERC20 → output FHERC20
3. Router calls `vault.initiateUnwrap(outputFherc20, amount)`
4. Returns claimId, user calls `vault.fulfillClaim()` when ready

**State:**
```solidity
FheVault public immutable vault;
PrivateSwapRouter public immutable swapRouter;
mapping(address => address) public erc20ToFherc20; // ERC20 → corresponding FHERC20
```

### 2.5 Token Pair Registry

Need to track which ERC20 maps to which FHERC20:
- WETH → fheWETH
- USDC → fheUSDC

This enables automatic wrapping/unwrapping.

---

## Phase 3: Deprecate v8Mixed

### 3.1 Steps
1. Add deprecation notice to `FheatherXv8Mixed.sol` header
2. Mark all public functions with `@deprecated` NatSpec
3. Do NOT delete the contract (existing deployments may still reference it)
4. Update frontend to stop creating new v8Mixed pools
5. Remove v8Mixed from deployment scripts

### 3.2 Documentation
- Update `CLAUDE.md` to remove v8Mixed references
- Add migration guide for existing v8Mixed positions
- Update `docs/fheatherx-v5/summary.md` if it references v8Mixed

---

## Phase 4: Frontend Updates

### 4.1 Remove ERC:FHE LP Support

**File: `frontend/src/app/liquidity/page.tsx`**
- Filter out ERC:FHE pools from LP options
- Show message: "Only FHE:FHE pools support liquidity provision"

**File: `frontend/src/components/liquidity/AddLiquidityForm.tsx`**
- Add check: if pool is not FHE:FHE, show unsupported message
- Hide/disable the form for non-FHE:FHE pools

**File: `frontend/src/stores/poolStore.ts`**
- Add helper: `isFullyEncryptedPool(pool)` → checks both tokens are fheerc20

### 4.2 Adapt Trading for Vault/Claims

**File: `frontend/src/components/trade/MarketSwapForm.tsx`**
Changes needed:
1. For ERC20 input → call VaultRouter instead of direct hook
2. After swap, show pending claim notification
3. Add "Claims" section to show pending unwrap claims
4. Add "Fulfill Claim" button for ready claims

**New Component: `frontend/src/components/portfolio/PendingClaimsPanel.tsx`**
- Display all user's pending claims
- Show status: pending/ready
- "Fulfill" button for ready claims

**New Hook: `frontend/src/hooks/useVaultClaims.ts`**
- Fetch user's pending claims from vault
- Check `isClaimReady()` for each
- Provide `fulfillClaim()` function

### 4.3 Add Vault Integration Hooks

**File: `frontend/src/hooks/useVaultBalance.ts`**
- Get encrypted balance in vault for a token
- Reveal functionality

**File: `frontend/src/hooks/useVaultWrap.ts`**
- Wrap ERC20 to vault
- Track transaction status

**File: `frontend/src/hooks/useVaultUnwrap.ts`**
- Initiate unwrap (creates claim)
- Track transaction status

---

## Phase 5: Frontend Bug Fixes

### 5.1 Auto-Reveal FHE Values on Portfolio Page

**Current Behavior:** FHE balances show "******" with "Reveal" button

**Desired Behavior:** Auto-reveal when:
1. FHE session is ready
2. User is on portfolio page
3. Balance hasn't been revealed yet

**Implementation:**

**File: `frontend/src/components/portfolio/TokenBalanceTable.tsx`**

Modify `WalletFherc20Token` component:
```typescript
// Add useEffect for auto-reveal
useEffect(() => {
  // Auto-reveal when session is ready and not already revealed
  if ((isReady || isMock) && status === 'idle' && !hasAttemptedAutoReveal.current) {
    hasAttemptedAutoReveal.current = true;
    reveal();
  }
}, [isReady, isMock, status, reveal]);
```

Modify `FheatherXToken` component:
```typescript
// Add auto-reveal via useAggregatedBalanceReveal
// The hook should have an autoReveal option
```

**File: `frontend/src/hooks/useAggregatedBalanceReveal.ts`**
- Add `autoReveal: boolean` option
- Trigger reveal automatically when session becomes ready

### 5.2 Fix Wallet Connection Across Tabs

**Current Issue:** Wallet connection state not persisting when navigating between tabs. Defaults to Ethereum Sepolia.

**Root Cause Analysis:**
- wagmi storage configuration may not be syncing correctly
- Chain selection not persisting

**File: `frontend/src/lib/wagmiConfig.ts`**

Current:
```typescript
storage: createStorage({
  storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  key: 'fheatherx-wagmi',
}),
```

**Fixes:**
1. Ensure storage key is consistent
2. Add chain persistence
3. Check RainbowKit's chain syncing

**File: `frontend/src/providers/WagmiProvider.tsx`** (if exists)
- Ensure WagmiProvider wraps entire app
- Check for reconnection handling

**File: `frontend/src/components/common/Header.tsx`** (wallet connect location)
- Verify RainbowKit chain selector persistence

### 5.3 Remove Up/Down Buttons on Amount Input

**Current Issue:** Trade order amount input has increment/decrement buttons that shouldn't be there.

**File: `frontend/src/components/trade/MarketSwapForm.tsx`**

Current code (lines 113-129):
```typescript
// Smart increment based on current value
const getIncrement = () => { ... };
const adjustAmount = (delta: number) => { ... };
```

And in JSX there are Plus/Minus buttons.

**Fix:** Remove the increment/decrement UI elements:
1. Remove `getIncrement` function
2. Remove `adjustAmount` function
3. Remove `<Button>` elements with `Plus` and `Minus` icons from the amount input group

**Also check:**
- `frontend/src/components/trade/LimitOrderForm.tsx`
- `frontend/src/components/trade/QuickLimitOrderPanel.tsx`
- Any other forms with amount inputs

---

## Phase 6: Deployment Scripts

### 6.1 Deploy Script Updates
**File:** `contracts/script/DeployVault.s.sol`
- Deploy FheVault
- Set supported tokens (WETH, USDC, fheWETH, fheUSDC)
- Transfer ownership if needed

**File:** `contracts/script/DeployVaultRouter.s.sol`
- Deploy VaultRouter with vault address
- Set token pair mappings (ERC20 → FHERC20)

### 6.2 Frontend ABI Exports
**Files to create:**
- `frontend/src/lib/contracts/vaultAbi.ts`
- `frontend/src/lib/contracts/vaultRouterAbi.ts`

Export ABIs from compiled contracts for wagmi hooks.

---

## Implementation Order (Revised)

**Note:** Bug fixes first (quick wins), then contracts, then frontend integration.

1. **Phase 5** - Frontend Bug Fixes (FIRST - quick wins)
   - Remove +/- buttons from amount inputs
   - Fix auto-reveal on portfolio page
   - Investigate wallet connection persistence

2. **Phase 1** - Vault Tests
   - Create FheVault.t.sol with mock setup
   - Implement all test cases
   - Run `forge test` and verify passing

3. **Phase 2** - VaultRouter Contract
   - Update FheVault for FHERC20 integration (simpler model)
   - Create VaultRouter with swap coordination
   - Add integration tests with v8FHE

4. **Phase 3** - Deprecate v8Mixed
   - Add deprecation notices
   - Update documentation

5. **Phase 6** - Deployment Scripts
   - Create deploy scripts for vault and router
   - Export ABIs for frontend

6. **Phase 4** - Frontend Vault Integration
   - Add vault hooks
   - Update swap forms for claim flow
   - Add claims panel to portfolio

---

## Testing Checklist

### Contracts
- [ ] All FheVault tests pass
- [ ] VaultRouter tests pass
- [ ] Integration test: ERC20 → wrap → swap → unwrap → claim → ERC20
- [ ] v8FHE still works standalone

### Frontend
- [ ] Portfolio page auto-reveals FHE balances
- [ ] Wallet stays connected across tab navigation
- [ ] Amount inputs don't have +/- buttons
- [ ] Swap flow works with vault integration
- [ ] Claims panel shows pending claims
- [ ] Fulfill claim works when ready

---

## Files to Create/Modify

### Create:
- `contracts/test/FheVault.t.sol`
- `contracts/src/VaultRouter.sol`
- `contracts/test/VaultRouter.t.sol`
- `contracts/script/DeployVault.s.sol`
- `contracts/script/DeployVaultRouter.s.sol`
- `frontend/src/lib/contracts/vaultAbi.ts`
- `frontend/src/lib/contracts/vaultRouterAbi.ts`
- `frontend/src/hooks/useVaultClaims.ts`
- `frontend/src/components/portfolio/PendingClaimsPanel.tsx`

### Modify:
- `contracts/src/FheVault.sol` (simplify for FHERC20 integration)
- `contracts/src/FheatherXv8Mixed.sol` (deprecation notice)
- `frontend/src/components/portfolio/TokenBalanceTable.tsx` (auto-reveal)
- `frontend/src/components/trade/MarketSwapForm.tsx` (remove +/- buttons, vault integration)
- `frontend/src/components/trade/LimitOrderForm.tsx` (remove +/- buttons if present)
- `frontend/src/app/liquidity/page.tsx` (filter to FHE:FHE only)
- `frontend/src/components/liquidity/AddLiquidityForm.tsx` (FHE:FHE check)
- `frontend/src/hooks/useAggregatedBalanceReveal.ts` (autoReveal option)
- `CLAUDE.md` (update documentation)
