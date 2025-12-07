'use client';

import { useState } from 'react';
import { Button, Input } from '@/components/ui';
import { ArrowDownUp, Loader2 } from 'lucide-react';
import { useSwap } from '@/hooks/useSwap';
import { useSelectedPool } from '@/stores/poolStore';
import { parseUnits } from 'viem';
import type { CurrentPrice } from '@/types/bucket';

interface MarketSwapFormProps {
  currentPrice: CurrentPrice | null;
}

export function MarketSwapForm({ currentPrice }: MarketSwapFormProps) {
  const [sellAmount, setSellAmount] = useState('');
  const [zeroForOne, setZeroForOne] = useState(true); // true = sell token0
  const [slippage, setSlippage] = useState('0.5');

  const { swap, step, isSwapping, error, reset } = useSwap();
  const { token0, token1 } = useSelectedPool();

  // Get token symbols from selected pool
  const sellToken = zeroForOne ? (token0?.symbol ?? 'Token0') : (token1?.symbol ?? 'Token1');
  const buyToken = zeroForOne ? (token1?.symbol ?? 'Token1') : (token0?.symbol ?? 'Token0');
  const sellDecimals = zeroForOne ? (token0?.decimals ?? 18) : (token1?.decimals ?? 18);
  const buyDecimals = zeroForOne ? (token1?.decimals ?? 18) : (token0?.decimals ?? 18);

  // Calculate estimated output
  const estimatedOutput = (() => {
    if (!sellAmount || !currentPrice || parseFloat(sellAmount) === 0) return '0';

    const inputAmount = parseFloat(sellAmount);
    const price = Number(currentPrice.price) / 1e18;

    if (zeroForOne) {
      // Selling token0 for token1: output = input * price
      return (inputAmount * price).toFixed(4);
    } else {
      // Selling token1 for token0: output = input / price
      return (inputAmount / price).toFixed(4);
    }
  })();

  const handleSwap = async () => {
    if (!sellAmount || parseFloat(sellAmount) === 0) return;

    try {
      const amountIn = parseUnits(sellAmount, sellDecimals);
      const slippagePercent = parseFloat(slippage) / 100;
      const estimatedOut = parseUnits(estimatedOutput, buyDecimals);
      const minAmountOut = estimatedOut - (estimatedOut * BigInt(Math.floor(slippagePercent * 10000)) / 10000n);

      // V4 swap signature: swap(zeroForOne, amountIn, minAmountOut, hookAddress?)
      const hash = await swap(zeroForOne, amountIn, minAmountOut);

      if (hash) {
        setSellAmount('');
      }
    } catch (err) {
      // Error is already handled by the hook
      console.error('Swap failed:', err);
    }
  };

  const handleFlip = () => {
    setZeroForOne(!zeroForOne);
    setSellAmount('');
  };

  return (
    <div className="space-y-4">
      {/* Sell Input */}
      <div className="space-y-2">
        <label className="text-sm text-feather-white/60">You Pay</label>
        <div className="relative">
          <Input
            type="number"
            placeholder="0.0"
            value={sellAmount}
            onChange={(e) => setSellAmount(e.target.value)}
            className="pr-20 text-lg"
            disabled={isSwapping}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-feather-white/60 font-medium">
            {sellToken}
          </span>
        </div>
      </div>

      {/* Flip Button */}
      <div className="flex justify-center">
        <Button
          variant="secondary"
          onClick={handleFlip}
          disabled={isSwapping}
          className="rounded-full p-2"
        >
          <ArrowDownUp className="w-4 h-4" />
        </Button>
      </div>

      {/* Buy Output */}
      <div className="space-y-2">
        <label className="text-sm text-feather-white/60">You Receive (Estimated)</label>
        <div className="relative">
          <Input
            type="text"
            value={estimatedOutput}
            readOnly
            className="pr-20 text-lg bg-ash-gray/50"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-feather-white/60 font-medium">
            {buyToken}
          </span>
        </div>
      </div>

      {/* Slippage */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-feather-white/60">Slippage Tolerance</span>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={slippage}
            onChange={(e) => setSlippage(e.target.value)}
            className="w-16 h-8 text-right"
            disabled={isSwapping}
          />
          <span className="text-feather-white/60">%</span>
        </div>
      </div>

      {/* Price Info */}
      <div className="p-3 bg-ash-gray/30 rounded-lg text-sm space-y-1">
        <div className="flex justify-between">
          <span className="text-feather-white/60">Rate</span>
          <span>1 {sellToken} = {zeroForOne ? currentPrice?.priceFormatted : (1 / (Number(currentPrice?.price ?? 1n) / 1e18)).toFixed(4)} {buyToken}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-feather-white/60">Min Received</span>
          <span>{(parseFloat(estimatedOutput) * (1 - parseFloat(slippage) / 100)).toFixed(4)} {buyToken}</span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-deep-magenta/10 border border-deep-magenta/20 rounded-lg text-sm text-deep-magenta">
          {error}
        </div>
      )}

      {/* Swap Button */}
      <Button
        className="w-full"
        size="lg"
        onClick={handleSwap}
        disabled={isSwapping || !sellAmount || parseFloat(sellAmount) === 0}
      >
        {isSwapping ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {step === 'simulating' ? 'Simulating...' : step === 'swapping' ? 'Swapping...' : 'Processing...'}
          </>
        ) : (
          `Swap ${sellToken} for ${buyToken}`
        )}
      </Button>

      {/* Note */}
      <p className="text-xs text-center text-feather-white/40">
        Market swaps use plaintext amounts (not encrypted)
      </p>
    </div>
  );
}
