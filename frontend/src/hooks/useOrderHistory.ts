'use client';

import { useAccount, useChainId, usePublicClient } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { PHEATHERX_ABI } from '@/lib/contracts/abi';
import { PHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { orderHistoryKey } from '@/lib/queryKeys';
import type { OrderPlacedEvent, OrderFilledEvent, OrderCancelledEvent } from '@/types/events';

export interface HistoricalOrder {
  orderId: bigint;
  owner: `0x${string}`;
  triggerTick: number;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  timestamp?: number;
  status: 'placed' | 'filled' | 'cancelled';
  executor?: `0x${string}`;
}

export function useOrderHistory(fromBlock?: bigint) {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const hookAddress = PHEATHERX_ADDRESSES[chainId];

  return useQuery({
    queryKey: orderHistoryKey(chainId, address),
    queryFn: async (): Promise<HistoricalOrder[]> => {
      if (!publicClient || !address || !hookAddress) return [];

      const defaultFromBlock = fromBlock ?? 0n;

      // Fetch all order events
      const [placedLogs, filledLogs, cancelledLogs] = await Promise.all([
        publicClient.getLogs({
          address: hookAddress,
          event: {
            type: 'event',
            name: 'OrderPlaced',
            inputs: [
              { type: 'uint256', name: 'orderId', indexed: true },
              { type: 'address', name: 'owner', indexed: true },
              { type: 'int24', name: 'triggerTick', indexed: false },
            ],
          },
          args: { owner: address },
          fromBlock: defaultFromBlock,
        }),
        publicClient.getLogs({
          address: hookAddress,
          event: {
            type: 'event',
            name: 'OrderFilled',
            inputs: [
              { type: 'uint256', name: 'orderId', indexed: true },
              { type: 'address', name: 'owner', indexed: true },
              { type: 'address', name: 'executor', indexed: false },
            ],
          },
          args: { owner: address },
          fromBlock: defaultFromBlock,
        }),
        publicClient.getLogs({
          address: hookAddress,
          event: {
            type: 'event',
            name: 'OrderCancelled',
            inputs: [
              { type: 'uint256', name: 'orderId', indexed: true },
              { type: 'address', name: 'owner', indexed: true },
            ],
          },
          args: { owner: address },
          fromBlock: defaultFromBlock,
        }),
      ]);

      // Create maps for filled and cancelled orders
      const filledMap = new Map<string, { executor: `0x${string}`; blockNumber: bigint }>();
      const cancelledMap = new Map<string, bigint>();

      filledLogs.forEach(log => {
        const orderId = (log.args as any).orderId?.toString();
        if (orderId) {
          filledMap.set(orderId, {
            executor: (log.args as any).executor,
            blockNumber: log.blockNumber,
          });
        }
      });

      cancelledLogs.forEach(log => {
        const orderId = (log.args as any).orderId?.toString();
        if (orderId) {
          cancelledMap.set(orderId, log.blockNumber);
        }
      });

      // Build historical orders from placed events
      const orders: HistoricalOrder[] = placedLogs.map(log => {
        const orderId = (log.args as any).orderId as bigint;
        const orderIdStr = orderId.toString();
        const filled = filledMap.get(orderIdStr);
        const cancelled = cancelledMap.get(orderIdStr);

        let status: 'placed' | 'filled' | 'cancelled' = 'placed';
        if (filled) status = 'filled';
        else if (cancelled) status = 'cancelled';

        return {
          orderId,
          owner: (log.args as any).owner,
          triggerTick: (log.args as any).triggerTick,
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          status,
          executor: filled?.executor,
        };
      });

      // Sort by block number descending (most recent first)
      return orders.sort((a, b) => Number(b.blockNumber - a.blockNumber));
    },
    enabled: !!publicClient && !!address && !!hookAddress,
    staleTime: 30_000, // 30 seconds
  });
}
