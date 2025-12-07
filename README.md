# FheatherX - Private DEX with FHE

**Trade in Silence. Your orders, encrypted on-chain.**

FheatherX is a private decentralized exchange built as a **Uniswap v4 Hook** using **Fhenix's Fully Homomorphic Encryption (FHE)**. All order amounts and balances are encrypted - no one can see your trading strategies, not even validators.

## Problem

Current DEXs expose all trading activity publicly on-chain:
- **Front-running**: Bots see your pending orders and trade ahead of you
- **Sandwich attacks**: MEV extractors profit by manipulating prices around your trades
- **Information leakage**: Competitors can analyze your trading patterns
- **Market manipulation**: Large orders reveal intent, moving prices against you

## Solution

FheatherX encrypts everything using FHE:
- **Encrypted Limit Orders**: Place buy/sell orders with hidden amounts
- **Private Balances**: Your deposited tokens are encrypted on-chain
- **MEV Protection**: Validators can't see order sizes to front-run
- **Fair Execution**: Proceeds-per-share model ensures equal fills

## Technical Architecture

### Uniswap v4 Hook Integration

FheatherXv4 is a proper Uniswap v4 Hook that extends the PoolManager:

```solidity
contract FheatherXv4 is BaseHook, ReentrancyGuard, Pausable, Ownable {
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,      // Set up encrypted pool state
            beforeSwap: false,
            afterSwap: true,            // Match limit orders
            // ...
        });
    }
}
```

### Fhenix FHE Integration

We use Fhenix's CoFHE (Coprocessor FHE) for encryption:

- **euint128**: 128-bit encrypted unsigned integers for balances/amounts
- **FHE.allowThis()**: ACL permissions for contract operations on encrypted values
- **FHERC20**: ERC20 tokens with fully encrypted balances
- **Client-side encryption**: Amounts encrypted before submission

### Bucketed Limit Order System

Orders are placed at specific tick price levels (buckets):
- **SELL buckets**: Filled when price rises through the tick
- **BUY buckets**: Filled when price falls through the tick
- **Proceeds-per-share**: Fair distribution of fills across all LPs in a bucket

## Features

- **Encrypted Swaps**: Trade token pairs with hidden amounts
- **Private Limit Orders**: Place hidden buy/sell orders at specific prices
- **Portfolio Dashboard**: View encrypted balances with FHE decryption
- **Testnet Faucet**: Get test tokens (tWETH, tUSDC, fheWETH, fheUSDC)
- **Multi-network**: Supports Ethereum Sepolia, Arbitrum Sepolia, Local Anvil

## Getting Started

### Prerequisites

- Node.js 18+
- Foundry (for contracts)
- A wallet with testnet ETH

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

### Contract Deployment

```bash
cd contracts
forge build
forge script script/DeployEthSepolia.s.sol --rpc-url $ETH_SEPOLIA_RPC --broadcast
```

## Project Structure

```
fheatherx/
├── contracts/
│   ├── src/
│   │   ├── FheatherXv4.sol      # Uniswap v4 Hook
│   │   ├── FheatherXv3.sol      # Standalone private DEX
│   │   └── tokens/              # FHERC20 implementations
│   └── test/
├── frontend/
│   ├── src/
│   │   ├── app/                 # Next.js pages
│   │   ├── components/          # React components
│   │   └── hooks/               # Contract interaction hooks
│   └── e2e/                     # Playwright E2E tests
└── docs/
```

## Demo

[Demo Video Link - TBD]

### Screenshots

**Homepage**
- Trade in Silence hero with stats bar

**Portfolio Dashboard**
- Encrypted balance cards with FHE decryption
- Testnet faucet for obtaining tokens

**Trade Interface**
- Swap and limit order placement
- Bucket visualization

## Partner Integrations

### Fhenix (Primary Integration)

FheatherX is built on **Fhenix's CoFHE** infrastructure:
- All balances stored as `euint128` encrypted values
- FHERC20 tokens for encrypted token transfers
- FHE session management for client-side encryption
- ACL-based permission system for secure multi-party computation

### Uniswap v4

FheatherXv4 extends Uniswap v4's hook system:
- Implements `BaseHook` interface
- Uses `afterSwap` callback to process limit orders
- Integrates with `PoolManager` for liquidity

## Team

Solo developer hackathon project

## Links

- **Live Demo**: [TBD]
- **GitHub**: https://github.com/[username]/fheatherx
- **Fhenix Docs**: https://docs.fhenix.zone
- **Uniswap v4**: https://docs.uniswap.org/contracts/v4/overview

---

Built for Hookathon 2024. Private trading, powered by FHE.
