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

// v8 event signature: Deposit(bytes32 indexed poolId, address indexed user, int24 tick, uint8 side)
// Note: tick is NOT indexed in v8 (it's in data, not topics)
const DEPOSIT_EVENT_SIG_V8 = '0x98e0863451aca29a3cdeef64626a798d954f7b972dca09d44db747aa59763446';

// v6 event signature: Deposit(bytes32 indexed poolId, address indexed user, int24 indexed tick, uint8 side, bytes32 amountHash)
const DEPOSIT_EVENT_SIG_V6 = '0xe227a6e7d62472606934cff09bd5338bef8353353f2e4cd5f33663baadbc64e8';

// v8 Withdraw event: Withdraw(bytes32 indexed poolId, address indexed user, int24 tick, uint8 side)
const WITHDRAW_EVENT_SIG_V8 = '0x1a121fa70f9714026baf73f9f3406ae516e435a9f5366e60d5d0b710fc8cacd0';

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

      // Get current block number for range calculation
      const currentBlock = await publicClient.getBlockNumber();
      // Look back ~24 hours worth of blocks (Arbitrum ~250ms blocks = ~345,600 blocks/day)
      const fromBlock = currentBlock - 50000n; // ~3.5 hours of blocks
      const fromBlockHex = `0x${(fromBlock > 0n ? fromBlock : 0n).toString(16)}` as `0x${string}`;
      const toBlockHex = `0x${currentBlock.toString(16)}` as `0x${string}`;

      // Query events in parallel: Deposits (v6 + v8), Withdrawals, BucketFilled, and Claims
      const [depositLogsV6, depositLogsV8, withdrawLogsV8, filledLogs, claimLogs] = await Promise.all([
        // Get v6 Deposit events (tick is indexed)
        publicClient.request({
          method: 'eth_getLogs',
          params: [{
            address: hookAddress,
            topics: [
              DEPOSIT_EVENT_SIG_V6,
              poolId,
              `0x000000000000000000000000${address.slice(2).toLowerCase()}` as `0x${string}`,
              null, // tick - all ticks
            ],
            fromBlock: fromBlockHex,
            toBlock: toBlockHex,
          }],
        }) as Promise<Array<{ topics: string[]; data: string; blockNumber: string }>>,

        // Get v8 Deposit events (tick is NOT indexed - only 2 indexed params)
        publicClient.request({
          method: 'eth_getLogs',
          params: [{
            address: hookAddress,
            topics: [
              DEPOSIT_EVENT_SIG_V8,
              poolId,
              `0x000000000000000000000000${address.slice(2).toLowerCase()}` as `0x${string}`,
            ],
            fromBlock: fromBlockHex,
            toBlock: toBlockHex,
          }],
        }) as Promise<Array<{ topics: string[]; data: string; blockNumber: string }>>,

        // Get v8 Withdraw events (to filter out withdrawn positions)
        publicClient.request({
          method: 'eth_getLogs',
          params: [{
            address: hookAddress,
            topics: [
              WITHDRAW_EVENT_SIG_V8,
              poolId,
              `0x000000000000000000000000${address.slice(2).toLowerCase()}` as `0x${string}`,
            ],
            fromBlock: fromBlockHex,
            toBlock: toBlockHex,
          }],
        }) as Promise<Array<{ topics: string[]; data: string; blockNumber: string }>>,

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
        depositsV6: depositLogsV6.length,
        depositsV8: depositLogsV8.length,
        withdrawsV8: withdrawLogsV8.length,
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

      // Build set of withdrawn positions (tick:side -> latest withdraw block)
      // Parse v8 Withdraw events: tick and side in data (same format as Deposit v8)
      const withdrawnPositions = new Map<string, bigint>();
      for (const log of withdrawLogsV8) {
        // Parse tick from first 32 bytes of data
        const tickHex = log.data.slice(2, 66);
        let tick = parseInt(tickHex, 16);
        if (tick > 0x7FFFFF) {
          tick = tick - 0x1000000;
        }
        // Parse side from second 32 bytes
        const side = parseInt(log.data.slice(66, 130), 16);
        const blockNumber = BigInt(log.blockNumber);

        const key = `${tick}-${side}`;
        const existing = withdrawnPositions.get(key);
        if (!existing || blockNumber > existing) {
          withdrawnPositions.set(key, blockNumber);
        }
      }

      // Build set of unique positions from deposits (both v6 and v8)
      // Track latest deposit block for each position
      const positionMap = new Map<string, { tick: number; side: number; latestDepositBlock: bigint }>();

      // Parse v6 deposits: tick in topics[3], side in data
      for (const log of depositLogsV6) {
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
        const blockNumber = BigInt(log.blockNumber);

        const key = `${tick}-${side}`;
        const existing = positionMap.get(key);
        if (!existing || blockNumber > existing.latestDepositBlock) {
          positionMap.set(key, { tick, side, latestDepositBlock: blockNumber });
        }
      }

      // Parse v8 deposits: tick and side both in data (not indexed)
      // v8 data format: int24 tick (32 bytes padded) + uint8 side (32 bytes padded)
      for (const log of depositLogsV8) {
        // Parse tick from first 32 bytes of data
        const tickHex = log.data.slice(2, 66); // bytes 0-31 = tick
        let tick = parseInt(tickHex, 16);
        // Handle sign extension for negative ticks (int24)
        if (tick > 0x7FFFFF) {
          tick = tick - 0x1000000;
        }

        // Parse side from second 32 bytes of data
        const side = parseInt(log.data.slice(66, 130), 16); // bytes 32-63 = side
        const blockNumber = BigInt(log.blockNumber);

        const key = `${tick}-${side}`;
        const existing = positionMap.get(key);
        if (!existing || blockNumber > existing.latestDepositBlock) {
          positionMap.set(key, { tick, side, latestDepositBlock: blockNumber });
        }
      }

      // Filter out positions that were withdrawn after the last deposit
      for (const [key, withdrawBlock] of withdrawnPositions) {
        const deposit = positionMap.get(key);
        if (deposit && withdrawBlock >= deposit.latestDepositBlock) {
          // Withdraw happened after or at same block as last deposit - position is empty
          positionMap.delete(key);
          console.log('[useActiveOrders] Filtered out withdrawn position:', key);
        }
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
