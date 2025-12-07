# FheatherX Integration Tests

These tests run against **real FHE** using the CoFHE coprocessor on supported testnets.

## Supported Networks

| Network | Chain ID | Status |
|---------|----------|--------|
| Ethereum Sepolia | 11155111 | Recommended |
| Arbitrum Sepolia | 421614 | Supported |

## Prerequisites

1. **Testnet ETH** - Get testnet ETH from a faucet
2. **Environment Setup** - Copy `.env.example` to `.env` and fill in your values
3. **Deploy Contracts** - Run the deployment script first

## Quick Start (Ethereum Sepolia)

```bash
# 1. Setup environment
cp .env.example .env
# Edit .env with your PRIVATE_KEY and ETH_SEPOLIA_RPC

# 2. Deploy contracts (only needed once)
npm run deploy:eth-sepolia

# 3. Run integration tests
npm run test:integration:eth
```

## Quick Start (Arbitrum Sepolia)

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
| `npm run test:integration:eth` | Run integration tests (real FHE on Eth Sepolia) |
| `npm run deploy:arb-sepolia` | Deploy contracts to Arb Sepolia |
| `npm run deploy:eth-sepolia` | Deploy contracts to Eth Sepolia |

## How It Works

### Unit Tests (Mock FHE)
- Located in `test/FheatherX.t.sol`
- Use `CoFheTest` which provides mock FHE operations
- Fast, free, runs locally
- Good for development and CI/CD

### Integration Tests (Real FHE)
- Located in `test/integration/`
- Fork the testnet where CoFHE is deployed
- Real FHE encryption/decryption via CoFHE coprocessor
- May take longer (FHE operations are processed off-chain)
- Requires testnet ETH for gas

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Integration Test                                                │
│  - Forks testnet (Eth Sepolia or Arb Sepolia)                   │
│  - Loads deployed addresses from deployments/{network}.json     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  FheatherX Hook (deployed on testnet)                            │
│  - Calls FHE.asEuint128(), FHE.add(), etc.                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  TaskManager @ 0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9       │
│  - Receives FHE operation requests                              │
│  - Queues tasks for CoFHE coprocessor                           │
│  (Same address on all supported networks)                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (off-chain)
┌─────────────────────────────────────────────────────────────────┐
│  CoFHE Coprocessor                                               │
│  - Performs actual TFHE operations                              │
│  - Submits results back on-chain                                │
└─────────────────────────────────────────────────────────────────┘
```

## Network Addresses

### Ethereum Sepolia (Chain ID: 11155111)
| Contract | Address |
|----------|---------|
| PoolManager | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |
| PoolSwapTest | `0x9b6b46e2c869aa39918db7f52f5557fe577b6eee` |
| PositionManager | `0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4` |
| TaskManager (CoFHE) | `0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9` |

### Arbitrum Sepolia (Chain ID: 421614)
| Contract | Address |
|----------|---------|
| PoolManager | `0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317` |
| PoolSwapTest | `0xf3A39C86dbd13C45365E57FB90fe413371F65AF8` |
| PositionManager | `0xAc631556d3d4019C95769033B5E719dD77124BAc` |
| TaskManager (CoFHE) | `0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9` |

## Deployment Persistence

After deploying, addresses are saved to `deployments/{network}.json`:

```json
{
  "chainId": 11155111,
  "contracts": {
    "token0": "0x...",
    "token1": "0x...",
    "hook": "0x...",
    "poolManager": "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
    "taskManager": "0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9"
  }
}
```

This allows you to deploy once and run tests multiple times without redeploying.

## Troubleshooting

### "Insufficient token balance"
Your test wallet needs USDC/WETH tokens. After deployment, tokens are minted to the deployer address.

### "File not found: deployments/{network}.json"
Run the deployment script first to deploy contracts and create the deployment file.

### FHE operations timeout
The CoFHE coprocessor processes operations asynchronously. If tests timeout, the coprocessor may be under heavy load. Try again later.

### "Execution reverted"
Check that:
1. Pool has been initialized (deployment script does this)
2. Token approvals are set
3. You have enough testnet ETH for gas

## Faucets

### Ethereum Sepolia
- [Alchemy Faucet](https://www.alchemy.com/faucets/ethereum-sepolia)
- [Infura Faucet](https://www.infura.io/faucet/sepolia)
- [QuickNode Faucet](https://faucet.quicknode.com/ethereum/sepolia)

### Arbitrum Sepolia
- [Arbitrum Faucet](https://faucet.arbitrum.io/)
- [Alchemy Faucet](https://www.alchemy.com/faucets/arbitrum-sepolia)
