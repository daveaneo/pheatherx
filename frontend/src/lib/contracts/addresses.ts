// Contract addresses per chain
// Supported networks: Local (31337), Ethereum Sepolia (11155111), Arbitrum Sepolia (421614), Fhenix Testnet (8008135)
//
// Pool Types:
// - native: Standard Uniswap v4 for ERC:ERC pools (no FHE hook, cheaper & faster)
// - v8FHE: Full privacy pools (both tokens FHERC20, encrypted LP)
// - v8Mixed: Mixed pools (one FHERC20, one ERC20, plaintext LP)

import type { ContractType } from '@/types/pool';

// Re-export ContractType for convenience
export type { ContractType } from '@/types/pool';

// Factory addresses (for multi-pool architecture)
export const FHEATHERX_FACTORY_ADDRESSES: Record<number, `0x${string}`> = {
  31337: (process.env.NEXT_PUBLIC_FHEATHERX_FACTORY_ADDRESS_LOCAL as `0x${string}`) || '0x0000000000000000000000000000000000000000',
  11155111: '0x0000000000000000000000000000000000000000',
  421614: '0x0000000000000000000000000000000000000000',
  8008135: (process.env.NEXT_PUBLIC_FHEATHERX_FACTORY_ADDRESS_FHENIX as `0x${string}`) || '0x0000000000000000000000000000000000000000',
};

// LEGACY: FheatherXv6 Hook addresses (being phased out)
// Kept for backward compatibility during migration
export const FHEATHERX_ADDRESSES: Record<number, `0x${string}`> = {
  31337: (process.env.NEXT_PUBLIC_FHEATHERX_ADDRESS_LOCAL as `0x${string}`) || '0x0000000000000000000000000000000000000000',
  11155111: '0x99bA4fC062c9355fccad7E4C093b2eb55F6ed0c8', // v6 Eth Sepolia (LEGACY)
  421614: '0x8eE2375234D0b0a50a41458a471cfa8fB490d0c8',   // v6 Arb Sepolia (LEGACY)
  8008135: (process.env.NEXT_PUBLIC_FHEATHERX_ADDRESS_FHENIX as `0x${string}`) || '0x0000000000000000000000000000000000000000',
};

// FheatherXv8FHE Hook addresses (Full privacy - FHE:FHE pools only)
export const FHEATHERX_V8_FHE_ADDRESSES: Record<number, `0x${string}`> = {
  31337: (process.env.NEXT_PUBLIC_FHEATHERX_V8_FHE_ADDRESS_LOCAL as `0x${string}`) || '0x0000000000000000000000000000000000000000',
  11155111: '0x297987BD9647d06Ac83bCc662ae89Fc6a4019088', // v8FHE Eth Sepolia (2024-12-16)
  421614: '0x74A83BA9AbD7aE1f579319DC62BEE0D628Ac1088',   // v8FHE Arb Sepolia (2024-12-16)
  8008135: '0x0000000000000000000000000000000000000000',
};

// FheatherXv8Mixed Hook addresses (Mixed pools - one FHERC20, one ERC20)
export const FHEATHERX_V8_MIXED_ADDRESSES: Record<number, `0x${string}`> = {
  31337: (process.env.NEXT_PUBLIC_FHEATHERX_V8_MIXED_ADDRESS_LOCAL as `0x${string}`) || '0x0000000000000000000000000000000000000000',
  11155111: '0x26c3413D190Da7B7dB6f17C477050b4F2828D088', // v8Mixed Eth Sepolia (2024-12-16)
  421614: '0x3eA1877d8C7D8d9577C4152195B55a1cC5249088',   // v8Mixed Arb Sepolia (2024-12-16)
  8008135: '0x0000000000000000000000000000000000000000',
};

// Uniswap v4 Universal Router addresses (for native ERC:ERC swaps)
export const UNIVERSAL_ROUTER_ADDRESSES: Record<number, `0x${string}`> = {
  31337: (process.env.NEXT_PUBLIC_UNIVERSAL_ROUTER_ADDRESS_LOCAL as `0x${string}`) || '0x0000000000000000000000000000000000000000',
  11155111: '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b', // Uniswap v4 Universal Router Eth Sepolia
  421614: '0x0000000000000000000000000000000000000000',   // TODO: Add Arb Sepolia Universal Router
  8008135: '0x0000000000000000000000000000000000000000',
};

// Uniswap v4 Position Manager addresses (for native ERC:ERC LP)
export const POSITION_MANAGER_ADDRESSES: Record<number, `0x${string}`> = {
  31337: (process.env.NEXT_PUBLIC_POSITION_MANAGER_ADDRESS_LOCAL as `0x${string}`) || '0x0000000000000000000000000000000000000000',
  11155111: '0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4', // Uniswap v4 Position Manager Eth Sepolia
  421614: '0x0000000000000000000000000000000000000000',   // TODO: Add Arb Sepolia Position Manager
  8008135: '0x0000000000000000000000000000000000000000',
};

