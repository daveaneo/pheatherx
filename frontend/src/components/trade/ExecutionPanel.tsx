'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { MarketSwapForm } from './MarketSwapForm';
import { LimitOrderForm } from './LimitOrderForm';
import type { CurrentPrice } from '@/types/bucket';

interface ExecutionPanelProps {
  currentTick: number;
  currentPrice: CurrentPrice | null;
  limitOrderPrefill?: { tick: number; isBuy: boolean } | null;
  onPrefillUsed?: () => void;
}

export function ExecutionPanel({
  currentTick,
  currentPrice,
  limitOrderPrefill,
  onPrefillUsed,
}: ExecutionPanelProps) {
  const [activeTab, setActiveTab] = useState('market');

  // Switch to limit tab when prefill is set
  useEffect(() => {
    if (limitOrderPrefill) {
      setActiveTab('limit');
    }
  }, [limitOrderPrefill]);

  return (
    <Card className="h-full" data-testid="execution-panel">
      <CardHeader className="pb-2">
        <CardTitle>Execute Trade</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="w-full">
            <TabsTrigger value="market" data-testid="market-tab">Market</TabsTrigger>
            <TabsTrigger value="limit" data-testid="limit-tab">Limit</TabsTrigger>
          </TabsList>

          <TabsContent value="market">
            <MarketSwapForm currentPrice={currentPrice} />
          </TabsContent>

          <TabsContent value="limit">
            <LimitOrderForm
              currentTick={currentTick}
              currentPrice={currentPrice}
              prefill={limitOrderPrefill}
              onPrefillUsed={onPrefillUsed}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
