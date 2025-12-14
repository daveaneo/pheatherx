'use client';

import { useReadContracts, useChainId } from 'wagmi';
import { FHEATHERX_V8_FHE_ABI } from '@/lib/contracts/fheatherXv8FHE-abi';
import { FHEATHERX_V8_MIXED_ABI } from '@/lib/contracts/fheatherXv8Mixed-abi';
import { UNISWAP_V4_POOL_MANAGER_ABI } from '@/lib/contracts/uniswapV4-abi';
import { POOL_MANAGER_ADDRESSES } from '@/lib/contracts/addresses';
import { getPoolIdFromTokens } from '@/lib/poolId';
import { usePoolStore, determineContractType } from '@/stores/poolStore';
import type { Token } from '@/lib/tokens';
import type { Pool, ContractType } from '@/types/pool';

/**
 * Get ABI based on contract type
 */
function getAbiForContractType(type: ContractType) {
  switch (type) {
    case 'v8fhe':
      return FHEATHERX_V8_FHE_ABI;
    case 'v8mixed':
      return FHEATHERX_V8_MIXED_ABI;
    case 'native':
    default:
      return UNISWAP_V4_POOL_MANAGER_ABI;
  }
}

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
 * Supports native (Uniswap v4), v8FHE, and v8Mixed contracts
 */
export function usePoolInfo(
  tokenA: Token | undefined,
  tokenB: Token | undefined
): PoolInfo {
  const chainId = useChainId();
  const pools = usePoolStore(state => state.pools);

  // Find if a pool exists for this token pair
  const pool = findPoolForPair(pools, tokenA, tokenB);

  // Determine contract type based on pool or token types
  const contractType = determineContractType(pool);
  const isNative = contractType === 'native';
  const abi = getAbiForContractType(contractType);

  // For native pools, use PoolManager; for FHE pools, use hook address
  const hookAddress = pool?.hook ?? (isNative ? undefined : undefined);
  const contractAddress = isNative
    ? POOL_MANAGER_ADDRESSES[chainId]
    : hookAddress;

  // Compute poolId if we have both tokens
  const poolId =
    tokenA && tokenB
      ? getPoolIdFromTokens(
          tokenA,
          tokenB,
          hookAddress || '0x0000000000000000000000000000000000000000' as `0x${string}`
        )
      : undefined;

  // Fetch pool data from the contract
  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: isNative ? [
      // Native Uniswap v4: getSlot0 and getLiquidity
      {
        address: contractAddress,
        abi,
        functionName: 'getSlot0' as const,
        args: poolId ? [poolId] : undefined,
      },
      {
        address: contractAddress,
        abi,
        functionName: 'getLiquidity' as const,
        args: poolId ? [poolId] : undefined,
      },
    ] : [
      // FHE pools: poolStates and getReserves
      {
        address: contractAddress,
        abi,
        functionName: 'poolStates' as const,
        args: poolId ? [poolId] : undefined,
      },
      {
        address: contractAddress,
        abi,
        functionName: 'getReserves' as const,
        args: poolId ? [poolId] : undefined,
      },
    ],
    query: {
      enabled: !!contractAddress && !!poolId,
      refetchInterval: 10000,
    },
  });

  // Parse pool state based on contract version
  let isInitialized = false;
  let reserve0 = 0n;
  let reserve1 = 0n;
  let totalLpSupply = 0n;

  if (isNative) {
    // Native Uniswap v4: getSlot0 returns (sqrtPriceX96, tick, protocolFee, lpFee)
    // Pool is initialized if sqrtPriceX96 > 0
    const slot0Data = data?.[0]?.result as [bigint, number, number, number] | undefined;
    isInitialized = (slot0Data?.[0] ?? 0n) > 0n;
    // getLiquidity returns uint128
    totalLpSupply = (data?.[1]?.result as bigint) ?? 0n;
    // Note: Native v4 doesn't expose reserves directly - would need to calculate from sqrtPriceX96
  } else if (contractType === 'v8fhe') {
    // v8FHE poolStates returns (token0, token1, initialized, protocolFeeBps)
    const stateData = data?.[0]?.result as [string, string, boolean, bigint] | undefined;
    isInitialized = stateData?.[2] ?? false;
    // v8 getReserves returns (reserve0, reserve1)
    const reservesData = data?.[1]?.result as [bigint, bigint] | undefined;
    reserve0 = reservesData?.[0] ?? 0n;
    reserve1 = reservesData?.[1] ?? 0n;
  } else if (contractType === 'v8mixed') {
    // v8Mixed poolStates returns (token0, token1, token0IsFherc20, token1IsFherc20, initialized, protocolFeeBps)
    const stateData = data?.[0]?.result as [string, string, boolean, boolean, boolean, bigint] | undefined;
    isInitialized = stateData?.[4] ?? false;
    // v8 getReserves returns (reserve0, reserve1)
    const reservesData = data?.[1]?.result as [bigint, bigint] | undefined;
    reserve0 = reservesData?.[0] ?? 0n;
    reserve1 = reservesData?.[1] ?? 0n;
  }

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
