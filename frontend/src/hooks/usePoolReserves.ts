'use client';

import { useReadContracts, useWriteContract, usePublicClient, useChainId } from 'wagmi';
import { FHEATHERX_V8_FHE_ABI } from '@/lib/contracts/fheatherXv8FHE-abi';
import { FHEATHERX_V8_MIXED_ABI } from '@/lib/contracts/fheatherXv8Mixed-abi';
import { UNISWAP_V4_POOL_MANAGER_ABI } from '@/lib/contracts/uniswapV4-abi';
import { POOL_MANAGER_ADDRESSES } from '@/lib/contracts/addresses';
import { useSelectedPool, determineContractType } from '@/stores/poolStore';
import { getPoolIdFromTokens } from '@/lib/poolId';
import type { ContractType } from '@/types/pool';
import { useCallback, useMemo } from 'react';

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

interface PoolReserves {
  reserve0: bigint;
  reserve1: bigint;
  totalLpSupply: bigint;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

interface PoolReservesExtended extends PoolReserves {
  // v8 extended fields
  reserveBlockNumber: bigint;
  nextRequestId: bigint;
  lastResolvedId: bigint;
  // Sync status helpers
  isSynced: boolean;
  pendingSyncs: bigint;
  // Encrypted handles (for advanced usage)
  encReserve0Handle: bigint;
  encReserve1Handle: bigint;
  encLpSupplyHandle: bigint;
  // Actions
  trySyncReserves: () => Promise<`0x${string}` | undefined>;
  isSyncing: boolean;
}

/**
 * Basic pool reserves hook (simple reserves only)
 * Works with all contract versions
 */
export function usePoolReserves(): PoolReserves {
  const { hookAddress, token0, token1, pool } = useSelectedPool();
  const chainId = useChainId();
  const contractType = determineContractType(pool);
  const isNative = contractType === 'native';

  // For native pools, use PoolManager address instead of hook
  const contractAddress = isNative
    ? POOL_MANAGER_ADDRESSES[chainId]
    : hookAddress;

  const abi = getAbiForContractType(contractType);

  // Compute poolId from tokens
  const poolId = useMemo(() => {
    if (!token0 || !token1) return undefined;
    // For native pools, hookAddress might be undefined (no FHE hook)
    const hook = hookAddress || '0x0000000000000000000000000000000000000000';
    return getPoolIdFromTokens(token0, token1, hook as `0x${string}`);
  }, [token0, token1, hookAddress]);

  // v8 uses getReserves, native uses getLiquidity (different approach)
  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: isNative ? [
      // Native Uniswap v4: Use getLiquidity and getSlot0
      {
        address: contractAddress,
        abi,
        functionName: 'getLiquidity' as const,
        args: poolId ? [poolId] : undefined,
      },
      {
        address: contractAddress,
        abi,
        functionName: 'getSlot0' as const,
        args: poolId ? [poolId] : undefined,
      },
    ] : [
      // v8FHE/v8Mixed: Use getReserves
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

  // Parse based on version
  let reserve0 = 0n;
  let reserve1 = 0n;
  let totalLpSupply = 0n;

  if (isNative) {
    // Native Uniswap v4: getLiquidity returns uint128
    // Note: v4 doesn't expose reserves directly - liquidity is in terms of sqrt price
    // For display purposes, we'd need to calculate from sqrtPriceX96
    totalLpSupply = (data?.[0]?.result as bigint) ?? 0n;
    // TODO: Calculate reserves from sqrtPriceX96 if needed for display
  } else {
    // v8 getReserves returns (reserve0, reserve1)
    const reserves = data?.[0]?.result as [bigint, bigint] | undefined;
    reserve0 = reserves?.[0] ?? 0n;
    reserve1 = reserves?.[1] ?? 0n;
  }

  return {
    reserve0,
    reserve1,
    totalLpSupply,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}

/**
 * Extended pool reserves hook with sync status (v8 only)
 * Returns full poolReserves data including sync status and trySyncReserves action
 */
export function usePoolReservesExtended(): PoolReservesExtended {
  const { hookAddress, token0, token1, pool } = useSelectedPool();
  const contractType = determineContractType(pool);
  const abi = getAbiForContractType(contractType);
  const publicClient = usePublicClient();
  const chainId = useChainId();
  const { writeContractAsync, isPending: isSyncing } = useWriteContract();

  // Compute poolId from tokens
  const poolId = useMemo(() => {
    if (!token0 || !token1 || !hookAddress) return undefined;
    return getPoolIdFromTokens(token0, token1, hookAddress);
  }, [token0, token1, hookAddress]);

  const isV8 = contractType === 'v8fhe' || contractType === 'v8mixed';

  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: [
      ...(isV8 ? [
        // v8: Use poolReserves for full data including sync status
        {
          address: hookAddress,
          abi,
          functionName: 'poolReserves' as const,
          args: poolId ? [poolId] : undefined,
        },
      ] : [
        // v6: Use getPoolReserves
        {
          address: hookAddress,
          abi,
          functionName: 'getPoolReserves' as const,
          args: poolId ? [poolId] : undefined,
        },
        {
          address: hookAddress,
          abi,
          functionName: 'totalLpSupply' as const,
          args: poolId ? [poolId] : undefined,
        },
      ]),
    ],
    query: {
      enabled: !!hookAddress && !!poolId,
      refetchInterval: 10000,
    },
  });

  // Parse based on version
  let reserve0 = 0n;
  let reserve1 = 0n;
  let totalLpSupply = 0n;
  let reserveBlockNumber = 0n;
  let nextRequestId = 0n;
  let lastResolvedId = 0n;
  let encReserve0Handle = 0n;
  let encReserve1Handle = 0n;
  let encLpSupplyHandle = 0n;

  if (isV8) {
    // v8FHE poolReserves returns:
    // (encReserve0, encReserve1, encTotalLpSupply, reserve0, reserve1, reserveBlockNumber, nextRequestId, lastResolvedId)
    // v8Mixed poolReserves returns:
    // (encReserve0, encReserve1, encTotalLpSupply, reserve0, reserve1, totalLpSupply, reserveBlockNumber, nextRequestId, lastResolvedId)
    const reserves = data?.[0]?.result as bigint[] | undefined;

    if (reserves) {
      encReserve0Handle = reserves[0] ?? 0n;
      encReserve1Handle = reserves[1] ?? 0n;
      encLpSupplyHandle = reserves[2] ?? 0n;
      reserve0 = reserves[3] ?? 0n;
      reserve1 = reserves[4] ?? 0n;

      if (contractType === 'v8mixed') {
        // v8Mixed has plaintext totalLpSupply at index 5
        totalLpSupply = reserves[5] ?? 0n;
        reserveBlockNumber = reserves[6] ?? 0n;
        nextRequestId = reserves[7] ?? 0n;
        lastResolvedId = reserves[8] ?? 0n;
      } else {
        // v8FHE doesn't have plaintext LP supply
        reserveBlockNumber = reserves[5] ?? 0n;
        nextRequestId = reserves[6] ?? 0n;
        lastResolvedId = reserves[7] ?? 0n;
      }
    }
  } else {
    // v6 getPoolReserves returns (reserve0, reserve1, lpSupply)
    const reserves = data?.[0]?.result as [bigint, bigint, bigint] | undefined;
    reserve0 = reserves?.[0] ?? 0n;
    reserve1 = reserves?.[1] ?? 0n;
    totalLpSupply = reserves?.[2] ?? (data?.[1]?.result as bigint) ?? 0n;
  }

  // Calculate sync status
  const isSynced = nextRequestId === lastResolvedId || !isV8;
  const pendingSyncs = nextRequestId - lastResolvedId;

  // trySyncReserves action (v8 only)
  const trySyncReserves = useCallback(async (): Promise<`0x${string}` | undefined> => {
    if (!isV8 || !hookAddress || !poolId) {
      console.log('[usePoolReserves] trySyncReserves: Not v8 or missing hook/poolId');
      return undefined;
    }

    try {
      const hash = await writeContractAsync({
        address: hookAddress,
        abi,
        functionName: 'trySyncReserves',
        args: [poolId],
      });

      console.log('[usePoolReserves] trySyncReserves tx:', hash);
      return hash;
    } catch (error) {
      console.error('[usePoolReserves] trySyncReserves failed:', error);
      throw error;
    }
  }, [isV8, hookAddress, poolId, abi, writeContractAsync]);

  return {
    reserve0,
    reserve1,
    totalLpSupply,
    reserveBlockNumber,
    nextRequestId,
    lastResolvedId,
    isSynced,
    pendingSyncs,
    encReserve0Handle,
    encReserve1Handle,
    encLpSupplyHandle,
    trySyncReserves,
    isSyncing,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}

/**
 * Hook to get reserves for a specific pool by tokens
 * Useful when you need reserves for a pool other than the selected one
 */
export function usePoolReservesForTokens(
  token0Address: `0x${string}` | undefined,
  token1Address: `0x${string}` | undefined,
  hookAddress: `0x${string}` | undefined,
  contractType: ContractType = 'native'
): PoolReserves {
  const chainId = useChainId();
  const isNative = contractType === 'native';
  const abi = getAbiForContractType(contractType);

  // For native pools, use PoolManager address
  const contractAddress = isNative
    ? POOL_MANAGER_ADDRESSES[chainId]
    : hookAddress;

  // Compute poolId from tokens
  const poolId = useMemo(() => {
    if (!token0Address || !token1Address) return undefined;
    const hook = hookAddress || '0x0000000000000000000000000000000000000000';
    // Create minimal token objects for poolId calculation
    const token0 = { address: token0Address, symbol: '', name: '', decimals: 18, type: 'erc20' as const };
    const token1 = { address: token1Address, symbol: '', name: '', decimals: 18, type: 'erc20' as const };
    return getPoolIdFromTokens(token0, token1, hook as `0x${string}`);
  }, [token0Address, token1Address, hookAddress]);

  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: isNative ? [
      {
        address: contractAddress,
        abi,
        functionName: 'getLiquidity' as const,
        args: poolId ? [poolId] : undefined,
      },
    ] : [
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

  // Parse based on version
  let reserve0 = 0n;
  let reserve1 = 0n;
  let totalLpSupply = 0n;

  if (isNative) {
    totalLpSupply = (data?.[0]?.result as bigint) ?? 0n;
  } else {
    const reserves = data?.[0]?.result as [bigint, bigint] | undefined;
    reserve0 = reserves?.[0] ?? 0n;
    reserve1 = reserves?.[1] ?? 0n;
  }

  return {
    reserve0,
    reserve1,
    totalLpSupply,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}
