'use client';

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  BucketSide,
  BucketPosition,
  Bucket,
  BucketKey,
  createBucketKey,
} from '@/types/bucket';

// ============================================================================
// Types
// ============================================================================

/**
 * Serialized position for storage (bigint → string)
 */
interface SerializedPosition {
  tick: number;
  side: BucketSide;
  shares: string;
  proceedsSnapshot: string;
  filledSnapshot: string;
  realized: string;
}

/**
 * Serialized bucket for storage
 */
interface SerializedBucket {
  tick: number;
  side: BucketSide;
  totalShares: string;
  liquidity: string;
  proceedsPerShare: string;
  filledPerShare: string;
  initialized: boolean;
}

// ============================================================================
// Store Interface
// ============================================================================

interface BucketState {
  // ==========================================================================
  // State
  // ==========================================================================

  /** User positions by bucket key (tick-side) */
  positions: Record<BucketKey, SerializedPosition>;

  /** Bucket data by bucket key */
  buckets: Record<BucketKey, SerializedBucket>;

  /** Current market state */
  currentTick: number;
  reserve0: string; // Stored as string for serialization
  reserve1: string;

  /** Loading states */
  isLoadingPositions: boolean;
  isLoadingBuckets: boolean;
  isLoadingReserves: boolean;

  /** Last update timestamps */
  lastPositionsUpdate: number | null;
  lastBucketsUpdate: number | null;
  lastReservesUpdate: number | null;

  // ==========================================================================
  // Actions - Positions
  // ==========================================================================

  /** Set a single position */
  setPosition: (tick: number, side: BucketSide, position: BucketPosition) => void;

  /** Set multiple positions at once */
  setPositions: (positions: BucketPosition[]) => void;

  /** Get a position (returns null if not found) */
  getPosition: (tick: number, side: BucketSide) => BucketPosition | null;

  /** Get all positions as array */
  getAllPositions: () => BucketPosition[];

  /** Remove a position */
  removePosition: (tick: number, side: BucketSide) => void;

  /** Clear all positions */
  clearPositions: () => void;

  // ==========================================================================
  // Actions - Buckets
  // ==========================================================================

  /** Set a single bucket */
  setBucket: (tick: number, side: BucketSide, bucket: Bucket) => void;

  /** Set multiple buckets at once */
  setBuckets: (buckets: Bucket[]) => void;

  /** Get a bucket (returns null if not found) */
  getBucket: (tick: number, side: BucketSide) => Bucket | null;

  /** Clear all buckets */
  clearBuckets: () => void;

  // ==========================================================================
  // Actions - Market State
  // ==========================================================================

  /** Set current tick */
  setCurrentTick: (tick: number) => void;

  /** Set reserves */
  setReserves: (reserve0: bigint, reserve1: bigint) => void;

  // ==========================================================================
  // Actions - Loading States
  // ==========================================================================

  /** Set loading state for positions */
  setLoadingPositions: (loading: boolean) => void;

  /** Set loading state for buckets */
  setLoadingBuckets: (loading: boolean) => void;

  /** Set loading state for reserves */
  setLoadingReserves: (loading: boolean) => void;

  // ==========================================================================
  // Actions - Reset
  // ==========================================================================

