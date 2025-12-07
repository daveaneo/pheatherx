'use client';

import { Card, CardContent, CardHeader, CardTitle, Button, Skeleton, Badge } from '@/components/ui';
import { Loader2, X } from 'lucide-react';
import { useActiveOrders } from '@/hooks/useActiveOrders';
import { useCancelOrder } from '@/hooks/useCancelOrder';
import { tickToPrice, formatPrice } from '@/lib/constants';

interface ActiveOrdersPanelProps {
  currentTick: number;
}

export function ActiveOrdersPanel({ currentTick }: ActiveOrdersPanelProps) {
  const { orderIds, isLoading, refetch } = useActiveOrders();
  const { cancelOrder, isCancelling } = useCancelOrder();

  const handleCancel = async (orderId: bigint) => {
    try {
      await cancelOrder(orderId);
      // Refresh orders after cancel
      refetch();
    } catch (err) {
      console.error('Cancel failed:', err);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Active Orders</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasOrders = orderIds && orderIds.length > 0;

  if (!hasOrders) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Active Orders</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-feather-white/40">
            <p>No active orders</p>
            <p className="text-sm mt-1">Place a limit order above to get started</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Your Active Orders</span>
          <Badge variant="default">{orderIds?.length ?? 0}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Header */}
        <div className="grid grid-cols-4 gap-4 px-4 py-2 text-xs text-feather-white/40 border-b border-carbon-gray">
          <span>Order ID</span>
          <span>Amount</span>
          <span>Status</span>
          <span className="text-right">Action</span>
        </div>

        {/* Orders */}
        <div className="divide-y divide-carbon-gray">
          {orderIds?.map((orderId) => (
            <div
              key={orderId.toString()}
              className="grid grid-cols-4 gap-4 px-4 py-3 items-center hover:bg-ash-gray/30"
            >
              {/* Order ID */}
              <div className="font-mono">#{orderId.toString()}</div>

              {/* Amount (encrypted) */}
              <div className="font-mono text-feather-white/40">
                ******
              </div>

              {/* Status */}
              <div>
                <Badge variant="default">
                  Active
                </Badge>
              </div>

              {/* Action */}
              <div className="text-right">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleCancel(orderId)}
                  disabled={isCancelling}
                  className="text-deep-magenta hover:text-deep-magenta"
                >
                  {isCancelling ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <X className="w-4 h-4 mr-1" />
                      Cancel
                    </>
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-4 pt-4 border-t border-carbon-gray text-xs text-feather-white/40 text-center">
          Order amounts are encrypted. Cancel to retrieve your funds.
        </div>
      </CardContent>
    </Card>
  );
}
