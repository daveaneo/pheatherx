/**
 * Pool types for the multi-pool FheatherX exchange
 */

export interface Token {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
}

/**
 * Raw pool info from the factory contract
 */
export interface PoolInfo {
  token0: `0x${string}`;
  token1: `0x${string}`;
  hook: `0x${string}`;
  createdAt: bigint;
  active: boolean;
}

/**
 * Pool with enriched token metadata
 */
export interface Pool extends PoolInfo {
  token0Meta: Token;
  token1Meta: Token;
}

/**
 * Pool selection state
 */
export interface PoolSelection {
  hookAddress: `0x${string}`;
  token0: Token;
  token1: Token;
}
