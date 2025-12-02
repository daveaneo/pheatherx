'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { TransactionLink } from '@/components/common/TransactionLink';
import { useOrderHistory, type HistoricalOrder } from '@/hooks/useOrderHistory';

function getStatusVariant(status: string): 'success' | 'error' | 'info' {
  switch (status) {
    case 'filled':
      return 'success';
    case 'cancelled':
      return 'error';
    default:
      return 'info';
  }
}

interface OrderHistoryItemProps {
  order: HistoricalOrder;
}

function OrderHistoryItem({ order }: OrderHistoryItemProps) {
  // Convert tick to approximate price
  const price = Math.pow(1.0001, order.triggerTick);

  return (
    <div className="flex items-center justify-between p-4 bg-ash-gray rounded-lg">
      <div>
        <div className="flex items-center gap-2">
          <p className="font-medium">Order #{order.orderId.toString()}</p>
          <Badge variant={getStatusVariant(order.status)}>
            {order.status}
          </Badge>
        </div>
        <p className="text-sm text-feather-white/60 mt-1">
          Trigger: {price.toFixed(4)} | Block: {order.blockNumber.toString()}
        </p>
        {order.executor && (
          <p className="text-sm text-feather-white/40 mt-1">
            Executed by: {order.executor.slice(0, 6)}...{order.executor.slice(-4)}
          </p>
        )}
      </div>
      <TransactionLink hash={order.transactionHash} />
    </div>
  );
}

export function OrderHistoryList() {
  const { data: orders, isLoading, error } = useOrderHistory();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Order History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Order History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-deep-magenta">Failed to load order history</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!orders || orders.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Order History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-4xl mb-4">&#x1F4DC;</p>
            <p className="text-feather-white/60">No order history</p>
            <p className="text-sm text-feather-white/40 mt-2">
              Your past orders will appear here
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Order History ({orders.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {orders.map((order) => (
          <OrderHistoryItem key={order.orderId.toString()} order={order} />
        ))}
      </CardContent>
    </Card>
  );
}
