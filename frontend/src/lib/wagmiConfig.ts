'use client';

import { http, createConfig, createStorage } from 'wagmi';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { mock } from 'wagmi/connectors';
import { privateKeyToAccount } from 'viem/accounts';
import { localAnvil, ethereumSepolia, arbSepolia, fhenixTestnet, supportedChains, testSupportedChains } from './chains';

// Check if test mode is enabled
export const isTestMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  return process.env.NEXT_PUBLIC_TEST_MODE === 'true';
};

// Test wallet private key (exported for use by viem wallet client in test mode)
export const TEST_WALLET_PRIVATE_KEY = process.env.NEXT_PUBLIC_TEST_WALLET_PRIVATE_KEY as `0x${string}` | undefined;

// Test wallet address (derived from private key in env)
export const TEST_WALLET_ADDRESS = TEST_WALLET_PRIVATE_KEY
  ? privateKeyToAccount(TEST_WALLET_PRIVATE_KEY).address
  : undefined;

// Standard transports for all chains
const transports = {
  [localAnvil.id]: http('http://127.0.0.1:8545'),
  [ethereumSepolia.id]: http('https://ethereum-sepolia-rpc.publicnode.com'),
  [arbSepolia.id]: http('https://sepolia-rollup.arbitrum.io/rpc'),
  [fhenixTestnet.id]: http('https://api.testnet.fhenix.zone:7747'),
};

// Normal RainbowKit config (used when TEST_MODE is false)
export const config = getDefaultConfig({
  appName: 'FheatherX',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo',
  chains: supportedChains,
  transports,
  ssr: true,
});

// Test mode config with mock connector (used when TEST_MODE is true)
// Note: The mock connector handles connection state display
// Actual transaction signing is handled by viem wallet client in hooks
// In test mode, localAnvil (31337) is the default chain
export const testConfig = TEST_WALLET_ADDRESS
  ? createConfig({
      chains: testSupportedChains,
      connectors: [
        mock({
          accounts: [TEST_WALLET_ADDRESS],
          features: {
            reconnect: false,
          },
        }),
      ],
      transports,
      // Use localStorage to prevent SSR issues
      storage: createStorage({
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      }),
    })
  : config; // Fallback to normal config if no test wallet configured
