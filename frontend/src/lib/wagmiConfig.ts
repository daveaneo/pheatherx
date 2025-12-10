'use client';

import { http, createConfig, createStorage } from 'wagmi';
import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import {
  metaMaskWallet,
  rainbowWallet,
  coinbaseWallet,
  walletConnectWallet,
  injectedWallet,
} from '@rainbow-me/rainbowkit/wallets';
import type { Wallet } from '@rainbow-me/rainbowkit';
import { mock } from 'wagmi/connectors';
import { privateKeyToAccount } from 'viem/accounts';
import { localAnvil, ethereumSepolia, arbSepolia, fhenixTestnet, supportedChains, testSupportedChains } from './chains';
import { devWalletConnector, getDevWalletAddress } from './devWalletConnector';

// Check if test mode is enabled
export const isTestMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  return process.env.NEXT_PUBLIC_TEST_MODE === 'true';
};

// Check if dev wallet is available (private key configured)
export const isDevWalletAvailable = (): boolean => {
  return !!getDevWalletAddress();
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

// WalletConnect project ID
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo';

// Dev wallet creator function for RainbowKit
const devWalletCreator = (): Wallet => {
  const address = getDevWalletAddress();
  return {
    id: 'devWallet',
    name: `Dev Wallet${address ? ` (${address.slice(0, 6)}...)` : ''}`,
    iconUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23f59e0b" width="100" height="100" rx="20"/><text x="50" y="70" font-size="50" text-anchor="middle" fill="white">D</text></svg>',
    iconAccent: '#f59e0b',
    iconBackground: '#1a1a1a',
    downloadUrls: {},
    createConnector: () => {
      const connector = devWalletConnector();
      if (!connector) {
        throw new Error('Dev wallet connector not available');
      }
      return connector;
    },
  };
};

// Build wallet groups - dev wallet first if available
const hasDevWallet = !!getDevWalletAddress();
const walletGroups = [
  // Dev wallet group (first, for easy access)
  ...(hasDevWallet
    ? [
        {
          groupName: 'Development',
          wallets: [() => devWalletCreator()],
        },
      ]
    : []),
  // Standard wallets group
  {
    groupName: 'Popular',
    wallets: [
      metaMaskWallet,
      rainbowWallet,
      coinbaseWallet,
      walletConnectWallet,
      injectedWallet,
    ],
  },
];

// Create connectors with dev wallet included
const connectors = connectorsForWallets(walletGroups, {
  appName: 'FheatherX',
  projectId,
});

// Normal config with dev wallet in wallet list
export const config = createConfig({
  chains: supportedChains,
  connectors,
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
