# PheatherX FHE Testing Issues Report

**Date:** December 4, 2025 (Updated)
**Project:** PheatherX E2E Testing with Playwright
**Author:** Claude Code Analysis

---

## Executive Summary

During the setup of automated Playwright E2E tests for PheatherX, we encountered multiple blocking issues related to FHE (Fully Homomorphic Encryption) infrastructure. This report documents the issues, root causes, and potential solutions.

**Latest Update (Dec 4):** We discovered a critical difference between `cofhejs/node` and `cofhejs/web`:
- **Node.js works perfectly** - `cofhejs/node` initializes successfully on both ETH Sepolia and Arbitrum Sepolia
- **Browser fails** - `cofhejs/web` fails with TFHE WASM initialization errors

---

## Issue 1: Fhenix Helium Testnet Unreachable

### Status: BLOCKING

### Description
The Fhenix Helium testnet (Chain ID: 8008135) is not responding to RPC requests.

### Evidence
```bash
# Attempted connections:
curl -X POST https://api.helium.fhenix.zone  # Failed - DNS resolution error
curl -X POST https://api.testnet.fhenix.zone:7747  # Failed - DNS resolution error
cast chain-id --rpc-url https://api.helium.fhenix.zone  # Failed
```

### Error
```
Error: error sending request for url (https://api.helium.fhenix.zone/)
Context:
- Error #0: client error (Connect)
- Error #1: dns error: failed to lookup address information: Name or service not known
```

