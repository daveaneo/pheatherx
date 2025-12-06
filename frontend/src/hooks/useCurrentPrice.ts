'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePublicClient, useAccount } from 'wagmi';
import { PHEATHERX_V3_ABI } from '@/lib/contracts/pheatherXv3Abi';
import { PHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { useBucketStore } from '@/stores/bucketStore';
import { tickToPrice, formatPrice, PRECISION, TICK_SPACING } from '@/lib/constants';
import type { CurrentPrice } from '@/types/bucket';

// ============================================================================
// Types
// ============================================================================

export interface UseCurrentPriceReturn {
  /** Current price data */
  currentPrice: CurrentPrice | null;

  /** Current tick (derived from reserves) */
  currentTick: number;

  /** Refresh price data */
  refresh: () => Promise<void>;

  /** Loading state */
  isLoading: boolean;

  /** Error state */
  error: Error | null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate current tick from reserves
 * tick = log(reserve1/reserve0) / log(1.0001)
 */
function reservesToTick(reserve0: bigint, reserve1: bigint): number {
  if (reserve0 === 0n || reserve1 === 0n) return 0;

  // Calculate price ratio
  const ratio = Number(reserve1) / Number(reserve0);

  // Convert to tick: tick = log(ratio) / log(1.0001)
  const tick = Math.log(ratio) / Math.log(1.0001);

  // Round to nearest TICK_SPACING
  return Math.round(tick / TICK_SPACING) * TICK_SPACING;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useCurrentPrice(): UseCurrentPriceReturn {
  const { chainId } = useAccount();
  const publicClient = usePublicClient();

  const { setReserves, setCurrentTick, reserve0: storedReserve0, reserve1: storedReserve1, currentTick: storedTick } = useBucketStore();

  const [currentPrice, setCurrentPrice] = useState<CurrentPrice | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Fetch current reserves and calculate price
   */
  const refresh = useCallback(async () => {
    if (!chainId || !publicClient) return;

    const contractAddress = PHEATHERX_ADDRESSES[chainId];
    if (!contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Fetch reserves from contract
      const [reserve0, reserve1] = await Promise.all([
        publicClient.readContract({
          address: contractAddress,
          abi: PHEATHERX_V3_ABI,
          functionName: 'reserve0',
        }) as Promise<bigint>,
        publicClient.readContract({
          address: contractAddress,
          abi: PHEATHERX_V3_ABI,
          functionName: 'reserve1',
        }) as Promise<bigint>,
      ]);

      // Calculate current tick from reserves
      const tick = reservesToTick(reserve0, reserve1);

      // Calculate price at current tick
      const price = tickToPrice(tick);

      // Update store
      setReserves(reserve0, reserve1);
      setCurrentTick(tick);

      // Update local state
      setCurrentPrice({
        currentTick: tick,
        price,
        priceFormatted: formatPrice(price),
        reserve0,
        reserve1,
      });

      console.log('[CurrentPrice] Updated:', { tick, price: formatPrice(price), reserve0: reserve0.toString(), reserve1: reserve1.toString() });
    } catch (err) {
      console.error('[CurrentPrice] Error:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [chainId, publicClient, setReserves, setCurrentTick]);

  // Auto-refresh on mount and chain change
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Derive current tick from stored values
  const currentTick = storedTick || (currentPrice?.currentTick ?? 0);

  return {
    currentPrice,
    currentTick,
    refresh,
    isLoading,
    error,
  };
}

// ============================================================================
// Utility Hook: Get tick price
// ============================================================================

/**
 * Hook to get prices for specific ticks
 */
export function useTickPrices(ticks: number[]): { prices: Record<number, bigint>; isLoading: boolean } {
  const { chainId } = useAccount();
  const publicClient = usePublicClient();

  const [prices, setPrices] = useState<Record<number, bigint>>({});
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!chainId || !publicClient || ticks.length === 0) return;

    const contractAddress = PHEATHERX_ADDRESSES[chainId];
    if (!contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
      // Use local calculation as fallback
      const localPrices: Record<number, bigint> = {};
      ticks.forEach(tick => {
        localPrices[tick] = tickToPrice(tick);
      });
      setPrices(localPrices);
      return;
    }

    setIsLoading(true);

    publicClient
      .readContract({
        address: contractAddress,
        abi: PHEATHERX_V3_ABI,
        functionName: 'getTickPrices',
        args: [ticks],
      })
      .then((result) => {
        const priceArray = result as bigint[];
        const priceMap: Record<number, bigint> = {};
        ticks.forEach((tick, i) => {
          priceMap[tick] = priceArray[i] ?? tickToPrice(tick);
        });
        setPrices(priceMap);
      })
      .catch((err) => {
        console.error('[TickPrices] Error:', err);
        // Fallback to local calculation
        const localPrices: Record<number, bigint> = {};
        ticks.forEach(tick => {
          localPrices[tick] = tickToPrice(tick);
        });
        setPrices(localPrices);
      })
      .finally(() => setIsLoading(false));
  }, [chainId, publicClient, ticks.join(',')]);

  return { prices, isLoading };
}
