/**
 * Pool types for the multi-pool FheatherX exchange
 */

export type TokenType = 'erc20' | 'fheerc20';

/**
 * Contract version type
 * - v6: Legacy contract with support for all pool types
 * - v8fhe: Full privacy pools (FHE:FHE only) - encrypted LP
 * - v8mixed: Mixed pools (one FHERC20, one ERC20) - plaintext LP
 */
export type ContractType = 'v6' | 'v8fhe' | 'v8mixed';

export interface Token {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  /** Token type - 'fheerc20' for encrypted tokens, 'erc20' for standard */
  type?: TokenType;
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
  /** Contract type - determines which ABI and functions to use */
  contractType?: ContractType;
}

/**
 * Pool selection state
 */
export interface PoolSelection {
  hookAddress: `0x${string}`;
  token0: Token;
  token1: Token;
}
