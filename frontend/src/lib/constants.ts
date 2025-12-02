// Protocol
export const PROTOCOL_FEE = 0.001; // ETH
export const PROTOCOL_FEE_WEI = BigInt(1e15); // 0.001 ETH in wei
export const EXECUTOR_REWARD_BPS = 100; // 1%

// FHE
export const FHE_SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
export const FHE_RETRY_ATTEMPTS = 3;
export const FHE_RETRY_BASE_DELAY_MS = 1000;

// Caching
export const BALANCE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const TX_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

// Uniswap
export const MIN_SQRT_RATIO = BigInt('4295128739');
export const MAX_SQRT_RATIO = BigInt('1461446703485210103287273052203988822378723970342');
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

// Addresses
export const NATIVE_ETH_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

// UI
export const DEFAULT_SLIPPAGE = 0.5; // 0.5%
export const MAX_SLIPPAGE = 50; // 50%
