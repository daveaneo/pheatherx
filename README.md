# FheatherX - Private DEX with FHE

**Trade in Silence. Your orders, encrypted on-chain.**

FheatherX is a private decentralized exchange built as a **Uniswap v4 Hook** using **Fhenix's Fully Homomorphic Encryption (FHE)**. FheatherXv6 combines a **Hybrid Encrypted AMM** with **Private Limit Orders** - supporting swaps and liquidity provision across ERC20 and FHERC20 token pairs. All order amounts and balances are encrypted - no one can see your trading strategies, not even validators.

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

FheatherXv6 is a Hybrid AMM + Limit Order system implemented as a Uniswap v4 Hook:

```solidity
contract FheatherXv6 is BaseHook, ReentrancyGuard, Pausable, Ownable {
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,      // Initialize encrypted pool state
            beforeSwap: true,           // Execute AMM swap logic
            afterSwap: true,            // Process triggered limit orders
            beforeSwapReturnsDelta: true, // Return swap amounts
            // ...
        });
    }
}
```

### v6 Hybrid Architecture

FheatherXv6 combines two systems:

1. **Encrypted AMM**: x*y=k constant product formula with FHE math on encrypted reserves
2. **Private Limit Orders**: Tick-based bucketed orders with proceeds-per-share fair fills

Every swap routes through the AMM first (always-available liquidity), then triggers any limit orders at crossed price ticks.


## Partner Integrations

### Fhenix (Primary Integration)

FheatherX is built entirely on **Fhenix's CoFHE (Coprocessor FHE)** infrastructure, enabling fully private DEX operations where trade amounts, order sizes, and balances remain encrypted on-chain. We use Fhenix's `euint128` and `ebool` types for all sensitive values, perform arithmetic directly on encrypted data using `FHE.add`, `FHE.mul`, `FHE.div`, and leverage `FHE.select` for conditional logic without revealing branch conditions. Our FHERC20 tokens (fheWETH, fheUSDC) are built on Fhenix's encrypted token standard, and the frontend uses Fhenix's SDK for session management and client-side encryption.

| Feature | Code Location |
|---------|---------------|
| FHE imports (`euint128`, `ebool`, `FHE.*`) | `contracts/src/FheatherXv6.sol:14` |
| Encrypted constants (`ENC_ZERO`, `ENC_PRECISION`) | `contracts/src/FheatherXv6.sol:139-143` |
| Encrypted reserves & LP balances | `contracts/src/FheatherXv6.sol:152-159` |
| FHE swap math (`FHE.add`, `FHE.mul`, `FHE.div`) | `contracts/src/FheatherXv6.sol:443-484` |
| Encrypted order triggering (`FHE.xor`, `FHE.gte`, `FHE.select`) | `contracts/src/FheatherXv6.sol:607-637` |
| FHERC20 encrypted transfers | `contracts/src/FheatherXv6.sol:1214-1221` |
| Async decryption flow | `contracts/src/FheatherXv6.sol:1254-1281` |
| FHERC20 token implementation | `contracts/src/tokens/FhenixFHERC20Faucet.sol` |
| Frontend FHE session & encryption | `frontend/src/hooks/useFheClient.ts` |
| Frontend balance decryption | `frontend/src/hooks/useBalanceReveal.ts` |

### CoFHE Async Decryption Performance

FheatherX uses Fhenix's CoFHE for asynchronous decryption of encrypted values. Observed performance on **Arbitrum Sepolia**:

**Note**: Decryption is asynchronous - `FHE.decrypt()` requests decryption, and `FHE.getDecryptResultSafe()` polls for the result. The contract uses a binary search algorithm to efficiently find the newest resolved decrypt among pending requests.



### Uniswap v4

FheatherXv6 extends Uniswap v4's hook system:

| Feature | Code Location |
|---------|---------------|
| `BaseHook` implementation | `contracts/src/FheatherXv6.sol:31` |
| `beforeSwap` / `afterSwap` hooks | `contracts/src/FheatherXv6.sol:307-436` |
| `TickMath` for price calculations | `contracts/src/FheatherXv6.sol:1330-1379` |
| `PoolManager` integration | `contracts/src/FheatherXv6.sol:6-12` |




### Bucketed Limit Order System

Orders are placed at specific tick price levels (buckets):
- **SELL buckets**: Filled when price rises through the tick
- **BUY buckets**: Filled when price falls through the tick
- **Proceeds-per-share**: Fair distribution of fills across all LPs in a bucket

## Features

