# FheatherX Issues and Fixes Tracking

This document tracks all issues encountered and their resolutions to prevent revisiting them.

## Date: December 4, 2025

---

## Issue #1: FHE ACL Permission Errors (ACLNotAllowed)

### Symptoms
- Foundry integration tests failing with `custom error 0x4d13139e: ACLNotAllowed(uint256,address)`
- Error occurs when trying to perform FHE.add() operations on existing encrypted reserves
- Trace shows `isAllowed()` returning `false` for the hook contract

### Root Cause
When FHE operations like `FHE.add()` or `FHE.sub()` create a **new ciphertext**, that new ciphertext needs explicit ACL permissions to be used in subsequent operations. The FheatherX contract was missing `FHE.allowThis()` calls after every FHE operation that creates a new encrypted value stored in state.

### Analysis
The FHE ACL (Access Control List) system works as follows:
1. When you create an encrypted value with `FHE.asEuint128()`, it gets stored with a unique ciphertext hash
2. Operations like `FHE.add(a, b)` produce a NEW ciphertext with a NEW hash
3. This new ciphertext has NO permissions by default
4. You must call `FHE.allowThis(newCiphertext)` to allow the contract to use it
5. You must call `FHE.allow(newCiphertext, user)` to allow a user to decrypt it

### Fix Applied
Added `FHE.allowThis()` calls after every state-modifying FHE operation in `FheatherX.sol`:

**Locations fixed:**
1. `deposit()` function (lines 417-428)
   - After updating `userBalanceToken0/1`
   - After updating `encReserve0/1`

2. `withdraw()` function (lines 441-456)
   - Same pattern as deposit

3. `_beforeAddLiquidity()` function (lines 375-378)
   - After updating `encReserve0/1`

4. `_beforeRemoveLiquidity()` function (lines 396-399)
   - After updating `encReserve0/1`

5. `_executeSwapMathConditional()` function (lines 359-362)
   - After updating `encReserve0/1`

6. `_executeSwapMath()` function (lines 655-658)
   - After updating `encReserve0/1`

7. `_debitUserBalance()` function (lines 667-674)
   - After updating both user balances

8. `_creditUserBalance()` function (lines 683-690)
   - After updating both user balances

9. `_creditUserBalanceReverse()` function (lines 699-706)
   - After updating both user balances

### Verification
After fix, all 4 integration tests pass:
```
[PASS] test_DepositWithRealFHE() (gas: 329601)
[PASS] test_FullE2EFlow() (gas: 973536)
[PASS] test_ProveRealFHEWorksWithDecryption() (gas: 466774)
[PASS] test_WithdrawWithRealFHE() (gas: 463712)
```

### Contract Redeployment
New contract deployed to ETH Sepolia:
- Hook: `0x877748c08B6e4848F3B22CCe813Ee91b7dD70aC8`
- Token0: `0x3565E82F0eb0b176aC4dE04707548907433115dd`
- Token1: `0x7BdfD109de10dE98cD82Eb3E46c890beC7114110`

---

## Issue #2: Infinite FHE Session Re-initialization Loop

### Symptoms
- Browser console showing `[FHE] Initializing session via API...` every ~1 second
- 100+ API calls per minute to `/api/fhe`
- High CPU usage, performance degradation

### Root Cause
Multiple issues combined:
1. Status listener in `useFheSession.ts` was triggering re-renders
2. No mutex/lock to prevent concurrent initializations in `singleton.ts`
3. Status updates during initialization triggered new initialization attempts
4. ChainId changes were triggering spurious resets

### Fix Applied
1. **Added initialization mutex** in `singleton.ts`:
```typescript
let initializationInProgress: Promise<FheSession> | null = null;

export async function initializeSession(...) {
  // If initialization is already in progress, wait for it
  if (initializationInProgress) {
    return initializationInProgress;
  }
  // ...
}
```

2. **Removed status listener subscription** in `useFheSession.ts`:
   - Changed from subscribing to status changes to checking on mount only
   - Used empty dependency arrays for mount-only effects

3. **Added chainId change tracking** with `useRef`:
```typescript
const prevChainIdRef = useRef<number | null>(null);

useEffect(() => {
  if (prevChainIdRef.current !== null && prevChainIdRef.current !== chainId) {
    reset();
    fheSingleton.clearSession();
  }
  prevChainIdRef.current = chainId;
}, [chainId, reset]);
```

### Files Modified
- `frontend/src/lib/fhe/singleton.ts`
- `frontend/src/hooks/useFheSession.ts`

---

## Issue #3: "Unsupported chain ID: 0" Error on Encrypt/Unseal

### Symptoms
- Error: `POST http://localhost:3000/api/fhe 400 (Bad Request)`
- Response: `{ success: false, error: "Unsupported chain ID: 0" }`
- Occurred when trying to encrypt or unseal values

### Root Cause
The `/api/fhe` route was validating `chainId` for ALL actions, but `encrypt` and `unseal` operations don't need chainId - they use the cached session which already has the chain context.

### Fix Applied
Modified `/api/fhe/route.ts` to only validate chainId for `initialize` action:
```typescript
// Only validate chainId for actions that need it (initialize)
// encrypt/unseal use the cached session which already has the chain context
if (action === 'initialize') {
  if (!chainId || !RPC_URLS[chainId]) {
    return NextResponse.json(
      { success: false, error: `Unsupported chain ID: ${chainId}` },
      { status: 400 }
    );
  }
}
```

