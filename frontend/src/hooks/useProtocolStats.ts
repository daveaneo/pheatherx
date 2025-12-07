'use client';

import { useReadContract } from 'wagmi';
import { useChainId } from 'wagmi';
import { formatUnits } from 'viem';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { FHEATHERX_FACTORY_ABI } from '@/lib/contracts/factoryAbi';
import { FHEATHERX_FACTORY_ADDRESSES } from '@/lib/contracts/addresses';
import { useSelectedPool } from '@/stores/poolStore';
import { useTransactionStore } from '@/stores/transactionStore';

interface ProtocolStats {
  // TVL data
  tvl: string;
  tvlRaw: { reserve0: bigint; reserve1: bigint };

  // Pool count from factory
  poolCount: number;

  // From transaction store (user's recent activity)
  recentTransactionCount: number;

  // Loading states
  isLoading: boolean;
  error: Error | null;

  // Refetch
  refetch: () => void;
}

/**
 * Hook to fetch protocol statistics from the blockchain
 *
 * What we CAN fetch on-chain:
 * - TVL (Total Value Locked) from getReserves()
 *
 * What we CANNOT fetch without an indexer:
 * - 24h Volume (would need event indexing)
 * - Historical trade counts (would need event indexing)
 * - Fee collection totals (would need event indexing)
 */
export function useProtocolStats(): ProtocolStats {
  const chainId = useChainId();
  const { hookAddress, token0, token1 } = useSelectedPool();
  const transactions = useTransactionStore(state => state.transactions);

  const factoryAddress = FHEATHERX_FACTORY_ADDRESSES[chainId];

  // Fetch reserves for TVL
  const {
    data: reservesData,
    isLoading: isLoadingReserves,
    error: reservesError,
    refetch: refetchReserves,
  } = useReadContract({
    address: hookAddress,
    abi: FHEATHERX_ABI,
    functionName: 'getReserves',
    query: {
      enabled: !!hookAddress,
      refetchInterval: 15000, // Refresh every 15 seconds
    },
  });

  // Fetch pool count from factory
  const {
    data: poolCountData,
    isLoading: isLoadingPoolCount,
  } = useReadContract({
    address: factoryAddress,
    abi: FHEATHERX_FACTORY_ABI,
    functionName: 'poolCount',
    query: {
      enabled: !!factoryAddress && factoryAddress !== '0x0000000000000000000000000000000000000000',
      refetchInterval: 30000, // Refresh every 30 seconds
    },
  });

  const reserves = reservesData as [bigint, bigint] | undefined;
  const reserve0 = reserves?.[0] ?? 0n;
  const reserve1 = reserves?.[1] ?? 0n;
  const poolCount = poolCountData ? Number(poolCountData) : 0;

  // Calculate TVL display value
  // For now, we'll show the raw token amounts
  // In production, you'd convert to USD using price feeds
  const tvl = formatTVL(reserve0, reserve1, token0?.decimals ?? 18, token1?.decimals ?? 18);

  const refetch = () => {
    refetchReserves();
  };

  return {
    tvl,
    tvlRaw: { reserve0, reserve1 },
    poolCount,
    recentTransactionCount: transactions.length,
    isLoading: isLoadingReserves || isLoadingPoolCount,
    error: reservesError as Error | null,
    refetch,
  };
}

/**
 * Format TVL for display
 * Shows combined value in a readable format
 */
function formatTVL(
  reserve0: bigint,
  reserve1: bigint,
  decimals0: number,
  decimals1: number
): string {
  const r0 = Number(formatUnits(reserve0, decimals0));
  const r1 = Number(formatUnits(reserve1, decimals1));

  // If both are 0, show $0
  if (r0 === 0 && r1 === 0) {
    return '$0';
  }

  // Simple estimation: assume token0 is ~$2000 (ETH-like) and token1 is ~$1 (stablecoin-like)
  // In production, use actual price feeds
  const estimatedTVL = r0 * 2000 + r1;

  if (estimatedTVL >= 1_000_000) {
    return `$${(estimatedTVL / 1_000_000).toFixed(2)}M`;
  } else if (estimatedTVL >= 1_000) {
    return `$${(estimatedTVL / 1_000).toFixed(1)}K`;
  } else {
    return `$${estimatedTVL.toFixed(2)}`;
  }
}

/**
 * Hook to get reserve amounts formatted with token symbols
 */
export function useFormattedReserves(): {
  reserve0Formatted: string;
  reserve1Formatted: string;
  isLoading: boolean;
} {
  const { hookAddress, token0, token1 } = useSelectedPool();

  const { data, isLoading } = useReadContract({
    address: hookAddress,
    abi: FHEATHERX_ABI,
    functionName: 'getReserves',
    query: {
      enabled: !!hookAddress,
      refetchInterval: 15000,
    },
  });

  const reserves = data as [bigint, bigint] | undefined;

  const formatReserve = (amount: bigint | undefined, decimals: number, symbol: string): string => {
    if (!amount || amount === 0n) return `0 ${symbol}`;
    const formatted = Number(formatUnits(amount, decimals));
    if (formatted >= 1_000_000) {
      return `${(formatted / 1_000_000).toFixed(2)}M ${symbol}`;
    } else if (formatted >= 1_000) {
      return `${(formatted / 1_000).toFixed(2)}K ${symbol}`;
    } else {
      return `${formatted.toFixed(4)} ${symbol}`;
    }
  };

  return {
    reserve0Formatted: formatReserve(reserves?.[0], token0?.decimals ?? 18, token0?.symbol ?? 'Token0'),
    reserve1Formatted: formatReserve(reserves?.[1], token1?.decimals ?? 18, token1?.symbol ?? 'Token1'),
    isLoading,
  };
}
