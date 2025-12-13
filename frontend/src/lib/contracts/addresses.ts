// Contract addresses per chain
// Supported networks: Local (31337), Ethereum Sepolia (11155111), Arbitrum Sepolia (421614), Fhenix Testnet (8008135)
//
// FheatherXv6 Deployments:
// - Arbitrum Sepolia: deployments/v6-arb-sepolia.json (PRIMARY - faster blocks)
// - Ethereum Sepolia: deployments/v6-eth-sepolia.json (SECONDARY)

// Factory addresses (for multi-pool architecture) - not used in v6
export const FHEATHERX_FACTORY_ADDRESSES: Record<number, `0x${string}`> = {
  31337: (process.env.NEXT_PUBLIC_FHEATHERX_FACTORY_ADDRESS_LOCAL as `0x${string}`) || '0x0000000000000000000000000000000000000000',
  11155111: '0x0000000000000000000000000000000000000000', // v6 doesn't use factory
  421614: '0x0000000000000000000000000000000000000000',   // v6 doesn't use factory
  8008135: (process.env.NEXT_PUBLIC_FHEATHERX_FACTORY_ADDRESS_FHENIX as `0x${string}`) || '0x0000000000000000000000000000000000000000',
};

// FheatherXv6 Hook addresses
// Note: .env values (NEXT_PUBLIC_FHEATHERX_ADDRESS_*) are potentially deprecated - addresses hardcoded here
export const FHEATHERX_ADDRESSES: Record<number, `0x${string}`> = {
  31337: (process.env.NEXT_PUBLIC_FHEATHERX_ADDRESS_LOCAL as `0x${string}`) || '0x0000000000000000000000000000000000000000',
  11155111: '0x99bA4fC062c9355fccad7E4C093b2eb55F6ed0c8', // v6 Eth Sepolia (2024-12-11 redeploy)
  421614: '0x8eE2375234D0b0a50a41458a471cfa8fB490d0c8',   // v6 Arb Sepolia (limit order bugfix - 2024-12-11)
  8008135: (process.env.NEXT_PUBLIC_FHEATHERX_ADDRESS_FHENIX as `0x${string}`) || '0x0000000000000000000000000000000000000000',
};

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
  // Eth Sepolia v6: WETH/USDC (WETH < USDC by address)
  11155111: {
    token0: '0xe9Df64F549Eb1d2778909F339B9Bd795d14cF32E',  // WETH
    token1: '0xF7Ff2A5E74eaA6E0463358BB26780049d3D45C56',  // USDC
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
