import { NATIVE_ETH_ADDRESS } from '@/lib/constants';
import { TOKEN_ADDRESSES } from '@/lib/contracts/addresses';

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

// Token lists per chain - will be populated dynamically from contract
export const TOKEN_LIST: Record<number, Token[]> = {
  // Local Anvil
  31337: [
    {
      address: TOKEN_ADDRESSES[31337]?.token0 || '0x0000000000000000000000000000000000000000',
      symbol: 'TKA',
      name: 'Test Token A',
      decimals: 18,
    },
    {
      address: TOKEN_ADDRESSES[31337]?.token1 || '0x0000000000000000000000000000000000000000',
      symbol: 'TKB',
      name: 'Test Token B',
      decimals: 18,
    },
  ],
  // Ethereum Sepolia
  // Note: token0/token1 are sorted by address in Uniswap v4
  // token0 (0x453...) = WETH (18 decimals)
  // token1 (0xF6f...) = USDC (6 decimals)
  11155111: [
    {
      address: TOKEN_ADDRESSES[11155111]?.token0 || '0x0000000000000000000000000000000000000000',
      symbol: 'WETH',
      name: 'WETH',
      decimals: 18,
      type: 'erc20',
      wrappedToken: '0xf0F8f49b4065A1B01050Fa358d287106B676a25F', // fheWETH
    },
    {
      address: TOKEN_ADDRESSES[11155111]?.token1 || '0x0000000000000000000000000000000000000000',
      symbol: 'USDC',
      name: 'USDC',
      decimals: 6,
      type: 'erc20',
      wrappedToken: '0x1D77eE754b2080B354733299A5aC678539a0D740', // fheUSDC
    },
  ],
  // Arbitrum Sepolia
  421614: [
    {
      address: TOKEN_ADDRESSES[421614]?.token0 || '0x0000000000000000000000000000000000000000',
      symbol: 'TKA',
      name: 'Test Token A',
      decimals: 18,
    },
    {
      address: TOKEN_ADDRESSES[421614]?.token1 || '0x0000000000000000000000000000000000000000',
      symbol: 'TKB',
      name: 'Test Token B',
      decimals: 18,
    },
  ],
  // Fhenix Testnet
  8008135: [
    {
      address: TOKEN_ADDRESSES[8008135]?.token0 || '0x0000000000000000000000000000000000000000',
      symbol: 'TKA',
      name: 'Test Token A',
      decimals: 18,
    },
    {
      address: TOKEN_ADDRESSES[8008135]?.token1 || '0x0000000000000000000000000000000000000000',
      symbol: 'TKB',
      name: 'Test Token B',
      decimals: 18,
    },
  ],
};

export function getToken(chainId: number, isToken0: boolean): Token | undefined {
  const tokens = TOKEN_LIST[chainId];
  if (!tokens) return undefined;
  return isToken0 ? tokens[0] : tokens[1];
}
