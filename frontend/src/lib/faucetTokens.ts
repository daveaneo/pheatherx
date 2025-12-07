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

// Faucet configuration by chain ID
export const FAUCET_CONFIG: Record<number, FaucetConfig> = {
  // Ethereum Sepolia
  11155111: {
    tokens: ETH_SEPOLIA_FAUCET_TOKENS,
    ethFaucetAmount: '0.002',
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
