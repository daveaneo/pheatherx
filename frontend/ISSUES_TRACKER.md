# Page Testing Issues Tracker

## Pages to Test
- [x] / (home) - ✅ 200 OK
- [x] /swap - ✅ 200 OK
- [x] /liquidity - ✅ 200 OK
- [x] /orders/new - ✅ 200 OK
- [x] /portfolio - ✅ 200 OK
- [x] /auctions - ✅ 200 OK
- [x] /launchpad - ✅ 200 OK
- [x] /faucet - ✅ 200 OK

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

---
## Remaining Warnings (Non-blocking)
These are informational warnings that don't affect functionality:
- WalletConnect Core re-initialization warnings (HMR in dev mode)
- Multiple Lit versions warning (common with wallet libraries)
- punycode deprecation warning (Node.js internal)

---

## Deployments

### PheatherXFactory (Ethereum Sepolia)
- **Address**: `0xD196ED9FC8A0396131C7136076B19e19f6a3AcFC`
- **Deployed**: 2024-12-02
- **Registered Pool**: tWETH/tUSDC with hook `0x47712BED8Ae60A41B5d092A3Dc04cb19FF508AC8`

---
*This document tracks issues found during page testing to avoid cyclical fixes*
