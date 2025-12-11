'use client';

import { useState, useMemo, useCallback } from 'react';
import { PriceChartPanel } from '@/components/trade/PriceChartPanel';
import { OrderBookPanel } from '@/components/trade/OrderBookPanel';
import { ExecutionPanel } from '@/components/trade/ExecutionPanel';
import { ActiveOrdersPanel } from '@/components/trade/ActiveOrdersPanel';
import { PoolSelector } from '@/components/pool/PoolSelector';
import { Badge, Button } from '@/components/ui';
import { ArrowRightLeft } from 'lucide-react';
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

// Direction toggle showing sell token -> buy token with flip button
function DirectionToggle({
  zeroForOne,
  onFlip
}: {
  zeroForOne: boolean;
  onFlip: () => void;
}) {
  const { token0, token1 } = useSelectedPool();

  const sellToken = zeroForOne ? token0?.symbol : token1?.symbol;
  const buyToken = zeroForOne ? token1?.symbol : token0?.symbol;

  if (!token0 || !token1) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-ash-gray/30 rounded-lg">
      <span className="text-sm font-medium">{sellToken}</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onFlip}
        className="p-1 h-6 w-6"
        title="Flip direction"
      >
        <ArrowRightLeft className="w-3.5 h-3.5" />
      </Button>
      <span className="text-sm font-medium">{buyToken}</span>
    </div>
  );
}

export default function TradePage() {
  const { currentPrice, currentTick, isLoading, refresh: refreshPrice } = useCurrentPrice();

  // Global trade direction - true = sell token0, false = sell token1
  const [zeroForOne, setZeroForOne] = useState(true);
  const handleFlipDirection = useCallback(() => {
    setZeroForOne(prev => !prev);
  }, []);

  // State for limit order prefill from Quick Limit Order panel
  const [limitOrderPrefill, setLimitOrderPrefill] = useState<{
    tick: number;
    isBuy: boolean;
  } | null>(null);

  // Handle quick limit order creation from the panel
  const handleCreateOrder = useCallback((tick: number, isBuy: boolean) => {
    setLimitOrderPrefill({ tick, isBuy });
  }, []);

  // Clear prefill after it's been used
  const clearPrefill = useCallback(() => {
    setLimitOrderPrefill(null);
  }, []);

  return (
    <div className="container mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-1">
          <h1 className="text-2xl font-bold">Trade</h1>
          <div className="flex items-center gap-3">
            <DirectionToggle zeroForOne={zeroForOne} onFlip={handleFlipDirection} />
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
            zeroForOne={zeroForOne}
          />
        </div>

        {/* Middle Column: Quick Limit Order */}
        <div className="lg:col-span-4">
          <OrderBookPanel
            currentTick={currentTick}
            currentPrice={currentPrice}
            isLoading={isLoading}
            onCreateOrder={handleCreateOrder}
            zeroForOne={zeroForOne}
          />
        </div>

        {/* Right Column: Execution Panel */}
        <div className="lg:col-span-4">
          <ExecutionPanel
            currentTick={currentTick}
            currentPrice={currentPrice}
            limitOrderPrefill={limitOrderPrefill}
            onPrefillUsed={clearPrefill}
            zeroForOne={zeroForOne}
            onFlipDirection={handleFlipDirection}
            onSwapComplete={refreshPrice}
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
