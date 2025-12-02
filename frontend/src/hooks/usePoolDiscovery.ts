'use client';

import { useEffect, useCallback } from 'react';
import { useChainId, usePublicClient, useWatchContractEvent } from 'wagmi';
import { PHEATHERX_FACTORY_ADDRESSES } from '@/lib/contracts/addresses';
import { PHEATHERX_FACTORY_ABI } from '@/lib/contracts/factoryAbi';
import { ERC20_ABI } from '@/lib/contracts/erc20Abi';
import { usePoolStore } from '@/stores/poolStore';
import type { Pool, PoolInfo, Token } from '@/types/pool';

/**
 * Hook that discovers pools from the factory contract and fetches token metadata
 */
export function usePoolDiscovery() {
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const factoryAddress = PHEATHERX_FACTORY_ADDRESSES[chainId];

  const setPools = usePoolStore(state => state.setPools);
  const setLoadingPools = usePoolStore(state => state.setLoadingPools);
  const setPoolsError = usePoolStore(state => state.setPoolsError);

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
   * Fetch all pools from the factory
   */
  const fetchPools = useCallback(async () => {
    if (!publicClient || !factoryAddress || factoryAddress === '0x0000000000000000000000000000000000000000') {
      console.log('[usePoolDiscovery] No factory address configured for chain', chainId);
      return;
    }

    setLoadingPools(true);
    setPoolsError(null);

    try {
      console.log('[usePoolDiscovery] Fetching pools from factory:', factoryAddress);

      // Get all pool info from factory
      const rawPools = (await publicClient.readContract({
        address: factoryAddress,
        abi: PHEATHERX_FACTORY_ABI,
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
      setPools(enrichedPools);
    } catch (error) {
      console.error('[usePoolDiscovery] Error fetching pools:', error);
      setPoolsError(error instanceof Error ? error.message : 'Failed to fetch pools');
    } finally {
      setLoadingPools(false);
    }
  }, [publicClient, factoryAddress, chainId, fetchTokenMetadata, setPools, setLoadingPools, setPoolsError]);

  // Fetch pools on mount and when chain changes
  useEffect(() => {
    fetchPools();
  }, [fetchPools]);

  // Watch for new pool creation events
  useWatchContractEvent({
    address: factoryAddress,
    abi: PHEATHERX_FACTORY_ABI,
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
