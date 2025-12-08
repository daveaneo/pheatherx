# FheatherX

Private DEX built on Fully Homomorphic Encryption (FHE) as a Uniswap v4 Hook.

## Project Structure

```
fheatherx/
├── contracts/          # Solidity smart contracts (Foundry)
│   ├── src/           # Contract source files
│   │   ├── FheatherXv5.sol    # Uniswap v4 Hook - Hybrid AMM + Limit Orders (CURRENT)
│   │   ├── FheatherXv4.sol    # Limit orders only (deprecated)
│   │   ├── FheatherXFactory.sol # Pool factory for multi-pool support
│   │   ├── FheatherXv3.sol    # Legacy standalone DEX (deprecated)
│   │   ├── FheatherXv2.sol    # Legacy (deprecated)
│   │   └── tokens/            # FHERC20 token contracts
│   ├── test/          # Foundry tests
│   └── script/        # Deployment scripts
├── frontend/          # Next.js web application
│   ├── src/
│   │   ├── app/       # Next.js App Router pages
│   │   ├── components/# React components
│   │   ├── hooks/     # V4 React hooks (useSwap, usePlaceOrder, etc.)
│   │   ├── lib/       # Utilities and configuration
│   │   └── stores/    # Zustand state management (poolStore, etc.)
│   └── e2e/           # Playwright E2E tests
└── docs/              # Documentation
```

## Key Commands

### Contracts (Foundry)
```bash
cd contracts
forge build              # Build contracts
forge test               # Run tests
forge test -vvv          # Verbose test output
```

### Frontend (Next.js)
```bash
cd frontend
npm install              # Install dependencies
npm run dev              # Start dev server (port 3000)
npm run build            # Production build
npm run test:e2e         # Run Playwright E2E tests
```

### Deployment
```bash
# Deploy to Ethereum Sepolia (FheatherXv4 + tokens + factory)
cd contracts
source .env
forge script script/DeployEthSepolia.s.sol --rpc-url $ETH_SEPOLIA_RPC --broadcast

# Deploy factory only
forge script script/DeployFactory.s.sol --rpc-url $ETH_SEPOLIA_RPC --broadcast

# Deploy faucet tokens (fheWETH, fheUSDC, etc.)
forge script script/DeployFaucetTokens.s.sol --rpc-url $ETH_SEPOLIA_RPC --broadcast
```

## Architecture

### FheatherXv5 (Current - Uniswap v4 Hook)

FheatherXv5 is a **Hybrid Encrypted AMM + Private Limit Orders** system combining:

**From V2 (AMM):**
- Encrypted reserves (`encReserve0`, `encReserve1`) with x*y=k FHE math
- Always-available liquidity from LP deposits
- Dual swap paths: hook-based and direct `swapEncrypted()`
- LP functions: `addLiquidity`, `removeLiquidity` (plaintext + encrypted)

**From V4 (Limit Orders):**
- Gas-optimized limit orders with tick bitmap for O(1) lookup
- Bucketed orders with proceeds-per-share accumulators
- Pre-computed tick prices (1.006^tick)

**Key Change from V4:** V4 routed ALL swaps through limit order buckets (failed if no orders). V5 routes swaps through the encrypted AMM first (always succeeds), then triggers limit orders on price movement.

For comprehensive details, see: [docs/fheatherx-v5/summary.md](docs/fheatherx-v5/summary.md)

### Key Concepts
- **Encrypted AMM:** x*y=k formula with FHE math on encrypted reserves
- **Limit Orders**: Placed at specific tick prices with encrypted amounts
- **Tick Prices**: Price levels where orders execute (tick spacing: 60, range: -6000 to +6000)
- **Proceeds-per-share**: Accumulator model for fair order fills
- **FHE Session**: User must initialize CoFHE session before encrypted operations
- **Multi-pool Support**: Frontend supports multiple token pairs via `useSelectedPool()` hook

## Tokens (Ethereum Sepolia)

The dApp supports 4 tokens (2 ERC20 + 2 FHERC20), enabling 24 potential trading pairs:

