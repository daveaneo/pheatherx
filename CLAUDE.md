# FheatherX

Private DEX built on Fully Homomorphic Encryption (FHE) as a Uniswap v4 Hook.

## Project Structure

```
fheatherx/
├── contracts/          # Solidity smart contracts (Foundry)
│   ├── src/           # Contract source files
│   │   ├── FheatherXv4.sol    # Uniswap v4 Hook (CURRENT)
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

### FheatherXv4 (Uniswap v4 Hook)
- **afterInitialize**: Sets up encrypted pool state
- **afterSwap**: Matches limit orders against swap price movement
- Uses Fhenix CoFHE for FHE encryption (euint128 encrypted amounts)
- Order-based limit orders at tick price levels

### Key Concepts
- **Orders**: Limit orders placed at specific tick prices with encrypted amounts
- **Tick Prices**: Price levels where orders execute (tick spacing: 60)
- **Proceeds-per-share**: Accumulator model for fair order fills
- **FHE Session**: User must initialize CoFHE session before encrypted operations
- **Multi-pool Support**: Frontend supports multiple token pairs via `useSelectedPool()` hook

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
5. **V4 Only**: Frontend uses only V4 hooks - V3 hooks have been removed

## Fhenix Integration

FheatherX uses Fhenix's CoFHE (Coprocessor FHE) for privacy:
- **euint128**: Encrypted 128-bit unsigned integers for balances
- **FHE.allowThis()**: Grant contract permission to operate on encrypted values
- **Common.isInitialized()**: Check if encrypted value is initialized
- **FHERC20**: ERC20 tokens with encrypted balances

## Key Documentation

These documents contain important project context:

- **[VISION.md](docs/VISION.md)**: Project vision - "Trade in Silence", MEV protection, FHE privacy model
- **[ISSUES_AND_FIXES.md](ISSUES_AND_FIXES.md)**: Tracked issues and their resolutions (FHE ACL errors, session loops, WASM loading, etc.)
- **[token-pair-support.md](docs/token-pair-support.md)**: Token combination matrix - which operations are allowed for ERC20/FHERC20 pairs

## Links

- Fhenix Docs: https://docs.fhenix.zone
- Uniswap v4 Docs: https://docs.uniswap.org/contracts/v4/overview
