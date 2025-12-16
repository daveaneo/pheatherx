/**
 * FheatherX v3 Bucket Types
 *
 * These types map directly to the FheatherXv3 contract interface.
 * BucketSide enum values MUST match contract: BUY=0, SELL=1
 */

// ============================================================================
// Core Enums (match contract exactly)
// ============================================================================

/**
 * Bucket side enum - matches contract BucketSide enum
 * BUY (0): Users want to buy token0, deposit token1
 * SELL (1): Users want to sell token0, deposit token0
 */
export enum BucketSide {
  BUY = 0,
  SELL = 1,
}

// ============================================================================
// Order Types (frontend terminology → bucket mapping)
// ============================================================================

/**
 * Order types use traditional trading terminology
 * These map to bucket deposits at specific ticks/sides
 */
export type OrderType = 'limit-buy' | 'limit-sell' | 'stop-loss' | 'take-profit';

/**
 * Order mode - determines execution behavior
 * - maker: Orders REST in the book, ADD liquidity, execute at EXACT price (no slippage)
 * - taker: Orders EXECUTE as swaps, TAKE liquidity, can have slippage up to 100%
 */
export type OrderMode = 'maker' | 'taker';

/**
 * Configuration for each order type
 */
export interface OrderTypeConfig {
  /** Display label */
  label: string;
  /** Description for users */
  description: string;
  /** Which bucket side to deposit into */
  side: BucketSide;
  /** Whether trigger tick should be below or above current price */
  tickRelation: 'below' | 'above';
  /** Token being deposited (input token) */
  depositToken: 'token0' | 'token1';
  /** Token received when filled (output token) */
  receiveToken: 'token0' | 'token1';
  /** Order mode: maker (exact price) or taker (can have slippage) */
  mode: OrderMode;
}

/**
 * Order type configurations mapping traditional terms to bucket mechanics
 */
export const ORDER_TYPE_CONFIG: Record<OrderType, OrderTypeConfig> = {
  'limit-buy': {
    label: 'Limit Buy',
    description: 'Buy token0 when price drops to target',
    side: BucketSide.BUY,
    tickRelation: 'below',
    depositToken: 'token1',
    receiveToken: 'token0',
    mode: 'maker',
  },
  'limit-sell': {
    label: 'Limit Sell',
    description: 'Sell token0 when price rises to target',
    side: BucketSide.SELL,
    tickRelation: 'above',
    depositToken: 'token0',
    receiveToken: 'token1',
    mode: 'maker',
  },
  'stop-loss': {
    label: 'Stop Loss',
    description: 'Sell token0 if price drops to stop level',
    side: BucketSide.SELL,
    tickRelation: 'below',
    depositToken: 'token0',
    receiveToken: 'token1',
    mode: 'taker',
  },
  'take-profit': {
    label: 'Take Profit',
    description: 'Sell token0 when price rises to target',
    side: BucketSide.SELL,
    tickRelation: 'above',
    depositToken: 'token0',
    receiveToken: 'token1',
    mode: 'taker',
  },
};

// ============================================================================
// Position Types (encrypted values from contract)
// ============================================================================

/**
 * User's position in a bucket at a specific tick/side
 * All bigint values are FHE ciphertext handles (not plaintext)
 */
export interface BucketPosition {
  /** Price tick (plaintext) */
  tick: number;
  /** Bucket side (plaintext) */
  side: BucketSide;
  /** User's shares - encrypted handle */
  shares: bigint;
  /** Proceeds snapshot - encrypted handle */
  proceedsSnapshot: bigint;
  /** Filled snapshot - encrypted handle */
  filledSnapshot: bigint;
  /** Realized proceeds - encrypted handle */
  realized: bigint;
}

/**
 * Derived position values (computed from position + bucket)
 */
export interface DerivedPosition {
  /** Base position data */
  position: BucketPosition;
  /** Claimable proceeds - encrypted handle (computed) */
  claimable: bigint;
  /** Withdrawable unfilled - encrypted handle (computed) */
  withdrawable: bigint;
  /** Whether position has any shares */
  hasPosition: boolean;
  /** Order type derived from tick position relative to current */
  orderType: OrderType | null;
  /** Price at this tick (plaintext, from tickPrices) */
  price: bigint;
  /** Formatted price string */
  priceFormatted: string;
}

// ============================================================================
// Bucket Types (bucket state from contract)
// ============================================================================

/**
 * Bucket state at a specific tick/side
 * All bigint values are FHE ciphertext handles
 */
