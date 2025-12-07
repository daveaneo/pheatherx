'use client';

import { useReadContract } from 'wagmi';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { useSelectedPool } from '@/stores/poolStore';

interface PoolReserves {
  reserve0: bigint;
  reserve1: bigint;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function usePoolReserves(): PoolReserves {
  // Get hook address from selected pool
  const { hookAddress } = useSelectedPool();

  const { data, isLoading, error, refetch } = useReadContract({
    address: hookAddress,
    abi: FHEATHERX_ABI,
    functionName: 'getReserves',
    query: {
      enabled: !!hookAddress,
      refetchInterval: 10000, // Refresh every 10 seconds
    },
  });

  const reserves = data as [bigint, bigint] | undefined;

  return {
    reserve0: reserves?.[0] ?? 0n,
    reserve1: reserves?.[1] ?? 0n,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}
