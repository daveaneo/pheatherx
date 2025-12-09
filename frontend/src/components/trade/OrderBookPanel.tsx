'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui';
import { Plus, Minus } from 'lucide-react';
import { useSelectedPool } from '@/stores/poolStore';
import {
  TICK_SPACING,
  tickToPrice,
  formatPrice,
  isValidTick,
} from '@/lib/constants';
import type { CurrentPrice } from '@/types/bucket';

interface QuickLimitOrderPanelProps {
  currentTick: number;
  currentPrice: CurrentPrice | null;
  isLoading: boolean;
  onCreateOrder?: (tick: number, isBuy: boolean) => void;
}

type GranularityOption = 1 | 2 | 5 | 10;

interface PriceLevelRow {
  tick: number;
  price: string;
  percentDiff: number;
  isAbove: boolean;
}

// Convert percentage to approximate tick delta
// Using tick base of 1.0001: pct = (1.0001^tick - 1) * 100
// So tick ≈ log(1 + pct/100) / log(1.0001)
function percentageToTickDelta(pct: number): number {
  const ratio = 1 + pct / 100;
  const tickDelta = Math.log(ratio) / Math.log(1.0001);
  // Round to nearest TICK_SPACING
  return Math.round(tickDelta / TICK_SPACING) * TICK_SPACING;
}

export function OrderBookPanel({
  currentTick,
  currentPrice,
  isLoading,
  onCreateOrder,
}: QuickLimitOrderPanelProps) {
  const [granularity, setGranularity] = useState<GranularityOption>(2);
  const { token0, token1 } = useSelectedPool();

  // Generate price levels based on granularity
  const priceLevels = useMemo(() => {
    const levels: PriceLevelRow[] = [];
    const currentPriceBigInt = tickToPrice(currentTick);

    // Generate percentage steps based on granularity
    const getPercentages = (gran: GranularityOption): number[] => {
      switch (gran) {
        case 1:
          return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        case 2:
          return [2, 4, 6, 8, 10];
        case 5:
          return [5, 10, 15, 20, 25];
        case 10:
          return [10, 20, 30, 40, 50];
        default:
          return [2, 4, 6, 8, 10];
      }
    };

    const percentages = getPercentages(granularity);

    // Add levels above current price (in descending order so highest is at top)
    for (let i = percentages.length - 1; i >= 0; i--) {
      const pct = percentages[i];
      const tickDelta = percentageToTickDelta(pct);
      const tick = currentTick + tickDelta;
      if (!isValidTick(tick)) continue;

      const price = tickToPrice(tick);
      levels.push({
        tick,
        price: formatPrice(price),
        percentDiff: pct,
        isAbove: true,
      });
    }

    // Add levels below current price
    for (const pct of percentages) {
      const tickDelta = percentageToTickDelta(pct);
      const tick = currentTick - tickDelta;
      if (!isValidTick(tick)) continue;

      const price = tickToPrice(tick);
      levels.push({
        tick,
        price: formatPrice(price),
        percentDiff: -pct,
        isAbove: false,
      });
    }

    return levels;
  }, [currentTick, granularity]);

  // Split into above and below current price
  const levelsAbove = priceLevels.filter(l => l.isAbove);
  const levelsBelow = priceLevels.filter(l => !l.isAbove);

  const handleOrderClick = (tick: number, isBuy: boolean) => {
    if (onCreateOrder) {
      onCreateOrder(tick, isBuy);
    }
  };

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Quick Limit Order</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
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
          <span>Quick Limit Order</span>
          {/* Granularity Selector */}
          <div className="flex gap-1">
            {([1, 2, 5, 10] as GranularityOption[]).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  granularity === g
                    ? 'bg-phoenix-ember text-white'
                    : 'bg-carbon-gray/50 text-feather-white/60 hover:bg-carbon-gray'
                }`}
              >
                {g}%
              </button>
            ))}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {/* Header */}
        <div className="grid grid-cols-[60px_1fr_60px] px-3 py-2 text-xs text-muted-foreground border-b">
          <span className="text-center">Action</span>
          <span className="text-center">Price</span>
          <span className="text-right">% Diff</span>
        </div>

        {/* Levels Above (sell territory) */}
        <div className="max-h-40 overflow-auto">
          {levelsAbove.map((level) => (
            <PriceLevelRow
              key={`above-${level.tick}`}
              level={level}
              onBuy={() => handleOrderClick(level.tick, true)}
              onSell={() => handleOrderClick(level.tick, false)}
            />
          ))}
        </div>

        {/* Current Price Divider */}
        <div className="px-3 py-2 bg-muted/50 border-y">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Current</span>
            <span className="font-mono font-bold text-sm">
              ${currentPrice?.priceFormatted ?? formatPrice(tickToPrice(currentTick))}
            </span>
            <span className="text-xs text-muted-foreground">
              Tick {currentTick}
            </span>
          </div>
        </div>

        {/* Levels Below (buy territory) */}
        <div className="max-h-40 overflow-auto">
          {levelsBelow.map((level) => (
            <PriceLevelRow
              key={`below-${level.tick}`}
              level={level}
              onBuy={() => handleOrderClick(level.tick, true)}
              onSell={() => handleOrderClick(level.tick, false)}
            />
          ))}
        </div>

        {/* Footer Legend */}
        <div className="px-3 py-2 border-t text-xs text-muted-foreground">
          <div className="flex justify-between items-center">
            <span className="flex items-center gap-1">
              <span className="w-4 h-4 rounded bg-green-500/20 flex items-center justify-center text-green-500">+</span>
              Buy {token0?.symbol ?? 'Token0'}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-4 h-4 rounded bg-red-500/20 flex items-center justify-center text-red-500">−</span>
              Sell {token0?.symbol ?? 'Token0'}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PriceLevelRow({
  level,
  onBuy,
  onSell,
}: {
  level: PriceLevelRow;
  onBuy: () => void;
  onSell: () => void;
}) {
  const isAbove = level.isAbove;

  return (
    <div
      className={`grid grid-cols-[60px_1fr_60px] px-3 py-1.5 text-sm hover:bg-muted/30 transition-colors items-center ${
        isAbove ? 'text-red-400/80' : 'text-green-400/80'
      }`}
    >
      {/* Action Buttons */}
      <div className="flex gap-1 justify-center">
        <button
          onClick={onSell}
          className="w-6 h-6 rounded flex items-center justify-center bg-red-500/20 hover:bg-red-500/40 text-red-500 transition-colors"
          title={`Sell at $${level.price}`}
        >
          <Minus className="w-3 h-3" />
        </button>
        <button
          onClick={onBuy}
          className="w-6 h-6 rounded flex items-center justify-center bg-green-500/20 hover:bg-green-500/40 text-green-500 transition-colors"
          title={`Buy at $${level.price}`}
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* Price */}
      <span className="font-mono text-center text-feather-white">${level.price}</span>

      {/* Percent Diff */}
      <span className="text-right">
        {level.percentDiff > 0 ? '+' : ''}{level.percentDiff}%
      </span>
    </div>
  );
}
