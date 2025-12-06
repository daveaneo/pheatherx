'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui';
import { BucketSide } from '@/types/bucket';
import {
  TICK_SPACING,
  ORDER_BOOK_TICKS_VISIBLE,
  tickToPrice,
  formatPrice,
} from '@/lib/constants';

interface OrderBookPanelProps {
  currentTick: number;
  isLoading: boolean;
}

interface OrderBookRow {
  tick: number;
  side: BucketSide;
  price: string;
  percentDiff: string;
}

export function OrderBookPanel({ currentTick, isLoading }: OrderBookPanelProps) {
  // Generate order book rows around current tick
  const orderBook = useMemo(() => {
    const sellOrders: OrderBookRow[] = [];
    const buyOrders: OrderBookRow[] = [];

    // SELL orders above current price
    for (let i = ORDER_BOOK_TICKS_VISIBLE; i >= 1; i--) {
      const tick = currentTick + i * TICK_SPACING;
      const price = tickToPrice(tick);
      const currentPrice = tickToPrice(currentTick);
      const percentDiff = ((Number(price) - Number(currentPrice)) / Number(currentPrice) * 100).toFixed(1);

      sellOrders.push({
        tick,
        side: BucketSide.SELL,
        price: formatPrice(price),
        percentDiff: `+${percentDiff}%`,
      });
    }

    // BUY orders below current price
    for (let i = 1; i <= ORDER_BOOK_TICKS_VISIBLE; i++) {
      const tick = currentTick - i * TICK_SPACING;
      const price = tickToPrice(tick);
      const currentPrice = tickToPrice(currentTick);
      const percentDiff = ((Number(price) - Number(currentPrice)) / Number(currentPrice) * 100).toFixed(1);

      buyOrders.push({
        tick,
        side: BucketSide.BUY,
        price: formatPrice(price),
        percentDiff: `${percentDiff}%`,
      });
    }

    return { sellOrders, buyOrders };
  }, [currentTick]);

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Order Book</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center justify-between">
          <span>Order Book</span>
          <span className="text-xs text-muted-foreground">Encrypted Depth</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {/* Header */}
        <div className="grid grid-cols-3 px-4 py-2 text-xs text-muted-foreground border-b">
          <span>Price</span>
          <span className="text-center">Tick</span>
          <span className="text-right">% Diff</span>
        </div>

        {/* Sell Orders (above current) */}
        <div className="max-h-48 overflow-auto">
          {orderBook.sellOrders.map((order) => (
            <OrderBookRow
              key={`sell-${order.tick}`}
              {...order}
              isSell
            />
          ))}
        </div>

        {/* Current Price Divider */}
        <div className="px-4 py-2 bg-muted/50 border-y">
          <div className="flex items-center justify-between">
            <span className="font-mono font-bold">
              ${formatPrice(tickToPrice(currentTick))}
            </span>
            <span className="text-sm text-muted-foreground">
              Current ({currentTick})
            </span>
          </div>
        </div>

        {/* Buy Orders (below current) */}
        <div className="max-h-48 overflow-auto">
          {orderBook.buyOrders.map((order) => (
            <OrderBookRow
              key={`buy-${order.tick}`}
              {...order}
              isSell={false}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t text-xs text-muted-foreground text-center">
          Liquidity amounts are encrypted
        </div>
      </CardContent>
    </Card>
  );
}

function OrderBookRow({
  tick,
  price,
  percentDiff,
  isSell,
}: OrderBookRow & { isSell: boolean }) {
  return (
    <div
      className={`grid grid-cols-3 px-4 py-1.5 text-sm hover:bg-muted/50 cursor-pointer transition-colors ${
        isSell ? 'text-red-500' : 'text-green-500'
      }`}
    >
      <span className="font-mono">${price}</span>
      <span className="text-center text-muted-foreground">{tick}</span>
      <span className="text-right">{percentDiff}</span>
    </div>
  );
}
