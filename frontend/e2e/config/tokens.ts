/**
 * Token Configuration for E2E Tests
 *
 * Ethereum Sepolia token addresses from faucetTokens.ts
 * These are the 4 tokens available for testing:
 * - 2 ERC20: WETH, USDC
 * - 2 FHERC20: fheWETH, fheUSDC
 */

export type TokenType = 'erc20' | 'fherc20';

export interface TestToken {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  type: TokenType;
}

export interface TokenPair {
  name: string;
  token0: TestToken;
  token1: TestToken;
  pairType: 'ERC:ERC' | 'FHE:FHE' | 'FHE:ERC' | 'ERC:FHE';
}

// ═══════════════════════════════════════════════════════════════════════
//                         SEPOLIA TOKEN ADDRESSES
// ═══════════════════════════════════════════════════════════════════════

export const SEPOLIA_TOKENS = {
  WETH: {
    address: '0xe9Df64F549Eb1d2778909F339B9Bd795d14cF32E' as `0x${string}`,
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
    type: 'erc20' as const,
  },
  USDC: {
    address: '0xF7Ff2A5E74eaA6E0463358BB26780049d3D45C56' as `0x${string}`,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    type: 'erc20' as const,
  },
  fheWETH: {
    address: '0xf0F8f49b4065A1B01050Fa358d287106B676a25F' as `0x${string}`,
    symbol: 'fheWETH',
    name: 'FHE Wrapped Ether',
    decimals: 18,
    type: 'fherc20' as const,
  },
  fheUSDC: {
    address: '0x1D77eE754b2080B354733299A5aC678539a0D740' as `0x${string}`,
    symbol: 'fheUSDC',
    name: 'FHE USD Coin',
    decimals: 6,
    type: 'fherc20' as const,
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════
//                            TOKEN PAIRS
// ═══════════════════════════════════════════════════════════════════════

/**
 * All 4 token pair combinations for testing:
 * 1. ERC:ERC  - WETH/USDC (standard AMM)
 * 2. FHE:FHE  - fheWETH/fheUSDC (fully encrypted)
 * 3. FHE:ERC  - fheWETH/USDC (mixed privacy)
 * 4. ERC:FHE  - WETH/fheUSDC (mixed privacy)
 */
export const TOKEN_PAIRS: TokenPair[] = [
  {
    name: 'WETH/USDC',
    token0: SEPOLIA_TOKENS.WETH,
    token1: SEPOLIA_TOKENS.USDC,
    pairType: 'ERC:ERC',
  },
  {
    name: 'fheWETH/fheUSDC',
    token0: SEPOLIA_TOKENS.fheWETH,
    token1: SEPOLIA_TOKENS.fheUSDC,
    pairType: 'FHE:FHE',
  },
  {
    name: 'fheWETH/USDC',
    token0: SEPOLIA_TOKENS.fheWETH,
    token1: SEPOLIA_TOKENS.USDC,
    pairType: 'FHE:ERC',
  },
  {
    name: 'WETH/fheUSDC',
    token0: SEPOLIA_TOKENS.WETH,
    token1: SEPOLIA_TOKENS.fheUSDC,
    pairType: 'ERC:FHE',
  },
];

// ═══════════════════════════════════════════════════════════════════════
//                          TEST CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════

export const TEST_CONFIG = {
  // Network
  chainId: 11155111,
  chainName: 'Ethereum Sepolia',
  rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',

  // Test wallet (funded on Sepolia)
  testWallet: '0x60B9be2A29a02F49e8D6ba535303caD1Ddcb9659' as `0x${string}`,

  // Small amounts to preserve test tokens
  liquidityAmount: '10', // 10 tokens per side
  swapAmount: '1', // 1 token per swap
  orderAmount: '5', // 5 tokens per limit order

  // Timeouts
  txTimeout: 60000, // 60s per transaction
  blockConfirmations: 2, // Wait for 2 confirmations
  testTimeout: 600000, // 10 min total test suite
};

// ═══════════════════════════════════════════════════════════════════════
//                          HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get token by symbol
 */
export function getToken(symbol: string): TestToken | undefined {
  return Object.values(SEPOLIA_TOKENS).find(
    (t) => t.symbol.toLowerCase() === symbol.toLowerCase()
  );
}

/**
 * Check if token is FHE-enabled
 */
export function isFheToken(token: TestToken): boolean {
  return token.type === 'fherc20';
}

/**
 * Get pair type description
 */
export function getPairDescription(pair: TokenPair): string {
  switch (pair.pairType) {
    case 'ERC:ERC':
      return 'Standard AMM (both ERC20)';
    case 'FHE:FHE':
      return 'Fully encrypted (both FHERC20)';
    case 'FHE:ERC':
    case 'ERC:FHE':
      return 'Mixed privacy (ERC20 + FHERC20)';
  }
}

/**
 * Format amount for display (handles different decimals)
 */
export function formatAmount(amount: bigint, decimals: number): string {
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
}

/**
 * Parse amount string to bigint
 */
export function parseAmount(amount: string, decimals: number): bigint {
  const [whole, fraction = ''] = amount.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole + paddedFraction);
}
