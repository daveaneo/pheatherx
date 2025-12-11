# Page Testing Issues Tracker

## Pages to Test
- [x] / (home) - ✅ 200 OK
- [x] /trade - ✅ 200 OK (NEW - unified trading page)
- [x] /swap - ✅ Redirects to /trade
- [x] /liquidity - ✅ 200 OK
- [x] /orders/new - ✅ Redirects to /trade
- [x] /orders/active - ✅ Redirects to /trade
- [x] /orders/history - ✅ Redirects to /trade
- [x] /portfolio - ✅ 200 OK
- [x] /auctions - ✅ 200 OK
- [x] /launchpad - ✅ 200 OK
- [x] /faucet - ✅ Redirects to /portfolio
- [x] /analytics - ✅ Redirects to /

## Issues Found and Fixes

### Issue 1: tfhe WASM fails during SSR ✅ FIXED
- **Page**: All pages using FheSessionGuard (/swap, /portfolio, /orders/new)
- **Error**: `Module not found: Can't resolve 'wbg'` in `tfhe_bg.wasm`
- **Cause**: FheSessionGuard imports useFheSession which imports singleton.ts which had `import('cofhejs/web')`. Even dynamic imports are analyzed by webpack at build time.
- **Import chain**:
  ```
  swap/page.tsx -> FheSessionGuard -> useFheSession -> singleton.ts -> cofhejs/web -> tfhe -> tfhe_bg.wasm
  ```
- **Fix**: Used `/* webpackIgnore: true */` magic comment with a variable module name to prevent webpack from analyzing the import:
  ```typescript
  const moduleName = 'cofhejs/web';
  const mod = await import(/* webpackIgnore: true */ moduleName);
  ```
- **Status**: ✅ FIXED

### Issue 2: Next.js 16 defaults to Turbopack ✅ FIXED
- **Error**: Next.js 16 uses Turbopack by default, which has issues with cofhejs/WASM
- **Fix**: Updated `package.json` to explicitly use `--webpack` flag:
  ```json
  "dev": "next dev --webpack",
  "build": "next build --webpack"
  ```
- **Status**: ✅ FIXED

### Issue 3: Service worker Response.clone() error ✅ FIXED
- **Error**: `TypeError: Failed to execute 'clone' on 'Response': Response body is already used`
- **Cause**: In `sw.js`, `response.clone()` was called after the response was already returned
- **Fix**: Clone the response BEFORE using it:
  ```javascript
  const responseToCache = response.clone();
  cache.put(event.request, responseToCache);
  ```
- **Status**: ✅ FIXED

### Issue 4: /trade route not in DAPP_ROUTES ✅ FIXED
- **Page**: /trade (new unified trading page)
- **Error**: Trade page showed homepage header instead of dApp header with wallet connection
- **Cause**: `DAPP_ROUTES` array in `src/lib/routes.ts` did not include `/trade`
- **Fix**: Added `/trade` to the `DAPP_ROUTES` array:
  ```typescript
  export const DAPP_ROUTES = [
    '/trade',      // Unified trading page (swaps + orders)
    '/swap',       // Legacy - redirects to /trade
    // ...
  ];
  ```
- **Status**: ✅ FIXED

### Issue 5: SEAL_OUTPUT_RETURNED_NULL when revealing FHERC20 balances ✅ FIXED
- **Page**: /portfolio (TokenBalanceTable component)
- **Error**: `CofhejsError: SEAL_OUTPUT_RETURNED_NULL` when clicking "Reveal" on encrypted balances
- **Symptoms**:
  - FHE session initialized successfully
  - Encrypted balance handle retrieved from contract
  - Unseal failed after 3 retry attempts
- **Root Cause**: **Permit signature mismatch**
  - The FHERC20 contract calls `FHE.allow(ciphertext, userAddress)` granting unseal permission to the user's wallet address
  - The server-side API (`/api/fhe`) was creating a **random wallet** to sign the permit
  - CoFHE service rejected the unseal because the permit signer (`0xRandomWallet...`) didn't match the address granted permission (`0xUserWallet...`)
  - Per Fhenix docs: "If you forget `allow()`, `unseal()` will silently fail with `SEAL_OUTPUT_RETURNED_NULL`" - same error occurs when permit signer doesn't match allowed address
