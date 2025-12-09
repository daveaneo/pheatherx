'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useChainId, usePublicClient, useWatchContractEvent } from 'wagmi';
import { FHEATHERX_FACTORY_ADDRESSES, FHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { FHEATHERX_FACTORY_ABI } from '@/lib/contracts/factoryAbi';
import { ERC20_ABI } from '@/lib/contracts/erc20Abi';
import { usePoolStore } from '@/stores/poolStore';
import { getTokensForChain, type Token as LibToken } from '@/lib/tokens';
import { sortTokens } from '@/lib/pairs';
import type { Pool, PoolInfo, Token } from '@/types/pool';

/**
 * Hook that discovers pools from the factory contract and fetches token metadata
 */
export function usePoolDiscovery() {
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const factoryAddress = FHEATHERX_FACTORY_ADDRESSES[chainId];

  const setPools = usePoolStore(state => state.setPools);
  const setCurrentChainId = usePoolStore(state => state.setCurrentChainId);
  const setLoadingPools = usePoolStore(state => state.setLoadingPools);
  const setPoolsError = usePoolStore(state => state.setPoolsError);

  // Track previous chain ID to detect chain switches
  const prevChainIdRef = useRef<number | null>(null);

  // Update current chain ID in store whenever it changes
  useEffect(() => {
    if (chainId && chainId !== prevChainIdRef.current) {
      console.log('[usePoolDiscovery] Chain changed from', prevChainIdRef.current, 'to', chainId);
      setCurrentChainId(chainId);
      prevChainIdRef.current = chainId;
    }
  }, [chainId, setCurrentChainId]);

  /**
   * Fetch token metadata (symbol, name, decimals)
   */
  const fetchTokenMetadata = useCallback(
    async (tokenAddress: `0x${string}`): Promise<Token> => {
      if (!publicClient) {
        return {
          address: tokenAddress,
          symbol: 'UNKNOWN',
          name: 'Unknown Token',
          decimals: 18,
        };
      }

      try {
        const [symbol, name, decimals] = await Promise.all([
          publicClient.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'symbol',
          }) as Promise<string>,
          publicClient.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'name',
          }) as Promise<string>,
          publicClient.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'decimals',
          }) as Promise<number>,
        ]);

        return {
          address: tokenAddress,
          symbol,
          name,
          decimals,
        };
      } catch (error) {
        console.error(`[usePoolDiscovery] Failed to fetch metadata for ${tokenAddress}:`, error);
        return {
          address: tokenAddress,
          symbol: 'UNKNOWN',
          name: 'Unknown Token',
          decimals: 18,
        };
      }
    },
    [publicClient]
  );

  /**
   * Create fallback pools for all token pairs when factory is not available
   * Uses tokens from tokens.ts to generate all possible trading pairs
   */
  const createFallbackPools = useCallback(async (): Promise<Pool[]> => {
    const hookAddress = FHEATHERX_ADDRESSES[chainId];

    if (!hookAddress || hookAddress === '0x0000000000000000000000000000000000000000') {
      console.log('[usePoolDiscovery] No hook address configured for chain', chainId);
      return [];
    }

    // Get all tokens from tokens.ts for this chain
    const configTokens = getTokensForChain(chainId);
    if (configTokens.length < 2) {
      console.log('[usePoolDiscovery] Not enough tokens configured for chain', chainId);
      return [];
    }

    console.log('[usePoolDiscovery] Creating fallback pools from tokens.ts for chain', chainId);
    console.log('[usePoolDiscovery] Available tokens:', configTokens.map(t => t.symbol));

    // Generate all unique token pairs (combinations, not permutations)
    const pools: Pool[] = [];

    for (let i = 0; i < configTokens.length; i++) {
      for (let j = i + 1; j < configTokens.length; j++) {
        const tokenA = configTokens[i];
        const tokenB = configTokens[j];

        // Sort tokens to ensure proper ordering (token0 < token1 by address)
        const [sorted0, sorted1] = sortTokens(tokenA, tokenB);

        // Convert from lib/tokens Token type to pool Token type
        const token0Meta: Token = {
          address: sorted0.address,
          symbol: sorted0.symbol,
          name: sorted0.name,
          decimals: sorted0.decimals,
        };
        const token1Meta: Token = {
          address: sorted1.address,
          symbol: sorted1.symbol,
          name: sorted1.name,
          decimals: sorted1.decimals,
        };

        pools.push({
          hook: hookAddress,
          token0: sorted0.address,
          token1: sorted1.address,
          createdAt: 0n,
          active: true,
          token0Meta,
          token1Meta,
        });

        console.log(`[usePoolDiscovery] Created pool: ${sorted0.symbol}/${sorted1.symbol}`);
      }
    }

    console.log(`[usePoolDiscovery] Created ${pools.length} fallback pools`);
    return pools;
  }, [chainId]);

  /**
   * Fetch all pools from the factory
   */
  const fetchPools = useCallback(async () => {
    // If no factory configured, create fallback pools from tokens.ts
    if (!factoryAddress || factoryAddress === '0x0000000000000000000000000000000000000000') {
      console.log('[usePoolDiscovery] No factory address configured for chain', chainId);

      // Create fallback pools for all token pairs from tokens.ts
      setLoadingPools(true);
      try {
        const fallbackPools = await createFallbackPools();
        if (fallbackPools.length > 0) {
          console.log('[usePoolDiscovery] Using fallback pools from tokens.ts:', fallbackPools.length);
          setPools(chainId, fallbackPools);
        } else {
          console.log('[usePoolDiscovery] No fallback pools created');
          setPools(chainId, []);
        }
      } catch (error) {
        console.error('[usePoolDiscovery] Error creating fallback pools:', error);
        setPools(chainId, []);
      } finally {
        setLoadingPools(false);
      }
      return;
    }

    if (!publicClient) {
      return;
    }

    setLoadingPools(true);
    setPoolsError(null);

    try {
      console.log('[usePoolDiscovery] Fetching pools from factory:', factoryAddress);

      // Get all pool info from factory
      const rawPools = (await publicClient.readContract({
        address: factoryAddress,
        abi: FHEATHERX_FACTORY_ABI,
        functionName: 'getAllPools',
      })) as PoolInfo[];

      console.log('[usePoolDiscovery] Found', rawPools.length, 'pools');

      // Fetch token metadata for all unique tokens
      const tokenAddresses = new Set<`0x${string}`>();
      for (const pool of rawPools) {
        tokenAddresses.add(pool.token0);
        tokenAddresses.add(pool.token1);
      }

      const tokenMetadataMap = new Map<`0x${string}`, Token>();
      await Promise.all(
        Array.from(tokenAddresses).map(async address => {
          const metadata = await fetchTokenMetadata(address);
          tokenMetadataMap.set(address, metadata);
        })
      );

      // Build enriched pool objects
      const enrichedPools: Pool[] = rawPools.map(pool => ({
        ...pool,
        token0Meta: tokenMetadataMap.get(pool.token0)!,
        token1Meta: tokenMetadataMap.get(pool.token1)!,
      }));

      console.log('[usePoolDiscovery] Enriched pools:', enrichedPools);
      setPools(chainId, enrichedPools);
    } catch (error) {
      console.error('[usePoolDiscovery] Error fetching pools:', error);
      setPoolsError(error instanceof Error ? error.message : 'Failed to fetch pools');
    } finally {
      setLoadingPools(false);
    }
  }, [publicClient, factoryAddress, chainId, fetchTokenMetadata, createFallbackPools, setPools, setLoadingPools, setPoolsError]);

  // Fetch pools on mount and when chain changes
  useEffect(() => {
    fetchPools();
  }, [fetchPools]);

  // Watch for new pool creation events
  useWatchContractEvent({
    address: factoryAddress,
    abi: FHEATHERX_FACTORY_ABI,
    eventName: 'PoolCreated',
    onLogs: logs => {
      console.log('[usePoolDiscovery] PoolCreated event:', logs);
      // Refetch all pools when a new one is created
      fetchPools();
    },
    enabled: Boolean(factoryAddress && factoryAddress !== '0x0000000000000000000000000000000000000000'),
  });

  return {
    refetch: fetchPools,
  };
}
