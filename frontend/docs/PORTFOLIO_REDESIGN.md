# Portfolio Page Redesign Plan

## Overview

Merge the Faucet functionality into the Portfolio page and remove the confusing Deposit/Withdraw concept.

## Current Issues

1. **Encoding bug**: Shows "&#x1F4B0;" instead of actual emoji
2. **Confusing "Deposit/Withdraw" tabs**: Implies moving tokens into/out of FheatherX private balances, but deposits only happen when adding liquidity
3. **"Private Balance" concept**: Conflates wallet balances with encrypted balances in FheatherX contracts

## New Design

### Page Structure

```
Portfolio
├── Your Tokens (4 cards, similar to current faucet design)
│   ├── tUSDC - Balance: X [Request more]
│   ├── tWETH - Balance: X [Request more]
│   ├── fheUSDC - Balance: 🔒 [Decrypt] [Request more]
│   └── fheWETH - Balance: 🔒 [Decrypt] [Request more]
├── [Get All Test Tokens] button
├── ETH Balance section (with faucet links)
└── Your Liquidity Positions (future feature)
```

### Token Cards

Each token card shows:
- Token icon and symbol
- Token type badge (ERC20 or FHE)
- Balance (plaintext for ERC20, encrypted with decrypt button for FHE)
- "Request" button to get 100 test tokens from faucet

### Key Changes

1. **Remove Faucet from navbar** - functionality moves to Portfolio
2. **Remove Deposit/Withdraw tabs** - not applicable for wallet balances
3. **Fix emoji encoding** - use actual emoji characters
4. **Unified token display** - same card design for all 4 tokens
5. **Clear distinction** - ERC20 vs FHE tokens with badges

## Implementation Steps

1. Update Portfolio page component to use FaucetTokenList design
2. Remove Deposit/Withdraw tabs and related components
3. Add ETH faucet section (from current FaucetEthRequest)
4. Add "Get All Tokens" button
5. Remove Faucet from navigation
6. Fix emoji encoding issues
7. (Future) Add liquidity positions section

## Files to Modify

- `src/app/portfolio/page.tsx` - Main redesign
- `src/components/layout/Navbar.tsx` - Remove Faucet link
- `src/components/portfolio/` - Remove/update components
- `src/components/faucet/` - Reuse FaucetTokenList design

## Navigation After Change

```
Swap | Liquidity | Orders | Portfolio | Auctions | Launchpad
```

(Faucet removed, functionality in Portfolio)
