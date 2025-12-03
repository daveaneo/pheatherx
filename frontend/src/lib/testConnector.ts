'use client';

import { createWalletClient, http, type WalletClient, type Chain } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { ethereumSepolia, arbSepolia, fhenixTestnet, localAnvil } from './chains';

/**
 * Creates a wallet client with a private key for E2E testing.
 * This can be used to sign and broadcast transactions without wallet extensions.
 */
export function createTestWalletClient(
  privateKey: `0x${string}`,
  chainId: number = ethereumSepolia.id
): WalletClient {
  const account = privateKeyToAccount(privateKey);

  // Find the chain by ID
  const chains = [ethereumSepolia, arbSepolia, fhenixTestnet, localAnvil];
  const chain = chains.find(c => c.id === chainId) || ethereumSepolia;

  // Get the appropriate RPC URL
  const rpcUrls: Record<number, string> = {
    [localAnvil.id]: 'http://127.0.0.1:8545',
    [ethereumSepolia.id]: 'https://ethereum-sepolia-rpc.publicnode.com',
    [arbSepolia.id]: 'https://sepolia-rollup.arbitrum.io/rpc',
    [fhenixTestnet.id]: 'https://api.testnet.fhenix.zone:7747',
  };

  return createWalletClient({
    account,
    chain,
    transport: http(rpcUrls[chainId] || rpcUrls[ethereumSepolia.id]),
  });
}

/**
 * Get the test account from the environment.
 */
export function getTestAccount(): PrivateKeyAccount | undefined {
  const privateKey = process.env.NEXT_PUBLIC_TEST_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey) return undefined;
  return privateKeyToAccount(privateKey);
}
