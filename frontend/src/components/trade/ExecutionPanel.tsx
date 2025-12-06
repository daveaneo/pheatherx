'use client';

import { Card, CardContent, CardHeader, CardTitle, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { MarketSwapForm } from './MarketSwapForm';
import { LimitOrderForm } from './LimitOrderForm';
import type { CurrentPrice } from '@/types/bucket';

interface ExecutionPanelProps {
  currentTick: number;
  currentPrice: CurrentPrice | null;
}

export function ExecutionPanel({ currentTick, currentPrice }: ExecutionPanelProps) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle>Execute Trade</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="market" className="space-y-4">
          <TabsList className="w-full">
            <TabsTrigger value="market">Market</TabsTrigger>
            <TabsTrigger value="limit">Limit</TabsTrigger>
          </TabsList>

          <TabsContent value="market">
            <MarketSwapForm currentPrice={currentPrice} />
          </TabsContent>

          <TabsContent value="limit">
            <LimitOrderForm currentTick={currentTick} currentPrice={currentPrice} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
