'use client';

import { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button, Skeleton, Badge } from '@/components/ui';
import { Loader2, X } from 'lucide-react';
import { useV3Position } from '@/hooks/useV3Position';
import { useV3Exit } from '@/hooks/useV3Exit';
import { BucketSide, deriveOrderType, ORDER_TYPE_CONFIG } from '@/types/bucket';
import { tickToPrice, formatPrice } from '@/lib/constants';

interface ActiveOrdersPanelProps {
  currentTick: number;
}

export function ActiveOrdersPanel({ currentTick }: ActiveOrdersPanelProps) {
  const { fetchAllPositions, getAllPositions, isLoading } = useV3Position();
  const { exit, isExiting, step: exitStep } = useV3Exit();

  // Fetch positions on mount
  useEffect(() => {
    fetchAllPositions();
  }, [fetchAllPositions]);

  const positions = getAllPositions();

  const handleExit = async (tick: number, side: BucketSide) => {
    await exit({ tick, side });
    // Refresh positions after exit
    fetchAllPositions();
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

  if (positions.length === 0) {
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
          <Badge variant="default">{positions.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Header */}
        <div className="grid grid-cols-6 gap-4 px-4 py-2 text-xs text-feather-white/40 border-b border-carbon-gray">
          <span>Type</span>
          <span>Price</span>
          <span>Tick</span>
          <span>Shares</span>
          <span>Status</span>
          <span className="text-right">Action</span>
        </div>

        {/* Positions */}
        <div className="divide-y divide-carbon-gray">
          {positions.map((position) => {
            const orderType = deriveOrderType(position.tick, position.side, currentTick);
            const config = orderType ? ORDER_TYPE_CONFIG[orderType] : null;
            const price = tickToPrice(position.tick);
            const priceDiff = ((Number(price) - Number(tickToPrice(currentTick))) / Number(tickToPrice(currentTick)) * 100);

            return (
              <div
                key={`${position.tick}-${position.side}`}
                className="grid grid-cols-6 gap-4 px-4 py-3 items-center hover:bg-ash-gray/30"
              >
                {/* Type */}
                <div>
                  <Badge variant={position.side === BucketSide.BUY ? 'success' : 'error'}>
                    {config?.label ?? (position.side === BucketSide.BUY ? 'BUY' : 'SELL')}
                  </Badge>
                </div>

                {/* Price */}
                <div className="font-mono">${formatPrice(price)}</div>

                {/* Tick */}
                <div className="text-feather-white/60">
                  {position.tick}
                  <span className="ml-1 text-xs">
                    ({priceDiff > 0 ? '+' : ''}{priceDiff.toFixed(1)}%)
                  </span>
                </div>

                {/* Shares (encrypted) */}
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
                    onClick={() => handleExit(position.tick, position.side)}
                    disabled={isExiting}
                    className="text-deep-magenta hover:text-deep-magenta"
                  >
                    {isExiting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <X className="w-4 h-4 mr-1" />
                        Exit
                      </>
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-4 pt-4 border-t border-carbon-gray text-xs text-feather-white/40 text-center">
          Share amounts are encrypted. Exit to claim proceeds and withdraw unfilled.
        </div>
      </CardContent>
    </Card>
  );
}
