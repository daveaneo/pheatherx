import { keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';
import { POOL_FEE, TICK_SPACING } from './contracts/addresses';
import { sortTokens } from './pairs';
import type { Token } from './tokens';

/**
 * PoolKey structure matching Uniswap v4
 */
export interface PoolKey {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

/**
 * Compute the PoolId (bytes32) from a PoolKey
 * PoolId = keccak256(abi.encode(PoolKey))
 */
export function computePoolId(poolKey: PoolKey): `0x${string}` {
  const encoded = encodeAbiParameters(
    parseAbiParameters('address, address, uint24, int24, address'),
    [
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.tickSpacing,
      poolKey.hooks,
    ]
  );
  return keccak256(encoded);
}

/**
 * Create a PoolKey from tokens and hook address
 * Tokens are automatically sorted to maintain consistency
 */
export function createPoolKey(
  tokenA: Token,
  tokenB: Token,
  hookAddress: `0x${string}`,
  fee: number = POOL_FEE,
  tickSpacing: number = TICK_SPACING
): PoolKey {
  const [token0, token1] = sortTokens(tokenA, tokenB);

  return {
    currency0: token0.address,
    currency1: token1.address,
    fee,
    tickSpacing,
    hooks: hookAddress,
  };
}

/**
 * Get PoolId from tokens and hook address
 */
export function getPoolIdFromTokens(
  tokenA: Token,
  tokenB: Token,
  hookAddress: `0x${string}`
): `0x${string}` {
  const poolKey = createPoolKey(tokenA, tokenB, hookAddress);
  return computePoolId(poolKey);
}
