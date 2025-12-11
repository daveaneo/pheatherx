/**
 * Test script for cofhejs unseal functionality
 *
 * Tests unsealing an FHERC20 balance to debug SEAL_OUTPUT_RETURNED_NULL error
 */

import { ethers } from 'ethers';
import { cofhejs, FheTypes } from 'cofhejs/node';

// Configuration
const RPC_URL = 'https://sepolia-rollup.arbitrum.io/rpc';
const CHAIN_ID = 421614;

// fheUSDC on Arb Sepolia
const TOKEN_ADDRESS = '0x43AcAe0A089f3cd188f9fB0731059Eb7bC27D3Aa';
// Test wallet address
const USER_ADDRESS = '0x60B9be2A29a02F49e8D6ba535303caD1Ddcb9659';

// FHERC20 ABI (just the functions we need)
const FHERC20_ABI = [
  'function balanceOfEncrypted(address account) view returns (uint256)',
  'function hasEncryptedBalance(address account) view returns (bool)',
];

async function main() {
  console.log('=== CoFHE Unseal Test ===\n');

  // 1. Setup provider
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  console.log('Connected to:', RPC_URL);
  console.log('Chain ID:', CHAIN_ID);
  console.log('User address:', USER_ADDRESS);
  console.log('Token address:', TOKEN_ADDRESS);

  // 2. Query encrypted balance from contract
  const token = new ethers.Contract(TOKEN_ADDRESS, FHERC20_ABI, provider);

  const hasBalance = await token.hasEncryptedBalance(USER_ADDRESS);
  console.log('\nHas encrypted balance:', hasBalance);

  if (!hasBalance) {
    console.log('User has no encrypted balance. Call faucet() first.');
    return;
  }

  const encryptedBalance = await token.balanceOfEncrypted(USER_ADDRESS);
  console.log('Encrypted balance handle:', encryptedBalance.toString());
  console.log('Encrypted balance hex:', '0x' + encryptedBalance.toString(16));

  if (encryptedBalance === 0n) {
    console.log('Encrypted balance is 0 (no real ciphertext exists)');
    return;
  }

  // 3. Initialize cofhejs
  console.log('\nInitializing cofhejs...');

  // Create a random wallet for signing permits (the actual user doesn't need to sign)
  // But we need to tell cofhejs the user's address for permission checks
  const sessionWallet = ethers.Wallet.createRandom().connect(provider);

  console.log('Session wallet address:', sessionWallet.address);
  console.log('Target user address:', USER_ADDRESS);

  // Initialize with the session wallet
  const initResult = await cofhejs.initializeWithEthers({
    ethersProvider: provider,
    ethersSigner: sessionWallet,
    environment: 'TESTNET',
    generatePermit: true,
  });

  if (!initResult.success) {
    console.error('Failed to initialize cofhejs:', initResult.error);
    return;
  }

  console.log('cofhejs initialized successfully');
  console.log('Permit issuer:', initResult.data?.issuer);

  // 4. Attempt to unseal
  console.log('\n--- Attempting unseal ---');
  console.log('ctHash:', encryptedBalance.toString());
  console.log('FheType:', FheTypes.Uint128);

  // Try without account parameter
  console.log('\nAttempt 1: unseal(ctHash, type) - no account');
  try {
    const result1 = await cofhejs.unseal(encryptedBalance, FheTypes.Uint128);
    console.log('Result:', JSON.stringify(result1, null, 2));
  } catch (err) {
    console.log('Error:', err.message || err);
  }

  // Try with session wallet address
  console.log('\nAttempt 2: unseal(ctHash, type, sessionWalletAddress)');
  try {
    const result2 = await cofhejs.unseal(encryptedBalance, FheTypes.Uint128, sessionWallet.address);
    console.log('Result:', JSON.stringify(result2, null, 2));
  } catch (err) {
    console.log('Error:', err.message || err);
  }

  // Try with user address (the one that actually owns the balance)
  console.log('\nAttempt 3: unseal(ctHash, type, userAddress)');
  try {
    const result3 = await cofhejs.unseal(encryptedBalance, FheTypes.Uint128, USER_ADDRESS);
    console.log('Result:', JSON.stringify(result3, null, 2));
  } catch (err) {
    console.log('Error:', err.message || err);
  }

  // 5. Let's also check what permit we have
  console.log('\n--- Permit Info ---');
  console.log('Permit data:', JSON.stringify(initResult.data, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value, 2));
}

main().catch(console.error);
