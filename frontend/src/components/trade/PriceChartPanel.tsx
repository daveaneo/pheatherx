'use client';

import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { useSelectedPool } from '@/stores/poolStore';
import { formatUnits } from 'viem';
import type { CurrentPrice } from '@/types/bucket';

interface PriceChartPanelProps {
  currentPrice: CurrentPrice | null;
  currentTick: number;
  isLoading: boolean;
  zeroForOne: boolean;
}

export function PriceChartPanel({
  currentPrice,
  currentTick,
  isLoading,
  zeroForOne,
}: PriceChartPanelProps) {
  const { token0, token1 } = useSelectedPool();

  // Swap base/quote based on direction
  const baseToken = zeroForOne ? token0 : token1;
  const quoteToken = zeroForOne ? token1 : token0;
  const pairLabel = baseToken && quoteToken ? `${baseToken.symbol}/${quoteToken.symbol}` : '';

  // Calculate price display - show reciprocal when direction is flipped
  const rawPrice = currentPrice?.priceFormatted ? parseFloat(currentPrice.priceFormatted) : 1;
  const displayPrice = zeroForOne ? rawPrice : (rawPrice > 0 ? 1 / rawPrice : 0);
  const priceDisplay = displayPrice.toFixed(4);

  const tickDisplay = currentTick ?? 0;
  const isPositiveTick = zeroForOne ? tickDisplay >= 0 : tickDisplay <= 0;

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center justify-between">
          <span>Current Price</span>
          {pairLabel && <span className="text-xs text-muted-foreground">{pairLabel}</span>}
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
                {priceDisplay} <span className="text-lg text-muted-foreground">{quoteToken?.symbol ?? ''}</span>
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
        {currentPrice && token0 && token1 && (
          <div className="grid grid-cols-2 gap-4 pt-2 border-t">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">{token0.symbol}</p>
              <p className="font-mono text-sm">
                {parseFloat(formatUnits(currentPrice.reserve0, token0.decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">{token1.symbol}</p>
              <p className="font-mono text-sm">
                {parseFloat(formatUnits(currentPrice.reserve1, token1.decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
