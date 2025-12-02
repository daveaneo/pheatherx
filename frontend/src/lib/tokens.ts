import { NATIVE_ETH_ADDRESS } from '@/lib/constants';
import { TOKEN_ADDRESSES } from '@/lib/contracts/addresses';

export interface Token {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  isNative?: boolean;
  logoUrl?: string;
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
  11155111: [
    {
      address: TOKEN_ADDRESSES[11155111]?.token0 || '0x0000000000000000000000000000000000000000',
      symbol: 'tUSDC',
      name: 'PheatherX Test USDC',
      decimals: 6,
    },
    {
      address: TOKEN_ADDRESSES[11155111]?.token1 || '0x0000000000000000000000000000000000000000',
      symbol: 'tWETH',
      name: 'PheatherX Test WETH',
      decimals: 18,
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
