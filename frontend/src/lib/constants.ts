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

// ============================================================================
// FheatherX Tick Constants (now using Uniswap's full TickMath range)
// ============================================================================

/** Tick spacing - each tick represents ~0.6% price change */
export const TICK_SPACING = 60;

/** Precision for fixed-point math (1e18) */
export const PRECISION = BigInt(1e18);

/** Default deadline for deposits (30 minutes from now) */
export const DEFAULT_DEADLINE_MINUTES = 30;

/** Default max tick drift (2 ticks = ~1.2% price movement) */
export const DEFAULT_MAX_TICK_DRIFT = 120;

/** Fee change delay (2 days in seconds) */
export const FEE_CHANGE_DELAY = 2 * 24 * 60 * 60;

/** Maximum protocol fee (100 bps = 1%) */
export const MAX_PROTOCOL_FEE_BPS = 100;

/** Number of ticks to show in order book (above and below current) */
export const ORDER_BOOK_TICKS_VISIBLE = 10;

// ============================================================================
// Tick/Price Utilities
// ============================================================================

/**
 * Calculate price from tick: price = 1.0001^tick * PRECISION
 * @param tick - The tick value
 * @returns Price scaled by PRECISION (1e18)
 */
export function tickToPrice(tick: number): bigint {
  // 1.0001^tick * 1e18
  const base = 1.0001;
  const price = Math.pow(base, tick) * 1e18;
  return BigInt(Math.floor(price));
}

/**
 * Calculate tick from price: tick = log(price / PRECISION) / log(1.0001)
 * @param price - Price scaled by PRECISION
 * @returns Nearest tick (rounded to TICK_SPACING)
 */
export function priceToTick(price: bigint): number {
  const priceNum = Number(price) / 1e18;
  const tick = Math.log(priceNum) / Math.log(1.0001);
  // Round to nearest TICK_SPACING
  return Math.round(tick / TICK_SPACING) * TICK_SPACING;
}

/**
 * Validate tick is within bounds and properly spaced
 */
export function isValidTick(tick: number): boolean {
  return (
    tick >= MIN_TICK &&
    tick <= MAX_TICK &&
    tick % TICK_SPACING === 0
  );
}

/**
 * Get all valid ticks in range
 */
export function getTicksInRange(startTick: number, endTick: number): number[] {
  const ticks: number[] = [];
  const start = Math.ceil(startTick / TICK_SPACING) * TICK_SPACING;
  const end = Math.floor(endTick / TICK_SPACING) * TICK_SPACING;

  for (let tick = start; tick <= end; tick += TICK_SPACING) {
    if (isValidTick(tick)) {
      ticks.push(tick);
    }
  }

  return ticks;
}

/**
 * Format price for display
 */
export function formatPrice(price: bigint, decimals: number = 4): string {
  const priceNum = Number(price) / 1e18;
  return priceNum.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Calculate deadline timestamp
 */
export function getDeadline(minutes: number = DEFAULT_DEADLINE_MINUTES): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + minutes * 60);
}
