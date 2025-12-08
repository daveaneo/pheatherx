'use client';

import { useAccount, useReadContracts } from 'wagmi';
import { FHEATHERX_V5_ABI } from '@/lib/contracts/fheatherXv5Abi';
import { usePoolStore } from '@/stores/poolStore';
import { getPoolIdFromTokens } from '@/lib/poolId';
import type { Pool } from '@/types/pool';
import type { Token } from '@/lib/tokens';

/**
 * Represents a user's LP position in a pool
 */
export interface LPPosition {
  pool: Pool;
  poolId: `0x${string}`;
  lpBalance: bigint;
  encLpBalance: bigint;
  reserve0: bigint;
  reserve1: bigint;
  totalLpSupply: bigint;
  token0: Token;
  token1: Token;
  hookAddress: `0x${string}`;
  // Computed values
  poolShare: number; // Percentage of pool owned (0-100)
  token0Amount: bigint; // User's share of token0 reserves
  token1Amount: bigint; // User's share of token1 reserves
  isEncrypted: boolean; // Whether balance is FHE encrypted
}

interface UseUserLPPositionsResult {
  positions: LPPosition[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

// Threshold to detect if a value looks like an encrypted FHE handle
const MAX_REASONABLE_BALANCE = BigInt('1000000000000000000000000000000'); // 10^30

function isLikelyEncrypted(value: bigint): boolean {
  return value > MAX_REASONABLE_BALANCE;
}

/**
 * Hook to fetch user's LP positions across all discovered pools
 */
export function useUserLPPositions(): UseUserLPPositionsResult {
  const { address } = useAccount();
  const pools = usePoolStore(state => state.pools);

  // Build contract read calls for each pool
  const contractCalls = pools.flatMap(pool => {
    const poolId = getPoolIdFromTokens(
      pool.token0Meta,
      pool.token1Meta,
      pool.hook
    );

    return [
      // LP balance (plaintext cache)
      {
        address: pool.hook,
        abi: FHEATHERX_V5_ABI,
        functionName: 'lpBalances',
        args: address ? [poolId, address] : undefined,
      },
      // Encrypted LP balance
      {
        address: pool.hook,
        abi: FHEATHERX_V5_ABI,
        functionName: 'encLpBalances',
        args: address ? [poolId, address] : undefined,
      },
      // Pool reserves
      {
        address: pool.hook,
        abi: FHEATHERX_V5_ABI,
        functionName: 'getPoolReserves',
        args: [poolId],
      },
      // Total LP supply
      {
        address: pool.hook,
        abi: FHEATHERX_V5_ABI,
        functionName: 'totalLpSupply',
        args: [poolId],
      },
    ];
  });

  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: contractCalls as any, // Type assertion needed due to dynamic contract array
    query: {
      enabled: !!address && pools.length > 0,
      refetchInterval: 15000,
    },
  });

  // Parse results into positions
  const positions: LPPosition[] = [];

  if (data) {
    pools.forEach((pool, poolIndex) => {
      const baseIndex = poolIndex * 4;

      const lpBalance = (data[baseIndex]?.result as bigint) ?? 0n;
      const encLpBalance = (data[baseIndex + 1]?.result as bigint) ?? 0n;
      const reservesData = data[baseIndex + 2]?.result as [bigint, bigint, bigint] | undefined;
      const totalLpSupply = (data[baseIndex + 3]?.result as bigint) ?? 0n;

      const reserve0 = reservesData?.[0] ?? 0n;
      const reserve1 = reservesData?.[1] ?? 0n;

      // Only include positions with non-zero balance
      const hasBalance = lpBalance > 0n || (encLpBalance > 0n && !isLikelyEncrypted(encLpBalance));
      const hasEncryptedBalance = isLikelyEncrypted(encLpBalance);

      if (hasBalance || hasEncryptedBalance) {
        const poolId = getPoolIdFromTokens(
          pool.token0Meta,
          pool.token1Meta,
          pool.hook
        );

        // Calculate pool share percentage
        const poolShare =
          totalLpSupply > 0n
            ? Number((lpBalance * 10000n) / totalLpSupply) / 100
            : 0;

        // Calculate user's share of reserves
        const token0Amount =
          totalLpSupply > 0n ? (reserve0 * lpBalance) / totalLpSupply : 0n;
        const token1Amount =
          totalLpSupply > 0n ? (reserve1 * lpBalance) / totalLpSupply : 0n;

        positions.push({
          pool,
          poolId,
          lpBalance,
          encLpBalance,
          reserve0,
          reserve1,
          totalLpSupply,
          token0: pool.token0Meta,
          token1: pool.token1Meta,
          hookAddress: pool.hook,
          poolShare,
          token0Amount,
          token1Amount,
          isEncrypted: hasEncryptedBalance && !hasBalance,
        });
      }
    });
  }

  return {
    positions,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}

/**
 * Hook to get a single LP position by pool
 */
export function useLPPosition(pool: Pool | undefined): LPPosition | undefined {
  const { positions } = useUserLPPositions();

  if (!pool) return undefined;

  return positions.find(p => p.hookAddress === pool.hook);
}
