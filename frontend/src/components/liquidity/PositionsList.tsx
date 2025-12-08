'use client';

import { Wallet, Loader2 } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useUserLPPositions } from '@/hooks/useUserLPPositions';
import { PositionCard } from './PositionCard';
import { Skeleton } from '@/components/ui/Skeleton';

interface PositionsListProps {
  onSelectPosition?: (poolHookAddress: `0x${string}`) => void;
  onRemovePosition?: (poolHookAddress: `0x${string}`) => void;
}

export function PositionsList({ onSelectPosition, onRemovePosition }: PositionsListProps) {
  const { isConnected } = useAccount();
  const { positions, isLoading, error } = useUserLPPositions();

  // Not connected
  if (!isConnected) {
    return (
      <div className="text-center py-8 text-feather-white/40">
        <Wallet className="w-12 h-12 mx-auto mb-4 opacity-40" />
        <p className="text-lg mb-2">Connect your wallet</p>
        <p className="text-sm">Connect to view your liquidity positions</p>
      </div>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="positions-loading">
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="text-center py-8 text-deep-magenta/60">
        <p className="text-lg mb-2">Error loading positions</p>
        <p className="text-sm">{error.message}</p>
      </div>
    );
  }

  // No positions
  if (positions.length === 0) {
    return (
      <div className="text-center py-8 text-feather-white/40" data-testid="no-positions">
        <div className="text-4xl mb-4">💧</div>
        <p className="text-lg mb-2">No liquidity positions</p>
        <p className="text-sm">Add liquidity to a pool to see your positions here</p>
      </div>
    );
  }

  // Has positions
  return (
    <div className="space-y-4" data-testid="positions-list">
      {positions.map(position => (
        <PositionCard
          key={position.hookAddress}
          position={position}
          onIncrease={() => onSelectPosition?.(position.hookAddress)}
          onDecrease={() => onRemovePosition?.(position.hookAddress)}
        />
      ))}
    </div>
  );
}
