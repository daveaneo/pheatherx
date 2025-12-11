'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { parseUnits, formatUnits } from 'viem';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TransactionModal } from '@/components/ui';
import { TransactionLink } from '@/components/common/TransactionLink';
import { useTransactionModal } from '@/hooks/useTransactionModal';
import { useRemoveLiquidity } from '@/hooks/useRemoveLiquidity';
import type { LPPosition } from '@/hooks/useUserLPPositions';

const removeLiquiditySchema = z.object({
  lpAmount: z.string().refine(
    (val) => {
      const num = parseFloat(val || '0');
      return num > 0;
    },
    { message: 'Enter amount to remove' }
  ),
});

type RemoveLiquidityFormValues = z.infer<typeof removeLiquiditySchema>;

interface RemoveLiquidityFormProps {
  position: LPPosition;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function RemoveLiquidityForm({ position, onSuccess, onCancel }: RemoveLiquidityFormProps) {
  const [percentage, setPercentage] = useState(0);

  const { token0, token1, lpBalance, hookAddress, poolShare, reserve0, reserve1, totalLpSupply, isEncrypted } = position;

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset: resetForm,
    setValue,
    watch,
  } = useForm<RemoveLiquidityFormValues>({
    resolver: zodResolver(removeLiquiditySchema),
    defaultValues: {
      lpAmount: '',
    },
  });

  const {
    removeLiquidityAuto,
    step,
    isLoading,
    txHash,
    error,
    reset: resetHook,
  } = useRemoveLiquidity();

  const txModal = useTransactionModal();

  // Watch LP amount for estimated token returns
  const watchedLpAmount = watch('lpAmount');

  // Calculate estimated tokens to receive
  const estimatedReturns = useMemo(() => {
    if (!watchedLpAmount || isEncrypted) return null;

    const lpAmount = parseUnits(watchedLpAmount, 18);
    if (lpAmount === 0n || totalLpSupply === 0n) return null;

    const amount0 = (reserve0 * lpAmount) / totalLpSupply;
    const amount1 = (reserve1 * lpAmount) / totalLpSupply;

    return { amount0, amount1 };
  }, [watchedLpAmount, reserve0, reserve1, totalLpSupply, isEncrypted]);

  // Handle success
  useEffect(() => {
    if (step === 'complete' && onSuccess) {
      onSuccess();
    }
  }, [step, onSuccess]);

