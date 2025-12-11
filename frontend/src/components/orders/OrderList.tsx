'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { useCancelOrder } from '@/hooks/useCancelOrder';
import { useActiveOrders, type ActivePosition } from '@/hooks/useActiveOrders';
import { tickToPrice, formatPrice } from '@/lib/constants';

interface PositionItemProps {
  position: ActivePosition;
  onWithdraw: () => void;
  isWithdrawing: boolean;
}

function PositionItem({
  position,
  onWithdraw,
  isWithdrawing,
}: PositionItemProps) {
  const price = tickToPrice(position.tick);
  const priceFormatted = formatPrice(price);
  const sideIcon = position.side === 0 ? '📈' : '📉';

  return (
    <div
      className="flex items-center justify-between p-4 bg-ash-gray rounded-lg"
      data-testid={`order-row-${position.tick}-${position.side}`}
    >
      <div className="flex items-center gap-4">
        <span className="text-2xl">{sideIcon}</span>
        <div>
          <p className="font-medium">Limit {position.sideLabel}</p>
          <p className="text-sm text-feather-white/60">
            Price: {priceFormatted} | Tick: {position.tick}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Badge variant="info">Active</Badge>
        <Button
          variant="danger"
          size="sm"
          onClick={onWithdraw}
          loading={isWithdrawing}
          data-testid="withdraw-btn"
        >
          Withdraw
        </Button>
      </div>
    </div>
  );
}

export function OrderList() {
  const { positions, isLoading, refetch } = useActiveOrders();
  const { withdraw, isCancelling, step } = useCancelOrder();

  // Track which position is being withdrawn
  const [withdrawingKey, setWithdrawingKey] = useState<string | null>(null);

  const handleWithdraw = async (position: ActivePosition) => {
    const key = `${position.tick}-${position.side}`;
    setWithdrawingKey(key);

    try {
      await withdraw(position.poolId, position.tick, position.side);
      refetch();
    } catch {
      // Error handled in hook
    } finally {
      setWithdrawingKey(null);
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

  const hasOrders = positions && positions.length > 0;

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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Active Orders ({positions.length})</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {positions.map((position) => {
          const key = `${position.tick}-${position.side}`;
          const isThisWithdrawing = withdrawingKey === key && isCancelling;

          return (
            <PositionItem
              key={key}
              position={position}
              onWithdraw={() => handleWithdraw(position)}
              isWithdrawing={isThisWithdrawing}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}