### Files Modified
- `frontend/src/app/api/fhe/route.ts`

---

## Issue #4: cofhejs/web WASM Loading Failure in Browser

### Symptoms
- Error: `Failed to resolve module specifier 'cofhejs/web'`
- WASM initialization failing in browser environment
- cofhejs works fine in Node.js but fails in browser

### Root Cause
The cofhejs library uses WASM which has different loading requirements in browser vs Node.js environments. The browser's ES module resolution couldn't properly handle the WASM imports.

### Solution Applied
Instead of trying to fix the browser-side WASM loading, we moved all FHE operations to the server:

1. **Created server-side API route** (`/api/fhe/route.ts`)
   - Runs `cofhejs/node` on the server where WASM works correctly
   - Exposes actions: `initialize`, `encrypt`, `unseal`, `getSession`
   - Uses session caching to maintain state across requests

2. **Updated singleton.ts** to call API routes instead of using browser-side cofhejs
   - All encrypt/unseal operations now go through fetch() to `/api/fhe`

3. **Benefits**:
   - WASM works reliably on server (Node.js environment)
   - No browser WASM compatibility issues
   - Session state managed server-side with proper cleanup

### Files Created/Modified
- `frontend/src/app/api/fhe/route.ts` (created)
- `frontend/src/lib/fhe/singleton.ts` (modified to use API)

---

## Current Contract Addresses (ETH Sepolia)

As of December 4, 2025:
```
Hook:    0x877748c08B6e4848F3B22CCe813Ee91b7dD70aC8
Token0:  0x3565E82F0eb0b176aC4dE04707548907433115dd
Token1:  0x7BdfD109de10dE98cD82Eb3E46c890beC7114110
Pool Manager: 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543
Swap Router:  0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe
Task Manager: 0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9
```

---

## Test Commands

### Run Foundry Integration Tests (ETH Sepolia)
```bash
cd contracts
forge test --match-path test/integration/EthSepolia* --fork-url https://ethereum-sepolia-rpc.publicnode.com -vvv
```

### Run All Foundry Tests
```bash
cd contracts
forge test -vv
```

### Run Frontend Dev Server
```bash
cd frontend
npm run dev
```

### Deploy to ETH Sepolia
```bash
cd contracts
rm deployments/eth-sepolia.json  # Remove existing deployment
source .env && forge script script/DeployEthSepolia.s.sol:DeployEthSepolia --rpc-url https://ethereum-sepolia-rpc.publicnode.com --broadcast -vvv
```

---

## Prevention Guidelines

1. **Always call `FHE.allowThis()` after FHE operations that update state**
   - Every `FHE.add()`, `FHE.sub()`, `FHE.select()` that stores result in state needs this

2. **Use mutex/locks for async singleton initialization**
   - Prevents concurrent initialization attempts

3. **Be careful with React effect dependencies**
   - Use `useRef` to track previous values when needed
   - Avoid subscribing to state that triggers re-initialization

4. **Validate API parameters based on action type**
   - Not all actions need all parameters
   - Session-based operations can use cached context

---

## Date: December 5, 2025

---

## Issue #5: Balance Reveal Fails with SEAL_OUTPUT_RETURNED_NULL Error

### Symptoms
- Error: `SEAL_OUTPUT_RETURNED_NULL` when trying to reveal balance
- Occurs for users who have never deposited (zero balance)
- FHE unseal operation fails because ciphertext is 0x0

### Root Cause
When a user has never deposited, their encrypted balance stored on-chain is `0n` (the zero value). This zero ciphertext was never actually created by the FHE system - it's just the default storage value. When the frontend tried to call `unseal(0x0)`, the CoFHE coprocessor correctly returned an error because you can't decrypt a ciphertext that was never encrypted.

### Analysis
```typescript
// In useBalanceReveal.ts line 114-117:
const encryptedHex = typeof encrypted === 'bigint'
  ? `0x${encrypted.toString(16)}`
  : String(encrypted);
const decrypted = await unseal(encryptedHex, FHE_RETRY_ATTEMPTS);
// ^ This fails with SEAL_OUTPUT_RETURNED_NULL when encrypted is 0n
```

The FHE unseal API cannot decrypt:
- Ciphertext hash `0x0` - no encryption ever happened
- Any value that wasn't actually encrypted with `FHE.asEuint128()`

### Fix Applied
Modified `frontend/src/hooks/useBalanceReveal.ts` to detect zero ciphertext and return `0n` directly without attempting unseal:

```typescript
// Handle case where encrypted balance is 0 (user has never deposited)
// A ciphertext hash of 0 means no encrypted value exists
if (encrypted === undefined || encrypted === null) {
  throw new Error('Failed to fetch encrypted balance');
}

// Check if balance is zero (no deposit made yet)
const encryptedBigInt = typeof encrypted === 'bigint' ? encrypted : BigInt(String(encrypted));
if (encryptedBigInt === 0n) {
  // No encrypted balance exists - user has 0 balance
  setValue(0n);
  cacheBalance(cacheKey, 0n);
  setStatus('revealed');
  setProgress(100);
  return 0n;
}

// Step 2: Start decryption with retry (only for non-zero ciphertexts)
setStatus('decrypting');
// ... rest of unseal logic
```

### Files Modified
- `frontend/src/hooks/useBalanceReveal.ts`

### Verification
- Users with no deposits now see "0" balance correctly
- Users with deposits can still reveal their actual encrypted balance
- No more SEAL_OUTPUT_RETURNED_NULL errors for new users
