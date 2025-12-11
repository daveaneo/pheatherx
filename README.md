# FheatherX - Private DEX with FHE

**Trade in Silence. Your orders, encrypted on-chain.**

FheatherX is a private decentralized exchange built as a **Uniswap v4 Hook** using **Fhenix's Fully Homomorphic Encryption (FHE)**. All order amounts and balances are encrypted - no one can see your trading strategies, not even validators. [improve: FheatherX supports 4 types of limit orders for fhe tokens: [list them] and swapping between erc20 and fheerc20, compatibly with existing pools]

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
│   │   ├── FheatherXv6.sol      # Current Uniswap v4 Hook (Hybrid AMM + Limit Orders)
│   │   ├── FheatherXv5.sol      # Previous version
│   │   └── tokens/              # FHERC20 implementations
│   ├── deployments/             # Deployment tracking (source of truth)
│   │   ├── v6-eth-sepolia.json  # Ethereum Sepolia addresses
│   │   └── v6-arb-sepolia.json  # Arbitrum Sepolia addresses
│   └── test/
├── frontend/
│   ├── src/
│   │   ├── app/                 # Next.js pages
│   │   ├── components/          # React components
│   │   ├── hooks/               # Contract interaction hooks
│   │   └── lib/
│   │       └── tokens.ts        # Token configuration per chain
│   └── e2e/                     # Playwright E2E tests
└── docs/
```

## Deployment Configuration

### Source of Truth

The `contracts/deployments/*.json` files are the **source of truth** for all deployed addresses:

```json
{
  "version": "v6",
  "chainId": 11155111,
  "contracts": {
    "hook": "0x...",
    "poolManager": "0x...",
    "swapRouter": "0x..."
  },
  "tokens": {
    "WETH": { "address": "0x...", "decimals": 18, "type": "ERC20" },
    "fheWETH": { "address": "0x...", "decimals": 18, "type": "FHERC20" }
  },
  "pools": { ... }
}
```

### Configuration Files

| File | Purpose |
|------|---------|
| `contracts/deployments/v6-*.json` | Complete deployment info (tokens, pools, poolIds) |
| `frontend/.env` | Contract addresses for frontend |
| `frontend/src/lib/tokens.ts` | Token metadata per chain |

### Environment Variables

```bash
# Ethereum Sepolia (Chain ID: 11155111)
NEXT_PUBLIC_POOL_MANAGER_ADDRESS_ETH_SEPOLIA=0x...
NEXT_PUBLIC_SWAP_ROUTER_ADDRESS_ETH_SEPOLIA=0x...
NEXT_PUBLIC_FHEATHERX_ADDRESS_ETH_SEPOLIA=0x...

# Arbitrum Sepolia (Chain ID: 421614)
NEXT_PUBLIC_POOL_MANAGER_ADDRESS_ARB_SEPOLIA=0x...
NEXT_PUBLIC_SWAP_ROUTER_ADDRESS_ARB_SEPOLIA=0x...
NEXT_PUBLIC_FHEATHERX_ADDRESS_ARB_SEPOLIA=0x...
```

### Supported Tokens

Each chain supports 4 tokens (2 ERC20 + 2 FHERC20):

| Token | Symbol | Type | Decimals |
|-------|--------|------|----------|
| Wrapped Ether | WETH | ERC20 | 18 |
| USD Coin | USDC | ERC20 | 6 |
| FHE Wrapped Ether | fheWETH | FHERC20 | 18 |
| FHE USD Coin | fheUSDC | FHERC20 | 6 |

### After Deployment Workflow

1. Deploy contracts → script creates `contracts/deployments/v6-{chain}.json`
2. Update `frontend/src/lib/tokens.ts` with token addresses
3. Update `frontend/.env` with hook/router addresses

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

## Improvements over iceberg-cofhe (Legacy FHE Orderbooks)

https://github.com/marronjo/iceberg-cofhe

FheatherX represents a paradigm shift from first-generation FHE DEXs. While implementations like `iceberg-cofhe` proved the concept of hidden orders, they suffer from fundamental $O(N)$ scaling issues and "Walled Garden" isolation. FheatherX solves these via **Uniswap V4 Hooks**, **Tick-Based Bucketing**, and **Transient Storage**.

### 1. Algorithmic Matching: O(1) Deterministic vs. O(N) Blind Search
**The Scalability Bottleneck (Iceberg):**
Because an encrypted contract cannot "see" prices to sort them, legacy FHE orderbooks act like an unsorted list (a "Haystack"). To find a match, the contract must pay gas to blind-compare the taker's price against every single maker order ($O(N)$ complexity).
*   *Failure Mode:* If there are 50 open orders, a taker transaction often runs out of gas before finding the matching order, causing the trade to fail even if liquidity exists.

**The FheatherX Solution: Pre-Sorted Tick Buckets.**
FheatherX shifts the sorting burden to the user via "Tick Buckets" (like slots in a vending machine).
*   *Mechanism:* The contract uses `TickMath` to map the current price directly to a specific bucket index.
*   *Result:* **$O(1)$ Constant Gas Cost.** The contract grabs the exact bucket for the current price instantly. It does not search; it fetches. This makes the system scalable to thousands of orders.

### 2. Execution UX: Synchronous "JIT" vs. Asynchronous Keepers
**The "Frozen Market" Problem (Iceberg):**
Matching is **Asynchronous**. A user places an order (Tx 1), but nothing happens until a second transaction (Tx 2) explicitly attempts to match it.
*   *Friction:* Markets remain "frozen" without off-chain Keepers paying gas to run the matching engine.

**The FheatherX Solution: Atomic "Crank" Hooks.**
FheatherX leverages the Uniswap V4 `afterSwap` hook to turn every standard swap into an **Atomic Crank**.
*   *Mechanism:* Every time a user swaps against the pool, the contract synchronously checks the `TickBitmap`. If the price crosses a populated bucket, the limit orders are filled *in the same transaction*.
*   *Result:* "Just-In-Time" (JIT) Liquidity. Takers get deeper liquidity automatically, and Makers get instant fills without waiting for Keepers.

### 3. MEV Protection: Transient Storage vs. Atomic Sandwiches
**The "Sandwich" Vulnerability (Standard AMMs & FHE DEXs):**
Even with encrypted amounts, MEV bots can blindly attack trades by ordering transactions: 1. Buy (Push Price Up) -> 2. Victim Buy -> 3. Sell (Profit).

**The FheatherX Solution: Transient Direction Lock.**
FheatherX introduces a **Transient Storage** check (EIP-1153 pattern) to enforce unidirectional trading per transaction.
*   *Mechanism:* When a transaction initiates a swap (e.g., `Token A -> B`), the hook sets a transient flag. If the same transaction attempts to swap back (`Token B -> A`), the hook reverts.
*   *Result:* It becomes impossible for a single contract to perform an atomic sandwich attack (Buy-and-Sell in one go), forcing attackers to take multi-block market risk.

### 4. Integration: Cross-Pool Composability vs. Walled Gardens
**The Isolation Problem (Iceberg):**
Legacy systems act as isolated islands. They usually support `FHERC20` only and cannot communicate with other DEXs. To trade `ETH -> PrivateToken`, a user must perform multiple manual steps across different dApps.

**The FheatherX Solution: V4 Router Integration.**
By building on Uniswap V4, FheatherX pools become natively composable with the entire DeFi ecosystem.
*   *Mechanism:* FheatherX plugs into the **Universal Router**.
*   *Result:* **Cross-Swapping.** A user can execute a single transaction that routes `ETH` through a standard Uniswap V3 pool, converts it to `USDC`, and then swaps that `USDC` into a private `FHE-Token` inside FheatherX. The privacy layer is fully integrated into the global liquidity layer.
* 

## Links

- **Live Demo**: [TBD]
- **GitHub**: https://github.com/[username]/fheatherx
- **Fhenix Docs**: https://docs.fhenix.zone
- **Uniswap v4**: https://docs.uniswap.org/contracts/v4/overview

---

Built for Hookathon 2024. Private trading, powered by FHE.
