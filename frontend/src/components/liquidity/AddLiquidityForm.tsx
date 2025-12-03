'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { parseUnits } from 'viem';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PoolSelector } from '@/components/pool/PoolSelector';
import { TransactionLink } from '@/components/common/TransactionLink';
import { useAddLiquidity } from '@/hooks/useAddLiquidity';
import { useSelectedPool } from '@/stores/poolStore';

const addLiquiditySchema = z.object({
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

type AddLiquidityFormValues = z.infer<typeof addLiquiditySchema>;

export function AddLiquidityForm() {
  // Get tokens from selected pool
  const { pool, token0, token1, isLoading: isLoadingPool, poolsLoaded } = useSelectedPool();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset: resetForm,
  } = useForm<AddLiquidityFormValues>({
    resolver: zodResolver(addLiquiditySchema),
    defaultValues: {
      amount0: '',
      amount1: '',
    },
  });

  const {
    addLiquidity,
    step,
    isLoading,
    token0TxHash,
    token1TxHash,
    error,
    reset: resetHook,
  } = useAddLiquidity();

  // Reset form when pool changes
  useEffect(() => {
    resetForm();
    resetHook();
  }, [pool?.hook, resetForm, resetHook]);

  const onSubmit = async (data: AddLiquidityFormValues) => {
    const amount0 = data.amount0
      ? parseUnits(data.amount0, token0?.decimals || 18)
      : 0n;
    const amount1 = data.amount1
      ? parseUnits(data.amount1, token1?.decimals || 18)
      : 0n;

    await addLiquidity(amount0, amount1);
  };

  const handleReset = () => {
    resetForm();
    resetHook();
  };

  const getButtonText = () => {
    switch (step) {
      case 'checking-token0':
        return 'Checking allowance...';
      case 'approving-token0':
        return `Approving ${token0?.symbol || 'Token0'}...`;
      case 'depositing-token0':
        return `Depositing ${token0?.symbol || 'Token0'}...`;
      case 'checking-token1':
        return 'Checking allowance...';
      case 'approving-token1':
        return `Approving ${token1?.symbol || 'Token1'}...`;
      case 'depositing-token1':
        return `Depositing ${token1?.symbol || 'Token1'}...`;
      case 'complete':
        return 'Done';
      case 'error':
        return 'Try Again';
      default:
        return 'Add Liquidity';
    }
  };

  // Show loading while pools are being fetched
  if (isLoadingPool || !poolsLoaded) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin w-8 h-8 border-2 border-phoenix-ember border-t-transparent rounded-full" />
            <p className="text-feather-white/60">Loading pools...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show "no pools" only after discovery has completed
  if (!pool) {
    return (
      <Card>
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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Add Liquidity</CardTitle>
            <p className="text-sm text-feather-white/60">
              Deposit tokens to provide liquidity
            </p>
          </div>
          <PoolSelector compact />
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              {token0?.symbol || 'Token0'} Amount
            </label>
            <Input
              {...register('amount0')}
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              error={!!errors.amount0}
              data-testid="deposit-amount-0"
            />
            {errors.amount0 && (
              <p className="text-deep-magenta text-sm mt-1">
                {errors.amount0.message}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              {token1?.symbol || 'Token1'} Amount
            </label>
            <Input
              {...register('amount1')}
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              error={!!errors.amount1}
              data-testid="deposit-amount-1"
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
            <div className="p-3 bg-electric-teal/10 border border-electric-teal/30 rounded-lg space-y-2" data-testid="deposit-success">
              <p className="text-electric-teal text-sm">
                Liquidity added successfully!
              </p>
              {token0TxHash && (
                <TransactionLink hash={token0TxHash} label={`${token0?.symbol} deposit`} />
              )}
              {token1TxHash && (
                <TransactionLink hash={token1TxHash} label={`${token1?.symbol} deposit`} />
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              type="submit"
              loading={isLoading}
              disabled={step === 'complete'}
              className="flex-1"
              data-testid="deposit-submit"
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
