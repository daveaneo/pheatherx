#!/bin/bash
# Setup script for E2E tests with local Anvil and MockPheatherX

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../" && pwd)"
CONTRACTS_DIR="$ROOT_DIR/contracts"
FRONTEND_DIR="$ROOT_DIR/frontend"

# Test wallet (matches wagmiConfig.ts)
TEST_PRIVATE_KEY="0x8080ec2e8e4f4af5da37afac0dd95e47497a4ab9d16d83aa99d5ac67c028130f"
TEST_WALLET_ADDRESS="0x60B9be2A29a02F49e8D6ba535303caD1Ddcb9659"

# Anvil's default first account (has 10000 ETH)
ANVIL_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

RPC_URL="http://127.0.0.1:8545"

echo "=== PheatherX E2E Test Setup ==="
echo ""

# Check if anvil is already running
if curl -s $RPC_URL > /dev/null 2>&1; then
    echo "Anvil already running on port 8545"
else
    echo "ERROR: Anvil is not running. Please start it with:"
    echo "  anvil --host 127.0.0.1 --port 8545"
    exit 1
fi

# Deploy mock contracts
echo ""
echo "Deploying mock contracts..."
cd "$CONTRACTS_DIR"

# Run the deployment script and capture output
DEPLOYED_OUTPUT=$(forge script script/local/DeployLocalTest.s.sol:DeployLocalTest \
    --rpc-url $RPC_URL \
    --broadcast \
    --private-key "$ANVIL_PRIVATE_KEY" 2>&1) || {
    echo "Deployment failed. Output:"
    echo "$DEPLOYED_OUTPUT"
    exit 1
}

echo "$DEPLOYED_OUTPUT"

# Extract addresses from deployment output using grep
TOKEN0_ADDRESS=$(echo "$DEPLOYED_OUTPUT" | grep -oP "Token0 \(ALPHA\):\s+\K0x[a-fA-F0-9]+")
TOKEN1_ADDRESS=$(echo "$DEPLOYED_OUTPUT" | grep -oP "Token1 \(BETA\):\s+\K0x[a-fA-F0-9]+")
PHEATHERX_ADDRESS=$(echo "$DEPLOYED_OUTPUT" | grep -oP "MockPheatherX:\s+\K0x[a-fA-F0-9]+")
ROUTER_ADDRESS=$(echo "$DEPLOYED_OUTPUT" | grep -oP "MockSwapRouter:\s+\K0x[a-fA-F0-9]+")

if [ -z "$TOKEN0_ADDRESS" ] || [ -z "$PHEATHERX_ADDRESS" ]; then
    echo ""
    echo "Could not parse addresses from output. Trying alternative extraction..."
    # Alternative: look for NEXT_PUBLIC format
    TOKEN0_ADDRESS=$(echo "$DEPLOYED_OUTPUT" | grep "NEXT_PUBLIC_TOKEN0_ADDRESS_LOCAL=" | cut -d'=' -f2 | tr -d ' ')
    TOKEN1_ADDRESS=$(echo "$DEPLOYED_OUTPUT" | grep "NEXT_PUBLIC_TOKEN1_ADDRESS_LOCAL=" | cut -d'=' -f2 | tr -d ' ')
    PHEATHERX_ADDRESS=$(echo "$DEPLOYED_OUTPUT" | grep "NEXT_PUBLIC_PHEATHERX_ADDRESS_LOCAL=" | cut -d'=' -f2 | tr -d ' ')
    ROUTER_ADDRESS=$(echo "$DEPLOYED_OUTPUT" | grep "NEXT_PUBLIC_SWAP_ROUTER_ADDRESS_LOCAL=" | cut -d'=' -f2 | tr -d ' ')
fi

echo ""
echo "Extracted addresses:"
echo "  Token0: $TOKEN0_ADDRESS"
echo "  Token1: $TOKEN1_ADDRESS"
echo "  MockPheatherX: $PHEATHERX_ADDRESS"
echo "  MockSwapRouter: $ROUTER_ADDRESS"

# Fund the test wallet
echo ""
echo "Funding test wallet $TEST_WALLET_ADDRESS..."

# Send 10 ETH to test wallet
cast send --private-key "$ANVIL_PRIVATE_KEY" \
    --rpc-url $RPC_URL \
    "$TEST_WALLET_ADDRESS" \
    --value 10ether > /dev/null 2>&1

echo "Sent 10 ETH to test wallet"

# Mint tokens to test wallet (MockToken has public mint function)
echo "Minting tokens to test wallet..."

# Mint 1000 of each token
cast send --private-key "$ANVIL_PRIVATE_KEY" \
    --rpc-url $RPC_URL \
    "$TOKEN0_ADDRESS" \
    "mint(address,uint256)" \
    "$TEST_WALLET_ADDRESS" \
    "1000000000000000000000" > /dev/null 2>&1

cast send --private-key "$ANVIL_PRIVATE_KEY" \
    --rpc-url $RPC_URL \
    "$TOKEN1_ADDRESS" \
    "mint(address,uint256)" \
    "$TEST_WALLET_ADDRESS" \
    "1000000000000000000000" > /dev/null 2>&1

echo "Minted 1000 of each token to test wallet"

# Verify balances
echo ""
echo "Verifying test wallet balances..."
ETH_BALANCE=$(cast balance $TEST_WALLET_ADDRESS --rpc-url $RPC_URL)
TOKEN0_BALANCE=$(cast call $TOKEN0_ADDRESS "balanceOf(address)(uint256)" $TEST_WALLET_ADDRESS --rpc-url $RPC_URL)
TOKEN1_BALANCE=$(cast call $TOKEN1_ADDRESS "balanceOf(address)(uint256)" $TEST_WALLET_ADDRESS --rpc-url $RPC_URL)

echo "  ETH: $ETH_BALANCE"
echo "  Token0: $TOKEN0_BALANCE"
echo "  Token1: $TOKEN1_BALANCE"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Contract Addresses for .env.local:"
echo ""
echo "NEXT_PUBLIC_PHEATHERX_ADDRESS_LOCAL=$PHEATHERX_ADDRESS"
echo "NEXT_PUBLIC_SWAP_ROUTER_ADDRESS_LOCAL=$ROUTER_ADDRESS"
echo "NEXT_PUBLIC_TOKEN0_ADDRESS_LOCAL=$TOKEN0_ADDRESS"
echo "NEXT_PUBLIC_TOKEN1_ADDRESS_LOCAL=$TOKEN1_ADDRESS"
echo ""
