'use client';

import { useReadContracts, useChainId } from 'wagmi';
import { FHEATHERX_V6_ABI } from '@/lib/contracts/fheatherXv6Abi';
import { FHEATHERX_V8_FHE_ABI } from '@/lib/contracts/fheatherXv8FHE-abi';
import { FHEATHERX_V8_MIXED_ABI } from '@/lib/contracts/fheatherXv8Mixed-abi';
import { FHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
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
    case 'v6':
    default:
      return FHEATHERX_V6_ABI;
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
 * Supports v6, v8FHE, and v8Mixed contracts
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
  const abi = getAbiForContractType(contractType);

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

  // Function names vary by version:
  // v6: getPoolState, getPoolReserves, totalLpSupply
  // v8: poolStates, getReserves (totalLpSupply in poolReserves)
  const stateFnName = contractType === 'v6' ? 'getPoolState' : 'poolStates';
  const reserveFnName = contractType === 'v6' ? 'getPoolReserves' : 'getReserves';

  // Fetch pool state, reserves and LP supply from the contract
  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: [
      {
        address: hookAddress,
        abi,
        functionName: stateFnName,
        args: poolId ? [poolId] : undefined,
      },
      {
        address: hookAddress,
        abi,
        functionName: reserveFnName,
        args: poolId ? [poolId] : undefined,
      },
      // v6 has separate totalLpSupply, v8 doesn't (LP is in poolReserves)
      ...(contractType === 'v6' ? [{
        address: hookAddress,
        abi,
        functionName: 'totalLpSupply' as const,
        args: poolId ? [poolId] : undefined,
      }] : []),
    ],
    query: {
      enabled: !!hookAddress && !!poolId,
      refetchInterval: 10000,
    },
  });

  // Parse pool state based on contract version
  let isInitialized = false;
  if (contractType === 'v6') {
    // v6 getPoolState returns (token0, token1, token0IsFherc20, token1IsFherc20, initialized, maxBucketsPerSwap, protocolFeeBps)
    const stateData = data?.[0]?.result as [string, string, boolean, boolean, boolean, bigint, bigint] | undefined;
    isInitialized = stateData?.[4] ?? false;
  } else if (contractType === 'v8fhe') {
    // v8FHE poolStates returns (token0, token1, initialized, protocolFeeBps)
    const stateData = data?.[0]?.result as [string, string, boolean, bigint] | undefined;
    isInitialized = stateData?.[2] ?? false;
  } else if (contractType === 'v8mixed') {
    // v8Mixed poolStates returns (token0, token1, token0IsFherc20, token1IsFherc20, initialized, protocolFeeBps)
    const stateData = data?.[0]?.result as [string, string, boolean, boolean, boolean, bigint] | undefined;
    isInitialized = stateData?.[4] ?? false;
  }

  // Parse reserves from contract response
  // v6 getPoolReserves returns (reserve0, reserve1, lpSupply)
  // v8 getReserves returns (reserve0, reserve1)
  const reservesData = data?.[1]?.result as [bigint, bigint, bigint?] | undefined;
  const reserve0 = reservesData?.[0] ?? 0n;
  const reserve1 = reservesData?.[1] ?? 0n;
  const lpSupplyFromReserves = reservesData?.[2] ?? 0n;

  // totalLpSupply: v6 has separate function, v8 doesn't have simple accessor
  const totalLpSupply = contractType === 'v6'
    ? ((data?.[2]?.result as bigint) ?? lpSupplyFromReserves)
    : lpSupplyFromReserves;

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
