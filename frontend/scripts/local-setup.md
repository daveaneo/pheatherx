# Local Development Setup

This guide walks you through setting up PheatherX for local testing with Anvil.

## Prerequisites

- Node.js 18+
- Foundry (for Anvil)
- A browser wallet (MetaMask recommended)

## Step 1: Start Anvil

In a terminal, start Anvil with a deterministic mnemonic for consistent addresses:

```bash
anvil --mnemonic "test test test test test test test test test test test junk"
```

This will start a local Ethereum node at `http://127.0.0.1:8545`.

## Step 2: Deploy Contracts

Navigate to the PheatherX contracts directory and deploy:

```bash
cd /home/david/PycharmProjects/atrium/learning-hooks-with-atrium/hooks/pheatherx

# Deploy contracts
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

Note the deployed contract addresses and update `.env.local`.

## Step 3: Update Environment Variables

After deployment, update the addresses in `.env.local`:

```env
NEXT_PUBLIC_PHEATHERX_ADDRESS_LOCAL=<deployed_pheatherx_address>
NEXT_PUBLIC_SWAP_ROUTER_ADDRESS_LOCAL=<deployed_router_address>
NEXT_PUBLIC_TOKEN0_ADDRESS_LOCAL=<deployed_token0_address>
NEXT_PUBLIC_TOKEN1_ADDRESS_LOCAL=<deployed_token1_address>
```

## Step 4: Configure MetaMask

1. Open MetaMask
2. Add Network:
   - Network Name: `Anvil Local`
   - RPC URL: `http://127.0.0.1:8545`
   - Chain ID: `31337`
   - Currency Symbol: `ETH`

3. Import Test Account:
   - Use one of the Anvil private keys (shown when Anvil starts)
   - First key: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`

## Step 5: Start the Frontend

```bash
cd /home/david/PycharmProjects/atrium/pheatherx/frontend
npm run dev
```

Visit `http://localhost:3000` in your browser.

## Step 6: Testing Flow

1. Connect your MetaMask wallet (using Anvil Local network)
2. Navigate to Portfolio
3. Initialize FHE session (mock mode for local)
4. Deposit some tokens
5. Try swapping
6. Place a limit order
7. View analytics

## Troubleshooting

### "Invalid network" error
- Make sure MetaMask is connected to Anvil Local (Chain ID 31337)
- Check that Anvil is running

### "Contract not found" error
- Verify contract addresses in `.env.local` match deployed addresses
- Restart the dev server after updating .env

### "FHE session failed"
- On local/Anvil, mock FHE is used automatically
- If it still fails, check the console for errors

### Transaction failing
- Make sure you have ETH from Anvil for gas
- Check that you have approved tokens for deposits

## Testing Checklist

- [ ] Wallet connects successfully
- [ ] Network switches to Anvil
- [ ] FHE session initializes (mock)
- [ ] Deposit flow works
- [ ] Balances display (mock encrypted values)
- [ ] Swap executes
- [ ] Order placement works
- [ ] Order cancellation works
- [ ] Analytics page loads
