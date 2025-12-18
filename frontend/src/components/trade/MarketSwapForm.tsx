'use client';

import { useState } from 'react';
import { Button, Input, TransactionModal } from '@/components/ui';
import { ArrowDownUp, Loader2, Lock } from 'lucide-react';
import { useSwap } from '@/hooks/useSwap';
import { useSelectedPool } from '@/stores/poolStore';
import { useTransactionModal } from '@/hooks/useTransactionModal';
import { getPoolIdFromTokens } from '@/lib/poolId';
import { parseUnits, formatUnits } from 'viem';
import type { CurrentPrice } from '@/types/bucket';
import { useAccount, useBalance } from 'wagmi';
import { useFherc20Balance } from '@/hooks/useFherc20Balance';

interface MarketSwapFormProps {
  currentPrice: CurrentPrice | null;
  zeroForOne: boolean;
  onFlipDirection: () => void;
  onSwapComplete?: () => void;
}

export function MarketSwapForm({ currentPrice, zeroForOne, onFlipDirection, onSwapComplete }: MarketSwapFormProps) {
  const [sellAmount, setSellAmount] = useState('');
  const [slippage, setSlippage] = useState('0.5');

  const { swap, swapForPool, step, isSwapping, error, reset } = useSwap();
  const { hookAddress, token0, token1, contractType } = useSelectedPool();
  const txModal = useTransactionModal();
  const { address } = useAccount();

  // Get buy token for balance refresh after swap
  const buyTokenObj = zeroForOne ? token1 : token0;

  // Get token symbols from selected pool
  const sellToken = zeroForOne ? (token0?.symbol ?? 'Token0') : (token1?.symbol ?? 'Token1');
  const buyToken = zeroForOne ? (token1?.symbol ?? 'Token1') : (token0?.symbol ?? 'Token0');
  const sellDecimals = zeroForOne ? (token0?.decimals ?? 18) : (token1?.decimals ?? 18);
  const buyDecimals = zeroForOne ? (token1?.decimals ?? 18) : (token0?.decimals ?? 18);
  const sellTokenObj = zeroForOne ? token0 : token1;
  const sellTokenAddress = sellTokenObj?.address;

  // Determine pool type
  const token0IsFhe = token0?.type === 'fheerc20';
  const token1IsFhe = token1?.type === 'fheerc20';
  const isFheFhePool = token0IsFhe && token1IsFhe;

  // Get wallet balance for sell token
  // For FHERC20 tokens, we need encrypted balance; for ERC20, use standard balance
  const { data: balanceData, isLoading: isBalanceLoading, refetch: refetchSellBalance } = useBalance({
    address,
    token: sellTokenAddress,
  });

  // Get encrypted balance for FHERC20 sell token
  const { balance: encryptedBalance, isLoading: isEncryptedBalanceLoading, invalidateAndRefresh: refreshSellEncrypted } = useFherc20Balance(
    sellTokenObj,
    address
  );

  // Get encrypted balance for FHERC20 buy token (for refresh after swap)
  const { invalidateAndRefresh: refreshBuyEncrypted } = useFherc20Balance(
    buyTokenObj,
    address
  );

  // Get standard balance for buy token (for refresh after swap)
  const { refetch: refetchBuyBalance } = useBalance({
    address,
    token: buyTokenObj?.address,
  });

  // Use encrypted balance for FHE:FHE pools, plaintext for others
  const sellBalance = isFheFhePool ? encryptedBalance : balanceData?.value;
  const isBalanceLoadingFinal = isFheFhePool ? isEncryptedBalanceLoading : isBalanceLoading;

  // Calculate estimated output using AMM constant product formula
  // Formula: amountOut = (amountIn * reserveOut) / (reserveIn + amountIn)
  const estimatedOutput = (() => {
    if (!sellAmount || !currentPrice || parseFloat(sellAmount) === 0) return '0';
    if (currentPrice.reserve0 === 0n || currentPrice.reserve1 === 0n) return '0';

    const inputAmount = parseFloat(sellAmount);

    // Normalize reserves to actual token amounts
    // reserve0 is always token0, reserve1 is always token1 - use their respective decimals
    const reserve0Normalized = Number(currentPrice.reserve0) / Math.pow(10, token0?.decimals ?? 18);
    const reserve1Normalized = Number(currentPrice.reserve1) / Math.pow(10, token1?.decimals ?? 18);

    if (zeroForOne) {
      // Selling token0 for token1
      // reserveIn = reserve0, reserveOut = reserve1
      const amountOut = (inputAmount * reserve1Normalized) / (reserve0Normalized + inputAmount);
      return amountOut.toFixed(4);
    } else {
      // Selling token1 for token0
      // reserveIn = reserve1, reserveOut = reserve0
      const amountOut = (inputAmount * reserve0Normalized) / (reserve1Normalized + inputAmount);
      return amountOut.toFixed(4);
    }
  })();

  // Handle percentage button click
  const handlePercentageClick = (pct: number) => {
    if (!sellBalance) return;
    const amount = (sellBalance * BigInt(pct)) / 100n;
    const formatted = formatUnits(amount, sellDecimals);
    // Trim trailing zeros but keep reasonable precision
    const trimmed = parseFloat(formatted).toString();
    setSellAmount(trimmed);
  };

  const handleSwap = async () => {
    if (!sellAmount || parseFloat(sellAmount) === 0) return;
    if (!token0 || !token1 || !hookAddress) return;

    // Open modal and show pending state
    const swapType = isFheFhePool ? 'Private Swap' : 'Market Swap';
    txModal.setPending(swapType, `Swapping ${sellAmount} ${sellToken} for ${buyToken}...`);
    txModal.openModal();

    try {
      const amountIn = parseUnits(sellAmount, sellDecimals);
      const slippagePercent = parseFloat(slippage) / 100;
      const estimatedOut = parseUnits(estimatedOutput, buyDecimals);
      const minAmountOut = estimatedOut - (estimatedOut * BigInt(Math.floor(slippagePercent * 10000)) / 10000n);

      // Compute poolId from selected tokens
      const poolId = getPoolIdFromTokens(token0, token1, hookAddress);

      let hash: `0x${string}`;

      // v8 contracts use router-based swap (hook intercepts via _beforeSwap)
      // v6 and older use direct swapForPool
      if (contractType === 'v8fhe' || contractType === 'v8mixed') {
        // v8 pools: use router-based swap (works for both FHE:FHE and mixed pools)
        hash = await swap(zeroForOne, amountIn, minAmountOut);
      } else {
        // Legacy pools: use direct swapForPool
        hash = await swapForPool(poolId, zeroForOne, amountIn, minAmountOut);
      }

      if (hash) {
        txModal.setSuccess(hash, [
          { label: 'Sold', value: `${sellAmount} ${sellToken}` },
          { label: 'Received', value: `~${estimatedOutput} ${buyToken}` },
        ]);
        setSellAmount('');

        // Refresh prices/reserves
        onSwapComplete?.();

        // Refresh balances (both sell and buy tokens)
        // For FHE tokens, use encrypted balance refresh; for ERC20, use standard refetch
        if (isFheFhePool) {
          // Both tokens are FHERC20
          // Wait for CoFHE to process the new ciphertext before unsealing
          // The on-chain tx is confirmed, but CoFHE needs time to index the new encrypted values
          console.log('[MarketSwapForm] Waiting 3s for CoFHE to process new ciphertext...');
          await new Promise(r => setTimeout(r, 3000));
          console.log('[MarketSwapForm] Refreshing encrypted balances...');
          refreshSellEncrypted?.();
          refreshBuyEncrypted?.();
        } else {
          // Mixed or ERC:ERC pool - refresh standard balances
          refetchSellBalance?.();
          refetchBuyBalance?.();
        }
      }
    } catch (err) {
      // Show error in modal
      const errorMessage = err instanceof Error ? err.message : 'Transaction failed';
      txModal.setError(errorMessage);
      console.error('Swap failed:', err);
    }
  };

  const handleFlip = () => {
    onFlipDirection();
    setSellAmount('');
  };

  return (
    <div className="space-y-4" data-testid="swap-form">
      {/* Sell Input */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm text-feather-white/60">
            You Pay {isFheFhePool && <span title="Encrypted"><Lock className="inline w-3 h-3 ml-1" /></span>}
          </label>
          <span className="text-xs text-feather-white/40">
            {isFheFhePool ? 'Encrypted ' : ''}Balance: {
              isBalanceLoadingFinal ? '...' :
              sellBalance !== null && sellBalance !== undefined ?
                parseFloat(formatUnits(sellBalance, sellDecimals)).toFixed(4) : '0'
            } {sellToken}
          </span>
        </div>
        <div className="relative">
          <Input
            type="number"
            placeholder="0.0"
            value={sellAmount}
            onChange={(e) => setSellAmount(e.target.value)}
            className="pr-24 text-lg text-left pl-4 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            disabled={isSwapping}
            data-testid="sell-amount-input"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-feather-white/60 font-medium">
            {sellToken}
          </span>
        </div>
        <div className="flex gap-1 mt-1">
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => handlePercentageClick(pct)}
              className="px-2 py-0.5 text-xs bg-ash-gray/50 hover:bg-ash-gray rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isBalanceLoadingFinal || !sellBalance || isSwapping}
            >
              {pct}%
            </button>
          ))}
        </div>
      </div>

      {/* Flip Button */}
      <div className="flex justify-center">
        <Button
          variant="secondary"
          onClick={handleFlip}
          disabled={isSwapping}
          className="rounded-full p-2"
          data-testid="flip-direction-button"
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
            className="pr-24 text-lg text-left pl-4 bg-ash-gray/50"
            data-testid="buy-amount-output"
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
            data-testid="slippage-input"
          />
          <span className="text-feather-white/60">%</span>
        </div>
      </div>

      {/* Price Info */}
      <div className="p-3 bg-ash-gray/30 rounded-lg text-sm space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-feather-white/60">Rate</span>
          <span className="text-right">
            1 {sellToken} = {(() => {
              if (!currentPrice || currentPrice.reserve0 === 0n || currentPrice.reserve1 === 0n) return '0.0000';
              // reserve0 is always token0, reserve1 is always token1 - decimals don't depend on swap direction
              const r0 = Number(currentPrice.reserve0) / Math.pow(10, token0?.decimals ?? 18);
              const r1 = Number(currentPrice.reserve1) / Math.pow(10, token1?.decimals ?? 18);
              // zeroForOne: selling token0 for token1, rate = r1/r0
              // !zeroForOne: selling token1 for token0, rate = r0/r1
              return zeroForOne ? (r1 / r0).toFixed(4) : (r0 / r1).toFixed(4);
            })()} {buyToken}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-feather-white/60">Min Received</span>
          <span className="text-right">{(parseFloat(estimatedOutput) * (1 - parseFloat(slippage) / 100)).toFixed(4)} {buyToken}</span>
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
        disabled={isSwapping || !sellAmount || parseFloat(sellAmount) === 0 || !hookAddress}
        data-testid="swap-button"
      >
        {isSwapping ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {step === 'simulating' ? 'Simulating...' :
             step === 'approving' ? 'Approving...' :
             step === 'swapping' ? 'Swapping...' : 'Processing...'}
          </>
        ) : (
          `Swap ${sellToken} for ${buyToken}`
        )}
      </Button>

      {/* Note */}
      <p className="text-xs text-center text-feather-white/40">
        {isFheFhePool
          ? 'Private swap - uses encrypted token balances'
          : 'Market swap - plaintext amounts'}
      </p>

      {/* Transaction Modal */}
      <TransactionModal
        isOpen={txModal.isOpen}
        onClose={txModal.closeModal}
        data={txModal.modalData}
      />
    </div>
  );
}
