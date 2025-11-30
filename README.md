# PheatherX

A private execution layer built on FHE (Fully Homomorphic Encryption) and engineered within the Fhenix ecosystem.

## Overview

PheatherX implements a custom Uniswap v4 hook that replaces public swap paths with encrypted balance accounting, ensuring that trade direction, size, and intent remain hidden from all observers.

## Project Structure

```
pheatherx/
├── contracts/          # Solidity smart contracts
│   ├── src/           # Main contract source files
│   ├── test/          # Contract tests
│   ├── script/        # Deployment scripts
│   ├── foundry.toml   # Foundry configuration
│   └── remappings.txt # Solidity import remappings
├── frontend/          # Web application
│   ├── src/           # Frontend source code
│   └── public/        # Static assets
└── README.md          # This file
```

## Getting Started

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) or npm

### Contracts

```bash
cd contracts
npm install
forge build
forge test --via-ir
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Deployment

Target network: Fhenix Testnet

## License

MIT
