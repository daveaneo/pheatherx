'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Pool, PoolInfo, Token } from '@/types/pool';

interface PoolState {
  // Pool data
  pools: Pool[];
  isLoadingPools: boolean;
  poolsError: string | null;

  // Selection state
  selectedPoolAddress: `0x${string}` | null;

  // Actions
  setPools: (pools: Pool[]) => void;
  setLoadingPools: (loading: boolean) => void;
  setPoolsError: (error: string | null) => void;
  selectPool: (hookAddress: `0x${string}`) => void;
  clearSelection: () => void;

  // Derived getters
  getSelectedPool: () => Pool | undefined;
  getPoolByAddress: (hookAddress: `0x${string}`) => Pool | undefined;
}

export const usePoolStore = create<PoolState>()(
  persist(
    (set, get) => ({
      // Initial state
      pools: [],
      isLoadingPools: false,
      poolsError: null,
      selectedPoolAddress: null,

      // Actions
      setPools: pools => {
        const currentSelection = get().selectedPoolAddress;
        const hasValidSelection = currentSelection && pools.some(p => p.hook === currentSelection);

        set({
          pools,
          // Auto-select first pool if no valid selection
          selectedPoolAddress: hasValidSelection
            ? currentSelection
            : pools.length > 0
              ? pools[0].hook
              : null,
        });
      },

      setLoadingPools: loading => set({ isLoadingPools: loading }),

      setPoolsError: error => set({ poolsError: error }),

      selectPool: hookAddress => {
        const pools = get().pools;
        const poolExists = pools.some(p => p.hook === hookAddress);

        if (poolExists) {
          set({ selectedPoolAddress: hookAddress });
        }
      },

      clearSelection: () => set({ selectedPoolAddress: null }),

      // Getters
      getSelectedPool: () => {
        const { pools, selectedPoolAddress } = get();
        return pools.find(p => p.hook === selectedPoolAddress);
      },

      getPoolByAddress: hookAddress => {
        const { pools } = get();
        return pools.find(p => p.hook === hookAddress);
      },
    }),
    {
      name: 'pheatherx-pools',
      partialize: state => ({
        selectedPoolAddress: state.selectedPoolAddress,
      }),
    }
  )
);

/**
 * Hook to get the currently selected pool with its tokens
 */
export function useSelectedPool(): {
  pool: Pool | undefined;
  hookAddress: `0x${string}` | undefined;
  token0: Token | undefined;
  token1: Token | undefined;
  isLoading: boolean;
  error: string | null;
} {
  const pool = usePoolStore(state => state.getSelectedPool());
  const isLoading = usePoolStore(state => state.isLoadingPools);
  const error = usePoolStore(state => state.poolsError);

  return {
    pool,
    hookAddress: pool?.hook,
    token0: pool?.token0Meta,
    token1: pool?.token1Meta,
    isLoading,
    error,
  };
}

/**
 * Hook to get all unique tokens across all pools
 */
export function useAllTokens(): Token[] {
  const pools = usePoolStore(state => state.pools);
  const tokenMap = new Map<`0x${string}`, Token>();

  for (const pool of pools) {
    if (pool.token0Meta) {
      tokenMap.set(pool.token0Meta.address, pool.token0Meta);
    }
    if (pool.token1Meta) {
      tokenMap.set(pool.token1Meta.address, pool.token1Meta);
    }
  }

  return Array.from(tokenMap.values());
}
