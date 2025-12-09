'use client';

import { useReadContracts, useChainId } from 'wagmi';
import { FHEATHERX_V6_ABI } from '@/lib/contracts/fheatherXv6Abi';
import { FHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { getPoolIdFromTokens } from '@/lib/poolId';
import { usePoolStore } from '@/stores/poolStore';
import type { Token } from '@/lib/tokens';
import type { Pool } from '@/types/pool';

interface PoolInfo {
  poolExists: boolean;
  isInitialized: boolean;
  poolId: `0x${string}` | undefined;
  reserve0: bigint;
  reserve1: bigint;
  totalLpSupply: bigint;
  token0: Token | undefined;
  token1: Token | undefined;
  hookAddress: `0x${string}` | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook to get pool info for a token pair
 * Finds if a pool exists for the given tokens and returns its reserves and LP supply
 */
export function usePoolInfo(
  tokenA: Token | undefined,
  tokenB: Token | undefined
): PoolInfo {
  const chainId = useChainId();
  const pools = usePoolStore(state => state.pools);

  // Find if a pool exists for this token pair
  const pool = findPoolForPair(pools, tokenA, tokenB);

  // Get hook address from pool or fallback to configured address
  const configuredHook = FHEATHERX_ADDRESSES[chainId];
  const hookAddress = pool?.hook ?? (
    configuredHook !== '0x0000000000000000000000000000000000000000'
      ? configuredHook
      : undefined
  );

  // Compute poolId if we have both tokens and a hook address
  const poolId =
    tokenA && tokenB && hookAddress
      ? getPoolIdFromTokens(tokenA, tokenB, hookAddress)
      : undefined;

  // Fetch pool state, reserves and LP supply from the contract
  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: [
      {
        address: hookAddress,
        abi: FHEATHERX_V6_ABI,
        functionName: 'getPoolState',
        args: poolId ? [poolId] : undefined,
      },
      {
        address: hookAddress,
        abi: FHEATHERX_V6_ABI,
        functionName: 'getPoolReserves',
        args: poolId ? [poolId] : undefined,
      },
      {
        address: hookAddress,
        abi: FHEATHERX_V6_ABI,
        functionName: 'totalLpSupply',
        args: poolId ? [poolId] : undefined,
      },
    ],
    query: {
      enabled: !!hookAddress && !!poolId,
      refetchInterval: 10000,
    },
  });

  // Parse pool state from contract response
  // getPoolState returns (token0, token1, initialized, maxBucketsPerSwap, protocolFeeBps)
  const stateData = data?.[0]?.result as [string, string, boolean, bigint, bigint] | undefined;
  const isInitialized = stateData?.[2] ?? false;

  // Parse reserves from contract response
  // getPoolReserves returns (reserve0, reserve1, lpSupply)
  const reservesData = data?.[1]?.result as [bigint, bigint, bigint] | undefined;
  const reserve0 = reservesData?.[0] ?? 0n;
  const reserve1 = reservesData?.[1] ?? 0n;
  const lpSupplyFromReserves = reservesData?.[2] ?? 0n;

  // totalLpSupply direct read (as backup/verification)
  const totalLpSupply = (data?.[2]?.result as bigint) ?? lpSupplyFromReserves;

  return {
    poolExists: !!pool || isInitialized,
    isInitialized,
    poolId,
    reserve0,
    reserve1,
    totalLpSupply,
    token0: pool?.token0Meta ?? tokenA,
    token1: pool?.token1Meta ?? tokenB,
    hookAddress,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}

/**
 * Find a pool for a given token pair (order doesn't matter)
 */
function findPoolForPair(
  pools: Pool[],
  tokenA: Token | undefined,
  tokenB: Token | undefined
): Pool | undefined {
  if (!tokenA || !tokenB) return undefined;

  const addrA = tokenA.address.toLowerCase();
  const addrB = tokenB.address.toLowerCase();

  return pools.find(pool => {
    const pool0 = pool.token0.toLowerCase();
    const pool1 = pool.token1.toLowerCase();

    return (
      (pool0 === addrA && pool1 === addrB) ||
      (pool0 === addrB && pool1 === addrA)
    );
  });
}

/**
 * Hook to get pool info by hook address (for existing positions)
 */
export function usePoolInfoByAddress(
  hookAddress: `0x${string}` | undefined
): PoolInfo {
  const pools = usePoolStore(state => state.pools);
  const pool = pools.find(p => p.hook === hookAddress);

  return usePoolInfo(pool?.token0Meta, pool?.token1Meta);
}