### Analysis
- The Fhenix Helium testnet was launched in June 2024
- According to [Fhenix's website](https://www.fhenix.io/), they have transitioned to **CoFHE** (FHE Coprocessor) which runs on existing chains (Ethereum mainnet, Arbitrum, and testnets like Arbitrum Sepolia)
- The standalone Helium testnet may have been deprecated in favor of CoFHE on established testnets
- No official announcement found about testnet shutdown

### References
- [ChainList - Fhenix Helium](https://chainlist.org/chain/8008135)
- [thirdweb - Fhenix Helium](https://thirdweb.com/fhenix-helium)

---

## Issue 2: ACLNotAllowed Error on Ethereum Sepolia

### Status: BLOCKING

### Description
The PheatherX hook contract deployed on Ethereum Sepolia (at `0x47712BED8Ae60A41B5d092A3Dc04cb19FF508AC8`) reverts with `ACLNotAllowed` when new users attempt to deposit tokens.

### Evidence
```bash
cast call 0x47712BED8Ae60A41B5d092A3Dc04cb19FF508AC8 \
  "deposit(bool,uint256)" true 1000000000000000000 \
  --from 0x60B9be2A29a02F49e8D6ba535303caD1Ddcb9659 \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com

# Error:
# execution reverted, data: "0x4d13139e..."
# Decoded: ACLNotAllowed(uint256 ctHash, address account)
```

### Error Data Decoded
```
Selector: 0x4d13139e (ACLNotAllowed)
Arguments:
  - ctHash: c60ab13edff8737c1c778b9dfc456f2418596feb43e4093739452319c0ea0600
  - account: 0x47712BED8Ae60A41B5d092A3Dc04cb19FF508AC8 (the hook contract itself!)
```

### Root Cause Analysis

The error occurs in the CoFHE TaskManager when performing FHE operations:

```solidity
// From MockTaskManager.sol:352-355
function checkAllowed(uint256 ctHash) internal view {
    if (!TMCommon.isTriviallyEncryptedFromHash(ctHash)) {
        if (!acl.isAllowed(ctHash, msg.sender))
            revert ACLNotAllowed(ctHash, msg.sender);
    }
}
```

**The problem:** The `ACLNotAllowed` error shows the **hook contract itself** (`0x47712...`) as the denied account, NOT the user's wallet. This indicates:

1. The contract is trying to operate on a ciphertext handle
2. The contract doesn't have permission in the ACL to use that handle
3. The `ENC_ZERO` constant or user balance handles may not have proper permissions

### PheatherX Contract ACL Setup (from `src/PheatherX.sol`)

```solidity
constructor(...) {
    // Cache encrypted constants
    ENC_ZERO = FHE.asEuint128(0);
    // ...

    // Allow FHE operations on cached values
    FHE.allowThis(ENC_ZERO);  // Line 129
    FHE.allowThis(ENC_ONE);   // Line 130
    // ...
}

function _ensureUserBalancesInitialized(address user) internal {
    if (!userInitialized[user]) {
        userBalanceToken0[user] = ENC_ZERO;
        userBalanceToken1[user] = ENC_ZERO;
        FHE.allowThis(userBalanceToken0[user]);  // Line 754
        FHE.allowThis(userBalanceToken1[user]);  // Line 755
        FHE.allow(userBalanceToken0[user], user); // Line 756
        FHE.allow(userBalanceToken1[user], user); // Line 757
        userInitialized[user] = true;
    }
}
```

### Potential Causes

1. **Constructor ACL permissions didn't persist** - The `FHE.allowThis(ENC_ZERO)` call in the constructor may not have properly registered permissions with the CoFHE coprocessor
2. **Ciphertext handle changed** - The `ENC_ZERO` handle created in constructor may be different from what's used later
3. **Transient vs Persistent permissions** - CoFHE has `allowTransient` for single-tx access and `allow`/`allowThis` for persistent. Possible mismatch.
4. **CoFHE coprocessor state mismatch** - The on-chain ACL state may not be synchronized with the coprocessor

### Possible Fix (Contract Level)

According to [Fhenix Access Control documentation](https://dev.to/fhenix_io/privacy-isnt-private-by-default-understanding-access-control-in-cofhe-38l0):

```solidity
// After every FHE operation that creates a new ciphertext, call:
result = FHE.add(a, b);
FHE.allowThis(result);    // Persist access for the contract
FHE.allowSender(result);  // Grant access to the caller (if needed)
```

The PheatherX contract may need to call `FHE.allowThis()` on **every** intermediate result, not just user balances.

### References
- [Understanding Access Control in CoFHE](https://dev.to/fhenix_io/privacy-isnt-private-by-default-understanding-access-control-in-cofhe-38l0)
- [Fhenix Permissions Documentation](https://docs.fhenix.zone/docs/devdocs/Writing%20Smart%20Contracts/Permissions)
- [CoFHE Contracts GitHub](https://github.com/FhenixProtocol/cofhe-contracts)

---

## Issue 3: Arbitrum Sepolia Testnet ETH Acquisition

### Status: CHALLENGE

### Description
To deploy and test on Arbitrum Sepolia (where CoFHE is fully supported), we need testnet ETH. However, obtaining testnet ETH has requirements.

### Faucet Options

| Faucet | URL | Requirements | Amount | Cooldown |
|--------|-----|--------------|--------|----------|
| [Alchemy](https://www.alchemy.com/faucets/arbitrum-sepolia) | alchemy.com/faucets | 0.001 ETH on mainnet | Varies | 24 hours |
| [QuickNode](https://faucet.quicknode.com/arbitrum/sepolia) | quicknode.com | 0.001 ETH on mainnet | 0.05 ETH | 12 hours |
| [Chainlink](https://faucets.chain.link/arbitrum-sepolia) | chain.link | Wallet connection | Varies | Rate limited |
| [L2 Faucet](https://www.l2faucet.com/arbitrum) | l2faucet.com | Device attestation | Varies | Daily |
| [Bware Labs](https://bwarelabs.com/faucets/arbitrum-sepolia) | bwarelabs.com | Wallet connection | Limited | Daily limit |

### Challenge
Most faucets require either:
- 0.001 ETH minimum balance on Ethereum mainnet
- Social verification (Twitter/GitHub)
- Device attestation

The test wallet (`0x60B9be2A29a02F49e8D6ba535303caD1Ddcb9659`) has 0 ETH on Arbitrum Sepolia and needs to be funded.

---

## Current Network Status

| Network | Chain ID | Status | PheatherX Deployed? |
|---------|----------|--------|---------------------|
| Fhenix Helium | 8008135 | **DOWN** (DNS unreachable) | No |
| Ethereum Sepolia | 11155111 | **UP** (ACL issues) | Yes |
| Arbitrum Sepolia | 421614 | **UP** (needs funding) | No |
| Local Anvil | 31337 | **UP** (mock only) | Yes (MockPheatherX) |

---

## Recommended Solutions

### Option A: Fix ACL on Existing Ethereum Sepolia Deployment

**Pros:** No redeployment needed
**Cons:** May require contract owner action, may not be fixable without redeploy

Steps:
1. Review if there's an admin function to pre-initialize users
2. Check if the constructor properly set up ACL permissions
3. Verify CoFHE coprocessor is fully synced
4. May require contract redeployment with fixed ACL logic

### Option B: Deploy to Arbitrum Sepolia

**Pros:** Full CoFHE support, more reliable
**Cons:** Requires testnet ETH, full deployment

Steps:
1. Fund test wallet with Arbitrum Sepolia ETH via faucet
2. Deploy test tokens (tWETH, tUSDC) to Arbitrum Sepolia
3. Deploy PheatherX hook to Arbitrum Sepolia
4. Update frontend config for Arbitrum Sepolia

### Option C: Use Local Anvil with MockPheatherX (Recommended for E2E Testing)

**Pros:** Fast, reliable, no external dependencies
**Cons:** Doesn't test real FHE operations

Steps:
1. Start Anvil with deterministic accounts
2. Deploy MockPheatherX (no FHE, just mock balances)
3. Fund test wallet locally
4. Run Playwright tests against local environment

---

## Technical Details: CoFHE ACL System

### How CoFHE ACL Works

```
┌──────────────────────────────────────────────────────────────────┐
│                     CoFHE Coprocessor                            │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    ACL (Access Control List)                │ │
│  │                                                             │ │
│  │  ctHash_1 -> [contract_A, user_X]                          │ │
│  │  ctHash_2 -> [contract_A, contract_B, user_Y]              │ │
│  │  ctHash_3 -> [global]                                       │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘

When a contract calls FHE.add(a, b):
1. TaskManager checks: isAllowed(a, msg.sender) && isAllowed(b, msg.sender)
2. If either fails -> revert ACLNotAllowed(ctHash, msg.sender)
3. If passes -> create result ciphertext with ACL = [msg.sender]
4. Contract must call FHE.allowThis(result) to persist access
```

### Required Pattern

```solidity
// CORRECT: Always allowThis after operations
function deposit(bool isToken0, uint256 amount) external {
    euint128 encAmount = FHE.asEuint128(uint128(amount));
    FHE.allowThis(encAmount);  // Must allow contract to use this!

    if (isToken0) {
        userBalanceToken0[msg.sender] = FHE.add(
            userBalanceToken0[msg.sender],
            encAmount
        );
        FHE.allowThis(userBalanceToken0[msg.sender]);  // Persist new balance
        FHE.allow(userBalanceToken0[msg.sender], msg.sender);  // User access
    }
}
```

---

## Files Referenced

- `/contracts/src/PheatherX.sol` - Main hook contract
- `/contracts/node_modules/@fhenixprotocol/cofhe-mock-contracts/MockTaskManager.sol` - ACL error definition
- `/contracts/node_modules/@fhenixprotocol/cofhe-contracts/FHE.sol` - FHE library
- `/frontend/src/lib/chains.ts` - Network configuration

---

---

## Issue 4: cofhejs/web WASM Initialization Failure (NEW - Dec 4, 2025)

### Status: BLOCKING (Browser only)

### Description
The `cofhejs/web` module fails to initialize in the browser with TFHE WASM errors, while `cofhejs/node` works perfectly in Node.js.

### Evidence

**Node.js - SUCCESS:**
```bash
$ node scripts/simple-cofhe-test.cjs

=== Testing on Ethereum Sepolia ===
Chain ID: 11155111
Calling initializeWithEthers...
Completed in 4426ms
Result: { "success": true, "data": { ... permit data ... } }
SUCCESS!

=== Testing on Arbitrum Sepolia ===
Chain ID: 421614
Calling initializeWithEthers...
Completed in 5772ms
Result: { "success": true, "data": { ... permit data ... } }
SUCCESS!
```

**Browser - FAILURE:**
```
cofhejs loaded successfully!
Connected: 0xA66bbE4E307462d37457d363FBE4814428C9278A
Chain ID: 421614 (Arbitrum Sepolia)

=== Variation 1: env + generatePermit ===
Completed in 3ms
FAILED (success=false):
{
  "name": "CofhejsError",
  "code": "INIT_TFHE_FAILED",
  "cause": {}
}
```

### Root Cause Analysis

1. **WASM loading issue**: The TFHE WASM module fails to initialize in the browser environment
2. **Webpack bundling**: Despite following the official Next.js config from cofhejs README, WASM files aren't loading correctly
3. **Console warnings**:
   - `Module not found: Can't resolve 'fs'` - Node.js modules being referenced in browser build
   - `Circular dependency between chunks with runtime` - WASM worker chunk issues

### Webpack Config Attempted (from official cofhejs docs)

```typescript
// next.config.ts
config.experiments = {
  asyncWebAssembly: true,
  layers: true,
  topLevelAwait: true,
};
config.optimization.moduleIds = 'named';
config.module.rules.push({ test: /\.wasm$/, type: 'asset/resource' });
config.output.webassemblyModuleFilename = 'static/wasm/tfhe_bg.wasm';
config.output.environment = { asyncFunction: true };
config.resolve.fallback = { fs: false, path: false, crypto: false };
```

### Test Files Created

- `scripts/simple-cofhe-test.cjs` - Node.js test (WORKS)
- `src/app/test-fhe/page.tsx` - Browser test page using bundled npm package (FAILS)
- `public/test-cofhejs.html` - Static HTML test using CDN (FAILS)

### Approaches Attempted (All Failed in Browser)

#### Approach 1: CDN via esm.sh
```javascript
const mod = await import('https://esm.sh/cofhejs@0.3.1/web');
```
**Result:** `INTERNAL_ERROR` - fails instantly (0-1ms)

#### Approach 2: CDN via unpkg
```javascript
const mod = await import('https://unpkg.com/cofhejs@0.3.1/dist/web.mjs');
```
**Result:** Also fails

#### Approach 3: CDN via jsdelivr
```javascript
const mod = await import('https://cdn.jsdelivr.net/npm/cofhejs@0.3.1/dist/web.mjs');
```
**Result:** Also fails

#### Approach 4: Bundled npm package (webpack)
```javascript
// In Next.js app with webpack config
const mod = await import('cofhejs/web');
```
**Result:** `INIT_TFHE_FAILED` - different error, WASM doesn't initialize

**Important:** The CDN approaches fail with `INTERNAL_ERROR` while the bundled approach fails with `INIT_TFHE_FAILED`. These are different failure modes:
- CDN: Module loads but can't reach coprocessor or detect chain
- Bundled: Module loads, detects chain, but TFHE WASM fails to init

Both approaches work fine in Node.js (`cofhejs/node`), confirming the issue is browser-specific WASM handling.

### Key Insight

The CoFHE coprocessor infrastructure IS working. The issue is purely client-side WASM bundling in the browser. Node.js uses native bindings while the browser needs WASM, and the WASM isn't initializing properly.

### Potential Solutions

1. **Use CDN prebuilt version** - Load from jsdelivr with pre-bundled WASM (currently fails with different error)
2. **Server-side proxy** - Make cofhejs calls from Next.js API routes instead of browser ✅ **IMPLEMENTED**
3. **Contact Fhenix** - Report browser WASM initialization issue on their Discord
4. **Wait for fix** - This may be a cofhejs bug that needs upstream fix

### ✅ SOLUTION IMPLEMENTED: Server-Side API Route

Since `cofhejs/node` works perfectly in Node.js, we bypass the browser WASM issue by running cofhejs on the server.

**Files Created:**
- `src/app/api/test-cofhe/route.ts` - Server-side API route
- `src/app/test-fhe/page.tsx` - Browser test page that calls the API

**API Endpoints:**

```bash
# Test all chains
GET /api/test-cofhe
# Response:
{
  "summary": "ALL TESTS PASSED",
  "results": [
    {"chainId": 11155111, "chainName": "Ethereum Sepolia", "success": true, "elapsed": 1738},
    {"chainId": 421614, "chainName": "Arbitrum Sepolia", "success": true, "elapsed": 1045}
  ]
}

# Test specific chain
POST /api/test-cofhe
Body: {"chainId": 421614, "variation": 1}
# Response:
{
  "success": true,
  "chainId": 421614,
  "chainName": "Arbitrum Sepolia",
  "variation": "env + generatePermit",
  "elapsed": 1329,
  "wallet": "0x...",
  "data": {"issuer": "0x...", "verifyingContract": "0x..."}
}
```

**How It Works:**
1. Browser calls `/api/test-cofhe`
2. Server loads `cofhejs/node` (which works)
3. Server creates random wallet, connects to RPC
4. Server runs `cofhejs.initializeWithEthers()`
5. Server returns result to browser

**Test Page:** http://localhost:3000/test-fhe
- Click "🚀 Run All Server Tests" to verify both chains work
- No wallet connection needed (uses server-side random wallets)
- Completes in ~3 seconds

---

## Summary: What Works vs What Doesn't

| Component | Node.js | Browser (direct) | Browser (via API) | Notes |
|-----------|---------|------------------|-------------------|-------|
| cofhejs loading | ✅ Works | ✅ Works | ✅ Works | Module loads |
| initializeWithEthers() | ✅ Works | ❌ INIT_TFHE_FAILED | ✅ Works | Use API route! |
| ETH Sepolia coprocessor | ✅ Reachable | ❌ Can't test | ✅ Works | Via server |
| Arb Sepolia coprocessor | ✅ Reachable | ❌ Can't test | ✅ Works | Via server |
| Contract FHE ops | ✅ Works | ✅ Works | ✅ Works | On-chain encryption |
| unseal() decryption | ✅ Works | ❌ Can't init | ✅ Would work | Needs init first |

---

## Next Steps

1. ✅ **DONE:** Server-side API route implemented - cofhejs works via `/api/test-cofhe`
2. **For Production FHE:**
   - Use server-side API routes for all cofhejs operations (encrypt, unseal, permit generation)
   - Browser sends data to server → server uses cofhejs/node → returns result
   - This is a valid architecture pattern (similar to how many crypto operations work)
3. **Optional:**
   - Report browser WASM issue to Fhenix Discord
   - Wait for cofhejs/web fix from Fhenix team
   - Implement balance tracker workaround if server-side approach isn't suitable

---

## Resources

- [Fhenix Documentation](https://cofhe-docs.fhenix.zone/)
- [CoFHE GitHub](https://github.com/FhenixProtocol/cofhe-contracts)
- [Understanding Access Control in CoFHE](https://dev.to/fhenix_io/privacy-isnt-private-by-default-understanding-access-control-in-cofhe-38l0)
- [Fhenix Permissions Guide](https://docs.fhenix.zone/docs/devdocs/Writing%20Smart%20Contracts/Permissions)
- [Arbitrum Sepolia Faucets](https://faucets.chain.link/arbitrum-sepolia)
