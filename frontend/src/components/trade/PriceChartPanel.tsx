'use client';

import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui';
import { TrendingUp, TrendingDown } from 'lucide-react';
import type { CurrentPrice } from '@/types/bucket';
import { formatPrice, tickToPrice } from '@/lib/constants';

interface PriceChartPanelProps {
  currentPrice: CurrentPrice | null;
  currentTick: number;
  isLoading: boolean;
}

export function PriceChartPanel({
  currentPrice,
  currentTick,
  isLoading,
}: PriceChartPanelProps) {
  // Calculate price display
  const priceDisplay = currentPrice?.priceFormatted ?? '1.0000';
  const tickDisplay = currentTick ?? 0;
  const isPositiveTick = tickDisplay >= 0;

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center justify-between">
          <span>Current Price</span>
          <span className="text-xs text-muted-foreground">tWETH/tUSDC</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Price Display */}
        <div className="text-center py-4">
          {isLoading ? (
            <Skeleton className="h-12 w-32 mx-auto" />
          ) : (
            <>
              <div className="text-4xl font-bold tracking-tight">
                ${priceDisplay}
              </div>
              <div className={`flex items-center justify-center gap-1 mt-2 text-sm ${
                isPositiveTick ? 'text-green-500' : 'text-red-500'
              }`}>
                {isPositiveTick ? (
                  <TrendingUp className="w-4 h-4" />
                ) : (
                  <TrendingDown className="w-4 h-4" />
                )}
                <span>Tick {tickDisplay}</span>
              </div>
            </>
          )}
        </div>

        {/* Chart Placeholder */}
        <div className="relative h-48 bg-muted/30 rounded-lg border border-dashed border-muted-foreground/25 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <svg
              className="mx-auto h-12 w-12 mb-2 opacity-50"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"
              />
            </svg>
            <p className="text-sm">Price chart coming soon</p>
            <p className="text-xs mt-1">TradingView integration planned</p>
          </div>
        </div>

        {/* Reserve Info */}
        {currentPrice && (
          <div className="grid grid-cols-2 gap-4 pt-2 border-t">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Reserve 0</p>
              <p className="font-mono text-sm">
                {Number(currentPrice.reserve0 / BigInt(1e14)) / 10000}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Reserve 1</p>
              <p className="font-mono text-sm">
                {Number(currentPrice.reserve1 / BigInt(1e14)) / 10000}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
