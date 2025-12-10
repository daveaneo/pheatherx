'use client';

import { useState, useMemo } from 'react';
import { useChainId } from 'wagmi';
import { ChevronDown, Lock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { getTokensForChain, type Token } from '@/lib/tokens';
import { sortTokens, isWrapPair, formatPairName } from '@/lib/pairs';
import { cn } from '@/lib/utils';

interface TokenPairSelectorProps {
  token0: Token | undefined;
  token1: Token | undefined;
  onSelect: (token0: Token, token1: Token) => void;
  disabled?: boolean;
  showPoolStatus?: boolean;
  poolExists?: boolean;
}

export function TokenPairSelector({
  token0,
  token1,
  onSelect,
  disabled = false,
  showPoolStatus = true,
  poolExists = false,
}: TokenPairSelectorProps) {
  const chainId = useChainId();
  const tokens = useMemo(() => getTokensForChain(chainId), [chainId]);

  const [isSelectingToken0, setIsSelectingToken0] = useState(false);
  const [isSelectingToken1, setIsSelectingToken1] = useState(false);

  // Check if current selection is a wrap pair (same underlying)
  const isWrap = token0 && token1 ? isWrapPair({ token0, token1 }) : false;

  const handleToken0Select = (token: Token) => {
    setIsSelectingToken0(false);
    if (token1) {
      // Sort tokens and pass to parent
      const [sorted0, sorted1] = sortTokens(token, token1);
      onSelect(sorted0, sorted1);
    } else {
      // Just update token0, parent will handle partial state
      onSelect(token, token1 as any);
    }
  };

  const handleToken1Select = (token: Token) => {
    setIsSelectingToken1(false);
    if (token0) {
      // Sort tokens and pass to parent
      const [sorted0, sorted1] = sortTokens(token0, token);
      onSelect(sorted0, sorted1);
    } else {
      // Just update token1, parent will handle partial state
      onSelect(token0 as any, token);
    }
  };

  // Filter out already selected token from options
  const token0Options = tokens.filter(t => t.address !== token1?.address);
  const token1Options = tokens.filter(t => t.address !== token0?.address);

  return (
    <div className="space-y-4">
      {/* Token Pair Selection */}
      <div className="flex items-center gap-2">
        {/* Token 0 Selector */}
        <div className="relative flex-1">
          <Button
            variant="secondary"
            className="w-full justify-between"
            onClick={() => setIsSelectingToken0(!isSelectingToken0)}
            disabled={disabled}
            data-testid="token0-selector"
          >
            {token0 ? (
              <span className="flex items-center gap-2">
                <TokenIcon token={token0} />
                <span>{token0.symbol}</span>
                {token0.type === 'fheerc20' && <Lock className="w-3 h-3 text-green-400" />}
              </span>
            ) : (
              <span className="text-feather-white/40">Select token</span>
            )}
            <ChevronDown className="w-4 h-4" />
          </Button>

          {/* Token 0 Dropdown */}
          {isSelectingToken0 && (
            <TokenDropdown
              tokens={token0Options}
              onSelect={handleToken0Select}
              onClose={() => setIsSelectingToken0(false)}
            />
          )}
        </div>

        {/* Separator */}
        <div className="text-feather-white/40 text-xl font-bold">/</div>

        {/* Token 1 Selector */}
        <div className="relative flex-1">
          <Button
            variant="secondary"
            className="w-full justify-between"
            onClick={() => setIsSelectingToken1(!isSelectingToken1)}
            disabled={disabled}
            data-testid="token1-selector"
          >
            {token1 ? (
              <span className="flex items-center gap-2">
                <TokenIcon token={token1} />
                <span>{token1.symbol}</span>
                {token1.type === 'fheerc20' && <Lock className="w-3 h-3 text-green-400" />}
              </span>
            ) : (
              <span className="text-feather-white/40">Select token</span>
            )}
            <ChevronDown className="w-4 h-4" />
          </Button>

          {/* Token 1 Dropdown */}
          {isSelectingToken1 && (
            <TokenDropdown
              tokens={token1Options}
              onSelect={handleToken1Select}
              onClose={() => setIsSelectingToken1(false)}
            />
          )}
        </div>
      </div>

      {/* Pool Status / Warnings */}
      {showPoolStatus && token0 && token1 && (
        <div className="space-y-2">
          {/* Wrap pair warning */}
          {isWrap && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>
                This pair represents the same underlying asset. Creating liquidity here may not be economically useful.
              </span>
            </div>
          )}

          {/* Pool exists status */}
          {!isWrap && (
            <div
              className={cn(
                'flex items-center gap-2 p-3 rounded-lg text-sm',
                poolExists
                  ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                  : 'bg-blue-500/10 border border-blue-500/20 text-blue-400'
              )}
            >
              {poolExists ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-green-400" />
                  <span>Pool exists - Add liquidity to existing pool</span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 rounded-full bg-blue-400" />
                  <span>New pool - Your deposit will initialize the pool</span>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Token icon component (placeholder, can be enhanced with actual logos)
 */
function TokenIcon({ token }: { token: Token }) {
  // Simple colored circle based on token type
  const bgColor = token.type === 'fheerc20' ? 'bg-green-500' : 'bg-blue-500';

  return (
    <div className={cn('w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold', bgColor)}>
      {token.symbol.charAt(0)}
    </div>
  );
}

/**
 * Dropdown for token selection
 */
function TokenDropdown({
  tokens,
  onSelect,
  onClose,
}: {
  tokens: Token[];
  onSelect: (token: Token) => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Dropdown */}
      <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-ash-gray rounded-lg border border-carbon-gray shadow-xl overflow-hidden">
        {tokens.map(token => (
          <button
            key={token.address}
            className="w-full px-4 py-3 flex items-center gap-3 hover:bg-carbon-gray/50 transition-colors"
            onClick={() => onSelect(token)}
          >
            <TokenIcon token={token} />
            <div className="flex-1 text-left">
              <div className="font-medium">{token.symbol}</div>
              <div className="text-xs text-feather-white/40">{token.name}</div>
            </div>
            {token.type === 'fheerc20' && (
              <div className="flex items-center gap-1 text-xs text-green-400">
                <Lock className="w-3 h-3" />
                Private
              </div>
            )}
          </button>
        ))}
      </div>
    </>
  );
}
