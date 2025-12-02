'use client';

import { useAccount, useChainId, useReadContract } from 'wagmi';
import { PHEATHERX_ABI } from '@/lib/contracts/abi';
import { PHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { deriveOrderType, deriveOrderStatus, ORDER_TYPE_INFO } from '@/lib/orders';

export interface Order {
  id: bigint;
  owner: `0x${string}`;
  triggerTick: number;
  isBuy: boolean;
  isLimit: boolean;
  slippageBps: number;
  filled: boolean;
  cancelled: boolean;
  // Derived fields
  orderType: string;
  orderTypeLabel: string;
  status: string;
}

export function useActiveOrders() {
  const { address } = useAccount();
  const chainId = useChainId();
  const hookAddress = PHEATHERX_ADDRESSES[chainId];

  const { data: orderIds, isLoading: isLoadingIds, refetch } = useReadContract({
    address: hookAddress,
    abi: PHEATHERX_ABI,
    functionName: 'getActiveOrders',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!hookAddress },
  });

  // For each order ID, we'd need to fetch the order details
  // In production, you'd batch these calls or use a multicall
  const orders: Order[] = [];

  // If we have order IDs, we can fetch details (simplified version)
  // In production, implement proper batching

  return {
    orders,
    orderIds: orderIds as bigint[] | undefined,
    isLoading: isLoadingIds,
    refetch,
  };
}
