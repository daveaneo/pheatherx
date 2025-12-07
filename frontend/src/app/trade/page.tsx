'use client';

import { useMemo } from 'react';
import { PriceChartPanel } from '@/components/trade/PriceChartPanel';
import { OrderBookPanel } from '@/components/trade/OrderBookPanel';
import { ExecutionPanel } from '@/components/trade/ExecutionPanel';
import { ActiveOrdersPanel } from '@/components/trade/ActiveOrdersPanel';
import { PoolSelector } from '@/components/pool/PoolSelector';
import { Badge } from '@/components/ui';
import { useCurrentPrice } from '@/hooks/useCurrentPrice';
import { useSelectedPool } from '@/stores/poolStore';

// Pool type indicator showing FHERC20/ERC20 status
function PoolTypeBadge() {
  const { token0, token1 } = useSelectedPool();

  const poolTypeInfo = useMemo(() => {
    if (!token0 || !token1) {
      return { type: 'Unknown', isFullyPrivate: false };
    }

    const t0Type = token0.symbol.startsWith('fhe') ? 'FHERC20' : 'ERC20';
    const t1Type = token1.symbol.startsWith('fhe') ? 'FHERC20' : 'ERC20';

    return {
      type: `${t0Type}:${t1Type}`,
      isFullyPrivate: t0Type === 'FHERC20' && t1Type === 'FHERC20',
    };
  }, [token0, token1]);

  if (!token0 || !token1) return null;

  return (
    <Badge
      variant={poolTypeInfo.isFullyPrivate ? 'success' : 'warning'}
      className="text-xs"
      title={poolTypeInfo.isFullyPrivate
        ? 'Both tokens are FHERC20 - fully private limit orders supported'
        : 'Mixed pool - some operations may have visibility limitations'}
    >
      {poolTypeInfo.type}
    </Badge>
  );
}

export default function TradePage() {
  const { currentPrice, currentTick, isLoading } = useCurrentPrice();

  return (
    <div className="container mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-1">
          <h1 className="text-2xl font-bold">Trade</h1>
          <div className="flex items-center gap-3">
            <PoolSelector compact />
            <PoolTypeBadge />
          </div>
        </div>
        <p className="text-muted-foreground">
          Swap tokens or place limit orders with encrypted amounts
        </p>
      </div>

      {/* Main Trading Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Price Chart */}
        <div className="lg:col-span-4">
          <PriceChartPanel
            currentPrice={currentPrice}
            currentTick={currentTick}
            isLoading={isLoading}
          />
        </div>

        {/* Middle Column: Order Book */}
        <div className="lg:col-span-4">
          <OrderBookPanel
            currentTick={currentTick}
            isLoading={isLoading}
          />
        </div>

        {/* Right Column: Execution Panel */}
        <div className="lg:col-span-4">
          <ExecutionPanel
            currentTick={currentTick}
            currentPrice={currentPrice}
          />
        </div>
      </div>

      {/* Bottom: Active Orders */}
      <div className="mt-6">
        <ActiveOrdersPanel currentTick={currentTick} />
      </div>
    </div>
  );
}
