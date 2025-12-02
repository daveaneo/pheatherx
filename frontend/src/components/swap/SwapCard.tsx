'use client';

import { useState, useEffect, useCallback } from 'react';
import { parseUnits, formatUnits } from 'viem';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TokenSelector } from './TokenSelector';
import { PoolSelector } from '@/components/pool/PoolSelector';
import { TransactionLink } from '@/components/common/TransactionLink';
import { useSwap } from '@/hooks/useSwap';
import { useSelectedPool } from '@/stores/poolStore';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';
import type { Token } from '@/types/pool';

export function SwapCard() {
  const slippage = useUiStore(state => state.slippageTolerance);
  const { pool, token0, token1, hookAddress, isLoading: isLoadingPool } = useSelectedPool();

  // Convert pool tokens to the format used by the swap
  const tokens: Token[] = token0 && token1 ? [token0, token1] : [];

  const [tokenIn, setTokenIn] = useState<Token | undefined>(undefined);
  const [tokenOut, setTokenOut] = useState<Token | undefined>(undefined);
  const [amountIn, setAmountIn] = useState('');
  const [amountOut, setAmountOut] = useState('');

  const {
    getQuote,
    swap,
    step,
    isSwapping,
    swapHash,
    error,
    quote,
    reset,
  } = useSwap();

  // Update tokens when pool changes
  useEffect(() => {
    if (token0 && token1) {
      setTokenIn(token0);
      setTokenOut(token1);
      setAmountIn('');
      setAmountOut('');
    }
  }, [token0, token1, pool?.hook]);

  // Get quote when amount changes
  useEffect(() => {
    const fetchQuote = async () => {
      if (!hookAddress || !tokenIn || !tokenOut || !amountIn || parseFloat(amountIn) <= 0) {
        setAmountOut('');
        return;
      }

      // Determine swap direction based on token positions
      const zeroForOne = tokenIn.address === token0?.address;
      const parsedAmount = parseUnits(amountIn, tokenIn.decimals);

      const newQuote = await getQuote(zeroForOne, parsedAmount, hookAddress);
      if (newQuote) {
        setAmountOut(formatUnits(newQuote.amountOut, tokenOut.decimals));
      }
    };

    const debounce = setTimeout(fetchQuote, 500);
    return () => clearTimeout(debounce);
  }, [amountIn, tokenIn, tokenOut, token0, hookAddress, getQuote]);

  const handleSwapTokens = useCallback(() => {
    const tempToken = tokenIn;
    setTokenIn(tokenOut);
    setTokenOut(tempToken);
    setAmountIn(amountOut);
    setAmountOut('');
  }, [tokenIn, tokenOut, amountOut]);

  const handleSwap = async () => {
    if (!hookAddress || !tokenIn || !tokenOut || !amountIn || !quote || !token0) return;

    const zeroForOne = tokenIn.address === token0.address;
    const parsedAmountIn = parseUnits(amountIn, tokenIn.decimals);

    // Calculate min output with slippage
    const slippageMultiplier = BigInt(Math.floor((100 - slippage) * 100));
    const minAmountOut = (quote.amountOut * slippageMultiplier) / BigInt(10000);

    await swap(zeroForOne, parsedAmountIn, minAmountOut, hookAddress);
  };

  const isValidInput = hookAddress && tokenIn && tokenOut && amountIn && parseFloat(amountIn) > 0;

  if (isLoadingPool) {
    return (
      <Card className="max-w-md mx-auto">
        <CardContent className="py-12">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin w-8 h-8 border-2 border-phoenix-ember border-t-transparent rounded-full" />
            <p className="text-feather-white/60">Loading pools...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!pool) {
    return (
      <Card className="max-w-md mx-auto">
        <CardContent className="py-12">
          <div className="text-center text-feather-white/60">
            <p>No pools available</p>
            <p className="text-sm mt-2">Deploy contracts and refresh the page</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-md mx-auto">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Swap</CardTitle>
            <p className="text-sm text-feather-white/60">
              Trade tokens privately with FHE protection
            </p>
          </div>
          <PoolSelector compact />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* From Token */}
        <div className="p-4 bg-ash-gray rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-feather-white/60">From</span>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              value={amountIn}
              onChange={e => setAmountIn(e.target.value)}
              className="bg-transparent border-none text-2xl p-0 focus:ring-0"
            />
            <TokenSelector
              selected={tokenIn}
              onSelect={setTokenIn}
              excludeToken={tokenOut}
              tokens={tokens}
            />
          </div>
        </div>

        {/* Swap Direction Button */}
        <div className="flex justify-center -my-2 relative z-10">
          <button
            onClick={handleSwapTokens}
            className="p-2 bg-carbon-gray rounded-lg border border-carbon-gray/50 hover:border-phoenix-ember/50 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
        </div>

        {/* To Token */}
        <div className="p-4 bg-ash-gray rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-feather-white/60">To</span>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              placeholder="0.0"
              value={amountOut}
              readOnly
              className="bg-transparent border-none text-2xl p-0 focus:ring-0 text-feather-white/80"
            />
            <TokenSelector
              selected={tokenOut}
              onSelect={setTokenOut}
              excludeToken={tokenIn}
              tokens={tokens}
            />
          </div>
        </div>

        {/* Quote Info */}
        {quote && (
          <div className="p-3 bg-ash-gray/50 rounded-lg space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-feather-white/60">Price Impact</span>
              <span className={cn(
                quote.priceImpact > 5 ? 'text-deep-magenta' :
                quote.priceImpact > 1 ? 'text-feather-gold' : 'text-electric-teal'
              )}>
                {quote.priceImpact.toFixed(2)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-feather-white/60">Slippage Tolerance</span>
              <span>{slippage}%</span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-3 bg-deep-magenta/10 border border-deep-magenta/30 rounded-lg">
            <p className="text-deep-magenta text-sm">{error}</p>
          </div>
        )}

        {/* Success */}
        {step === 'complete' && swapHash && (
          <div className="p-3 bg-electric-teal/10 border border-electric-teal/30 rounded-lg">
            <p className="text-electric-teal text-sm mb-1">Swap successful!</p>
            <TransactionLink hash={swapHash} label="View transaction" />
          </div>
        )}

        {/* Swap Button */}
        <Button
          onClick={step === 'complete' ? reset : handleSwap}
          loading={isSwapping}
          disabled={!isValidInput && step !== 'complete'}
          className="w-full"
        >
          {step === 'simulating' && 'Getting quote...'}
          {step === 'swapping' && 'Swapping...'}
          {step === 'complete' && 'Swap Again'}
          {step === 'error' && 'Try Again'}
          {step === 'idle' && (isValidInput ? 'Swap' : 'Enter amount')}
        </Button>
      </CardContent>
    </Card>
  );
}
