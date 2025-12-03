'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Pool, PoolInfo, Token } from '@/types/pool';

interface PoolState {
  // Pool data (keyed by chainId for multi-chain support)
  poolsByChain: Record<number, Pool[]>;
  currentChainId: number | null;
  isLoadingPools: boolean;
  poolsError: string | null;
  // Track which chains have completed initial pool discovery
  poolsLoadedByChain: Record<number, boolean>;

  // Selection state (per chain)
  selectedPoolAddressByChain: Record<number, `0x${string}` | null>;

  // Actions
  setPools: (chainId: number, pools: Pool[]) => void;
  setCurrentChainId: (chainId: number) => void;
  setLoadingPools: (loading: boolean) => void;
  setPoolsError: (error: string | null) => void;
  selectPool: (hookAddress: `0x${string}`) => void;
  clearSelection: () => void;
  clearPoolsForChain: (chainId: number) => void;

  // Derived getters (use currentChainId)
  pools: Pool[];
  selectedPoolAddress: `0x${string}` | null;
  poolsLoaded: boolean;
  getSelectedPool: () => Pool | undefined;
  getPoolByAddress: (hookAddress: `0x${string}`) => Pool | undefined;
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
      selectedPoolAddressByChain: {},

      // Computed properties
      get pools() {
        const { poolsByChain, currentChainId } = get();
        return currentChainId ? (poolsByChain[currentChainId] || []) : [];
      },

      get selectedPoolAddress() {
        const { selectedPoolAddressByChain, currentChainId } = get();
        return currentChainId ? (selectedPoolAddressByChain[currentChainId] || null) : null;
      },

      get poolsLoaded() {
        const { poolsLoadedByChain, currentChainId } = get();
        return currentChainId ? (poolsLoadedByChain[currentChainId] || false) : false;
      },

      // Actions
      setPools: (chainId, pools) => {
        const currentSelection = get().selectedPoolAddressByChain[chainId];
        const hasValidSelection = currentSelection && pools.some(p => p.hook === currentSelection);

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
          selectedPoolAddressByChain: {
            ...state.selectedPoolAddressByChain,
            [chainId]: hasValidSelection
              ? currentSelection
              : pools.length > 0
                ? pools[0].hook
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

      selectPool: hookAddress => {
        const { currentChainId, poolsByChain } = get();
        if (!currentChainId) return;

        const pools = poolsByChain[currentChainId] || [];
        const poolExists = pools.some(p => p.hook === hookAddress);

        if (poolExists) {
          set(state => ({
            selectedPoolAddressByChain: {
              ...state.selectedPoolAddressByChain,
              [currentChainId]: hookAddress,
            },
          }));
        }
      },

      clearSelection: () => {
        const { currentChainId } = get();
        if (!currentChainId) return;

        set(state => ({
          selectedPoolAddressByChain: {
            ...state.selectedPoolAddressByChain,
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
          selectedPoolAddressByChain: {
            ...state.selectedPoolAddressByChain,
            [chainId]: null,
          },
        }));
      },

      // Getters
      getSelectedPool: () => {
        const { poolsByChain, selectedPoolAddressByChain, currentChainId } = get();
        if (!currentChainId) return undefined;
        const pools = poolsByChain[currentChainId] || [];
        const selectedAddress = selectedPoolAddressByChain[currentChainId];
        return pools.find(p => p.hook === selectedAddress);
      },

      getPoolByAddress: hookAddress => {
        const { poolsByChain, currentChainId } = get();
        if (!currentChainId) return undefined;
        const pools = poolsByChain[currentChainId] || [];
        return pools.find(p => p.hook === hookAddress);
      },
    }),
    {
      name: 'pheatherx-pools',
      partialize: state => ({
        selectedPoolAddressByChain: state.selectedPoolAddressByChain,
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
