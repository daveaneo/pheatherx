/**
 * Simple cofhejs initialization test
 * Run with: node scripts/simple-cofhe-test.mjs
 */

import { ethers } from 'ethers';

// Create a random wallet for testing
const randomWallet = ethers.Wallet.createRandom();
console.log('Test wallet address:', randomWallet.address);

// ETH Sepolia RPC
const ETH_SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
// Arbitrum Sepolia RPC
const ARB_SEPOLIA_RPC = 'https://sepolia-rollup.arbitrum.io/rpc';

async function testOnChain(name, rpcUrl) {
  console.log(`\n=== Testing on ${name} ===`);
  console.log('RPC:', rpcUrl);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = randomWallet.connect(provider);

  const network = await provider.getNetwork();
  console.log('Chain ID:', network.chainId.toString());

  // Dynamic import cofhejs
  console.log('Loading cofhejs/node...');
  const { cofhejs } = await import('cofhejs/node');

  console.log('Calling initializeWithEthers...');
  const startTime = Date.now();

  try {
    const result = await cofhejs.initializeWithEthers({
      ethersProvider: provider,
      ethersSigner: wallet,
      environment: 'TESTNET',
    });

    const elapsed = Date.now() - startTime;
    console.log(`Completed in ${elapsed}ms`);
    console.log('Result:', JSON.stringify(result, null, 2));

    if (result.success) {
      console.log('SUCCESS!');
    } else {
      console.log('FAILED:', result.error);
    }
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.log(`Failed after ${elapsed}ms`);
    console.log('Error:', {
      name: error.name,
      message: error.message,
      code: error.code,
      cause: error.cause,
    });
  }
}

async function main() {
  console.log('=== Simple cofhejs Test ===\n');

  // Test ETH Sepolia
  await testOnChain('Ethereum Sepolia', ETH_SEPOLIA_RPC);

  // Test Arbitrum Sepolia
  await testOnChain('Arbitrum Sepolia', ARB_SEPOLIA_RPC);

  console.log('\n=== Done ===');
}

main().catch(console.error);
