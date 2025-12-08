'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { TransactionLink } from '@/components/common/TransactionLink';
import { useCancelOrder } from '@/hooks/useCancelOrder';
import { useClosePosition } from '@/hooks/useClosePosition';
import { useActiveOrders, type Order } from '@/hooks/useActiveOrders';
import { ORDER_TYPE_INFO } from '@/lib/orders';
import { BucketSide, type BucketSideType } from '@/lib/contracts/fheatherXv5Abi';

interface PositionItemProps {
  index: number;
  poolId: `0x${string}`;
  tick: number;
  side: BucketSideType;
  status: 'active' | 'filled' | 'partial';
  onClose: () => void;
  isClosing: boolean;
  closeTxHash: `0x${string}` | null;
}

function PositionItem({
  index,
  poolId,
  tick,
  side,
  status,
  onClose,
  isClosing,
  closeTxHash,
}: PositionItemProps) {
  // Convert tick to approximate price
  const price = Math.pow(1.0001, tick);
  const sideLabel = side === BucketSide.BUY ? 'Buy' : 'Sell';
  const sideIcon = side === BucketSide.BUY ? '📈' : '📉';

  return (
    <div
      className="flex items-center justify-between p-4 bg-ash-gray rounded-lg"
      data-testid={`order-row-${index}`}
    >
      <div className="flex items-center gap-4">
        <span className="text-2xl">{sideIcon}</span>
        <div>
          <p className="font-medium">Limit {sideLabel}</p>
          <p className="text-sm text-feather-white/60">
            Trigger: ${price.toFixed(4)} | Tick: {tick}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Badge variant={status === 'active' ? 'info' : status === 'filled' ? 'success' : 'warning'}>
          {status}
        </Badge>

        {isClosing && (
          <span data-testid="tx-pending" className="text-sm text-feather-white/60">
            Closing...
          </span>
        )}

        {closeTxHash && !isClosing && (
          <span data-testid="tx-success" className="text-sm text-electric-teal">
            Closed
          </span>
        )}

        {!isClosing && !closeTxHash && (
          <Button
            variant="danger"
            size="sm"
            onClick={onClose}
            data-testid="close-position-btn"
          >
            Close Position
          </Button>
        )}
      </div>
    </div>
  );
}

// Legacy Order Item for old order ID based system
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
        <span className="text-2xl">{typeInfo?.icon || '📋'}</span>
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

// Demo positions for UI testing (these would come from contract events in production)
interface DemoPosition {
  poolId: `0x${string}`;
  tick: number;
  side: BucketSideType;
  status: 'active' | 'filled' | 'partial';
}

export function OrderList() {
  const { orderIds, isLoading, refetch } = useActiveOrders();
  const { cancelOrder, isCancelling } = useCancelOrder();
  const { closePosition, isClosing, txHash: closeTxHash, reset: resetClose } = useClosePosition();

  // Track which position is being closed
  const [closingPositionKey, setClosingPositionKey] = useState<string | null>(null);

  // Demo positions - in production these would be fetched from contract events
  const [demoPositions] = useState<DemoPosition[]>([
    // Example positions for UI demonstration
    // { poolId: '0x...', tick: 100, side: BucketSide.BUY, status: 'active' },
  ]);

  const handleCancel = async (orderId: bigint) => {
    await cancelOrder(orderId);
    refetch();
  };

  const handleClosePosition = async (position: DemoPosition, index: number) => {
    const key = `${position.poolId}-${position.tick}-${position.side}`;
    setClosingPositionKey(key);

    try {
      await closePosition(position.poolId, position.tick, position.side);
      // In production: remove position from list or refetch
    } catch {
      // Error handled in hook
    } finally {
      setClosingPositionKey(null);
      resetClose();
    }
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

  const hasOrders = (orderIds && orderIds.length > 0) || demoPositions.length > 0;

  if (!hasOrders) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Active Orders</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-4xl mb-4">📋</p>
            <p className="text-feather-white/60">No active orders</p>
            <p className="text-sm text-feather-white/40 mt-2">
              Place an order to get started
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalCount = (orderIds?.length || 0) + demoPositions.length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Active Orders ({totalCount})</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* V5 Position-based orders */}
        {demoPositions.map((position, index) => {
          const key = `${position.poolId}-${position.tick}-${position.side}`;
          const isThisClosing = closingPositionKey === key && isClosing;
          const hasCloseTx = closingPositionKey === key && closeTxHash;

          return (
            <PositionItem
              key={key}
              index={index}
              poolId={position.poolId}
              tick={position.tick}
              side={position.side}
              status={position.status}
              onClose={() => handleClosePosition(position, index)}
              isClosing={isThisClosing}
              closeTxHash={hasCloseTx ? closeTxHash : null}
            />
          );
        })}

        {/* Legacy order ID-based orders */}
        {orderIds?.map((orderId, index) => (
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
