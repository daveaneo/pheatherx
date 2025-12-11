'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePublicClient, useAccount } from 'wagmi';
import { FHEATHERX_V6_ABI } from '@/lib/contracts/fheatherXv6Abi';
import { FHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { useBucketStore } from '@/stores/bucketStore';
import { useSelectedPool } from '@/stores/poolStore';
import { tickToPrice, formatPrice, PRECISION, TICK_SPACING } from '@/lib/constants';
import { getPoolIdFromTokens } from '@/lib/poolId';
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
 *
 * Important: reserves must be normalized by their token decimals before calculating ratio
 */
function reservesToTick(
  reserve0: bigint,
  reserve1: bigint,
  decimals0: number,
  decimals1: number
): number {
  if (reserve0 === 0n || reserve1 === 0n) return 0;

  // Normalize reserves to their actual token amounts (divide by 10^decimals)
  const normalized0 = Number(reserve0) / Math.pow(10, decimals0);
  const normalized1 = Number(reserve1) / Math.pow(10, decimals1);

  if (normalized0 === 0) return 0;

  // Calculate price ratio (token1 per token0)
  const ratio = normalized1 / normalized0;

  // Convert to tick: tick = log(ratio) / log(1.0001)
  const tick = Math.log(ratio) / Math.log(1.0001);

  // Round to nearest TICK_SPACING
  return Math.round(tick / TICK_SPACING) * TICK_SPACING;
}

/**
 * Calculate formatted price from reserves with decimal normalization
 */
function reservesToPrice(
  reserve0: bigint,
  reserve1: bigint,
  decimals0: number,
  decimals1: number
): string {
  if (reserve0 === 0n) return '0.0000';

  // Normalize reserves to their actual token amounts
  const normalized0 = Number(reserve0) / Math.pow(10, decimals0);
  const normalized1 = Number(reserve1) / Math.pow(10, decimals1);

  if (normalized0 === 0) return '0.0000';

  // Price = token1 amount / token0 amount
  const price = normalized1 / normalized0;

  // Format with appropriate precision
  if (price >= 1000) {
    return price.toFixed(2);
  } else if (price >= 1) {
    return price.toFixed(4);
  } else {
    return price.toFixed(6);
  }
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useCurrentPrice(): UseCurrentPriceReturn {
  const { chainId } = useAccount();
  const publicClient = usePublicClient();

  // Get hook address and tokens from selected pool (multi-pool support)
  const { hookAddress: selectedHookAddress, token0, token1 } = useSelectedPool();

  // Validate hook address matches current chain - prevents using stale data from wrong chain
  const expectedHookAddress = chainId ? FHEATHERX_ADDRESSES[chainId] : undefined;
  const hookAddress = useMemo(() => {
    // Only use the selected hook if it matches the current chain's expected hook
    if (selectedHookAddress && expectedHookAddress &&
        selectedHookAddress.toLowerCase() === expectedHookAddress.toLowerCase()) {
      return selectedHookAddress;
    }
    // Fall back to the chain's hook address
    return expectedHookAddress;
  }, [selectedHookAddress, expectedHookAddress]);

  // Compute pool ID from tokens and hook
  const poolId = useMemo(() => {
    if (!token0 || !token1 || !hookAddress) return null;
    try {
      return getPoolIdFromTokens(token0, token1, hookAddress);
    } catch {
      return null;
    }
  }, [token0, token1, hookAddress]);

  const { setReserves, setCurrentTick, reserve0: storedReserve0, reserve1: storedReserve1, currentTick: storedTick } = useBucketStore();

  const [currentPrice, setCurrentPrice] = useState<CurrentPrice | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Fetch current reserves and calculate price
   */
  const refresh = useCallback(async () => {
    if (!chainId || !publicClient || !hookAddress || !poolId || !token0 || !token1) return;

    setIsLoading(true);
    setError(null);

    try {
      // Fetch reserves from contract using v6 API: getPoolReserves(poolId)
      const result = await publicClient.readContract({
        address: hookAddress,
        abi: FHEATHERX_V6_ABI,
        functionName: 'getPoolReserves',
        args: [poolId],
      }) as [bigint, bigint, bigint]; // [reserve0, reserve1, lpSupply]

      const [reserve0, reserve1] = result;

      // Calculate current tick from reserves (with decimal normalization)
      const tick = reservesToTick(reserve0, reserve1, token0.decimals, token1.decimals);

      // Calculate price at current tick
      const price = tickToPrice(tick);

      // Calculate formatted price directly from reserves (more accurate than tick-based)
      const priceFormatted = reservesToPrice(reserve0, reserve1, token0.decimals, token1.decimals);

      // Update store
      setReserves(reserve0, reserve1);
      setCurrentTick(tick);

      // Update local state
      setCurrentPrice({
        currentTick: tick,
        price,
        priceFormatted,
        reserve0,
        reserve1,
      });

      console.log('[CurrentPrice] Updated:', { poolId, tick, priceFormatted, reserve0: reserve0.toString(), reserve1: reserve1.toString() });
    } catch (err) {
      // Don't log errors for uninitialized pools (reserves will be 0)
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (!errorMessage.includes('reverted')) {
        console.error('[CurrentPrice] Error:', err);
      }
      setError(err instanceof Error ? err : new Error(String(err)));

      // Set default values for uninitialized pools
      setCurrentPrice({
        currentTick: 0,
        price: PRECISION,
        priceFormatted: '1.0000',
        reserve0: 0n,
        reserve1: 0n,
      });
    } finally {
      setIsLoading(false);
    }
  }, [chainId, publicClient, hookAddress, poolId, token0, token1, setReserves, setCurrentTick]);

  // Auto-refresh on mount and chain change
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll for reserve updates every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      refresh();
    }, 10000); // 10 second polling interval

    return () => clearInterval(interval);
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
 * Uses local calculation since V4 hooks may not have getTickPrices
 */
export function useTickPrices(ticks: number[]): { prices: Record<number, bigint>; isLoading: boolean } {
  const [prices, setPrices] = useState<Record<number, bigint>>({});
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (ticks.length === 0) return;

    setIsLoading(true);

    // Use local calculation for tick prices
    const localPrices: Record<number, bigint> = {};
    ticks.forEach(tick => {
      localPrices[tick] = tickToPrice(tick);
    });
    setPrices(localPrices);
    setIsLoading(false);
  }, [ticks.join(',')]);

  return { prices, isLoading };
}
