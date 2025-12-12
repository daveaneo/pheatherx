'use client';

/**
 * useActiveOrders - v6 Active Orders Hook
 *
 * In v6, orders are stored as positions in buckets at specific ticks.
 * A position is "active" if it has:
 * - shares > 0 (unfilled order), OR
 * - claimable proceeds (from filled orders)
 *
 * Detection uses:
 * 1. Deposit events to find user's positions
 * 2. positions mapping for shares and realizedProceeds handles
 * 3. BucketFilled events to detect filled buckets
 * 4. Claim events to exclude already claimed positions
 *
 * Position key: positions[poolId][user][tick][side]
 */

import { useState, useEffect, useCallback } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { FHEATHERX_V6_ABI, BucketSide } from '@/lib/contracts/fheatherXv6Abi';
import { useSelectedPool } from '@/stores/poolStore';
import { getPoolIdFromTokens } from '@/lib/poolId';
import { parseAbiItem } from 'viem';

export interface ActivePosition {
  poolId: `0x${string}`;
  tick: number;
  side: number; // 0 = BUY, 1 = SELL
  sharesHandle: bigint; // euint128 handle (encrypted)
  // Proceeds detection
  realizedProceedsHandle: bigint; // euint128 handle for accumulated proceeds
  hasClaimableProceeds: boolean; // true if user can claim proceeds
  // UI display
  sideLabel: 'BUY' | 'SELL';
}

// Event signatures for claimable detection
const BucketFilledEvent = parseAbiItem('event BucketFilled(bytes32 indexed poolId, int24 indexed tick, uint8 side)');
const ClaimEvent = parseAbiItem('event Claim(bytes32 indexed poolId, address indexed user, int24 indexed tick, uint8 side, bytes32 amountHash)');

export function useActiveOrders() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { hookAddress, token0, token1 } = useSelectedPool();

  const [positions, setPositions] = useState<ActivePosition[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compute poolId
  const poolId = token0 && token1 && hookAddress
    ? getPoolIdFromTokens(token0, token1, hookAddress)
    : null;

  // Fetch user's positions by querying Deposit events and checking for claimable proceeds
  const fetchPositions = useCallback(async () => {
    if (!address || !hookAddress || !publicClient || !poolId) {
      console.log('[useActiveOrders] Missing deps:', { address, hookAddress, publicClient: !!publicClient, poolId });
      setPositions([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log('[useActiveOrders] Fetching positions for:', { poolId, address, hookAddress });

      // Deposit event signature: keccak256("Deposit(bytes32,address,int24,uint8,bytes32)")
      const DEPOSIT_EVENT_SIG = '0xe227a6e7d62472606934cff09bd5338bef8353353f2e4cd5f33663baadbc64e8';

      // Get current block number for range calculation
      const currentBlock = await publicClient.getBlockNumber();
      // Look back ~24 hours worth of blocks (Arbitrum ~250ms blocks = ~345,600 blocks/day)
      const fromBlock = currentBlock - 50000n; // ~3.5 hours of blocks
      const fromBlockHex = `0x${(fromBlock > 0n ? fromBlock : 0n).toString(16)}` as `0x${string}`;
      const toBlockHex = `0x${currentBlock.toString(16)}` as `0x${string}`;

      // Query events in parallel: Deposits, BucketFilled, and Claims
      const [depositLogs, filledLogs, claimLogs] = await Promise.all([
        // Get Deposit events for this user
        publicClient.request({
          method: 'eth_getLogs',
          params: [{
            address: hookAddress,
            topics: [
              DEPOSIT_EVENT_SIG,
              poolId,
              `0x000000000000000000000000${address.slice(2).toLowerCase()}` as `0x${string}`,
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

        // Get Claim events for this user
        publicClient.getLogs({
          address: hookAddress,
          event: ClaimEvent,
          args: { poolId: poolId as `0x${string}`, user: address },
          fromBlock: fromBlock > 0n ? fromBlock : 0n,
          toBlock: 'latest',
        }),
      ]);

      console.log('[useActiveOrders] Found events:', {
        deposits: depositLogs.length,
        filled: filledLogs.length,
        claims: claimLogs.length,
      });

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
        // data format: side (uint8) + amountHash (bytes32)
        const side = parseInt(log.data.slice(2, 66), 16); // First 32 bytes = side (padded)

        const key = `${tick}-${side}`;
        positionMap.set(key, { tick, side });
      }

      // For each position, query the contract and determine if active
      const activePositions: ActivePosition[] = [];

      console.log('[useActiveOrders] Querying positions for', positionMap.size, 'unique tick/side combos');

      for (const [key, pos] of positionMap) {
        try {
          // Query positions mapping: positions(bytes32, address, int24, uint8)
          const result = await publicClient.readContract({
            address: hookAddress,
            abi: FHEATHERX_V6_ABI,
            functionName: 'positions',
            args: [poolId, address, pos.tick, pos.side],
          }) as [bigint, bigint, bigint, bigint]; // [shares, proceedsPerShareSnapshot, filledPerShareSnapshot, realizedProceeds]

          const sharesHandle = result[0];
          const realizedProceedsHandle = result[3];

          // Determine if position has claimable proceeds
          // 1. realizedProceeds handle exists (accumulated proceeds)
          // 2. OR bucket was filled and user hasn't claimed yet
          const bucketKey = `${pos.tick}:${pos.side}`;
          const hasBucketFilled = filledBuckets.has(bucketKey);
          const hasAlreadyClaimed = claimedPositions.has(bucketKey);
          const hasUnclaimedFilledBucket = hasBucketFilled && !hasAlreadyClaimed;

          const hasClaimableProceeds =
            realizedProceedsHandle > 0n || // Has accumulated proceeds
            hasUnclaimedFilledBucket;       // Bucket filled but not claimed

          // Position is "active" if it has shares OR claimable proceeds
          const isActive = sharesHandle > 0n || hasClaimableProceeds;

          if (isActive) {
            activePositions.push({
              poolId: poolId as `0x${string}`,
              tick: pos.tick,
              side: pos.side,
              sharesHandle,
              realizedProceedsHandle,
              hasClaimableProceeds,
              sideLabel: pos.side === 0 ? 'BUY' : 'SELL',
            });

            console.log('[useActiveOrders] Active position:', {
              tick: pos.tick,
              side: pos.side,
              sharesHandle: sharesHandle.toString(),
              hasClaimableProceeds,
            });
          }
        } catch (err) {
          console.warn(`[useActiveOrders] Failed to query position at tick ${pos.tick}, side ${pos.side}:`, err);
        }
      }

      console.log('[useActiveOrders] Found', activePositions.length, 'active positions');
      setPositions(activePositions);
    } catch (err) {
      console.error('[useActiveOrders] Error fetching positions:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch positions');
      setPositions([]);
    } finally {
      setIsLoading(false);
    }
  }, [address, hookAddress, publicClient, poolId]);

  // Fetch on mount and when dependencies change
  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  return {
    positions,
    // Legacy compatibility - return position count as "orderIds"
    orderIds: positions.map((_, i) => BigInt(i)),
    isLoading,
    error,
    refetch: fetchPositions,
  };
}
