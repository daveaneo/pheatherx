# FheatherX

Private DEX built on Fully Homomorphic Encryption (FHE) as a Uniswap v4 Hook.

## Project Structure

```
fheatherx/
├── contracts/          # Solidity smart contracts (Foundry)
│   ├── src/           # Contract source files
│   │   ├── FheatherXv4.sol    # Uniswap v4 Hook (current)
│   │   ├── FheatherXv3.sol    # Standalone private DEX
│   │   └── tokens/            # FHERC20 token contracts
│   ├── test/          # Foundry tests
│   └── script/        # Deployment scripts
├── frontend/          # Next.js web application
│   ├── src/
│   │   ├── app/       # Next.js App Router pages
│   │   ├── components/# React components
│   │   ├── hooks/     # React hooks for contract interaction
│   │   ├── lib/       # Utilities and configuration
│   │   └── stores/    # Zustand state management
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
# Deploy to Ethereum Sepolia
cd contracts
source .env
forge script script/DeployEthSepolia.s.sol --rpc-url $ETH_SEPOLIA_RPC --broadcast

# Deploy FheatherXv4 Hook
forge script script/DeployFheatherXv4.s.sol --rpc-url $RPC_URL --broadcast
```

## Architecture

### FheatherXv4 (Uniswap v4 Hook)
- **afterInitialize**: Sets up encrypted pool state
- **afterSwap**: Matches limit orders against swap price movement
- Uses Fhenix CoFHE for FHE encryption (euint128 encrypted amounts)
- Bucketed limit orders at tick price levels

### Key Concepts
- **Buckets**: Price levels where limit orders accumulate (SELL/BUY sides)
- **Proceeds-per-share**: Accumulator model for fair order fills
- **FHE Session**: User must initialize CoFHE session before encrypted operations
- **Tick Spacing**: 60 (all ticks must be multiples of 60)

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
2. **CoFHE API**: Uses async operations - encryption happens client-side, decryption requires network round-trip
3. **Test Mode**: Set `NEXT_PUBLIC_TEST_MODE=true` for E2E testing with mock wallet
4. **Gas Costs**: FHE operations are gas-intensive (~500k+ gas for deposits)

## Fhenix Integration

FheatherX uses Fhenix's CoFHE (Coprocessor FHE) for privacy:
- **euint128**: Encrypted 128-bit unsigned integers for balances
- **FHE.allowThis()**: Grant contract permission to operate on encrypted values
- **Common.isInitialized()**: Check if encrypted value is initialized
- **FHERC20**: ERC20 tokens with encrypted balances

## Links

- Fhenix Docs: https://docs.fhenix.zone
- Uniswap v4 Docs: https://docs.uniswap.org/contracts/v4/overview
