import { defineChain } from 'viem';
import { sepolia, arbitrumSepolia } from 'viem/chains';

export const localAnvil = defineChain({
  id: 31337,
  name: 'Local Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://localhost:8545'] },
  },
});

// Re-export Ethereum Sepolia with any customizations
export const ethereumSepolia = defineChain({
  ...sepolia,
  id: 11155111,
  name: 'Ethereum Sepolia',
  rpcUrls: {
    default: { http: ['https://ethereum-sepolia-rpc.publicnode.com'] },
  },
  blockExplorers: {
    default: { name: 'Etherscan', url: 'https://sepolia.etherscan.io' },
  },
  testnet: true,
});

// Re-export Arbitrum Sepolia with any customizations
export const arbSepolia = defineChain({
  ...arbitrumSepolia,
  id: 421614,
  name: 'Arbitrum Sepolia',
  rpcUrls: {
    default: { http: ['https://sepolia-rollup.arbitrum.io/rpc'] },
  },
  blockExplorers: {
    default: { name: 'Arbiscan', url: 'https://sepolia.arbiscan.io' },
  },
  testnet: true,
});

export const fhenixTestnet = defineChain({
  id: 8008135,
  name: 'Fhenix Testnet',
  nativeCurrency: { name: 'FHE', symbol: 'FHE', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://api.testnet.fhenix.zone:7747'] },
  },
  blockExplorers: {
    default: { name: 'Fhenix Explorer', url: 'https://explorer.testnet.fhenix.zone' },
  },
  testnet: true,
});

// Ethereum Sepolia first = default chain for production (has CoFHE + Uniswap v4)
export const supportedChains = [ethereumSepolia, arbSepolia, fhenixTestnet, localAnvil] as const;

// Local Anvil first = default chain for testing (uses MockPheatherX)
export const testSupportedChains = [localAnvil, ethereumSepolia, arbSepolia, fhenixTestnet] as const;

// FHE support per network
// CoFHE supports Ethereum Sepolia and Arbitrum Sepolia
export type FheSupport = 'full' | 'mock';
export const fheSupport: Record<number, FheSupport> = {
  31337: 'mock',
  11155111: 'full', // Ethereum Sepolia - CoFHE supported
  421614: 'full',   // Arbitrum Sepolia - CoFHE supported
  8008135: 'full',  // Fhenix Testnet
};

// Block explorer URL helpers
export function getExplorerTxUrl(chainId: number, txHash: `0x${string}`): string | null {
  const chain = supportedChains.find(c => c.id === chainId);
  const explorer = chain?.blockExplorers?.default;
  if (!explorer) return null;
  return `${explorer.url}/tx/${txHash}`;
}

export function getExplorerAddressUrl(chainId: number, address: `0x${string}`): string | null {
  const chain = supportedChains.find(c => c.id === chainId);
  const explorer = chain?.blockExplorers?.default;
  if (!explorer) return null;
  return `${explorer.url}/address/${address}`;
}

export function getExplorerName(chainId: number): string | null {
  const chain = supportedChains.find(c => c.id === chainId);
  return chain?.blockExplorers?.default?.name ?? null;
}
