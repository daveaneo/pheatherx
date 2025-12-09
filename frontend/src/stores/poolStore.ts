'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Pool, PoolInfo, Token } from '@/types/pool';

/**
 * Generate a unique pool key from hook + token addresses
 * This is needed because multiple pools can share the same hook address
 */
export function getPoolKey(pool: Pool | { hook: `0x${string}`; token0: `0x${string}`; token1: `0x${string}` }): string {
  return `${pool.hook}-${pool.token0}-${pool.token1}`.toLowerCase();
}

interface PoolState {
  // Pool data (keyed by chainId for multi-chain support)
  poolsByChain: Record<number, Pool[]>;
  currentChainId: number | null;
  isLoadingPools: boolean;
  poolsError: string | null;
  // Track which chains have completed initial pool discovery
  poolsLoadedByChain: Record<number, boolean>;

  // Selection state (per chain) - now uses poolKey instead of just hookAddress
  selectedPoolKeyByChain: Record<number, string | null>;

  // Actions
  setPools: (chainId: number, pools: Pool[]) => void;
  setCurrentChainId: (chainId: number) => void;
  setLoadingPools: (loading: boolean) => void;
  setPoolsError: (error: string | null) => void;
  selectPool: (poolKey: string) => void;
  selectPoolByTokens: (hook: `0x${string}`, token0: `0x${string}`, token1: `0x${string}`) => void;
  clearSelection: () => void;
  clearPoolsForChain: (chainId: number) => void;

  // Derived getters (use currentChainId)
  pools: Pool[];
  selectedPoolKey: string | null;
  poolsLoaded: boolean;
  getSelectedPool: () => Pool | undefined;
  getPoolByKey: (poolKey: string) => Pool | undefined;
}

export const usePoolStore = create<PoolState>()(
  persist(
    (set, get) => ({
      // Initial state
      poolsByChain: {},
      currentChainId: null,
      isLoadingPools: false,
      poolsError: null,
      poolsLoadedByChain: {},
      selectedPoolKeyByChain: {},

      // Computed properties
      get pools() {
        const { poolsByChain, currentChainId } = get();
        return currentChainId ? (poolsByChain[currentChainId] || []) : [];
      },

      get selectedPoolKey() {
        const { selectedPoolKeyByChain, currentChainId } = get();
        return currentChainId ? (selectedPoolKeyByChain[currentChainId] || null) : null;
      },

      get poolsLoaded() {
        const { poolsLoadedByChain, currentChainId } = get();
        return currentChainId ? (poolsLoadedByChain[currentChainId] || false) : false;
      },

      // Actions
      setPools: (chainId, pools) => {
        const currentSelection = get().selectedPoolKeyByChain[chainId];
        const hasValidSelection = currentSelection && pools.some(p => getPoolKey(p) === currentSelection);

        set(state => ({
          poolsByChain: {
            ...state.poolsByChain,
            [chainId]: pools,
          },
          // Mark this chain as having completed pool discovery
          poolsLoadedByChain: {
            ...state.poolsLoadedByChain,
            [chainId]: true,
          },
          // Auto-select first pool if no valid selection for this chain
          selectedPoolKeyByChain: {
            ...state.selectedPoolKeyByChain,
            [chainId]: hasValidSelection
              ? currentSelection
              : pools.length > 0
                ? getPoolKey(pools[0])
                : null,
          },
        }));
      },

      setCurrentChainId: chainId => {
        console.log('[PoolStore] Setting current chain ID:', chainId);
        set({ currentChainId: chainId });
      },

      setLoadingPools: loading => set({ isLoadingPools: loading }),

      setPoolsError: error => set({ poolsError: error }),

      selectPool: poolKey => {
        const { currentChainId, poolsByChain } = get();
        if (!currentChainId) return;

        const pools = poolsByChain[currentChainId] || [];
        const poolExists = pools.some(p => getPoolKey(p) === poolKey);

        if (poolExists) {
          console.log('[PoolStore] Selecting pool:', poolKey);
          set(state => ({
            selectedPoolKeyByChain: {
              ...state.selectedPoolKeyByChain,
              [currentChainId]: poolKey,
            },
          }));
        }
      },

      selectPoolByTokens: (hook, token0, token1) => {
        const poolKey = `${hook}-${token0}-${token1}`.toLowerCase();
        get().selectPool(poolKey);
      },

      clearSelection: () => {
        const { currentChainId } = get();
        if (!currentChainId) return;

        set(state => ({
          selectedPoolKeyByChain: {
            ...state.selectedPoolKeyByChain,
            [currentChainId]: null,
          },
        }));
      },

      clearPoolsForChain: chainId => {
        console.log('[PoolStore] Clearing pools for chain:', chainId);
        set(state => ({
          poolsByChain: {
            ...state.poolsByChain,
            [chainId]: [],
          },
          selectedPoolKeyByChain: {
            ...state.selectedPoolKeyByChain,
            [chainId]: null,
          },
        }));
      },

      // Getters
      getSelectedPool: () => {
        const { poolsByChain, selectedPoolKeyByChain, currentChainId } = get();
        if (!currentChainId) return undefined;
        const pools = poolsByChain[currentChainId] || [];
        const selectedKey = selectedPoolKeyByChain[currentChainId];
        return pools.find(p => getPoolKey(p) === selectedKey);
      },

      getPoolByKey: poolKey => {
        const { poolsByChain, currentChainId } = get();
        if (!currentChainId) return undefined;
        const pools = poolsByChain[currentChainId] || [];
        return pools.find(p => getPoolKey(p) === poolKey);
      },
    }),
    {
      name: 'fheatherx-pools-v2', // New key to avoid conflicts with old data
      partialize: state => ({
        selectedPoolKeyByChain: state.selectedPoolKeyByChain,
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
  poolsLoaded: boolean;
  error: string | null;
} {
  const pool = usePoolStore(state => state.getSelectedPool());
  const isLoading = usePoolStore(state => state.isLoadingPools);
  const poolsLoaded = usePoolStore(state => state.poolsLoaded);
  const error = usePoolStore(state => state.poolsError);

  return {
    pool,
    hookAddress: pool?.hook,
    token0: pool?.token0Meta,
    token1: pool?.token1Meta,
    isLoading,
    poolsLoaded,
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