- **Investigation Steps**:
  1. Created test script to verify contract has `FHE.allow()` calls ✅
  2. Verified user's wallet address matches permit issuer - **MISMATCH FOUND**
  3. Created `/test-cofhejs-web` page to test client-side cofhejs with user's actual wallet
  4. Confirmed unseal works when permit is signed by user's wallet
- **Fix**: Rewrote `src/lib/fhe/singleton.ts` to use `cofhejs/web` client-side instead of server-side API
  - **Before**: Server created random wallet → signed permit → user couldn't unseal (wrong signer)
  - **After**: Client uses user's actual wallet (via wagmi signer) → signs permit → unseal works
  ```typescript
  // Now uses cofhejs/web client-side with user's actual wallet
  const { cofhejs } = await import('cofhejs/web');
  const result = await cofhejs.initializeWithEthers({
    ethersProvider: provider,
    ethersSigner: signer,  // User's actual wallet from wagmi
    environment: 'TESTNET',
    generatePermit: true,
  });
  ```
- **Files Changed**:
  - `src/lib/fhe/singleton.ts` - Complete rewrite to use cofhejs/web client-side
  - `src/app/api/fhe/route.ts` - No longer used for permit generation (kept for backwards compatibility)
- **Related Documentation**: [Fhenix CoFHE Access Control](https://dev.to/fhenix_io/privacy-isnt-private-by-default-understanding-access-control-in-cofhe-38l0)
- **Status**: ✅ FIXED

---
## Remaining Warnings (Non-blocking)
These are informational warnings that don't affect functionality:
- WalletConnect Core re-initialization warnings (HMR in dev mode)
- Multiple Lit versions warning (common with wallet libraries)
- punycode deprecation warning (Node.js internal)

---

## E2E Test Results

### Audit Date: December 2024

**Test Suite Summary: 45 tests, all passing**

| Test Suite | Tests | Status |
|------------|-------|--------|
| Route Redirects | 6 | ✅ All passing |
| Trade Page | 9 | ✅ All passing |
| Portfolio Page | 11 | ✅ All passing |
| Liquidity Page | 5 | ✅ All passing |
| Navigation | 8 | ✅ All passing |
| Route Accessibility | 6 | ✅ All passing |

### Test Coverage
- **Redirects**: /swap, /faucet, /orders/*, /analytics all redirect correctly
- **Trade Page**: Market swap form, limit order form, order book, active orders
- **Portfolio Page**: Balance cards, faucet section, positions, claims, history tabs
- **Liquidity Page**: Add/remove liquidity forms
- **Navigation**: Desktop nav, homepage links, route accessibility
- **Wallet Connection**: Test wallet auto-connects in test mode

---

## Deployments

### FheatherXFactory (Ethereum Sepolia)
- **Address**: `0xD196ED9FC8A0396131C7136076B19e19f6a3AcFC`
- **Deployed**: 2024-12-02
- **Registered Pool**: tWETH/tUSDC with hook `0x47712BED8Ae60A41B5d092A3Dc04cb19FF508AC8`

### FheatherX Hook (Ethereum Sepolia)
- **Address**: `0x877748c08B6e4848F3B22CCe813Ee91b7dD70aC8`

### Test Tokens (Ethereum Sepolia)
- **tWETH**: `0x3565E82F0eb0b176aC4dE04707548907433115dd`
- **tUSDC**: `0x7BdfD109de10dE98cD82Eb3E46c890beC7114110`

### Test Wallet (E2E Testing)
- **Address**: `0x60B9be2A29a02F49e8D6ba535303caD1Ddcb9659`
- **Funded with**: ETH, tWETH, tUSDC on Ethereum Sepolia and Local Anvil

---
*This document tracks issues found during page testing to avoid cyclical fixes*
