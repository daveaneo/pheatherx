'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui';
import { Plus, Minus } from 'lucide-react';
import { useSelectedPool } from '@/stores/poolStore';
import {
  TICK_SPACING,
  tickToPrice,
  formatPrice,
  MIN_TICK,
  MAX_TICK,
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

// Number of price levels to show above and below current price
const LEVELS_PER_SIDE = 10;

export function OrderBookPanel({
  currentTick,
  currentPrice,
  isLoading,
  onCreateOrder,
}: QuickLimitOrderPanelProps) {
  const [granularity, setGranularity] = useState<GranularityOption>(2);
  const { token0, token1 } = useSelectedPool();

  // Generate price levels based on granularity
  // Always show LEVELS_PER_SIDE levels above and below current price
  const priceLevels = useMemo(() => {
    const levelsAbove: PriceLevelRow[] = [];
    const levelsBelow: PriceLevelRow[] = [];

    // Generate 10 levels above and 10 below, stepping by granularity %
    for (let i = 1; i <= LEVELS_PER_SIDE; i++) {
      const pct = i * granularity;
      const tickDelta = percentageToTickDelta(pct);

      // Level above current price
      const tickAbove = currentTick + tickDelta;
      if (tickAbove >= MIN_TICK && tickAbove <= MAX_TICK) {
        levelsAbove.push({
          tick: tickAbove,
          price: formatPrice(tickToPrice(tickAbove)),
          percentDiff: pct,
          isAbove: true,
        });
      }

      // Level below current price
      const tickBelow = currentTick - tickDelta;
      if (tickBelow >= MIN_TICK && tickBelow <= MAX_TICK) {
        levelsBelow.push({
          tick: tickBelow,
          price: formatPrice(tickToPrice(tickBelow)),
          percentDiff: -pct,
          isAbove: false,
        });
      }
    }

    return { levelsAbove, levelsBelow };
  }, [currentTick, granularity]);

  // Reverse levelsAbove so highest is at top
  const levelsAbove = [...priceLevels.levelsAbove].reverse();
  const levelsBelow = priceLevels.levelsBelow;

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
        <div className="grid grid-cols-[50px_1fr_70px_55px] px-3 py-2 text-xs text-muted-foreground border-b">
          <span className="text-center">Action</span>
          <span className="text-center">Price</span>
          <span className="text-center">Tick</span>
          <span className="text-right">% Diff</span>
        </div>

        {/* Levels Above (sell territory) */}
        <div className="max-h-[200px] overflow-auto">
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
        <div className="grid grid-cols-[50px_1fr_70px_55px] px-3 py-2 bg-muted/50 border-y items-center">
          <span className="text-xs text-muted-foreground text-center">Current</span>
          <span className="font-mono font-bold text-sm text-center">
            ${currentPrice?.priceFormatted ?? formatPrice(tickToPrice(currentTick))}
          </span>
          <span className="text-xs text-muted-foreground text-center font-mono">
            {currentTick}
          </span>
          <span className="text-xs text-right">0%</span>
        </div>

        {/* Levels Below (buy territory) */}
        <div className="max-h-[200px] overflow-auto">
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
      className={`grid grid-cols-[50px_1fr_70px_55px] px-3 py-1.5 text-sm hover:bg-muted/30 transition-colors items-center ${
        isAbove ? 'text-red-400/80' : 'text-green-400/80'
      }`}
    >
      {/* Action Buttons */}
      <div className="flex gap-1 justify-center">
        <button
          onClick={onSell}
          className="w-5 h-5 rounded flex items-center justify-center bg-red-500/20 hover:bg-red-500/40 text-red-500 transition-colors"
          title={`Sell at $${level.price}`}
        >
          <Minus className="w-3 h-3" />
        </button>
        <button
          onClick={onBuy}
          className="w-5 h-5 rounded flex items-center justify-center bg-green-500/20 hover:bg-green-500/40 text-green-500 transition-colors"
          title={`Buy at $${level.price}`}
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* Price */}
      <span className="font-mono text-center text-feather-white text-xs">${level.price}</span>

      {/* Tick */}
      <span className="font-mono text-center text-muted-foreground text-xs">{level.tick}</span>

      {/* Percent Diff */}
      <span className="text-right text-xs">
        {level.percentDiff > 0 ? '+' : ''}{level.percentDiff}%
      </span>
    </div>
  );
}
