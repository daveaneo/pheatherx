# PheatherX Integration Tests

These tests run against **real FHE** on Arbitrum Sepolia using the CoFHE coprocessor.

## Prerequisites

1. **Testnet ETH** - Get Arb Sepolia ETH from a faucet
2. **Environment Setup** - Copy `.env.example` to `.env` and fill in your values
3. **Deploy Contracts** - Run the deployment script first

## Quick Start

```bash
# 1. Setup environment
cp .env.example .env
# Edit .env with your PRIVATE_KEY and ARB_SEPOLIA_RPC

# 2. Deploy contracts (only needed once)
npm run deploy:arb-sepolia

# 3. Run integration tests
npm run test:integration
```

## Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run unit tests (fast, mock FHE) |
| `npm run test:unit` | Same as above, explicitly exclude integration |
| `npm run test:integration` | Run integration tests (real FHE on Arb Sepolia) |
| `npm run deploy:arb-sepolia` | Deploy contracts to Arb Sepolia |

## How It Works

### Unit Tests (Mock FHE)
- Located in `test/PheatherX.t.sol`
- Use `CoFheTest` which provides mock FHE operations
- Fast, free, runs locally
- Good for development and CI/CD

### Integration Tests (Real FHE)
- Located in `test/integration/`
- Fork Arbitrum Sepolia where CoFHE is deployed
- Real FHE encryption/decryption via CoFHE coprocessor
- May take longer (FHE operations are processed off-chain)
- Requires testnet ETH for gas

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Integration Test (this file)                                    │
│  - Forks Arb Sepolia                                            │
│  - Loads deployed addresses from deployments/arb-sepolia.json   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PheatherX Hook (on Arb Sepolia)                                 │
│  - Calls FHE.asEuint128(), FHE.add(), etc.                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  TaskManager @ 0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9       │
│  - Receives FHE operation requests                              │
│  - Queues tasks for CoFHE coprocessor                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (off-chain)
┌─────────────────────────────────────────────────────────────────┐
│  CoFHE Coprocessor                                               │
│  - Performs actual TFHE operations                              │
│  - Submits results back on-chain                                │
└─────────────────────────────────────────────────────────────────┘
```

## Deployment Persistence

After running `npm run deploy:arb-sepolia`, addresses are saved to `deployments/arb-sepolia.json`:

```json
{
  "chainId": 421614,
  "contracts": {
    "token0": "0x...",
    "token1": "0x...",
    "hook": "0x...",
    "poolManager": "0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317",
    "taskManager": "0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9"
  }
}
```

This allows you to deploy once and run tests multiple times without redeploying.

## Troubleshooting

### "Insufficient token balance"
Your test wallet needs tUSDC/tWETH tokens. After deployment, tokens are minted to the deployer address.

### "File not found: deployments/arb-sepolia.json"
Run `npm run deploy:arb-sepolia` first to deploy contracts and create the deployment file.

### FHE operations timeout
The CoFHE coprocessor processes operations asynchronously. If tests timeout, the coprocessor may be under heavy load. Try again later.

### "Execution reverted"
Check that:
1. Pool has been initialized (deployment script does this)
2. Token approvals are set
3. You have enough testnet ETH for gas
