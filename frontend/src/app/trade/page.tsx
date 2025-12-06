'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { PriceChartPanel } from '@/components/trade/PriceChartPanel';
import { OrderBookPanel } from '@/components/trade/OrderBookPanel';
import { ExecutionPanel } from '@/components/trade/ExecutionPanel';
import { ActiveOrdersPanel } from '@/components/trade/ActiveOrdersPanel';
import { useCurrentPrice } from '@/hooks/useCurrentPrice';

export default function TradePage() {
  const { currentPrice, currentTick, isLoading } = useCurrentPrice();

  return (
    <div className="container mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Trade</h1>
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
