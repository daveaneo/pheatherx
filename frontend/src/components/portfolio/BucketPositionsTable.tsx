'use client';

import { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button, Badge, Skeleton } from '@/components/ui';
import { Loader2, X, Eye } from 'lucide-react';
import { useV3Position } from '@/hooks/useV3Position';
import { useV3Exit } from '@/hooks/useV3Exit';
import { useCurrentPrice } from '@/hooks/useCurrentPrice';
import { BucketSide, deriveOrderType, ORDER_TYPE_CONFIG } from '@/types/bucket';
import { tickToPrice, formatPrice } from '@/lib/constants';

/**
 * Displays all user bucket positions with exit functionality
 */
export function BucketPositionsTable() {
  const { fetchAllPositions, getAllPositions, isLoading } = useV3Position();
  const { exit, isExiting } = useV3Exit();
  const { currentTick } = useCurrentPrice();

  useEffect(() => {
    fetchAllPositions();
  }, [fetchAllPositions]);

  const positions = getAllPositions();

  const handleExit = async (tick: number, side: BucketSide) => {
    await exit({ tick, side });
    fetchAllPositions();
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Positions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
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
          <CardTitle>Your Positions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-feather-white/40">
            <p className="text-lg mb-2">No active positions</p>
            <p className="text-sm">Place limit orders on the Trade page to create positions</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Your Positions</span>
          <Badge variant="default">{positions.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Table Header */}
        <div className="grid grid-cols-5 gap-4 px-4 py-2 text-xs text-feather-white/40 border-b border-carbon-gray">
          <span>Type</span>
          <span>Price / Tick</span>
          <span>Shares</span>
          <span>Status</span>
          <span className="text-right">Action</span>
        </div>

        {/* Position Rows */}
        <div className="divide-y divide-carbon-gray">
          {positions.map((position) => {
            const orderType = deriveOrderType(position.tick, position.side, currentTick);
            const config = orderType ? ORDER_TYPE_CONFIG[orderType] : null;
            const price = tickToPrice(position.tick);
            const priceDiff = ((Number(price) - Number(tickToPrice(currentTick))) / Number(tickToPrice(currentTick)) * 100);
            const isBuy = position.side === BucketSide.BUY;

            return (
              <div
                key={`${position.tick}-${position.side}`}
                className="grid grid-cols-5 gap-4 px-4 py-4 items-center hover:bg-ash-gray/20"
              >
                {/* Type */}
                <div className="flex items-center gap-2">
                  <Badge variant={isBuy ? 'success' : 'error'}>
                    {config?.label ?? (isBuy ? 'BUY' : 'SELL')}
                  </Badge>
                </div>

                {/* Price / Tick */}
                <div>
                  <div className="font-mono text-feather-white">${formatPrice(price)}</div>
                  <div className="text-xs text-feather-white/40">
                    Tick {position.tick} ({priceDiff > 0 ? '+' : ''}{priceDiff.toFixed(1)}%)
                  </div>
                </div>

                {/* Shares (encrypted) */}
                <div className="flex items-center gap-2">
                  <span className="font-mono text-feather-white/60">••••••</span>
                  <Button variant="secondary" size="sm" className="p-1 h-6 w-6">
                    <Eye className="w-3 h-3" />
                  </Button>
                </div>

                {/* Status */}
                <div>
                  <Badge variant="default">Active</Badge>
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
          Share amounts are encrypted. Use the reveal button to decrypt.
          <br />
          Exit will claim proceeds and withdraw unfilled liquidity.
        </div>
      </CardContent>
    </Card>
  );
}