  /** Reset all state */
  reset: () => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

function serializePosition(position: BucketPosition): SerializedPosition {
  return {
    tick: position.tick,
    side: position.side,
    shares: position.shares.toString(),
    proceedsSnapshot: position.proceedsSnapshot.toString(),
    filledSnapshot: position.filledSnapshot.toString(),
    realized: position.realized.toString(),
  };
}

function deserializePosition(serialized: SerializedPosition): BucketPosition {
  return {
    tick: serialized.tick,
    side: serialized.side,
    shares: BigInt(serialized.shares),
    proceedsSnapshot: BigInt(serialized.proceedsSnapshot),
    filledSnapshot: BigInt(serialized.filledSnapshot),
    realized: BigInt(serialized.realized),
  };
}

function serializeBucket(bucket: Bucket): SerializedBucket {
  return {
    tick: bucket.tick,
    side: bucket.side,
    totalShares: bucket.totalShares.toString(),
    liquidity: bucket.liquidity.toString(),
    proceedsPerShare: bucket.proceedsPerShare.toString(),
    filledPerShare: bucket.filledPerShare.toString(),
    initialized: bucket.initialized,
  };
}

function deserializeBucket(serialized: SerializedBucket): Bucket {
  return {
    tick: serialized.tick,
    side: serialized.side,
    totalShares: BigInt(serialized.totalShares),
    liquidity: BigInt(serialized.liquidity),
    proceedsPerShare: BigInt(serialized.proceedsPerShare),
    filledPerShare: BigInt(serialized.filledPerShare),
    initialized: serialized.initialized,
  };
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useBucketStore = create<BucketState>()(
  immer((set, get) => ({
    // Initial state
    positions: {},
    buckets: {},
    currentTick: 0,
    reserve0: '0',
    reserve1: '0',
    isLoadingPositions: false,
    isLoadingBuckets: false,
    isLoadingReserves: false,
    lastPositionsUpdate: null,
    lastBucketsUpdate: null,
    lastReservesUpdate: null,

    // ==========================================================================
    // Position Actions
    // ==========================================================================

    setPosition: (tick, side, position) =>
      set(state => {
        const key = createBucketKey(tick, side);
        state.positions[key] = serializePosition(position);
        state.lastPositionsUpdate = Date.now();
      }),

    setPositions: positions =>
      set(state => {
        for (const position of positions) {
          const key = createBucketKey(position.tick, position.side);
          state.positions[key] = serializePosition(position);
        }
        state.lastPositionsUpdate = Date.now();
      }),

    getPosition: (tick, side) => {
      const key = createBucketKey(tick, side);
      const serialized = get().positions[key];
      if (!serialized) return null;
      return deserializePosition(serialized);
    },

    getAllPositions: () => {
      const { positions } = get();
      return Object.values(positions).map(deserializePosition);
    },

    removePosition: (tick, side) =>
      set(state => {
        const key = createBucketKey(tick, side);
        delete state.positions[key];
        state.lastPositionsUpdate = Date.now();
      }),

    clearPositions: () =>
      set(state => {
        state.positions = {};
        state.lastPositionsUpdate = Date.now();
      }),

    // ==========================================================================
    // Bucket Actions
    // ==========================================================================

    setBucket: (tick, side, bucket) =>
      set(state => {
        const key = createBucketKey(tick, side);
        state.buckets[key] = serializeBucket(bucket);
        state.lastBucketsUpdate = Date.now();
      }),

    setBuckets: buckets =>
      set(state => {
        for (const bucket of buckets) {
          const key = createBucketKey(bucket.tick, bucket.side);
          state.buckets[key] = serializeBucket(bucket);
        }
        state.lastBucketsUpdate = Date.now();
      }),

    getBucket: (tick, side) => {
      const key = createBucketKey(tick, side);
      const serialized = get().buckets[key];
      if (!serialized) return null;
      return deserializeBucket(serialized);
    },

    clearBuckets: () =>
      set(state => {
        state.buckets = {};
        state.lastBucketsUpdate = Date.now();
      }),

    // ==========================================================================
    // Market State Actions
    // ==========================================================================

    setCurrentTick: tick =>
      set(state => {
        state.currentTick = tick;
      }),

    setReserves: (reserve0, reserve1) =>
      set(state => {
        state.reserve0 = reserve0.toString();
        state.reserve1 = reserve1.toString();
        state.lastReservesUpdate = Date.now();
      }),

    // ==========================================================================
    // Loading State Actions
    // ==========================================================================

    setLoadingPositions: loading =>
      set(state => {
        state.isLoadingPositions = loading;
      }),

    setLoadingBuckets: loading =>
      set(state => {
        state.isLoadingBuckets = loading;
      }),

    setLoadingReserves: loading =>
      set(state => {
        state.isLoadingReserves = loading;
      }),

    // ==========================================================================
    // Reset
    // ==========================================================================

    reset: () =>
      set(state => {
        state.positions = {};
        state.buckets = {};
        state.currentTick = 0;
        state.reserve0 = '0';
        state.reserve1 = '0';
        state.isLoadingPositions = false;
        state.isLoadingBuckets = false;
        state.isLoadingReserves = false;
        state.lastPositionsUpdate = null;
        state.lastBucketsUpdate = null;
        state.lastReservesUpdate = null;
      }),
  }))
);

// ============================================================================
// Selector Hooks (for derived state)
// ============================================================================

/**
 * Get positions count
 */
export function usePositionsCount(): number {
  return useBucketStore(state => Object.keys(state.positions).length);
}

/**
 * Get reserve0 as bigint
 */
export function useReserve0(): bigint {
  return useBucketStore(state => BigInt(state.reserve0));
}

/**
 * Get reserve1 as bigint
 */
export function useReserve1(): bigint {
  return useBucketStore(state => BigInt(state.reserve1));
}

/**
 * Check if user has any positions
 */
export function useHasPositions(): boolean {
  return useBucketStore(state => Object.keys(state.positions).length > 0);
}

/**
 * Get positions for a specific side
 */
export function usePositionsBySide(side: BucketSide): BucketPosition[] {
  return useBucketStore(state =>
    Object.values(state.positions)
      .filter(p => p.side === side)
      .map(deserializePosition)
  );
}
