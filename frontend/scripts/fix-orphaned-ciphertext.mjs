#!/usr/bin/env node
/**
 * Fix Orphaned Ciphertext Script
 *
 * This script helps recover tokens when CoFHE has lost track of your encrypted balance.
 * It will:
 * 1. Show your current balances
 * 2. Unwrap your encrypted balance to plaintext
 * 3. Re-wrap to create a fresh ciphertext that CoFHE can track
 *
 * Usage:
 *   PRIVATE_KEY=0x... node scripts/fix-orphaned-ciphertext.mjs
 *   PRIVATE_KEY=0x... node scripts/fix-orphaned-ciphertext.mjs --unwrap-amount 100
 */

import { createPublicClient, createWalletClient, http, formatUnits, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';

// Configuration - Arb Sepolia
const RPC_URL = 'https://sepolia-rollup.arbitrum.io/rpc';
const CHAIN = arbitrumSepolia;

// FHERC20 tokens on Arb Sepolia
const TOKENS = {
  fheWETH: { address: '0x7Da141eeA1F3c2dD0cC41915eE0AA19bE545d3e0', decimals: 18, symbol: 'fheWETH' },
  fheUSDC: { address: '0x987731d456B5996E7414d79474D8aba58d4681DC', decimals: 6, symbol: 'fheUSDC' },
};

// FHERC20 ABI
const FHERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'balanceOfEncrypted', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'hasEncryptedBalance', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'wrap', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'unwrap', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'faucet', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
];

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('ERROR: Set PRIVATE_KEY environment variable');
    console.error('Usage: PRIVATE_KEY=0x... node scripts/fix-orphaned-ciphertext.mjs');
    process.exit(1);
  }

  // Parse command line args
  const args = process.argv.slice(2);
  const unwrapAmountArg = args.find(a => a.startsWith('--unwrap-amount='));
  const tokenArg = args.find(a => a.startsWith('--token='));
  const doWrap = args.includes('--wrap');
  const doUnwrap = args.includes('--unwrap');

  const account = privateKeyToAccount(privateKey);
  console.log('=== Fix Orphaned Ciphertext ===\n');
  console.log('Network: Arbitrum Sepolia');
  console.log('Wallet:', account.address);
  console.log('');

  const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, chain: CHAIN, transport: http(RPC_URL) });

  // Check ETH balance for gas
  const ethBalance = await publicClient.getBalance({ address: account.address });
  console.log('ETH Balance:', formatUnits(ethBalance, 18), 'ETH');
  if (ethBalance < parseUnits('0.001', 18)) {
    console.error('WARNING: Low ETH balance - may not have enough for gas');
  }
  console.log('');

  // Show balances for all tokens
  console.log('--- Token Balances ---\n');

  for (const [name, token] of Object.entries(TOKENS)) {
    console.log(`${name} (${token.address}):`);

    try {
      // Plaintext balance
      const plainBalance = await publicClient.readContract({
        address: token.address,
        abi: FHERC20_ABI,
        functionName: 'balanceOf',
        args: [account.address],
      });
      console.log(`  Plaintext balance: ${formatUnits(plainBalance, token.decimals)} ${token.symbol}`);

      // Encrypted balance status
      const hasEnc = await publicClient.readContract({
        address: token.address,
        abi: FHERC20_ABI,
        functionName: 'hasEncryptedBalance',
        args: [account.address],
      });

      if (hasEnc) {
        const encHandle = await publicClient.readContract({
          address: token.address,
          abi: FHERC20_ABI,
          functionName: 'balanceOfEncrypted',
          args: [account.address],
        });
        console.log(`  Has encrypted balance: YES`);
        console.log(`  Ciphertext handle: 0x${encHandle.toString(16).slice(0, 16)}...`);
        console.log(`  (CoFHE cannot unseal this - it's an orphaned ciphertext)`);
      } else {
        console.log(`  Has encrypted balance: NO`);
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
    console.log('');
  }

  // If no action specified, show help
  if (!doWrap && !doUnwrap) {
    console.log('--- Available Actions ---\n');
    console.log('To unwrap encrypted balance (you must know/guess the amount):');
    console.log('  PRIVATE_KEY=0x... node scripts/fix-orphaned-ciphertext.mjs --unwrap --token=fheWETH --unwrap-amount=100');
    console.log('');
    console.log('To wrap plaintext balance:');
    console.log('  PRIVATE_KEY=0x... node scripts/fix-orphaned-ciphertext.mjs --wrap --token=fheWETH --unwrap-amount=100');
    console.log('');
    console.log('Note: unwrap-amount is in human-readable units (e.g., 100 = 100 tokens)');
    return;
  }

  // Get token
  const tokenName = tokenArg?.split('=')[1] || 'fheWETH';
  const token = TOKENS[tokenName];
  if (!token) {
    console.error(`Unknown token: ${tokenName}. Use fheWETH or fheUSDC`);
    process.exit(1);
  }

  // Get amount
  const amountStr = unwrapAmountArg?.split('=')[1];
  if (!amountStr) {
    console.error('ERROR: Specify --unwrap-amount=<amount>');
    process.exit(1);
  }
  const amount = parseUnits(amountStr, token.decimals);

  if (doUnwrap) {
    console.log(`--- Unwrapping ${amountStr} ${token.symbol} ---\n`);

    try {
      console.log('Sending unwrap transaction...');
      const hash = await walletClient.writeContract({
        address: token.address,
        abi: FHERC20_ABI,
        functionName: 'unwrap',
        args: [amount],
      });
      console.log('TX Hash:', hash);

      console.log('Waiting for confirmation...');
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log('Status:', receipt.status === 'success' ? 'SUCCESS' : 'FAILED');

      if (receipt.status === 'success') {
        // Check new balance
        const newPlain = await publicClient.readContract({
          address: token.address,
          abi: FHERC20_ABI,
          functionName: 'balanceOf',
          args: [account.address],
        });
        console.log(`\nNew plaintext balance: ${formatUnits(newPlain, token.decimals)} ${token.symbol}`);
        console.log('\nNow run with --wrap to re-wrap and create fresh ciphertext');
      }
    } catch (e) {
      console.error('Unwrap failed:', e.message);
      if (e.message.includes('No encrypted balance')) {
        console.log('You have no encrypted balance to unwrap.');
      }
    }
  }

  if (doWrap) {
    console.log(`--- Wrapping ${amountStr} ${token.symbol} ---\n`);

    // Check plaintext balance first
    const plainBalance = await publicClient.readContract({
      address: token.address,
      abi: FHERC20_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    });

    if (plainBalance < amount) {
      console.error(`Insufficient plaintext balance. Have: ${formatUnits(plainBalance, token.decimals)}, need: ${amountStr}`);
      process.exit(1);
    }

    try {
      console.log('Sending wrap transaction...');
      const hash = await walletClient.writeContract({
        address: token.address,
        abi: FHERC20_ABI,
        functionName: 'wrap',
        args: [amount],
      });
      console.log('TX Hash:', hash);

      console.log('Waiting for confirmation...');
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log('Status:', receipt.status === 'success' ? 'SUCCESS' : 'FAILED');

      if (receipt.status === 'success') {
        console.log('\nTokens wrapped! The new ciphertext should be visible on CoFHE.');
        console.log('Refresh the frontend to see your encrypted balance.');
      }
    } catch (e) {
      console.error('Wrap failed:', e.message);
    }
  }
}

main().catch(console.error);
