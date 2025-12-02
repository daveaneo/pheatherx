'use client';

import { useAccount, useReadContracts } from 'wagmi';
import { PHEATHERX_ABI } from '@/lib/contracts/abi';
import { useSelectedPool } from '@/stores/poolStore';

interface LiquidityPosition {
  balance0: bigint;
  balance1: bigint;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useLiquidityPosition(): LiquidityPosition {
  const { address } = useAccount();
  // Get hook address from selected pool
  const { hookAddress } = useSelectedPool();

  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: [
      {
        address: hookAddress,
        abi: PHEATHERX_ABI,
        functionName: 'getUserBalanceToken0',
        args: address ? [address] : undefined,
      },
      {
        address: hookAddress,
        abi: PHEATHERX_ABI,
        functionName: 'getUserBalanceToken1',
        args: address ? [address] : undefined,
      },
    ],
    query: {
      enabled: !!hookAddress && !!address,
      refetchInterval: 10000,
    },
  });

  return {
    balance0: (data?.[0]?.result as bigint) ?? 0n,
    balance1: (data?.[1]?.result as bigint) ?? 0n,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}