export interface Bucket {
  /** Price tick (plaintext) */
  tick: number;
  /** Bucket side (plaintext) */
  side: BucketSide;
  /** Total shares in bucket - encrypted handle */
  totalShares: bigint;
  /** Unfilled liquidity - encrypted handle */
  liquidity: bigint;
  /** Proceeds per share accumulator - encrypted handle */
  proceedsPerShare: bigint;
  /** Filled per share accumulator - encrypted handle */
  filledPerShare: bigint;
  /** Whether bucket has been initialized (plaintext) */
  initialized: boolean;
}

// ============================================================================
// Price Types
// ============================================================================

/**
 * Tick price information
 */
export interface TickPrice {
  /** Tick value */
  tick: number;
  /** Price scaled by PRECISION (1e18) */
  price: bigint;
  /** Human-readable price string */
  priceFormatted: string;
  /** Percentage difference from current tick */
  percentFromCurrent?: number;
}

/**
 * Current market price state
 */
export interface CurrentPrice {
  /** Current tick (derived from reserves) */
  currentTick: number;
  /** Current price (scaled by 1e18) */
  price: bigint;
  /** Formatted price string */
  priceFormatted: string;
  /** Reserve of token0 */
  reserve0: bigint;
  /** Reserve of token1 */
  reserve1: bigint;
}

// ============================================================================
// Transaction Types
// ============================================================================

/**
 * Deposit parameters
 */
export interface DepositParams {
  /** Target tick (must be multiple of TICK_SPACING) */
  tick: number;
  /** Amount to deposit (will be encrypted) */
  amount: bigint;
  /** Bucket side */
  side: BucketSide;
  /** Transaction deadline (block.timestamp) */
  deadline: bigint;
  /** Maximum tick drift allowed */
  maxTickDrift: number;
}

/**
 * Swap parameters
 */
export interface SwapParams {
  /** True = sell token0 for token1 */
  zeroForOne: boolean;
  /** Input amount (plaintext) */
  amountIn: bigint;
  /** Minimum output amount (after fees) */
  minAmountOut: bigint;
}

/**
 * Withdraw parameters
 */
export interface WithdrawParams {
  /** Tick to withdraw from */
  tick: number;
  /** Bucket side */
  side: BucketSide;
  /** Amount to withdraw (will be encrypted) */
  amount: bigint;
}

// ============================================================================
// Event Types (for indexing)
// ============================================================================

/**
 * Deposit event from contract
 */
export interface DepositEvent {
  user: `0x${string}`;
  tick: number;
  side: BucketSide;
  amountHash: `0x${string}`;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
}

/**
 * Swap event from contract
 */
export interface SwapEvent {
  user: `0x${string}`;
  zeroForOne: boolean;
  amountIn: bigint;
  amountOut: bigint;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
}

/**
 * Claim event from contract
 */
export interface ClaimEvent {
  user: `0x${string}`;
  tick: number;
  side: BucketSide;
  amountHash: `0x${string}`;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
}

/**
 * Withdraw event from contract
 */
export interface WithdrawEvent {
  user: `0x${string}`;
  tick: number;
  side: BucketSide;
  amountHash: `0x${string}`;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
}

/**
 * BucketFilled event from contract
 */
export interface BucketFilledEvent {
  tick: number;
  side: BucketSide;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Key for position/bucket maps: "${tick}-${side}"
 */
export type BucketKey = `${number}-${BucketSide}`;

/**
 * Create a bucket key from tick and side
 */
export function createBucketKey(tick: number, side: BucketSide): BucketKey {
  return `${tick}-${side}`;
}

/**
 * Parse a bucket key back to tick and side
 */
export function parseBucketKey(key: BucketKey): { tick: number; side: BucketSide } {
  const [tickStr, sideStr] = key.split('-');
  return {
    tick: parseInt(tickStr, 10),
    side: parseInt(sideStr, 10) as BucketSide,
  };
}

/**
 * Get the opposite side
 */
export function getOppositeSide(side: BucketSide): BucketSide {
  return side === BucketSide.BUY ? BucketSide.SELL : BucketSide.BUY;
}

/**
 * Get display name for bucket side
 */
export function getSideName(side: BucketSide): string {
  return side === BucketSide.BUY ? 'BUY' : 'SELL';
}

/**
 * Determine order type from tick position relative to current
 */
export function deriveOrderType(
  tick: number,
  side: BucketSide,
  currentTick: number
): OrderType | null {
  const isAbove = tick > currentTick;
  const isBelow = tick < currentTick;

  if (side === BucketSide.BUY) {
    // BUY bucket: only valid below current (limit buy)
    if (isBelow) return 'limit-buy';
  } else {
    // SELL bucket: can be above (limit sell / take profit) or below (stop loss)
    if (isAbove) return 'limit-sell'; // or 'take-profit' - they're the same mechanically
    if (isBelow) return 'stop-loss';
  }

  return null;
}
