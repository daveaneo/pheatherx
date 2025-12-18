'use client';

/**
 * useAllPositions - Cross-pool position aggregation hook
 *
 * Queries positions across ALL pools for the Portfolio page.
 * Uses the same detection logic as useActiveOrders but iterates all pools.
 * Supports v6, v8FHE, v8Mixed contracts - skips native (ERC:ERC) pools.
 *
 * Position is "active" if it has:
 * - shares > 0 (unfilled order), OR
 * - claimable proceeds (from filled orders)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { parseAbiItem } from 'viem';
import { usePoolStore, getPoolKey, determineContractType } from '@/stores/poolStore';
import { FHEATHERX_V6_ABI } from '@/lib/contracts/fheatherXv6Abi';
import { FHEATHERX_V8_FHE_ABI } from '@/lib/contracts/fheatherXv8FHE-abi';
import { FHEATHERX_V8_MIXED_ABI } from '@/lib/contracts/fheatherXv8Mixed-abi';
import { getPoolIdFromTokens } from '@/lib/poolId';
import type { Pool, Token, ContractType } from '@/types/pool';

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
      return FHEATHERX_V6_ABI;
  }
}

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

// v6 Event signatures for claimable detection
const V6BucketFilledEvent = parseAbiItem('event BucketFilled(bytes32 indexed poolId, int24 indexed tick, uint8 side)');
const V6ClaimEvent = parseAbiItem('event Claim(bytes32 indexed poolId, address indexed user, int24 indexed tick, uint8 side, bytes32 amountHash)');

// v8 Event signatures (no amountHash)
const V8ClaimEvent = parseAbiItem('event Claim(bytes32 indexed poolId, address indexed user, int24 tick, uint8 side)');
const V8MomentumActivatedEvent = parseAbiItem('event MomentumActivated(bytes32 indexed poolId, int24 fromTick, int24 toTick, uint8 bucketsActivated)');

// Deposit event signatures
const V6_DEPOSIT_EVENT_SIG = '0xe227a6e7d62472606934cff09bd5338bef8353353f2e4cd5f33663baadbc64e8'; // v6 with amountHash
// Note: v8 has same event name but different signature due to no amountHash
const V8_DEPOSIT_EVENT_SIG = '0xe227a6e7d62472606934cff09bd5338bef8353353f2e4cd5f33663baadbc64e8'; // May need update for v8

export function useAllPositions() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  // Access raw state to ensure proper reactivity (computed getters don't subscribe well)
  const poolsByChain = usePoolStore(state => state.poolsByChain);
  const currentChainId = usePoolStore(state => state.currentChainId);
  const pools = currentChainId ? (poolsByChain[currentChainId] || []) : [];

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

    // Determine contract type for this pool
    const contractType = determineContractType(pool);

    // Skip native pools - they don't have limit orders
    if (contractType === 'native') {
      return [];
    }

    const isV8 = contractType === 'v8fhe' || contractType === 'v8mixed';
    const abi = getAbiForContractType(contractType);
    const hookAddress = pool.hook;
    const poolId = getPoolIdFromTokens(pool.token0Meta, pool.token1Meta, hookAddress);
    const poolKey = getPoolKey(pool);

    // Select event signature based on version
    const DEPOSIT_EVENT_SIG = isV8 ? V8_DEPOSIT_EVENT_SIG : V6_DEPOSIT_EVENT_SIG;
    const ClaimEvent = isV8 ? V8ClaimEvent : V6ClaimEvent;

    // Get current block number for range calculation
    const currentBlock = await publicClient.getBlockNumber();
    // Look back ~3.5 hours of blocks (Arbitrum ~250ms blocks)
    const fromBlock = currentBlock - 50000n;
    const fromBlockHex = `0x${(fromBlock > 0n ? fromBlock : 0n).toString(16)}` as `0x${string}`;
    const toBlockHex = `0x${currentBlock.toString(16)}` as `0x${string}`;

    // Build event promises based on version
    const eventPromises: Promise<unknown>[] = [
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
      }),

      // Get Claim events for this user in this pool
      publicClient.getLogs({
        address: hookAddress,
        event: ClaimEvent,
        args: { poolId: poolId as `0x${string}`, user: userAddress },
        fromBlock: fromBlock > 0n ? fromBlock : 0n,
        toBlock: 'latest',
      }),
    ];

    // v6 uses BucketFilled, v8 uses MomentumActivated
    if (isV8) {
      eventPromises.push(
        publicClient.getLogs({
          address: hookAddress,
          event: V8MomentumActivatedEvent,
          args: { poolId: poolId as `0x${string}` },
          fromBlock: fromBlock > 0n ? fromBlock : 0n,
          toBlock: 'latest',
        })
      );
    } else {
      eventPromises.push(
        publicClient.getLogs({
          address: hookAddress,
          event: V6BucketFilledEvent,
          args: { poolId: poolId as `0x${string}` },
          fromBlock: fromBlock > 0n ? fromBlock : 0n,
          toBlock: 'latest',
        })
      );
    }

    const [depositLogs, claimLogs, filledOrMomentumLogs] = await Promise.all(eventPromises) as [
      Array<{ topics: string[]; data: string }>,
      Awaited<ReturnType<typeof publicClient.getLogs>>,
      Awaited<ReturnType<typeof publicClient.getLogs>>
    ];

    // Build set of already claimed positions (tick:side -> true)
    const claimedPositions = new Set<string>();
    for (const log of claimLogs) {
      const args = (log as { args: Record<string, unknown> }).args;
      const tick = args.tick;
      const side = args.side;
      if (tick !== undefined && side !== undefined) {
        claimedPositions.add(`${tick}:${side}`);
      }
    }

    // Build claimability data based on version
    // For v6: Build set of filled buckets (tick:side -> true)
    // For v8: Build set of momentum ranges for taker orders
    const filledBuckets = new Set<string>();
    interface MomentumRange { fromTick: number; toTick: number; }
    const momentumRanges: MomentumRange[] = [];

    if (isV8) {
      // v8: Parse MomentumActivated events
      for (const log of filledOrMomentumLogs) {
        const args = (log as { args: Record<string, unknown> }).args;
        const fromTick = args.fromTick as number | undefined;
        const toTick = args.toTick as number | undefined;
        if (fromTick !== undefined && toTick !== undefined) {
          momentumRanges.push({
            fromTick: Number(fromTick),
            toTick: Number(toTick),
          });
        }
      }
    } else {
      // v6: Parse BucketFilled events
      for (const log of filledOrMomentumLogs) {
        const args = (log as { args: Record<string, unknown> }).args;
        const tick = args.tick;
        const side = args.side;
        if (tick !== undefined && side !== undefined) {
          filledBuckets.add(`${tick}:${side}`);
        }
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
        // Use dynamic ABI based on contract type
        const result = await publicClient.readContract({
          address: hookAddress,
          abi,
          functionName: 'positions',
          args: [poolId, userAddress, pos.tick, pos.side],
        }) as [bigint, bigint, bigint, bigint];

        const sharesHandle = result[0];
        const realizedProceedsHandle = result[3];

        // Determine if position has claimable proceeds
        // NOTE: We cannot rely on realizedProceedsHandle > 0n because in FHE,
        // ANY initialized encrypted value has handle > 0, even encrypted zeros.
        const bucketKey = `${pos.tick}:${pos.side}`;
        const hasAlreadyClaimed = claimedPositions.has(bucketKey);

        let hasUnclaimedFill = false;

        if (isV8) {
          // v8: Check if tick falls within any momentum activation range
          // AND the activation happened AFTER user's deposit
          for (const range of momentumRanges) {
            const tickInRange = (pos.tick >= Math.min(range.fromTick, range.toTick)) &&
                               (pos.tick <= Math.max(range.fromTick, range.toTick));
            // TODO: Add deposit block tracking for proper comparison
            if (tickInRange && !hasAlreadyClaimed) {
              hasUnclaimedFill = true;
              break;
            }
          }
        }
        // Note: Removed v6 BucketFilled check as it's not user-specific

        // Only show claimable if we have evidence of fills after deposit
        const hasClaimableProceeds = hasUnclaimedFill;

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
    console.log('[useAllPositions] fetchAllPositions called:', {
      address,
      publicClient: !!publicClient,
      poolsLength: pools.length,
      currentChainId,
    });

    if (!address || !publicClient || pools.length === 0) {
      console.log('[useAllPositions] Skipping - missing deps or no pools');
      setPositionsByPool(new Map());
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log('[useAllPositions] Fetching positions across', pools.length, 'pools:', pools.map(p => `${p.token0Meta?.symbol}/${p.token1Meta?.symbol}`));

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
  }, [address, publicClient, pools, currentChainId, fetchPoolPositions]);

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
