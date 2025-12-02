'use client';

import { formatUnits } from 'viem';
import { useBalanceReveal } from '@/hooks/useBalanceReveal';
import { Button } from '@/components/ui/Button';
import { Progress } from '@/components/ui/Progress';

interface EncryptedBalanceProps {
  isToken0: boolean;
  decimals: number;
  symbol: string;
  showRevealButton?: boolean;
}

export function EncryptedBalance({
  isToken0,
  decimals,
  symbol,
  showRevealButton = true,
}: EncryptedBalanceProps) {
  const { status, value, error, progress, reveal, hide, isRevealing, isRevealed } =
    useBalanceReveal(isToken0);

  if (status === 'error') {
    return (
      <div className="text-deep-magenta text-sm">
        {error}
        <button onClick={reveal} className="ml-2 underline">
          Retry
        </button>
      </div>
    );
  }

  if (isRevealing) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-feather-white/60 text-sm">Decrypting...</span>
        </div>
        <Progress value={progress} className="h-1" />
      </div>
    );
  }

  if (isRevealed && value !== null) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-lg">
          {formatUnits(value, decimals)} {symbol}
        </span>
        <button
          onClick={hide}
          className="text-xs text-iridescent-violet hover:underline"
        >
          Hide
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-iridescent-violet text-lg">******</span>
      {showRevealButton && (
        <button
          onClick={reveal}
          className="text-xs text-phoenix-ember hover:underline"
        >
          Reveal
        </button>
      )}
    </div>
  );
}
