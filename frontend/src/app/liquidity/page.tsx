'use client';

import { useState } from 'react';
import { AddLiquidityForm, PositionsList, RemoveLiquidityForm } from '@/components/liquidity';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { FheSessionGuard } from '@/components/common/FheSessionGuard';
import { useUserLPPositions, type LPPosition } from '@/hooks/useUserLPPositions';

export default function LiquidityPage() {
  const [activeTab, setActiveTab] = useState<'add' | 'remove'>('add');
  const [selectedPosition, setSelectedPosition] = useState<LPPosition | null>(null);
  const { positions, refetch } = useUserLPPositions();

  const handlePositionSelect = (position: LPPosition) => {
    setSelectedPosition(position);
    setActiveTab('remove');
  };

  const handleSuccess = () => {
    // Refresh positions after successful add/remove
    refetch();
    setSelectedPosition(null);
  };

  const handleCancel = () => {
    setSelectedPosition(null);
    setActiveTab('add');
  };

  return (
    <FheSessionGuard requireSession>
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-3xl font-bold mb-2">Liquidity</h1>
            <p className="text-feather-white/60">
              Provide liquidity to earn trading fees
            </p>
          </div>

          {/* Tabbed Interface for Add/Remove */}
          <Card>
            <CardHeader className="pb-0">
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'add' | 'remove')}>
                <TabsList>
                  <TabsTrigger value="add" data-testid="add-liquidity-tab">
                    Add
                  </TabsTrigger>
                  <TabsTrigger value="remove" data-testid="remove-liquidity-tab">
                    Remove
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className="pt-6">
              {activeTab === 'add' && (
                <AddLiquidityFormWrapper onSuccess={handleSuccess} />
              )}
              {activeTab === 'remove' && (
                <RemoveLiquidityTab
                  positions={positions}
                  selectedPosition={selectedPosition}
                  onSelectPosition={handlePositionSelect}
                  onSuccess={handleSuccess}
                  onCancel={handleCancel}
                />
              )}
            </CardContent>
          </Card>

          {/* Your Positions */}
          <Card>
            <CardHeader>
              <CardTitle>Your Positions</CardTitle>
              <p className="text-sm text-feather-white/60">
                Manage your liquidity positions
              </p>
            </CardHeader>
            <CardContent>
              <PositionsListWithRemove onRemove={handlePositionSelect} />
            </CardContent>
          </Card>
        </div>
      </div>
    </FheSessionGuard>
  );
}

/**
 * Wrapper for AddLiquidityForm without the Card wrapper (since parent has Card)
 */
function AddLiquidityFormWrapper({ onSuccess }: { onSuccess: () => void }) {
  return (
    <div className="space-y-6">
      <div className="text-sm text-feather-white/60 mb-4">
        Select a token pair and enter amounts to add liquidity.
      </div>
      <AddLiquidityForm onSuccess={onSuccess} />
    </div>
  );
}

/**
 * Remove liquidity tab content with position selector
 */
function RemoveLiquidityTab({
  positions,
  selectedPosition,
  onSelectPosition,
  onSuccess,
  onCancel,
}: {
  positions: LPPosition[];
  selectedPosition: LPPosition | null;
  onSelectPosition: (position: LPPosition) => void;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const positionsWithBalance = positions.filter(p => p.lpBalance > 0n);

  // If no positions, show empty state
  if (positionsWithBalance.length === 0) {
    return (
      <div className="py-8 text-center">
        <div className="text-feather-white/40 mb-2">No liquidity positions found</div>
        <p className="text-sm text-feather-white/30">
          Add liquidity first to see your positions here.
        </p>
      </div>
    );
  }

  // If position is selected, show the remove form
  if (selectedPosition) {
    return (
      <RemoveLiquidityForm
        position={selectedPosition}
        onSuccess={onSuccess}
        onCancel={onCancel}
      />
    );
  }

  // Show position selector
  return (
    <div className="space-y-4">
      <div className="text-sm text-feather-white/60 mb-4">
        Select a position to remove liquidity from:
      </div>
      <div className="grid gap-3">
        {positionsWithBalance.map((position) => (
          <button
            key={position.hookAddress}
            onClick={() => onSelectPosition(position)}
            className="p-4 rounded-lg bg-ash-gray/30 hover:bg-ash-gray/50 transition-colors text-left"
            data-testid={`position-select-${position.token0.symbol}-${position.token1.symbol}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium">
                  {position.token0.symbol} / {position.token1.symbol}
                </span>
                <div className="text-xs text-feather-white/60 mt-1">
                  {position.isEncrypted ? (
                    <span>LP Balance: ****</span>
                  ) : (
                    <span>Pool Share: {position.poolShare.toFixed(2)}%</span>
                  )}
                </div>
              </div>
              <div className="text-feather-white/60">
                <Minus className="w-5 h-5" />
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Wrapper component for PositionsList that handles remove action
 */
function PositionsListWithRemove({ onRemove }: { onRemove: (position: LPPosition) => void }) {
  const { positions } = useUserLPPositions();

  // Custom PositionsList with position-aware remove handler
  return (
    <PositionsList
      onRemovePosition={(hookAddress) => {
        const position = positions.find(p => p.hookAddress === hookAddress);
        if (position) {
          onRemove(position);
        }
      }}
    />
  );
}
