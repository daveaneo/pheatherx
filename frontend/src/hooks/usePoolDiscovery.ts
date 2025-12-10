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
      console.log('[PoolDiscovery] Chain:', chainId, '| Hook:', FHEATHERX_ADDRESSES[chainId]?.slice(0, 10) + '...');
      setCurrentChainId(chainId);
      prevChainIdRef.current = chainId;
    }
  }, [chainId, setCurrentChainId]);

  /**
   * Fetch token metadata (symbol, name, decimals) and determine type
   */
  const fetchTokenMetadata = useCallback(
    async (tokenAddress: `0x${string}`): Promise<Token> => {
      // First check if we have this token in our static config (includes type info)
      const configTokens = getTokensForChain(chainId);
      const configToken = configTokens.find(
        t => t.address.toLowerCase() === tokenAddress.toLowerCase()
      );

      if (!publicClient) {
        return {
          address: tokenAddress,
          symbol: configToken?.symbol ?? 'UNKNOWN',
          name: configToken?.name ?? 'Unknown Token',
          decimals: configToken?.decimals ?? 18,
          type: configToken?.type,
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

        // Use type from config if available, otherwise infer from symbol
        const type = configToken?.type ?? (symbol.toLowerCase().startsWith('fhe') ? 'fheerc20' : 'erc20');

        return {
          address: tokenAddress,
          symbol,
          name,
          decimals,
          type,
        };
      } catch (error) {
        console.error(`[usePoolDiscovery] Failed to fetch metadata for ${tokenAddress}:`, error);
        return {
          address: tokenAddress,
          symbol: configToken?.symbol ?? 'UNKNOWN',
          name: configToken?.name ?? 'Unknown Token',
          decimals: configToken?.decimals ?? 18,
          type: configToken?.type,
        };
      }
    },
    [publicClient, chainId]
  );

  /**
   * Create fallback pools for all token pairs when factory is not available
   * Uses tokens from tokens.ts to generate all possible trading pairs
   */
  const createFallbackPools = useCallback(async (): Promise<Pool[]> => {
    const hookAddress = FHEATHERX_ADDRESSES[chainId];

    // Creating pools for chain

    if (!hookAddress || hookAddress === '0x0000000000000000000000000000000000000000') {
      return [];
    }

    // Get all tokens from tokens.ts for this chain
    const configTokens = getTokensForChain(chainId);
    if (configTokens.length < 2) {
      return [];
    }

    // Creating fallback pools from tokens.ts

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
          type: sorted0.type,
        };
        const token1Meta: Token = {
          address: sorted1.address,
          symbol: sorted1.symbol,
          name: sorted1.name,
          decimals: sorted1.decimals,
          type: sorted1.type,
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

        // Pool created: sorted0.symbol/sorted1.symbol
      }
    }

    console.log(`[PoolDiscovery] Created ${pools.length} pools for chain ${chainId}`);
    return pools;
  }, [chainId]);

  /**
   * Fetch all pools from the factory
   */
  const fetchPools = useCallback(async () => {
    // If no factory configured, create fallback pools from tokens.ts
    if (!factoryAddress || factoryAddress === '0x0000000000000000000000000000000000000000') {
      // No factory - use fallback pools from tokens.ts
      setLoadingPools(true);
      try {
        const fallbackPools = await createFallbackPools();
        setPools(chainId, fallbackPools);
      } catch (error) {
        console.error('[PoolDiscovery] Error creating pools:', error);
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
      // Get all pool info from factory
      const rawPools = (await publicClient.readContract({
        address: factoryAddress,
        abi: FHEATHERX_FACTORY_ABI,
        functionName: 'getAllPools',
      })) as PoolInfo[];

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

      console.log(`[PoolDiscovery] Fetched ${enrichedPools.length} pools from factory`);
      setPools(chainId, enrichedPools);
    } catch (error) {
      console.error('[PoolDiscovery] Error fetching pools:', error);
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
    onLogs: () => {
      // Refetch all pools when a new one is created
      fetchPools();
    },
    enabled: Boolean(factoryAddress && factoryAddress !== '0x0000000000000000000000000000000000000000'),
  });

  return {
    refetch: fetchPools,
  };
}