// Helper to get FHE hook address by type (for v8fhe/v8mixed only)
// Native pools don't use FHE hooks - they use Uniswap v4 directly
export function getFheHookAddress(
  contractType: ContractType,
  chainId: number
): `0x${string}` | undefined {
  switch (contractType) {
    case 'v8fhe':
      return FHEATHERX_V8_FHE_ADDRESSES[chainId] || undefined;
    case 'v8mixed':
      return FHEATHERX_V8_MIXED_ADDRESSES[chainId] || undefined;
    case 'native':
    default:
      // Native pools don't have FHE hooks
      return undefined;
  }
}

// Helper to get the appropriate router/swap contract for a pool type
export function getSwapContractAddress(
  contractType: ContractType,
  chainId: number
): `0x${string}` {
  if (contractType === 'native') {
    // Native ERC:ERC pools use Universal Router
    return UNIVERSAL_ROUTER_ADDRESSES[chainId] || '0x0000000000000000000000000000000000000000';
  }
  // FHE pools (v8fhe/v8mixed) use their hook contract directly for swaps
  return getFheHookAddress(contractType, chainId) || '0x0000000000000000000000000000000000000000';
}

// LEGACY: Swap router for older deployments
export const SWAP_ROUTER_ADDRESSES: Record<number, `0x${string}`> = {
  31337: (process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS_LOCAL as `0x${string}`) || '0x0000000000000000000000000000000000000000',
  11155111: '0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe', // Uniswap v4 PoolSwapTest Eth Sepolia
  421614: '0xf3A39C86dbd13C45365E57FB90fe413371F65AF8',   // Uniswap v4 PoolSwapTest Arb Sepolia
  8008135: (process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS_FHENIX as `0x${string}`) || '0x0000000000000000000000000000000000000000',
};

// Token addresses - LEGACY fallback for pool discovery
// For v6 deployments, we use WETH/USDC as default pool (Pool A)
export const TOKEN_ADDRESSES: Record<number, { token0: `0x${string}`; token1: `0x${string}` }> = {
  31337: {
    token0: (process.env.NEXT_PUBLIC_TOKEN0_ADDRESS_LOCAL as `0x${string}`) || '0x0000000000000000000000000000000000000000',
    token1: (process.env.NEXT_PUBLIC_TOKEN1_ADDRESS_LOCAL as `0x${string}`) || '0x0000000000000000000000000000000000000000',
  },
  // Eth Sepolia: USDC/WETH (sorted by address - USDC < WETH) - 2024-12-16
  11155111: {
    token0: '0xD3A106120C25aA31F2783064f26829Cb57066C2c',  // USDC
    token1: '0x2586AD56EBF7046b32405df62F583662a7086eDD',  // WETH
  },
  // Arb Sepolia v6: USDC/WETH (sorted by address - USDC < WETH)
  421614: {
    token0: '0x00F7DC53A57b980F839767a6C6214b4089d916b1',  // USDC
    token1: '0xC5EcD76Db9f00B07088DDbFbdf7BF9927F6DDE13',  // WETH
  },
  8008135: {
    token0: (process.env.NEXT_PUBLIC_TOKEN0_ADDRESS_FHENIX as `0x${string}`) || '0x0000000000000000000000000000000000000000',
    token1: (process.env.NEXT_PUBLIC_TOKEN1_ADDRESS_FHENIX as `0x${string}`) || '0x0000000000000000000000000000000000000000',
  },
};

// Uniswap v4 PoolManager addresses
export const POOL_MANAGER_ADDRESSES: Record<number, `0x${string}`> = {
  31337: (process.env.NEXT_PUBLIC_POOL_MANAGER_ADDRESS_LOCAL as `0x${string}`) || '0x0000000000000000000000000000000000000000',
  11155111: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543', // Uniswap v4 Eth Sepolia
  421614: '0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317',   // Uniswap v4 Arb Sepolia
  8008135: (process.env.NEXT_PUBLIC_POOL_MANAGER_ADDRESS_FHENIX as `0x${string}`) || '0x0000000000000000000000000000000000000000',
};

// Pool configuration
export const POOL_FEE = Number(process.env.NEXT_PUBLIC_POOL_FEE) || 3000;
export const TICK_SPACING = Number(process.env.NEXT_PUBLIC_TICK_SPACING) || 60;

// Default sqrtPriceX96 for 1:1 price ratio
// sqrt(1) * 2^96 = 79228162514264337593543950336
export const SQRT_PRICE_1_1 = BigInt('79228162514264337593543950336');
