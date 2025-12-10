import { NATIVE_ETH_ADDRESS } from '@/lib/constants';

export type TokenType = 'erc20' | 'fherc20';

export interface Token {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  isNative?: boolean;
  logoUrl?: string;
  /** Token type: erc20 (standard) or fherc20 (FHE-enabled) */
  type?: TokenType;
  /** For ERC20 tokens, the address of the corresponding FHERC20 wrapper */
  wrappedToken?: `0x${string}`;
  /** For FHERC20 tokens, the address of the underlying ERC20 */
  unwrappedToken?: `0x${string}`;
}

export function isNativeEth(address: string): boolean {
  return (
    address.toLowerCase() === NATIVE_ETH_ADDRESS.toLowerCase() ||
    address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  );
}

// ═══════════════════════════════════════════════════════════════════════
//                      TOKEN ADDRESSES BY CHAIN
// ═══════════════════════════════════════════════════════════════════════

// Ethereum Sepolia Token Addresses (from contracts/deployments/v6-eth-sepolia.json)
const ETH_SEPOLIA_TOKENS = {
  WETH: '0xe9Df64F549Eb1d2778909F339B9Bd795d14cF32E' as `0x${string}`,
  USDC: '0xF7Ff2A5E74eaA6E0463358BB26780049d3D45C56' as `0x${string}`,
  fheWETH: '0xf0F8f49b4065A1B01050Fa358d287106B676a25F' as `0x${string}`,
  fheUSDC: '0x1D77eE754b2080B354733299A5aC678539a0D740' as `0x${string}`,
} as const;

// Arbitrum Sepolia Token Addresses (from contracts/deployments/v6-arb-sepolia.json)
const ARB_SEPOLIA_TOKENS = {
  WETH: '0x34010C7b06cD65365C129223A466032Bc7897110' as `0x${string}`,
  USDC: '0xbdDd18385FE6Ad2C81E3c1Adf40f28E3AA2a41e5' as `0x${string}`,
  fheWETH: '0x9E0b37Ec3eC64ac667C3Bc7aD82DaC27bF82D55c' as `0x${string}`,
  fheUSDC: '0xF6f6a3162Ca3162E3855d0B201d2264de64a52F6' as `0x${string}`,
} as const;

// ═══════════════════════════════════════════════════════════════════════
//                         TOKEN CONFIGURATIONS
// ═══════════════════════════════════════════════════════════════════════

/**
 * All tokens supported by the application, grouped by chain.
 * Includes both ERC20 and FHERC20 tokens with their relationships.
 */
export const ALL_TOKENS: Record<number, Token[]> = {
  // Local Anvil - placeholder tokens
  31337: [
    {
      address: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      symbol: 'TKA',
      name: 'Test Token A',
      decimals: 18,
      type: 'erc20',
    },
    {
      address: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
      symbol: 'TKB',
      name: 'Test Token B',
      decimals: 18,
      type: 'erc20',
    },
  ],

  // Ethereum Sepolia - 4 tokens (2 ERC20 + 2 FHERC20)
  11155111: [
    {
      address: ETH_SEPOLIA_TOKENS.WETH,
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      type: 'erc20',
    },
    {
      address: ETH_SEPOLIA_TOKENS.USDC,
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      type: 'erc20',
    },
    {
      address: ETH_SEPOLIA_TOKENS.fheWETH,
      symbol: 'fheWETH',
      name: 'FHE Wrapped Ether',
      decimals: 18,
      type: 'fherc20',
    },
    {
      address: ETH_SEPOLIA_TOKENS.fheUSDC,
      symbol: 'fheUSDC',
      name: 'FHE USD Coin',
      decimals: 6,
      type: 'fherc20',
    },
  ],

  // Arbitrum Sepolia - 4 tokens (2 ERC20 + 2 FHERC20)
  421614: [
    {
      address: ARB_SEPOLIA_TOKENS.WETH,
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      type: 'erc20',
    },
    {
      address: ARB_SEPOLIA_TOKENS.USDC,
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      type: 'erc20',
    },
    {
      address: ARB_SEPOLIA_TOKENS.fheWETH,
      symbol: 'fheWETH',
      name: 'FHE Wrapped Ether',
      decimals: 18,
      type: 'fherc20',
    },
    {
      address: ARB_SEPOLIA_TOKENS.fheUSDC,
      symbol: 'fheUSDC',
      name: 'FHE USD Coin',
      decimals: 6,
      type: 'fherc20',
    },
  ],

  // Fhenix Testnet - placeholder
  8008135: [
    {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'TKA',
      name: 'Test Token A',
      decimals: 18,
      type: 'erc20',
    },
    {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'TKB',
      name: 'Test Token B',
      decimals: 18,
      type: 'erc20',
    },
  ],
};

// Legacy TOKEN_LIST for backwards compatibility
export const TOKEN_LIST = ALL_TOKENS;

// ═══════════════════════════════════════════════════════════════════════
//                          HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get a token by chain and position (legacy function for backwards compatibility)
 */
export function getToken(chainId: number, isToken0: boolean): Token | undefined {
  const tokens = ALL_TOKENS[chainId];
  if (!tokens) return undefined;
  return isToken0 ? tokens[0] : tokens[1];
}

/**
 * Get all tokens for a chain
 */
export function getTokensForChain(chainId: number): Token[] {
  return ALL_TOKENS[chainId] || [];
}

/**
 * Get only ERC20 tokens for a chain
 */
export function getERC20Tokens(chainId: number): Token[] {
  return getTokensForChain(chainId).filter(t => t.type === 'erc20');
}

/**
 * Get only FHERC20 tokens for a chain
 */
export function getFHERC20Tokens(chainId: number): Token[] {
  return getTokensForChain(chainId).filter(t => t.type === 'fherc20');
}

/**
 * Find a token by address on a chain
 */
export function getTokenByAddress(chainId: number, address: `0x${string}`): Token | undefined {
  return getTokensForChain(chainId).find(
    t => t.address.toLowerCase() === address.toLowerCase()
  );
}

/**
 * Find a token by symbol on a chain
 */
export function getTokenBySymbol(chainId: number, symbol: string): Token | undefined {
  return getTokensForChain(chainId).find(
    t => t.symbol.toLowerCase() === symbol.toLowerCase()
  );
}

/**
 * Get the FHERC20 wrapper for an ERC20 token
 */
export function getWrapperForToken(chainId: number, erc20Address: `0x${string}`): Token | undefined {
  const token = getTokenByAddress(chainId, erc20Address);
  if (token?.wrappedToken) {
    return getTokenByAddress(chainId, token.wrappedToken);
  }
  return undefined;
}

/**
 * Get the underlying ERC20 for an FHERC20 token
 */
export function getUnderlyingForToken(chainId: number, fherc20Address: `0x${string}`): Token | undefined {
  const token = getTokenByAddress(chainId, fherc20Address);
  if (token?.unwrappedToken) {
    return getTokenByAddress(chainId, token.unwrappedToken);
  }
  return undefined;
}

/**
 * Token pairs that can be wrapped/unwrapped
 */
export interface TokenPair {
  erc20: Token;
  fherc20: Token;
}

/**
 * Get all wrap/unwrap token pairs for a chain
 */
export function getWrapPairs(chainId: number): TokenPair[] {
  const tokens = getTokensForChain(chainId);
  const pairs: TokenPair[] = [];

  for (const token of tokens) {
    if (token.type === 'erc20' && token.wrappedToken) {
      const fherc20 = getTokenByAddress(chainId, token.wrappedToken);
      if (fherc20) {
        pairs.push({ erc20: token, fherc20 });
      }
    }
  }

  return pairs;
}
