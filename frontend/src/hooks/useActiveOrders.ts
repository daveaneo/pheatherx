'use client';

/**
 * useActiveOrders - v6 Active Orders Hook
 *
 * In v6, orders are stored as positions in buckets at specific ticks.
 * To find active orders, we:
 * 1. Query Deposit events from the contract to find user's positions
 * 2. Query the positions mapping to check if shares > 0
 *
 * Position key: positions[poolId][user][tick][side]
 */

import { useState, useEffect, useCallback } from 'react';
import { useAccount, usePublicClient, useReadContract } from 'wagmi';
import { FHEATHERX_V6_ABI, BucketSide } from '@/lib/contracts/fheatherXv6Abi';
import { useSelectedPool } from '@/stores/poolStore';
import { getPoolIdFromTokens } from '@/lib/poolId';

export interface ActivePosition {
  poolId: `0x${string}`;
  tick: number;
  side: number; // 0 = BUY, 1 = SELL
  sharesHandle: bigint; // euint128 handle (encrypted)
  // UI display
  sideLabel: 'BUY' | 'SELL';
}

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

  // Fetch user's positions by querying Deposit events
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
      // Use a smaller lookback for initial testing
      const fromBlock = currentBlock - 50000n; // ~3.5 hours of blocks

      // Get Deposit events using raw RPC request for proper topic filtering
      // topics[0] = event sig, topics[1] = poolId, topics[2] = user, topics[3] = tick
      const depositLogs = await publicClient.request({
        method: 'eth_getLogs',
        params: [{
          address: hookAddress,
          topics: [
            DEPOSIT_EVENT_SIG,
            poolId,
            `0x000000000000000000000000${address.slice(2).toLowerCase()}`,
            null, // tick - all ticks
          ],
          fromBlock: `0x${(fromBlock > 0n ? fromBlock : 0n).toString(16)}`,
          toBlock: `0x${currentBlock.toString(16)}`,
        }],
      }) as Array<{ topics: string[]; data: string }>;

      console.log('[useActiveOrders] Found deposit logs:', depositLogs.length);

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

        console.log('[useActiveOrders] Parsed deposit:', { tick, side, tickHex });

        const key = `${tick}-${side}`;
        positionMap.set(key, { tick, side });
      }

      // For each position, query the contract to check if it still has shares
      const activePositions: ActivePosition[] = [];

      console.log('[useActiveOrders] Querying positions for', positionMap.size, 'unique tick/side combos');

      for (const [key, pos] of positionMap) {
        try {
          console.log('[useActiveOrders] Querying position:', { poolId, address, tick: pos.tick, side: pos.side });

          // Query positions mapping: positions(bytes32, address, int24, uint8)
          const result = await publicClient.readContract({
            address: hookAddress,
            abi: FHEATHERX_V6_ABI,
            functionName: 'positions',
            args: [poolId, address, pos.tick, pos.side],
          }) as [bigint, bigint, bigint, bigint]; // [shares, proceedsPerShareSnapshot, filledPerShareSnapshot, realizedProceeds]

          const sharesHandle = result[0];
          console.log('[useActiveOrders] Position result:', { tick: pos.tick, side: pos.side, sharesHandle: sharesHandle.toString() });

          // If shares handle is non-zero, position is active
          // (The handle being non-zero means there's an encrypted value)
          if (sharesHandle > 0n) {
            activePositions.push({
              poolId: poolId as `0x${string}`,
              tick: pos.tick,
              side: pos.side,
              sharesHandle,
              sideLabel: pos.side === 0 ? 'BUY' : 'SELL',
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
