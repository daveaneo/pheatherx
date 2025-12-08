'use client';

import { useState } from 'react';
import { Lock, Plus, Minus, ChevronDown, ChevronUp } from 'lucide-react';
import { formatUnits } from 'viem';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import type { LPPosition } from '@/hooks/useUserLPPositions';
import { cn } from '@/lib/utils';

interface PositionCardProps {
  position: LPPosition;
  onIncrease?: () => void;
  onDecrease?: () => void;
  isExpanded?: boolean;
}

export function PositionCard({
  position,
  onIncrease,
  onDecrease,
  isExpanded: initialExpanded = false,
}: PositionCardProps) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded);

  const { token0, token1, lpBalance, poolShare, token0Amount, token1Amount, isEncrypted } = position;

  // Format amounts for display
  const formattedToken0 = isEncrypted
    ? '****'
    : formatTokenAmount(token0Amount, token0.decimals);
  const formattedToken1 = isEncrypted
    ? '****'
    : formatTokenAmount(token1Amount, token1.decimals);
  const formattedLP = isEncrypted
    ? '****'
    : formatTokenAmount(lpBalance, 18);

  // Check if this is a fully private pair
  const isPrivatePair = token0.type === 'fherc20' && token1.type === 'fherc20';

  return (
    <Card
      className="overflow-hidden hover:border-electric-cyan/30 transition-colors cursor-pointer"
      onClick={() => setIsExpanded(!isExpanded)}
      data-testid="position-card"
    >
      <CardContent className="p-4">
        {/* Header Row */}
        <div className="flex items-center justify-between">
          {/* Token Pair */}
          <div className="flex items-center gap-3">
            {/* Token Icons */}
            <div className="flex -space-x-2">
              <TokenIcon token={token0} />
              <TokenIcon token={token1} />
            </div>

            {/* Pair Name */}
            <div>
              <div className="font-medium flex items-center gap-2">
                {token0.symbol} / {token1.symbol}
                {isPrivatePair && <Lock className="w-3 h-3 text-green-400" />}
              </div>
              <div className="text-xs text-feather-white/40">
                {isEncrypted ? 'Encrypted Position' : 'Full Range'}
              </div>
            </div>
          </div>

          {/* Pool Share */}
          <div className="text-right">
            <div className="font-medium">
              {isEncrypted ? '****' : `${poolShare.toFixed(2)}%`}
            </div>
            <div className="text-xs text-feather-white/40">Pool Share</div>
          </div>

          {/* Expand Icon */}
          <div className="ml-4">
            {isExpanded ? (
              <ChevronUp className="w-5 h-5 text-feather-white/40" />
            ) : (
              <ChevronDown className="w-5 h-5 text-feather-white/40" />
            )}
          </div>
        </div>

        {/* Expanded Content */}
        {isExpanded && (
          <div className="mt-4 pt-4 border-t border-carbon-gray space-y-4" onClick={e => e.stopPropagation()}>
            {/* Token Amounts */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-lg bg-ash-gray/50">
                <div className="text-xs text-feather-white/40 mb-1">{token0.symbol}</div>
                <div className="font-mono font-medium">{formattedToken0}</div>
              </div>
              <div className="p-3 rounded-lg bg-ash-gray/50">
                <div className="text-xs text-feather-white/40 mb-1">{token1.symbol}</div>
                <div className="font-mono font-medium">{formattedToken1}</div>
              </div>
            </div>

            {/* LP Token Info */}
            <div className="p-3 rounded-lg bg-ash-gray/50">
              <div className="flex justify-between items-center">
                <div className="text-xs text-feather-white/40">LP Tokens</div>
                <div className="font-mono text-sm">{formattedLP}</div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={onIncrease}
                data-testid="increase-position-btn"
              >
                <Plus className="w-4 h-4 mr-1" />
                Increase
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                onClick={onDecrease}
                data-testid="decrease-position-btn"
              >
                <Minus className="w-4 h-4 mr-1" />
                Remove
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Format a token amount for display
 */
function formatTokenAmount(amount: bigint, decimals: number): string {
  const formatted = formatUnits(amount, decimals);
  const num = parseFloat(formatted);

  if (num === 0) return '0';
  if (num < 0.0001) return '<0.0001';
  if (num < 1) return num.toFixed(4);
  if (num < 1000) return num.toFixed(2);
  if (num < 1000000) return `${(num / 1000).toFixed(2)}K`;
  return `${(num / 1000000).toFixed(2)}M`;
}

/**
 * Token icon component
 */
function TokenIcon({ token }: { token: { symbol: string; type?: string } }) {
  const bgColor = token.type === 'fherc20' ? 'bg-green-500' : 'bg-blue-500';

  return (
    <div
      className={cn(
        'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 border-ash-gray',
        bgColor
      )}
    >
      {token.symbol.charAt(0)}
    </div>
  );
}
