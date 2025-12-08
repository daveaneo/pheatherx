'use client';

import { useState } from 'react';
import { AddLiquidityForm, PositionsList, RemoveLiquidityForm } from '@/components/liquidity';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { FheSessionGuard } from '@/components/common/FheSessionGuard';
import { useUserLPPositions, type LPPosition } from '@/hooks/useUserLPPositions';

export default function LiquidityPage() {
  const [selectedPosition, setSelectedPosition] = useState<LPPosition | null>(null);
  const [mode, setMode] = useState<'add' | 'remove' | null>(null);
  const { refetch } = useUserLPPositions();

  const handleSelectPosition = (poolHookAddress: `0x${string}`) => {
    // Find the position and open add liquidity form for it
    // For now, just switch to add mode
    setMode('add');
  };

  const handleRemovePosition = (poolHookAddress: `0x${string}`) => {
    // This will be called from PositionCard, need to get position
    setMode('remove');
  };

  const handlePositionSelect = (position: LPPosition) => {
    setSelectedPosition(position);
    setMode('remove');
  };

  const handleSuccess = () => {
    // Refresh positions after successful add/remove
    refetch();
    setMode(null);
    setSelectedPosition(null);
  };

  const handleCancel = () => {
    setMode(null);
    setSelectedPosition(null);
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

          {/* Remove Liquidity Form (shown when a position is selected) */}
          {mode === 'remove' && selectedPosition && (
            <RemoveLiquidityForm
              position={selectedPosition}
              onSuccess={handleSuccess}
              onCancel={handleCancel}
            />
          )}

          {/* Add Liquidity Form (always visible unless in remove mode) */}
          {mode !== 'remove' && (
            <AddLiquidityForm onSuccess={handleSuccess} />
          )}

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
 * Wrapper component for PositionsList that handles remove action
 */
function PositionsListWithRemove({ onRemove }: { onRemove: (position: LPPosition) => void }) {
  const { positions, isLoading, error } = useUserLPPositions();

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
