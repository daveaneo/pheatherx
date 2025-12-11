/**
 * Static configuration of faucet tokens for testnet
 * These tokens have a public faucet() function that mints 100 tokens per call
 */

export interface FaucetToken {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  type: 'erc20' | 'fheerc20';
  faucetAmount: number; // Amount dispensed per faucet call (in human-readable units)
}

export interface FaucetConfig {
  tokens: FaucetToken[];
  ethFaucetAmount: string; // ETH amount for faucet links (e.g., "0.002")
}

// Faucet tokens deployed on Ethereum Sepolia (Chain ID: 11155111)
// Source: contracts/deployments/v6-eth-sepolia.json
export const ETH_SEPOLIA_FAUCET_TOKENS: FaucetToken[] = [
  {
    address: '0xF7Ff2A5E74eaA6E0463358BB26780049d3D45C56',
    symbol: 'USDC',
    name: 'USDC',
    decimals: 6,
    type: 'erc20',
    faucetAmount: 100,
  },
  {
    address: '0xe9Df64F549Eb1d2778909F339B9Bd795d14cF32E',
    symbol: 'WETH',
    name: 'WETH',
    decimals: 18,
    type: 'erc20',
    faucetAmount: 100,
  },
  {
    address: '0x1D77eE754b2080B354733299A5aC678539a0D740',
    symbol: 'fheUSDC',
    name: 'FHE USDC',
    decimals: 6,
    type: 'fheerc20',
    faucetAmount: 100,
  },
  {
    address: '0xf0F8f49b4065A1B01050Fa358d287106B676a25F',
    symbol: 'fheWETH',
    name: 'FHE WETH',
    decimals: 18,
    type: 'fheerc20',
    faucetAmount: 100,
  },
];

// Faucet tokens deployed on Arbitrum Sepolia (Chain ID: 421614)
// Source: contracts/deployments/v6-arb-sepolia.json (synced with tokens.ts)
// Updated: 2025-12-11 with optimized v6 deployment (6 pools)
export const ARB_SEPOLIA_FAUCET_TOKENS: FaucetToken[] = [
  {
    address: '0x00F7DC53A57b980F839767a6C6214b4089d916b1',
    symbol: 'USDC',
    name: 'USDC',
    decimals: 6,
    type: 'erc20',
    faucetAmount: 100,
  },
  {
    address: '0xC5EcD76Db9f00B07088DDbFbdf7BF9927F6DDE13',
    symbol: 'WETH',
    name: 'WETH',
    decimals: 18,
    type: 'erc20',
    faucetAmount: 100,
  },
  {
    address: '0x987731d456B5996E7414d79474D8aba58d4681DC',
    symbol: 'fheUSDC',
    name: 'FHE USDC',
    decimals: 6,
    type: 'fheerc20',
    faucetAmount: 100,
  },
  {
    address: '0x7Da141eeA1F3c2dD0cC41915eE0AA19bE545d3e0',
    symbol: 'fheWETH',
    name: 'FHE WETH',
    decimals: 18,
    type: 'fheerc20',
    faucetAmount: 100,
  },
];

// Faucet configuration by chain ID
export const FAUCET_CONFIG: Record<number, FaucetConfig> = {
  // Ethereum Sepolia
  11155111: {
    tokens: ETH_SEPOLIA_FAUCET_TOKENS,
    ethFaucetAmount: '0.002',
  },
  // Arbitrum Sepolia (no public ETH faucet - bridge from ETH Sepolia or use funded account)
  421614: {
    tokens: ARB_SEPOLIA_FAUCET_TOKENS,
    ethFaucetAmount: '0.001',
  },
  // Local Anvil (if needed in future)
  31337: {
    tokens: [],
    ethFaucetAmount: '1.0',
  },
};

/**
 * Get faucet configuration for a specific chain
 */
export function getFaucetConfig(chainId: number): FaucetConfig | undefined {
  return FAUCET_CONFIG[chainId];
}

/**
 * Get faucet tokens for a specific chain
 */
export function getFaucetTokens(chainId: number): FaucetToken[] {
  return FAUCET_CONFIG[chainId]?.tokens || [];
}
