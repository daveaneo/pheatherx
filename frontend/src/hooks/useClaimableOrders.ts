'use client';

/**
 * useClaimableOrders - Hook to fetch orders with claimable proceeds
 *
 * In v6, orders become claimable when:
 * 1. User has placed a deposit (OrderDeposit event)
 * 2. The bucket has been filled (BucketFilled event matching tick/side)
 * 3. User hasn't claimed yet (no Claim event for that position)
 *
 * The claim() function retrieves filled proceeds without requiring encrypted amount.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { BucketSide, type BucketSideType } from '@/lib/contracts/fheatherXv6Abi';
import { useSelectedPool } from '@/stores/poolStore';
import { parseAbiItem } from 'viem';

export interface ClaimableOrder {
  poolId: `0x${string}`;
  tick: number;
  side: BucketSideType;
  sideLabel: 'Buy' | 'Sell';
  /** Approximate trigger price based on tick */
  price: number;
  /** Block number when deposit was made */
  depositBlock: bigint;
  /** Block number when bucket was filled */
  filledBlock: bigint;
  /** Unique key for this position */
  key: string;
}

interface UseClaimableOrdersResult {
  claimableOrders: ClaimableOrder[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// Event signatures for parsing
const OrderDepositEvent = parseAbiItem('event OrderDeposit(bytes32 indexed poolId, address indexed user, int24 indexed tick, uint8 side, bytes32 amountHash)');
const BucketFilledEvent = parseAbiItem('event BucketFilled(bytes32 indexed poolId, int24 indexed tick, uint8 side)');
const ClaimEvent = parseAbiItem('event Claim(bytes32 indexed poolId, address indexed user, int24 indexed tick, uint8 side, bytes32 amountHash)');
const WithdrawEvent = parseAbiItem('event Withdraw(bytes32 indexed poolId, address indexed user, int24 indexed tick, uint8 side, bytes32 amountHash)');

export function useClaimableOrders(): UseClaimableOrdersResult {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { hookAddress } = useSelectedPool();

  const [claimableOrders, setClaimableOrders] = useState<ClaimableOrder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchClaimableOrders = useCallback(async () => {
    if (!address || !hookAddress || !publicClient) {
      setClaimableOrders([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Look back a reasonable number of blocks (e.g., ~7 days on mainnet)
      const currentBlock = await publicClient.getBlockNumber();
      const fromBlock = currentBlock > 50000n ? currentBlock - 50000n : 0n;

      // Fetch all relevant events in parallel
      const [depositLogs, filledLogs, claimLogs, withdrawLogs] = await Promise.all([
        // User's deposits
        publicClient.getLogs({
          address: hookAddress,
          event: OrderDepositEvent,
          args: { user: address },
          fromBlock,
          toBlock: 'latest',
        }),
        // All bucket filled events (we'll filter by pool later)
        publicClient.getLogs({
          address: hookAddress,
          event: BucketFilledEvent,
          fromBlock,
          toBlock: 'latest',
        }),
        // User's claims
        publicClient.getLogs({
          address: hookAddress,
          event: ClaimEvent,
          args: { user: address },
          fromBlock,
          toBlock: 'latest',
        }),
        // User's withdrawals
        publicClient.getLogs({
          address: hookAddress,
          event: WithdrawEvent,
          args: { user: address },
          fromBlock,
          toBlock: 'latest',
        }),
      ]);

      // Build a set of filled buckets (poolId:tick:side)
      const filledBuckets = new Map<string, bigint>();
      for (const log of filledLogs) {
        const poolId = log.args.poolId;
        const tick = log.args.tick;
        const side = log.args.side;
        if (poolId === undefined || tick === undefined || side === undefined) continue;

        const key = `${poolId}:${tick}:${side}`;
        // Track the block when it was filled
        if (!filledBuckets.has(key) || (log.blockNumber && log.blockNumber < filledBuckets.get(key)!)) {
          filledBuckets.set(key, log.blockNumber || 0n);
        }
      }

      // Build a set of already claimed/withdrawn positions (poolId:tick:side:user)
      const claimedPositions = new Set<string>();
      for (const log of claimLogs) {
        const poolId = log.args.poolId;
        const tick = log.args.tick;
        const side = log.args.side;
        if (poolId === undefined || tick === undefined || side === undefined) continue;
        claimedPositions.add(`${poolId}:${tick}:${side}`);
      }
      for (const log of withdrawLogs) {
        const poolId = log.args.poolId;
        const tick = log.args.tick;
        const side = log.args.side;
        if (poolId === undefined || tick === undefined || side === undefined) continue;
        claimedPositions.add(`${poolId}:${tick}:${side}`);
      }

      // Find deposits that are in filled buckets but not yet claimed
      const claimable: ClaimableOrder[] = [];
      const seenPositions = new Set<string>();

      for (const log of depositLogs) {
        const poolId = log.args.poolId;
        const tick = log.args.tick;
        const side = log.args.side;
        if (poolId === undefined || tick === undefined || side === undefined) continue;

        const bucketKey = `${poolId}:${tick}:${side}`;
        const positionKey = bucketKey;

        // Skip if already processed this position
        if (seenPositions.has(positionKey)) continue;
        seenPositions.add(positionKey);

        // Check if bucket is filled and not yet claimed
        if (filledBuckets.has(bucketKey) && !claimedPositions.has(positionKey)) {
          const tickNum = Number(tick);
          const sideNum = side as BucketSideType;
          const price = Math.pow(1.0001, tickNum);

          claimable.push({
            poolId: poolId as `0x${string}`,
            tick: tickNum,
            side: sideNum,
            sideLabel: sideNum === BucketSide.BUY ? 'Buy' : 'Sell',
            price,
            depositBlock: log.blockNumber || 0n,
            filledBlock: filledBuckets.get(bucketKey) || 0n,
            key: positionKey,
          });
        }
      }

      // Sort by filled block (most recent first)
      claimable.sort((a, b) => Number(b.filledBlock - a.filledBlock));

      setClaimableOrders(claimable);
    } catch (err) {
      console.error('[useClaimableOrders] Error fetching orders:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch claimable orders');
      setClaimableOrders([]);
    } finally {
      setIsLoading(false);
    }
  }, [address, hookAddress, publicClient]);

  // Fetch on mount and when dependencies change
  useEffect(() => {
    fetchClaimableOrders();
  }, [fetchClaimableOrders]);

  return {
    claimableOrders,
    isLoading,
    error,
    refetch: fetchClaimableOrders,
  };
}

/**
 * Hook to get count of claimable orders (for badges/notifications)
 */
export function useClaimableOrdersCount(): number {
  const { claimableOrders } = useClaimableOrders();
  return claimableOrders.length;
}