| Token | Symbol | Type | Decimals | Address |
|-------|--------|------|----------|---------|
| WETH | WETH | ERC20 | 18 | `0xe9Df64F549Eb1d2778909F339B9Bd795d14cF32E` |
| USDC | USDC | ERC20 | 6 | `0xF7Ff2A5E74eaA6E0463358BB26780049d3D45C56` |
| FHE WETH | fheWETH | FHERC20 | 18 | `0xf0F8f49b4065A1B01050Fa358d287106B676a25F` |
| FHE USDC | fheUSDC | FHERC20 | 6 | `0x1D77eE754b2080B354733299A5aC678539a0D740` |

**Note:** All tokens have a `faucet()` function that mints 100 tokens per call.

### Frontend V4 Hooks
All frontend hooks are V4-compatible and use `useSelectedPool()` for multi-pool support:

| Hook | Purpose |
|------|---------|
| `useSwap` | Execute market swaps |
| `usePlaceOrder` | Place encrypted limit orders |
| `useCancelOrder` | Cancel active orders |
| `useActiveOrders` | Fetch user's active order IDs |
| `useDeposit` | Deposit tokens to hook contract |
| `useCurrentPrice` | Get current pool price |
| `useBalanceReveal` | Decrypt and reveal FHE balances |
| `useAggregatedBalanceReveal` | Reveal balances across all pools |

### Pool Store
The `poolStore` (Zustand) manages multi-pool state:
- `useSelectedPool()` - Returns current pool's `{ hookAddress, token0, token1 }`
- `PoolSelector` component - UI for switching between pools

## Environment Variables

### Frontend (.env)
```
NEXT_PUBLIC_FHEATHERX_ADDRESS_ETH_SEPOLIA=0x...
NEXT_PUBLIC_FHEATHERX_FACTORY_ADDRESS_ETH_SEPOLIA=0x...
NEXT_PUBLIC_TOKEN0_ADDRESS_ETH_SEPOLIA=0x...
NEXT_PUBLIC_TOKEN1_ADDRESS_ETH_SEPOLIA=0x...
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...
```

### Contracts (.env)
```
PRIVATE_KEY=0x...
ETH_SEPOLIA_RPC=https://ethereum-sepolia-rpc.publicnode.com
POOL_MANAGER=0x...
```

## Important Notes

1. **FHE Session Required**: Users must click "Initialize FHE Session" before any encrypted operations
2. **CoFHE API**: Uses async operations - encryption happens server-side via `/api/fhe` route
3. **Test Mode**: Set `NEXT_PUBLIC_TEST_MODE=true` for E2E testing with mock wallet
4. **Gas Costs**: FHE operations are gas-intensive (~500k+ gas for deposits)
5. **V5 Architecture**: Hybrid AMM + Limit Orders (V4 was limit orders only, V3 was standalone AMM)

## Fhenix Integration

FheatherX uses Fhenix's CoFHE (Coprocessor FHE) for privacy:
- **euint128**: Encrypted 128-bit unsigned integers for balances
- **FHE.allowThis()**: Grant contract permission to operate on encrypted values
- **Common.isInitialized()**: Check if encrypted value is initialized
- **FHERC20**: ERC20 tokens with encrypted balances

## Key Documentation

These documents contain important project context:

- **[VISION.md](docs/VISION.md)**: Project vision - "Trade in Silence", MEV protection, FHE privacy model
- **[fheatherx-v5/summary.md](docs/fheatherx-v5/summary.md)**: Comprehensive FheatherXv5 contract reference with function signatures
- **[future-features.md](docs/future-features.md)**: Planned features including FHE.div optimization, periphery contracts
- **[ISSUES_AND_FIXES.md](ISSUES_AND_FIXES.md)**: Tracked issues and their resolutions (FHE ACL errors, session loops, WASM loading, etc.)
- **[token-pair-support.md](docs/token-pair-support.md)**: Token combination matrix - which operations are allowed for ERC20/FHERC20 pairs

## Links

- Fhenix Docs: https://docs.fhenix.zone
- Uniswap v4 Docs: https://docs.uniswap.org/contracts/v4/overview