- **Hybrid AMM + Limit Orders**: Encrypted constant-product AMM with private limit order book
- **Multi-Pool Support**: ERC:ERC, ERC:FHE, FHE:FHE pool types with automatic routing
- **Encrypted Swaps**: Trade with hidden amounts via `swapEncrypted()`
- **Private Limit Orders**: Place buy/sell orders at specific ticks with encrypted amounts
- **LP Functions**: `addLiquidity` / `addLiquidityEncrypted` for providing liquidity
- **MEV Protection**: SwapLock prevents atomic sandwich attacks (one swap per pool per tx)
- **Portfolio Dashboard**: View encrypted balances with FHE decryption
- **Testnet Faucet**: Get test tokens (WETH, USDC, fheWETH, fheUSDC)
- **Multi-network**: Supports Ethereum Sepolia, Arbitrum Sepolia

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

### Contract Deployment (v8)

The unified deployment script handles everything: hook deployment, pool initialization, seeding, and frontend address updates.

```bash
cd contracts

# Full deployment to Arbitrum Sepolia
NETWORK=arb-sepolia node scripts/deploy-complete.cjs

# Full deployment to Ethereum Sepolia
NETWORK=eth-sepolia node scripts/deploy-complete.cjs

# Dry run (verify current deployment without changes)
DRY_RUN=true NETWORK=arb-sepolia node scripts/deploy-complete.cjs
```

**What `deploy-complete.cjs` does:**
1. Deploys v8FHE and v8Mixed hooks via Foundry
2. Initializes all 5 FHE pools (1 FHE:FHE + 4 Mixed)
3. Seeds v8Mixed pools via Foundry (plaintext amounts)
4. Seeds v8FHE pool via cofhejs (encrypted amounts)
5. Updates frontend addresses automatically
6. Saves deployment info to `deployments/v8-{network}-latest.json`

**Individual scripts (for manual steps):**
```bash
# Deploy hooks only
forge script script/DeployV8Only.s.sol --rpc-url $RPC --broadcast

# Initialize and seed v8Mixed pools
forge script script/InitAndSeedV8.s.sol --rpc-url $RPC --broadcast

# Seed v8FHE pool with encrypted liquidity (requires cofhejs)
NETWORK=arb-sepolia node scripts/seed-encrypted-liquidity.cjs
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

## Deployment Scripts

### Current Scripts (v8)

| Script | Purpose |
|--------|---------|
| `scripts/deploy-complete.cjs` | **Unified deployment** - does everything |
| `scripts/seed-encrypted-liquidity.cjs` | Seeds v8FHE pools with cofhejs |
| `script/DeployV8Only.s.sol` | Deploys hooks only (no pool init) |
| `script/InitAndSeedV8.s.sol` | Initializes pools + seeds v8Mixed |
| `script/DeployFaucetTokens.s.sol` | Deploys new FHERC20 faucet tokens |
| `script/SeedNativePool.s.sol` | Seeds native ERC:ERC pools |
| `script/SmokeTestV8.s.sol` | Basic v8 contract testing |
| `script/TestSwap.s.sol` | Swap functionality testing |

### Archived Scripts (in `old/` directories)

Legacy and one-time scripts have been moved to `script/old/` and `scripts/old/`.

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

## Current Deployment (Arbitrum Sepolia)

**Chain ID**: 421614

### Contracts

| Contract | Address |
|----------|---------|
| FheatherXv6 Hook | `0xa4522Bc1dA1880035835Aa7c281b566EBD2110c8` |
| Pool Manager | `0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317` |
| Swap Router | `0xf3A39C86dbd13C45365E57FB90fe413371F65AF8` |

### Tokens

| Token | Address | Type | Decimals |
|-------|---------|------|----------|
| WETH | `0xC5EcD76Db9f00B07088DDbFbdf7BF9927F6DDE13` | ERC20 | 18 |
| USDC | `0x00F7DC53A57b980F839767a6C6214b4089d916b1` | ERC20 | 6 |
| fheWETH | `0x7Da141eeA1F3c2dD0cC41915eE0AA19bE545d3e0` | FHERC20 | 18 |
| fheUSDC | `0x987731d456B5996E7414d79474D8aba58d4681DC` | FHERC20 | 6 |

### Pools

| Pool | Type | Pool ID |
|------|------|---------|
| WETH/USDC | ERC:ERC | `0x3b4ccdc9...` |
| fheWETH/fheUSDC | FHE:FHE | `0xb3449a4b...` |
| WETH/fheUSDC | ERC:FHE | `0x73e4eda6...` |
| fheWETH/USDC | FHE:ERC | `0x4d086d67...` |

## Links

- **GitHub**: https://github.com/davidjsonn/fheatherx
- **Fhenix Docs**: https://docs.fhenix.zone
- **Uniswap v4**: https://docs.uniswap.org/contracts/v4/overview

---

Built with Fhenix CoFHE. Private trading, powered by FHE.
