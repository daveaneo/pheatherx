'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { TransactionLink } from '@/components/common/TransactionLink';
import { useCancelOrder } from '@/hooks/useCancelOrder';
import { useActiveOrders, type Order } from '@/hooks/useActiveOrders';
import { ORDER_TYPE_INFO } from '@/lib/orders';

interface OrderItemProps {
  orderId: bigint;
  orderType: string;
  triggerTick: number;
  status: string;
  onCancel: () => void;
  isCancelling: boolean;
}

function OrderItem({
  orderId,
  orderType,
  triggerTick,
  status,
  onCancel,
  isCancelling,
}: OrderItemProps) {
  const typeInfo = ORDER_TYPE_INFO[orderType as keyof typeof ORDER_TYPE_INFO];

  // Convert tick to approximate price
  const price = Math.pow(1.0001, triggerTick);

  return (
    <div className="flex items-center justify-between p-4 bg-ash-gray rounded-lg">
      <div className="flex items-center gap-4">
        <span className="text-2xl">{typeInfo?.icon || '&#x1F4CB;'}</span>
        <div>
          <p className="font-medium">{typeInfo?.label || orderType}</p>
          <p className="text-sm text-feather-white/60">
            Trigger: {price.toFixed(4)} | ID: {orderId.toString()}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Badge variant={status === 'active' ? 'info' : 'default'}>
          {status}
        </Badge>
        {status === 'active' && (
          <Button
            variant="danger"
            size="sm"
            onClick={onCancel}
            loading={isCancelling}
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

export function OrderList() {
  const { orderIds, isLoading, refetch } = useActiveOrders();
  const { cancelOrder, isCancelling } = useCancelOrder();

  const handleCancel = async (orderId: bigint) => {
    await cancelOrder(orderId);
    refetch();
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Active Orders</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </CardContent>
      </Card>
    );
  }

  if (!orderIds || orderIds.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Active Orders</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-4xl mb-4">&#x1F4CB;</p>
            <p className="text-feather-white/60">No active orders</p>
            <p className="text-sm text-feather-white/40 mt-2">
              Place an order to get started
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Active Orders ({orderIds.length})</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {orderIds.map((orderId) => (
          <OrderItem
            key={orderId.toString()}
            orderId={orderId}
            orderType="limit-buy" // Would be fetched from order details
            triggerTick={0} // Would be fetched from order details
            status="active"
            onCancel={() => handleCancel(orderId)}
            isCancelling={isCancelling}
          />
        ))}
      </CardContent>
    </Card>
  );
}
