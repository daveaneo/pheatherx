'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { parseUnits, formatUnits } from 'viem';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TransactionLink } from '@/components/common/TransactionLink';
import { useRemoveLiquidity } from '@/hooks/useRemoveLiquidity';
import { useLiquidityPosition } from '@/hooks/useLiquidityPosition';
import { useSelectedPool } from '@/stores/poolStore';

const removeLiquiditySchema = z.object({
  amount0: z.string(),
  amount1: z.string(),
}).refine(
  (data) => {
    const a0 = parseFloat(data.amount0 || '0');
    const a1 = parseFloat(data.amount1 || '0');
    return a0 > 0 || a1 > 0;
  },
  { message: 'Enter at least one amount', path: ['amount0'] }
);

type RemoveLiquidityFormValues = z.infer<typeof removeLiquiditySchema>;

export function RemoveLiquidityForm() {
  // Get tokens from selected pool
  const { pool, token0, token1 } = useSelectedPool();

  const { balance0, balance1 } = useLiquidityPosition();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset: resetForm,
    setValue,
  } = useForm<RemoveLiquidityFormValues>({
    resolver: zodResolver(removeLiquiditySchema),
    defaultValues: {
      amount0: '',
      amount1: '',
    },
  });

  const {
    removeLiquidity,
    step,
    isLoading,
    token0TxHash,
    token1TxHash,
    error,
    reset: resetHook,
  } = useRemoveLiquidity();

  // Reset form when pool changes
  useEffect(() => {
    resetForm();
    resetHook();
  }, [pool?.hook, resetForm, resetHook]);

  const onSubmit = async (data: RemoveLiquidityFormValues) => {
    const amount0 = data.amount0
      ? parseUnits(data.amount0, token0?.decimals || 18)
      : 0n;
    const amount1 = data.amount1
      ? parseUnits(data.amount1, token1?.decimals || 18)
      : 0n;

    await removeLiquidity(amount0, amount1);
  };

  const handleReset = () => {
    resetForm();
    resetHook();
  };

  const handleMax0 = () => {
    if (token0 && balance0 > 0n) {
      setValue('amount0', formatUnits(balance0, token0.decimals));
    }
  };

  const handleMax1 = () => {
    if (token1 && balance1 > 0n) {
      setValue('amount1', formatUnits(balance1, token1.decimals));
    }
  };

  const getButtonText = () => {
    switch (step) {
      case 'withdrawing-token0':
        return `Cancelling ${token0?.symbol || 'Token0'} order...`;
      case 'withdrawing-token1':
        return `Cancelling ${token1?.symbol || 'Token1'} order...`;
      case 'complete':
        return 'Done';
      case 'error':
        return 'Try Again';
      default:
        return 'Cancel Orders';
    }
  };

  const formattedBalance0 = token0
    ? parseFloat(formatUnits(balance0, token0.decimals)).toLocaleString(undefined, {
        maximumFractionDigits: 4,
      })
    : '0';

  const formattedBalance1 = token1
    ? parseFloat(formatUnits(balance1, token1.decimals)).toLocaleString(undefined, {
        maximumFractionDigits: 4,
      })
    : '0';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cancel Orders</CardTitle>
        <p className="text-sm text-feather-white/60">
          Cancel unfilled orders and reclaim your tokens
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium">
                {token0?.symbol || 'Token0'} Amount
              </label>
              <button
                type="button"
                onClick={handleMax0}
                className="text-xs text-phoenix-ember hover:text-phoenix-ember/80"
              >
                Max: {formattedBalance0}
              </button>
            </div>
            <Input
              {...register('amount0')}
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              error={!!errors.amount0}
            />
            {errors.amount0 && (
              <p className="text-deep-magenta text-sm mt-1">
                {errors.amount0.message}
              </p>
            )}
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium">
                {token1?.symbol || 'Token1'} Amount
              </label>
              <button
                type="button"
                onClick={handleMax1}
                className="text-xs text-phoenix-ember hover:text-phoenix-ember/80"
              >
                Max: {formattedBalance1}
              </button>
            </div>
            <Input
              {...register('amount1')}
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              error={!!errors.amount1}
            />
            {errors.amount1 && (
              <p className="text-deep-magenta text-sm mt-1">
                {errors.amount1.message}
              </p>
            )}
          </div>

          {error && (
            <div className="p-3 bg-deep-magenta/10 border border-deep-magenta/30 rounded-lg">
              <p className="text-deep-magenta text-sm">{error}</p>
            </div>
          )}

          {step === 'complete' && (
            <div className="p-3 bg-electric-teal/10 border border-electric-teal/30 rounded-lg space-y-2">
              <p className="text-electric-teal text-sm">
                Orders cancelled successfully!
              </p>
              {token0TxHash && (
                <TransactionLink hash={token0TxHash} label={`${token0?.symbol} cancellation`} />
              )}
              {token1TxHash && (
                <TransactionLink hash={token1TxHash} label={`${token1?.symbol} cancellation`} />
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              type="submit"
              loading={isLoading}
              disabled={step === 'complete' || (balance0 === 0n && balance1 === 0n)}
              className="flex-1"
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
    </Card>
  );
}
