'use client';

import { PoolStats, LiquidityPosition, AddLiquidityForm, RemoveLiquidityForm } from '@/components/liquidity';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';

export default function LiquidityPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Liquidity</h1>
          <p className="text-feather-white/60">
            Provide liquidity to earn trading fees
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <PoolStats />
          <LiquidityPosition />
        </div>

        <Tabs defaultValue="add" className="w-full">
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="add">Add Liquidity</TabsTrigger>
            <TabsTrigger value="remove">Remove Liquidity</TabsTrigger>
          </TabsList>

          <TabsContent value="add" className="mt-4">
            <AddLiquidityForm />
          </TabsContent>

          <TabsContent value="remove" className="mt-4">
            <RemoveLiquidityForm />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
