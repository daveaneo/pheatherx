/**
 * Test script for cofhejs initialization variations
 * Run with: npx tsx scripts/test-cofhejs-init.ts
 */

import { ethers } from 'ethers';

const ETH_SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Anvil default

async function testCofhejsInit() {
  console.log('=== cofhejs Initialization Test ===\n');

  // Setup provider and signer
  const provider = new ethers.JsonRpcProvider(ETH_SEPOLIA_RPC);
  const wallet = new ethers.Wallet(TEST_PRIVATE_KEY, provider);

  console.log('Provider:', ETH_SEPOLIA_RPC);
  console.log('Wallet:', wallet.address);

  const chainId = await provider.getNetwork().then(n => Number(n.chainId));
  console.log('Chain ID:', chainId);
  console.log('');

  // Dynamically import cofhejs
  console.log('Loading cofhejs from node module...');
  let cofhejs: any;
  try {
    const mod = await import('cofhejs/node');
    cofhejs = mod.cofhejs;
    console.log('cofhejs loaded successfully\n');
  } catch (e) {
    console.error('Failed to load cofhejs:', e);
    return;
  }

  // Test variations
  const variations = [
    {
      name: 'Variation 1: With environment + generatePermit',
      options: {
        ethersProvider: provider,
        ethersSigner: wallet,
        environment: 'TESTNET',
        generatePermit: true,
      },
    },
    {
      name: 'Variation 2: With environment, no generatePermit',
      options: {
        ethersProvider: provider,
        ethersSigner: wallet,
        environment: 'TESTNET',
      },
    },
    {
      name: 'Variation 3: No environment (auto-detect), with generatePermit',
      options: {
        ethersProvider: provider,
        ethersSigner: wallet,
        generatePermit: true,
      },
    },
    {
      name: 'Variation 4: Minimal - only provider and signer',
      options: {
        ethersProvider: provider,
        ethersSigner: wallet,
      },
    },
  ];

  for (const { name, options } of variations) {
    console.log(`\n--- ${name} ---`);
    console.log('Options:', JSON.stringify(Object.keys(options)));

    try {
      const result = await cofhejs.initializeWithEthers(options);

      // Check if it's a Result type
      if (result && typeof result === 'object') {
        if ('success' in result) {
          if (result.success) {
            console.log('SUCCESS! Result:', result);
          } else {
            console.log('FAILED (Result.success=false):', result.error);
          }
        } else if ('error' in result) {
          console.log('FAILED (has error property):', result.error);
        } else {
          console.log('SUCCESS (no error):', result);
        }
      } else {
        console.log('Result:', result);
      }
    } catch (error: any) {
      console.log('THREW EXCEPTION:');
      console.log('  Type:', error?.constructor?.name);
      console.log('  Message:', error?.message);
      if (error?.cause) console.log('  Cause:', error.cause);
      if (error?.code) console.log('  Code:', error.code);
      if (error?.stack) {
        const stackLines = error.stack.split('\n').slice(0, 5);
        console.log('  Stack (first 5 lines):');
        stackLines.forEach((line: string) => console.log('    ', line));
      }
    }
  }

  console.log('\n=== Test Complete ===');
}

testCofhejsInit().catch(console.error);