  // Format for display (moved up to be used in onSubmit)
  const formatTokenAmount = (amount: bigint, decimals: number): string => {
    const formatted = formatUnits(amount, decimals);
    const num = parseFloat(formatted);
    if (num < 0.0001) return '<0.0001';
    if (num < 1) return num.toFixed(4);
    if (num < 1000) return num.toFixed(2);
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  const onSubmit = async (data: RemoveLiquidityFormValues) => {
    const lpAmount = parseUnits(data.lpAmount, 18);

    // Open modal and show pending state
    txModal.setPending(
      'Remove Liquidity',
      `Removing ${data.lpAmount} LP tokens from ${token0.symbol}/${token1.symbol}...`
    );
    txModal.openModal();

    try {
      // Use removeLiquidityAuto which routes to correct method based on pool type:
      // - FHE:FHE pools → removeLiquidityEncrypted (tokens go to encrypted balance)
      // - ERC:FHE pools → removeLiquidity (tokens go to plaintext balance)
      // - ERC:ERC pools → removeLiquidity
      await removeLiquidityAuto(token0, token1, hookAddress, lpAmount);
      // Success is handled via useEffect watching step/txHash
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Transaction failed';
      txModal.setError(errorMessage);
    }
  };

  // Watch for transaction completion
  useEffect(() => {
    if (step === 'complete' && txHash && txModal.isOpen) {
      const details = [
        { label: 'Pool', value: `${token0.symbol}/${token1.symbol}` },
        { label: 'Status', value: 'Liquidity removed successfully' },
      ];
      txModal.setSuccess(txHash, details);
    }
  }, [step, txHash, txModal, token0.symbol, token1.symbol]);

  const handleReset = () => {
    resetForm();
    resetHook();
    setPercentage(0);
  };

  const handlePercentageChange = (pct: number) => {
    setPercentage(pct);
    if (pct === 0) {
      setValue('lpAmount', '');
    } else {
      const amount = (lpBalance * BigInt(pct)) / 100n;
      setValue('lpAmount', formatUnits(amount, 18));
    }
  };

  const handleMax = () => {
    handlePercentageChange(100);
  };

  const getButtonText = () => {
    switch (step) {
      case 'encrypting':
        return 'Encrypting...';
      case 'removing-liquidity':
        return 'Removing liquidity...';
      case 'complete':
        return 'Done';
      case 'error':
        return 'Try Again';
      default:
        return 'Remove Liquidity';
    }
  };

  const formattedLpBalance = formatUnits(lpBalance, 18);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Remove Liquidity</CardTitle>
            <p className="text-sm text-feather-white/60">
              {token0.symbol} / {token1.symbol}
            </p>
          </div>
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Position Info */}
          <div className="p-3 rounded-lg bg-ash-gray/50 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-feather-white/60">Your LP Balance</span>
              <span className="font-mono">
                {isEncrypted ? '****' : parseFloat(formattedLpBalance).toFixed(4)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-feather-white/60">Pool Share</span>
              <span>{isEncrypted ? '****' : `${poolShare.toFixed(2)}%`}</span>
            </div>
          </div>

          {/* Percentage Quick Buttons */}
          {!isEncrypted && (
            <div className="flex gap-2">
              {[25, 50, 75, 100].map((pct) => (
                <Button
                  key={pct}
                  type="button"
                  variant={percentage === pct ? 'primary' : 'secondary'}
                  size="sm"
                  className="flex-1"
                  onClick={() => handlePercentageChange(pct)}
                >
                  {pct}%
                </Button>
              ))}
            </div>
          )}

          {/* LP Amount Input */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium">LP Tokens to Remove</label>
              {!isEncrypted && (
                <button
                  type="button"
                  onClick={handleMax}
                  className="text-xs text-phoenix-ember hover:text-phoenix-ember/80"
                >
                  Max
                </button>
              )}
            </div>
            <Input
              {...register('lpAmount')}
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              error={!!errors.lpAmount}
              disabled={isLoading || isEncrypted}
              data-testid="remove-liquidity-amount"
            />
            {errors.lpAmount && (
              <p className="text-deep-magenta text-sm mt-1">
                {errors.lpAmount.message}
              </p>
            )}
          </div>

          {/* Estimated Returns */}
          {estimatedReturns && (
            <div className="p-3 rounded-lg bg-ash-gray/50 space-y-2 text-sm">
              <div className="text-feather-white/60 text-xs mb-2">You will receive (estimated)</div>
              <div className="flex justify-between">
                <span>{token0.symbol}</span>
                <span className="font-mono">
                  ~{formatTokenAmount(estimatedReturns.amount0, token0.decimals)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>{token1.symbol}</span>
                <span className="font-mono">
                  ~{formatTokenAmount(estimatedReturns.amount1, token1.decimals)}
                </span>
              </div>
            </div>
          )}

          {/* Encrypted Position Warning */}
          {isEncrypted && (
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-400 text-sm">
              This position uses encrypted balances. Removal requires FHE decryption.
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="p-3 bg-deep-magenta/10 border border-deep-magenta/30 rounded-lg">
              <p className="text-deep-magenta text-sm">{error}</p>
            </div>
          )}

          {/* Success Display */}
          {step === 'complete' && txHash && (
            <div className="p-3 bg-electric-teal/10 border border-electric-teal/30 rounded-lg space-y-2" data-testid="remove-liquidity-success">
              <p className="text-electric-teal text-sm">
                Liquidity removed successfully!
              </p>
              <TransactionLink hash={txHash} label="View transaction" />
            </div>
          )}

          {/* Submit Button */}
          <div className="flex gap-2">
            <Button
              type="submit"
              loading={isLoading}
              disabled={step === 'complete' || lpBalance === 0n || isEncrypted}
              className="flex-1"
              data-testid="remove-liquidity-submit"
            >
              {getButtonText()}
            </Button>

            {(step === 'complete' || step === 'error') && (
              <Button type="button" variant="secondary" onClick={handleReset}>
                Reset
              </Button>
            )}
          </div>
        </form>
      </CardContent>

      {/* Transaction Modal */}
      <TransactionModal
        isOpen={txModal.isOpen}
        onClose={txModal.closeModal}
        data={txModal.modalData}
      />
    </Card>
  );
}
