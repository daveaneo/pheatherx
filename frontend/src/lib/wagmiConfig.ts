'use client';

import { http, createConfig } from 'wagmi';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { localAnvil, ethereumSepolia, arbSepolia, fhenixTestnet, supportedChains } from './chains';

export const config = getDefaultConfig({
  appName: 'PheatherX',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo',
  chains: supportedChains,
  transports: {
    [localAnvil.id]: http('http://127.0.0.1:8545'),
    [ethereumSepolia.id]: http('https://ethereum-sepolia-rpc.publicnode.com'),
    [arbSepolia.id]: http('https://sepolia-rollup.arbitrum.io/rpc'),
    [fhenixTestnet.id]: http('https://api.testnet.fhenix.zone:7747'),
  },
  ssr: true,
});
