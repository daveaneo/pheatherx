import { Token, getTokensForChain } from './tokens';

/**
 * Represents a token pair for liquidity pools
 */
export interface TokenPair {
  token0: Token;
  token1: Token;
}

/**
 * Sorts tokens by address to ensure consistent ordering
 * Uniswap convention: token0.address < token1.address
 */
export function sortTokens(tokenA: Token, tokenB: Token): [Token, Token] {
  if (tokenA.address.toLowerCase() < tokenB.address.toLowerCase()) {
    return [tokenA, tokenB];
  }
  return [tokenB, tokenA];
}

/**
 * Get all possible token pairs for a chain
 * For 4 tokens, this returns 6 unique pairs (4 choose 2 = 6)
 */
export function getAllTokenPairs(chainId: number): TokenPair[] {
  const tokens = getTokensForChain(chainId);
  const pairs: TokenPair[] = [];

  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      const [token0, token1] = sortTokens(tokens[i], tokens[j]);
      pairs.push({ token0, token1 });
    }
  }

  return pairs;
}

/**
 * Get a specific token pair, sorted correctly
 */
export function getTokenPair(tokenA: Token, tokenB: Token): TokenPair {
  const [token0, token1] = sortTokens(tokenA, tokenB);
  return { token0, token1 };
}

/**
 * Check if two token pairs are equal (same tokens, any order)
 */
export function arePairsEqual(pairA: TokenPair, pairB: TokenPair): boolean {
  const sortedA = sortTokens(pairA.token0, pairA.token1);
  const sortedB = sortTokens(pairB.token0, pairB.token1);

  return (
    sortedA[0].address.toLowerCase() === sortedB[0].address.toLowerCase() &&
    sortedA[1].address.toLowerCase() === sortedB[1].address.toLowerCase()
  );
}

/**
 * Get a unique identifier for a token pair
 */
export function getPairId(pair: TokenPair): string {
  const [token0, token1] = sortTokens(pair.token0, pair.token1);
  return `${token0.address.toLowerCase()}-${token1.address.toLowerCase()}`;
}

/**
 * Format a token pair for display
 */
export function formatPairName(pair: TokenPair): string {
  return `${pair.token0.symbol} / ${pair.token1.symbol}`;
}

/**
 * Check if a pair contains only FHERC20 tokens (fully private)
 */
export function isPrivatePair(pair: TokenPair): boolean {
  return pair.token0.type === 'fheerc20' && pair.token1.type === 'fheerc20';
}

/**
 * Check if a pair contains any FHERC20 tokens
 */
export function hasPrivateToken(pair: TokenPair): boolean {
  return pair.token0.type === 'fheerc20' || pair.token1.type === 'fheerc20';
}

/**
 * Check if a pair is a "wrap pair" (same underlying asset)
 * e.g., WETH/fheWETH or USDC/fheUSDC
 */
export function isWrapPair(pair: TokenPair): boolean {
  // Check if one token is the wrapped version of the other
  if (pair.token0.wrappedToken === pair.token1.address) return true;
  if (pair.token1.wrappedToken === pair.token0.address) return true;
  if (pair.token0.unwrappedToken === pair.token1.address) return true;
  if (pair.token1.unwrappedToken === pair.token0.address) return true;
  return false;
}

/**
 * Get recommended pairs (exclude wrap pairs which don't make economic sense)
 */
export function getRecommendedPairs(chainId: number): TokenPair[] {
  return getAllTokenPairs(chainId).filter(pair => !isWrapPair(pair));
}
