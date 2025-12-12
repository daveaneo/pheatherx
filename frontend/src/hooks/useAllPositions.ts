'use client';

/**
 * useAllPositions - Cross-pool position aggregation hook
 *
 * Queries positions across ALL pools for the Portfolio page.
 * Uses the same detection logic as useActiveOrders but iterates all pools.
 *
 * Position is "active" if it has:
 * - shares > 0 (unfilled order), OR
 * - claimable proceeds (from filled orders)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { parseAbiItem } from 'viem';
import { usePoolStore, getPoolKey } from '@/stores/poolStore';
import { FHEATHERX_V6_ABI } from '@/lib/contracts/fheatherXv6Abi';
import { getPoolIdFromTokens } from '@/lib/poolId';
import type { Pool, Token } from '@/types/pool';

export interface AllPoolPosition {
  // Pool info
  pool: Pool;
  poolKey: string;
  poolId: `0x${string}`;
  // Position info
  tick: number;
  side: number; // 0 = BUY, 1 = SELL
  sharesHandle: bigint;
  realizedProceedsHandle: bigint;
  hasClaimableProceeds: boolean;
  // UI display
  sideLabel: 'BUY' | 'SELL';
  // Token references for this position
  depositToken: Token | undefined;
  proceedsToken: Token | undefined;
}

export interface PoolPositionGroup {
  pool: Pool;
  poolKey: string;
  poolId: `0x${string}`;
  positions: AllPoolPosition[];
  hasClaimable: boolean;
}

// Event signatures for claimable detection
const BucketFilledEvent = parseAbiItem('event BucketFilled(bytes32 indexed poolId, int24 indexed tick, uint8 side)');
const ClaimEvent = parseAbiItem('event Claim(bytes32 indexed poolId, address indexed user, int24 indexed tick, uint8 side, bytes32 amountHash)');

export function useAllPositions() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const pools = usePoolStore(state => state.pools);

  const [positionsByPool, setPositionsByPool] = useState<Map<string, PoolPositionGroup>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Flatten all positions for easy iteration
  const allPositions = useMemo(() => {
    const positions: AllPoolPosition[] = [];
    for (const group of positionsByPool.values()) {
      positions.push(...group.positions);
    }
    return positions;
  }, [positionsByPool]);

  // Count of positions with claimable proceeds
  const claimableCount = useMemo(() => {
    return allPositions.filter(p => p.hasClaimableProceeds).length;
  }, [allPositions]);

  // Fetch positions for a single pool
  const fetchPoolPositions = useCallback(async (
    pool: Pool,
    userAddress: `0x${string}`
  ): Promise<AllPoolPosition[]> => {
    if (!publicClient) return [];

    const hookAddress = pool.hook;
    const poolId = getPoolIdFromTokens(pool.token0Meta, pool.token1Meta, hookAddress);
    const poolKey = getPoolKey(pool);

    // Deposit event signature: keccak256("Deposit(bytes32,address,int24,uint8,bytes32)")
    const DEPOSIT_EVENT_SIG = '0xe227a6e7d62472606934cff09bd5338bef8353353f2e4cd5f33663baadbc64e8';

    // Get current block number for range calculation
    const currentBlock = await publicClient.getBlockNumber();
    // Look back ~3.5 hours of blocks (Arbitrum ~250ms blocks)
    const fromBlock = currentBlock - 50000n;
    const fromBlockHex = `0x${(fromBlock > 0n ? fromBlock : 0n).toString(16)}` as `0x${string}`;
    const toBlockHex = `0x${currentBlock.toString(16)}` as `0x${string}`;

    // Query events in parallel: Deposits, BucketFilled, and Claims
    const [depositLogs, filledLogs, claimLogs] = await Promise.all([
      // Get Deposit events for this user in this pool
      publicClient.request({
        method: 'eth_getLogs',
        params: [{
          address: hookAddress,
          topics: [
            DEPOSIT_EVENT_SIG,
            poolId,
            `0x000000000000000000000000${userAddress.slice(2).toLowerCase()}` as `0x${string}`,
            null, // tick - all ticks
          ],
          fromBlock: fromBlockHex,
          toBlock: toBlockHex,
        }],
      }) as Promise<Array<{ topics: string[]; data: string }>>,

      // Get BucketFilled events for this pool
      publicClient.getLogs({
        address: hookAddress,
        event: BucketFilledEvent,
        args: { poolId: poolId as `0x${string}` },
        fromBlock: fromBlock > 0n ? fromBlock : 0n,
        toBlock: 'latest',
      }),

      // Get Claim events for this user in this pool
      publicClient.getLogs({
        address: hookAddress,
        event: ClaimEvent,
        args: { poolId: poolId as `0x${string}`, user: userAddress },
        fromBlock: fromBlock > 0n ? fromBlock : 0n,
        toBlock: 'latest',
      }),
    ]);

    // Build set of filled buckets (tick:side -> true)
    const filledBuckets = new Set<string>();
    for (const log of filledLogs) {
      const tick = log.args.tick;
      const side = log.args.side;
      if (tick !== undefined && side !== undefined) {
        filledBuckets.add(`${tick}:${side}`);
      }
    }

    // Build set of already claimed positions (tick:side -> true)
    const claimedPositions = new Set<string>();
    for (const log of claimLogs) {
      const tick = log.args.tick;
      const side = log.args.side;
      if (tick !== undefined && side !== undefined) {
        claimedPositions.add(`${tick}:${side}`);
      }
    }

    // Build set of unique positions from deposits
    const positionMap = new Map<string, { tick: number; side: number }>();

    for (const log of depositLogs) {
      // Parse tick from topics[3] - it's int24, sign-extended to 32 bytes
      const tickHex = log.topics[3];
      if (!tickHex) continue;

      // Parse as signed int24 from the hex
      let tick = parseInt(tickHex, 16);
      // Handle sign extension for negative ticks
      if (tick > 0x7FFFFF) {
        tick = tick - 0x1000000;
      }

      // Parse side from data (first byte after removing 0x prefix)
      const side = parseInt(log.data.slice(2, 66), 16);

      const key = `${tick}-${side}`;
      positionMap.set(key, { tick, side });
    }

    // For each position, query the contract and determine if active
    const activePositions: AllPoolPosition[] = [];

    for (const [_, pos] of positionMap) {
      try {
        // Query positions mapping: positions(bytes32, address, int24, uint8)
        const result = await publicClient.readContract({
          address: hookAddress,
          abi: FHEATHERX_V6_ABI,
          functionName: 'positions',
          args: [poolId, userAddress, pos.tick, pos.side],
        }) as [bigint, bigint, bigint, bigint];

        const sharesHandle = result[0];
        const realizedProceedsHandle = result[3];

        // Determine if position has claimable proceeds
        const bucketKey = `${pos.tick}:${pos.side}`;
        const hasBucketFilled = filledBuckets.has(bucketKey);
        const hasAlreadyClaimed = claimedPositions.has(bucketKey);
        const hasUnclaimedFilledBucket = hasBucketFilled && !hasAlreadyClaimed;

        const hasClaimableProceeds =
          realizedProceedsHandle > 0n ||
          hasUnclaimedFilledBucket;

        // Position is "active" if it has shares OR claimable proceeds
        const isActive = sharesHandle > 0n || hasClaimableProceeds;

        if (isActive) {
          // Determine tokens based on side
          // SELL: deposit token0, receive token1
          // BUY: deposit token1, receive token0
          const depositToken = pos.side === 1 ? pool.token0Meta : pool.token1Meta;
          const proceedsToken = pos.side === 1 ? pool.token1Meta : pool.token0Meta;

          activePositions.push({
            pool,
            poolKey,
            poolId: poolId as `0x${string}`,
            tick: pos.tick,
            side: pos.side,
            sharesHandle,
            realizedProceedsHandle,
            hasClaimableProceeds,
            sideLabel: pos.side === 0 ? 'BUY' : 'SELL',
            depositToken,
            proceedsToken,
          });
        }
      } catch (err) {
        console.warn(`[useAllPositions] Failed to query position at tick ${pos.tick}, side ${pos.side}:`, err);
      }
    }

    return activePositions;
  }, [publicClient]);

  // Fetch all positions across all pools
  const fetchAllPositions = useCallback(async () => {
    if (!address || !publicClient || pools.length === 0) {
      setPositionsByPool(new Map());
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log('[useAllPositions] Fetching positions across', pools.length, 'pools');

      const newPositionsByPool = new Map<string, PoolPositionGroup>();

      // Query all pools in parallel for better performance
      const results = await Promise.all(
        pools.map(async pool => {
          try {
            const positions = await fetchPoolPositions(pool, address);
            return { pool, positions };
          } catch (err) {
            console.warn(`[useAllPositions] Failed to fetch positions for pool ${pool.hook}:`, err);
            return { pool, positions: [] };
          }
        })
      );

      // Organize results by pool
      for (const { pool, positions } of results) {
        if (positions.length > 0) {
          const poolKey = getPoolKey(pool);
          const poolId = getPoolIdFromTokens(pool.token0Meta, pool.token1Meta, pool.hook);
          newPositionsByPool.set(poolKey, {
            pool,
            poolKey,
            poolId: poolId as `0x${string}`,
            positions,
            hasClaimable: positions.some(p => p.hasClaimableProceeds),
          });
        }
      }

      console.log('[useAllPositions] Found positions in', newPositionsByPool.size, 'pools');
      setPositionsByPool(newPositionsByPool);
    } catch (err) {
      console.error('[useAllPositions] Error fetching all positions:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch positions');
      setPositionsByPool(new Map());
    } finally {
      setIsLoading(false);
    }
  }, [address, publicClient, pools, fetchPoolPositions]);

  // Fetch on mount and when dependencies change
  useEffect(() => {
    fetchAllPositions();
  }, [fetchAllPositions]);

  return {
    positionsByPool,
    allPositions,
    claimableCount,
    isLoading,
    error,
    refetch: fetchAllPositions,
    // Convenience getters
    hasPositions: allPositions.length > 0,
    hasClaimable: claimableCount > 0,
  };
}
