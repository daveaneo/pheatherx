'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Pool, PoolInfo, Token, ContractType } from '@/types/pool';

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

        // Determine best default pool: prefer v8fhe (full privacy) > v8mixed > any
        let defaultPool: Pool | undefined;
        if (!hasValidSelection && pools.length > 0) {
          // First, try to find an FHE:FHE pool (full privacy)
          defaultPool = pools.find(p => p.contractType === 'v8fhe');
          // If no FHE:FHE, try mixed pool
          if (!defaultPool) {
            defaultPool = pools.find(p => p.contractType === 'v8mixed');
          }
          // Fallback to first pool
          if (!defaultPool) {
            defaultPool = pools[0];
          }
        }

        const newSelection = hasValidSelection
          ? currentSelection
          : defaultPool
            ? getPoolKey(defaultPool)
            : null;
        console.log(`[PoolStore] setPools chain=${chainId} pools=${pools.length} selection=${newSelection?.slice(0, 30)}...`);

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
          // Auto-select best pool if no valid selection for this chain
          selectedPoolKeyByChain: {
            ...state.selectedPoolKeyByChain,
            [chainId]: newSelection,
          },
        }));
      },

      setCurrentChainId: chainId => {
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
 * Determine contract type based on pool token types
 * - v8fhe: Both tokens are FHERC20 (full privacy, encrypted LP)
 * - v8mixed: Exactly one token is FHERC20 (partial privacy, plaintext LP)
 * - native: Both tokens are ERC20 (no privacy, use standard Uniswap v4)
 */
export function determineContractType(pool: Pool | undefined): ContractType {
  if (!pool) return 'native';

  // If contractType is explicitly set, use it
  if (pool.contractType) return pool.contractType;

  const token0IsFhe = pool.token0Meta?.type === 'fheerc20';
  const token1IsFhe = pool.token1Meta?.type === 'fheerc20';

  if (token0IsFhe && token1IsFhe) {
    return 'v8fhe';
  } else if (token0IsFhe || token1IsFhe) {
    return 'v8mixed';
  }

  // ERC:ERC pools use native Uniswap v4 (no FHE hooks needed)
  return 'native';
}

/**
 * Hook to get the currently selected pool with its tokens
 */
export function useSelectedPool(): {
  pool: Pool | undefined;
  hookAddress: `0x${string}` | undefined;
  token0: Token | undefined;
  token1: Token | undefined;
  contractType: ContractType;
  isLoading: boolean;
  poolsLoaded: boolean;
  error: string | null;
} {
  const pool = usePoolStore(state => state.getSelectedPool());
  const isLoading = usePoolStore(state => state.isLoadingPools);
  const poolsLoaded = usePoolStore(state => state.poolsLoaded);
  const error = usePoolStore(state => state.poolsError);
  const contractType = determineContractType(pool);

  return {
    pool,
    hookAddress: pool?.hook,
    token0: pool?.token0Meta,
    token1: pool?.token1Meta,
    contractType,
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
