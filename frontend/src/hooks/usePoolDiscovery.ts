'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useChainId, usePublicClient, useWatchContractEvent } from 'wagmi';
import {
  FHEATHERX_FACTORY_ADDRESSES,
  FHEATHERX_ADDRESSES,
  FHEATHERX_V8_FHE_ADDRESSES,
  FHEATHERX_V8_MIXED_ADDRESSES
} from '@/lib/contracts/addresses';
import { FHEATHERX_FACTORY_ABI } from '@/lib/contracts/factoryAbi';
import { ERC20_ABI } from '@/lib/contracts/erc20Abi';
import { usePoolStore } from '@/stores/poolStore';
import { getTokensForChain, type Token as LibToken } from '@/lib/tokens';
import { sortTokens } from '@/lib/pairs';
import type { Pool, PoolInfo, Token, ContractType } from '@/types/pool';

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
   * Get the appropriate hook address based on token types
   * - native (ERC:ERC): address(0) - use standard Uniswap v4
   * - v8fhe (FHE:FHE): v8FHE hook for full privacy
   * - v8mixed (ERC:FHE or FHE:ERC): v8Mixed hook for partial privacy
   */
  const getHookForTokenPair = useCallback((
    token0Type: string | undefined,
    token1Type: string | undefined
  ): { hook: `0x${string}`; contractType: ContractType } => {
    const t0IsFhe = token0Type === 'fheerc20';
    const t1IsFhe = token1Type === 'fheerc20';

    if (t0IsFhe && t1IsFhe) {
      // Both FHE - use v8FHE hook
      const hook = FHEATHERX_V8_FHE_ADDRESSES[chainId] || '0x0000000000000000000000000000000000000000' as `0x${string}`;
      return { hook, contractType: 'v8fhe' };
    } else if (t0IsFhe || t1IsFhe) {
      // One FHE - use v8Mixed hook
      const hook = FHEATHERX_V8_MIXED_ADDRESSES[chainId] || '0x0000000000000000000000000000000000000000' as `0x${string}`;
      return { hook, contractType: 'v8mixed' };
    } else {
      // Both ERC - native Uniswap v4 (no hook)
      return { hook: '0x0000000000000000000000000000000000000000' as `0x${string}`, contractType: 'native' };
    }
  }, [chainId]);

  /**
   * Create fallback pools for all token pairs when factory is not available
   * Uses tokens from tokens.ts to generate all possible trading pairs
   * Assigns correct hook based on token types (native/v8fhe/v8mixed)
   */
  const createFallbackPools = useCallback(async (): Promise<Pool[]> => {
    // Get all tokens from tokens.ts for this chain
    const configTokens = getTokensForChain(chainId);
    if (configTokens.length < 2) {
      return [];
    }

    // Generate all unique token pairs (combinations, not permutations)
    const pools: Pool[] = [];

    for (let i = 0; i < configTokens.length; i++) {
      for (let j = i + 1; j < configTokens.length; j++) {
        const tokenA = configTokens[i];
        const tokenB = configTokens[j];

        // Sort tokens to ensure proper ordering (token0 < token1 by address)
        const [sorted0, sorted1] = sortTokens(tokenA, tokenB);

        // Get the correct hook for this token pair
        const { hook, contractType } = getHookForTokenPair(sorted0.type, sorted1.type);

        // Skip if hook is not deployed (except for native which uses address(0))
        if (contractType !== 'native' && hook === '0x0000000000000000000000000000000000000000') {
          console.log(`[PoolDiscovery] Skipping ${sorted0.symbol}/${sorted1.symbol} - ${contractType} hook not deployed`);
          continue;
        }

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
          hook,
          token0: sorted0.address,
          token1: sorted1.address,
          createdAt: 0n,
          active: true,
          token0Meta,
          token1Meta,
          contractType,
        });
      }
    }

    console.log(`[PoolDiscovery] Created ${pools.length} pools for chain ${chainId}`);
    return pools;
  }, [chainId, getHookForTokenPair]);

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
