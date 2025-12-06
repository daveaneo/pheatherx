'use client';

import { useCallback } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { BucketSide, BucketPosition, Bucket } from '@/types/bucket';
import { PHEATHERX_V3_ABI } from '@/lib/contracts/pheatherXv3Abi';
import { PHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { useBucketStore } from '@/stores/bucketStore';
import { isValidTick, TICK_SPACING, MIN_TICK_V3, MAX_TICK_V3 } from '@/lib/constants';

// ============================================================================
// Types
// ============================================================================

export interface UseV3PositionReturn {
  /** Fetch a single position */
  fetchPosition: (tick: number, side: BucketSide) => Promise<BucketPosition | null>;

  /** Fetch all positions for the current user across all ticks */
  fetchAllPositions: () => Promise<BucketPosition[]>;

  /** Fetch bucket data for a specific tick/side */
  fetchBucket: (tick: number, side: BucketSide) => Promise<Bucket | null>;

  /** Get a position from the local store */
  getPosition: (tick: number, side: BucketSide) => BucketPosition | null;

  /** Get all positions from local store */
  getAllPositions: () => BucketPosition[];

  /** Loading state */
  isLoading: boolean;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useV3Position(): UseV3PositionReturn {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();

  const {
    setPosition,
    setPositions,
    getPosition,
    getAllPositions,
    setBucket,
    isLoadingPositions,
    setLoadingPositions,
  } = useBucketStore();

  /**
   * Fetch a single position from the contract
   */
  const fetchPosition = useCallback(
    async (tick: number, side: BucketSide): Promise<BucketPosition | null> => {
      if (!address || !chainId || !publicClient) return null;

      const contractAddress = PHEATHERX_ADDRESSES[chainId];
      if (!contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
        return null;
      }

      try {
        const result = await publicClient.readContract({
          address: contractAddress,
          abi: PHEATHERX_V3_ABI,
          functionName: 'getPosition',
          args: [address, tick, side],
        }) as [bigint, bigint, bigint, bigint];

        const [shares, proceedsSnapshot, filledSnapshot, realized] = result;

        // Skip if no position (shares = 0)
        if (shares === 0n) return null;

        const position: BucketPosition = {
          tick,
          side,
          shares,
          proceedsSnapshot,
          filledSnapshot,
          realized,
        };

        // Update store
        setPosition(tick, side, position);

        return position;
      } catch (err) {
        console.error('[V3Position] Error fetching position:', err);
        return null;
      }
    },
    [address, chainId, publicClient, setPosition]
  );

  /**
   * Fetch all positions by scanning initialized buckets
   * This is expensive - should be optimized with indexing in production
   */
  const fetchAllPositions = useCallback(async (): Promise<BucketPosition[]> => {
    if (!address || !chainId || !publicClient) return [];

    const contractAddress = PHEATHERX_ADDRESSES[chainId];
    if (!contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
      return [];
    }

    setLoadingPositions(true);

    try {
      const positions: BucketPosition[] = [];
      const ticksToCheck: { tick: number; side: BucketSide }[] = [];

      // Generate list of tick/side combinations to check
      // In production, this should use events or an indexer
      for (let tick = MIN_TICK_V3; tick <= MAX_TICK_V3; tick += TICK_SPACING) {
        ticksToCheck.push({ tick, side: BucketSide.BUY });
        ticksToCheck.push({ tick, side: BucketSide.SELL });
      }

      // Batch fetch positions (limit concurrent requests)
      const batchSize = 10;
      for (let i = 0; i < ticksToCheck.length; i += batchSize) {
        const batch = ticksToCheck.slice(i, i + batchSize);

        const results = await Promise.all(
          batch.map(async ({ tick, side }) => {
            try {
              const result = await publicClient.readContract({
                address: contractAddress,
                abi: PHEATHERX_V3_ABI,
                functionName: 'getPosition',
                args: [address, tick, side],
              }) as [bigint, bigint, bigint, bigint];

              const [shares, proceedsSnapshot, filledSnapshot, realized] = result;

              if (shares === 0n) return null;

              return {
                tick,
                side,
                shares,
                proceedsSnapshot,
                filledSnapshot,
                realized,
              } as BucketPosition;
            } catch {
              return null;
            }
          })
        );

        results.filter((p): p is BucketPosition => p !== null).forEach(p => positions.push(p));
      }

      // Update store with all positions
      setPositions(positions);

      console.log('[V3Position] Found', positions.length, 'positions');
      return positions;
    } catch (err) {
      console.error('[V3Position] Error fetching all positions:', err);
      return [];
    } finally {
      setLoadingPositions(false);
    }
  }, [address, chainId, publicClient, setPositions, setLoadingPositions]);

  /**
   * Fetch bucket data from contract
   */
  const fetchBucket = useCallback(
    async (tick: number, side: BucketSide): Promise<Bucket | null> => {
      if (!chainId || !publicClient) return null;

      const contractAddress = PHEATHERX_ADDRESSES[chainId];
      if (!contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
        return null;
      }

      try {
        const result = await publicClient.readContract({
          address: contractAddress,
          abi: PHEATHERX_V3_ABI,
          functionName: 'getBucket',
          args: [tick, side],
        }) as [bigint, bigint, bigint, bigint, boolean];

        const [totalShares, liquidity, proceedsPerShare, filledPerShare, initialized] = result;

        const bucket: Bucket = {
          tick,
          side,
          totalShares,
          liquidity,
          proceedsPerShare,
          filledPerShare,
          initialized,
        };

        // Update store
        setBucket(tick, side, bucket);

        return bucket;
      } catch (err) {
        console.error('[V3Position] Error fetching bucket:', err);
        return null;
      }
    },
    [chainId, publicClient, setBucket]
  );

  return {
    fetchPosition,
    fetchAllPositions,
    fetchBucket,
    getPosition,
    getAllPositions,
    isLoading: isLoadingPositions,
  };
}
