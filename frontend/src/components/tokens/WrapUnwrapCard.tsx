'use client';

import { useState, useMemo } from 'react';
import { useChainId, useAccount, useBalance } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TransactionLink } from '@/components/common/TransactionLink';
import { useWrap } from '@/hooks/useWrap';
import { useUnwrap } from '@/hooks/useUnwrap';
import { getWrapPairs, type TokenPair, type Token } from '@/lib/tokens';
import { useFheSession } from '@/hooks/useFheSession';

type Mode = 'wrap' | 'unwrap';

interface WrapUnwrapCardProps {
  className?: string;
}

export function WrapUnwrapCard({ className }: WrapUnwrapCardProps) {
  const chainId = useChainId();
  const { address } = useAccount();
  const { isReady: fheReady, initialize: initFhe, isInitializing } = useFheSession();

  // Get available wrap pairs for this chain
  const wrapPairs = useMemo(() => getWrapPairs(chainId), [chainId]);

  // State
  const [mode, setMode] = useState<Mode>('wrap');
  const [selectedPairIndex, setSelectedPairIndex] = useState(0);
  const [amount, setAmount] = useState('');

  // Get selected pair
  const selectedPair: TokenPair | undefined = wrapPairs[selectedPairIndex];
  const sourceToken = mode === 'wrap' ? selectedPair?.erc20 : selectedPair?.fherc20;
  const destToken = mode === 'wrap' ? selectedPair?.fherc20 : selectedPair?.erc20;

  // Get source token balance
  const { data: sourceBalance } = useBalance({
    address,
    token: sourceToken?.address,
    query: { enabled: !!sourceToken?.address },
  });

  // Hooks for wrap and unwrap
  const {
    wrapWithApproval,
    step: wrapStep,
    isApproving,
    isWrapping,
    wrapHash,
    error: wrapError,
    reset: resetWrap,
  } = useWrap(selectedPair?.erc20, selectedPair?.fherc20);

  const {
    unwrap,
    step: unwrapStep,
    isUnwrapping,
    unwrapHash,
    error: unwrapError,
    reset: resetUnwrap,
  } = useUnwrap(selectedPair?.fherc20, selectedPair?.erc20);

  // Combined state
  const isLoading = isApproving || isWrapping || isUnwrapping;
  const isComplete = (mode === 'wrap' && wrapStep === 'complete') ||
                     (mode === 'unwrap' && unwrapStep === 'complete');
  const error = mode === 'wrap' ? wrapError : unwrapError;
  const txHash = mode === 'wrap' ? wrapHash : unwrapHash;

  // Parse amount
  const parsedAmount = useMemo(() => {
    if (!amount || !sourceToken) return 0n;
    try {
      return parseUnits(amount, sourceToken.decimals);
    } catch {
      return 0n;
    }
  }, [amount, sourceToken]);

  // Handle submit
  const handleSubmit = async () => {
    if (!parsedAmount || parsedAmount === 0n) return;

    try {
      if (mode === 'wrap') {
        await wrapWithApproval(parsedAmount);
      } else {
        await unwrap(parsedAmount);
      }
    } catch {
      // Error handled in hooks
    }
  };

  // Handle mode change
  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    setAmount('');
    resetWrap();
    resetUnwrap();
  };

  // Handle max button
  const handleMax = () => {
    if (sourceBalance) {
      setAmount(formatUnits(sourceBalance.value, sourceBalance.decimals));
    }
  };

  // Handle new transaction
  const handleReset = () => {
    setAmount('');
    resetWrap();
    resetUnwrap();
  };

  // No wrap pairs available
  if (wrapPairs.length === 0) {
    return (
      <Card className={className} data-testid="wrap-unwrap-card">
        <CardHeader>
          <CardTitle>Wrap / Unwrap</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-feather-white/60 text-center py-8">
            No wrap/unwrap pairs available on this network.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className} data-testid="wrap-unwrap-card">
      <CardHeader>
        <CardTitle>Wrap / Unwrap Tokens</CardTitle>
        <p className="text-sm text-feather-white/60">
          Convert between ERC20 and private FHERC20 tokens
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Mode Toggle */}
        <div className="flex gap-2">
          <Button
            variant={mode === 'wrap' ? 'primary' : 'ghost'}
            onClick={() => handleModeChange('wrap')}
            className="flex-1"
            data-testid="wrap-mode-btn"
          >
            Wrap
          </Button>
          <Button
            variant={mode === 'unwrap' ? 'primary' : 'ghost'}
            onClick={() => handleModeChange('unwrap')}
            className="flex-1"
            data-testid="unwrap-mode-btn"
          >
            Unwrap
          </Button>
        </div>

        {/* Token Pair Selector */}
        <div>
          <label className="block text-sm font-medium mb-2">Token Pair</label>
          <select
            className="input-field w-full"
            value={selectedPairIndex}
            onChange={(e) => {
              setSelectedPairIndex(Number(e.target.value));
              setAmount('');
            }}
            data-testid="wrap-token-selector"
          >
            {wrapPairs.map((pair, index) => (
              <option key={index} value={index}>
                {mode === 'wrap'
                  ? `${pair.erc20.symbol} → ${pair.fherc20.symbol}`
                  : `${pair.fherc20.symbol} → ${pair.erc20.symbol}`}
              </option>
            ))}
          </select>
        </div>

        {/* Balance Display */}
        <div className="flex justify-between text-sm">
          <span className="text-feather-white/60" data-testid="wrap-balance-from">
            Balance: {sourceBalance
              ? `${formatUnits(sourceBalance.value, sourceBalance.decimals)} ${sourceToken?.symbol}`
              : '...'
            }
          </span>
          <span className="text-feather-white/60" data-testid="wrap-balance-to">
            Rate: 1:1
          </span>
        </div>

        {/* Amount Input */}
        <div>
          <label className="block text-sm font-medium mb-2">Amount</label>
          <div className="flex gap-2">
            <Input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              disabled={isLoading || isComplete}
              data-testid="wrap-amount-input"
            />
            <Button
              variant="secondary"
              onClick={handleMax}
              disabled={isLoading || isComplete}
              data-testid="wrap-max-btn"
            >
              Max
            </Button>
          </div>
        </div>

        {/* FHE Session Warning (for wrap mode) */}
        {mode === 'wrap' && !fheReady && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <p className="text-amber-500 text-sm mb-2">
              FHE session required for private tokens
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={initFhe}
              loading={isInitializing}
            >
              Initialize FHE Session
            </Button>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="p-3 bg-deep-magenta/10 border border-deep-magenta/30 rounded-lg" data-testid="tx-error">
            <p className="text-deep-magenta text-sm">{error}</p>
          </div>
        )}

        {/* Success Display */}
        {isComplete && txHash && (
          <div className="p-3 bg-electric-teal/10 border border-electric-teal/30 rounded-lg" data-testid="tx-success">
            <p className="text-electric-teal text-sm mb-1">
              {mode === 'wrap' ? 'Wrap' : 'Unwrap'} complete!
            </p>
            <TransactionLink hash={txHash} label="View transaction" />
          </div>
        )}

        {/* Submit Button */}
        <Button
          className="w-full"
          onClick={isComplete ? handleReset : handleSubmit}
          loading={isLoading}
          disabled={!isComplete && (!parsedAmount || parsedAmount === 0n || (mode === 'wrap' && !fheReady))}
          data-testid="wrap-submit-btn"
        >
          {isApproving && 'Approving...'}
          {isWrapping && 'Wrapping...'}
          {isUnwrapping && 'Unwrapping...'}
          {isComplete && 'New Transaction'}
          {!isLoading && !isComplete && (mode === 'wrap' ? 'Wrap Tokens' : 'Unwrap Tokens')}
        </Button>

        {/* Info Text */}
        <p className="text-xs text-feather-white/40 text-center">
          {mode === 'wrap'
            ? 'Wrap converts your ERC20 tokens to private FHERC20 tokens with encrypted balances.'
            : 'Unwrap converts your private FHERC20 tokens back to standard ERC20 tokens.'
          }
        </p>
      </CardContent>
    </Card>
  );
}
