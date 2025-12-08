'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { parseUnits, formatUnits } from 'viem';
import { useChainId } from 'wagmi';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TransactionLink } from '@/components/common/TransactionLink';
import { TokenPairSelector } from './TokenPairSelector';
import { useAddLiquidity } from '@/hooks/useAddLiquidity';
import { usePoolInfo } from '@/hooks/usePoolInfo';
import { getTokensForChain, type Token } from '@/lib/tokens';
import { sortTokens } from '@/lib/pairs';
import { usePoolStore } from '@/stores/poolStore';

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

interface AddLiquidityFormProps {
  /** Pre-select a pool by hook address */
  selectedPoolHook?: `0x${string}`;
  onSuccess?: () => void;
}

export function AddLiquidityForm({ selectedPoolHook, onSuccess }: AddLiquidityFormProps) {
  const chainId = useChainId();
  const pools = usePoolStore(state => state.pools);
  const poolsLoaded = usePoolStore(state => state.poolsLoaded);
  const tokens = useMemo(() => getTokensForChain(chainId), [chainId]);

  // Get hook address from first available pool (all pools use the same v5 hook)
  const hookAddress = pools.length > 0 ? pools[0].hook : undefined;

  // Token pair state - default to first two tokens if available
  const [token0, setToken0] = useState<Token | undefined>(
    tokens.length >= 2 ? sortTokens(tokens[0], tokens[1])[0] : undefined
  );
  const [token1, setToken1] = useState<Token | undefined>(
    tokens.length >= 2 ? sortTokens(tokens[0], tokens[1])[1] : undefined
  );

  // Get pool info for selected pair
  const { poolExists, reserve0, reserve1, totalLpSupply, isLoading: isLoadingPool } = usePoolInfo(token0, token1);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset: resetForm,
    watch,
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
    txHash,
    error,
    reset: resetHook,
  } = useAddLiquidity();

  // Watch amounts for estimated share calculation
  const watchedAmount0 = watch('amount0');
  const watchedAmount1 = watch('amount1');

  // Reset form when token pair changes
  useEffect(() => {
    resetForm();
    resetHook();
  }, [token0?.address, token1?.address, resetForm, resetHook]);

  // Handle success
  useEffect(() => {
    if (step === 'complete' && onSuccess) {
      onSuccess();
    }
  }, [step, onSuccess]);

  const handleTokenPairSelect = (newToken0: Token, newToken1: Token) => {
    // Ensure tokens are properly sorted
    const [sorted0, sorted1] = sortTokens(newToken0, newToken1);
    setToken0(sorted0);
    setToken1(sorted1);
  };

  const onSubmit = async (data: AddLiquidityFormValues) => {
    if (!token0 || !token1 || !hookAddress) return;

    const amount0 = data.amount0
      ? parseUnits(data.amount0, token0.decimals)
      : 0n;
    const amount1 = data.amount1
      ? parseUnits(data.amount1, token1.decimals)
      : 0n;

    await addLiquidity(token0, token1, hookAddress, amount0, amount1);
  };

  const handleReset = () => {
    resetForm();
    resetHook();
  };

  // Estimate pool share after adding liquidity
  const estimatedPoolShare = useMemo(() => {
    if (!token0 || !token1) return null;

    const amount0 = watchedAmount0 ? parseUnits(watchedAmount0, token0.decimals) : 0n;
    const amount1 = watchedAmount1 ? parseUnits(watchedAmount1, token1.decimals) : 0n;

    if (amount0 === 0n && amount1 === 0n) return null;

    if (!poolExists || totalLpSupply === 0n) {
      // New pool - will get 100% of initial LP tokens
      return 100;
    }

    // Estimate based on proportion of reserves
    // This is a simplified calculation - actual LP tokens depend on AMM math
    if (reserve0 > 0n && amount0 > 0n) {
      const share = Number((amount0 * 10000n) / (reserve0 + amount0)) / 100;
      return Math.min(share, 100);
    }
    if (reserve1 > 0n && amount1 > 0n) {
      const share = Number((amount1 * 10000n) / (reserve1 + amount1)) / 100;
      return Math.min(share, 100);
    }

    return null;
  }, [watchedAmount0, watchedAmount1, token0, token1, poolExists, reserve0, reserve1, totalLpSupply]);

  const getButtonText = () => {
    switch (step) {
      case 'checking-token0':
        return 'Checking allowance...';
      case 'approving-token0':
        return `Approving ${token0?.symbol || 'Token0'}...`;
      case 'checking-token1':
        return 'Checking allowance...';
      case 'approving-token1':
        return `Approving ${token1?.symbol || 'Token1'}...`;
      case 'adding-liquidity':
        return 'Adding liquidity...';
      case 'complete':
        return 'Done';
      case 'error':
        return 'Try Again';
      default:
        if (!poolExists) {
          return 'Create Pool';
        }
        return 'Add Liquidity';
    }
  };

  // Show loading state while pools are being discovered
  if (!poolsLoaded) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin w-8 h-8 border-2 border-phoenix-ember border-t-transparent rounded-full" />
            <p className="text-feather-white/60">Discovering pools...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!hookAddress) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-feather-white/60">
            <p>No pools found on this network</p>
            <p className="text-sm mt-2">Deploy contracts and refresh the page</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add Liquidity</CardTitle>
        <p className="text-sm text-feather-white/60">
          Provide tokens to earn trading fees
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Token Pair Selector */}
          <TokenPairSelector
            token0={token0}
            token1={token1}
            onSelect={handleTokenPairSelect}
            disabled={isLoading}
            poolExists={poolExists}
          />

          {/* Amount Inputs */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Token 0 Input */}
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
                disabled={!token0 || isLoading}
                data-testid="add-liquidity-amount0"
              />
              {errors.amount0 && (
                <p className="text-deep-magenta text-sm mt-1">
                  {errors.amount0.message}
                </p>
              )}
            </div>

            {/* Token 1 Input */}
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
                disabled={!token1 || isLoading}
                data-testid="add-liquidity-amount1"
              />
              {errors.amount1 && (
                <p className="text-deep-magenta text-sm mt-1">
                  {errors.amount1.message}
                </p>
              )}
            </div>

            {/* Pool Info */}
            {token0 && token1 && (
              <div className="p-3 rounded-lg bg-ash-gray/50 space-y-2 text-sm">
                {/* Pool Status */}
                <div className="flex justify-between">
                  <span className="text-feather-white/60">Pool Status</span>
                  <span className={poolExists ? 'text-green-400' : 'text-blue-400'}>
                    {isLoadingPool ? 'Loading...' : poolExists ? 'Active' : 'New Pool'}
                  </span>
                </div>

                {/* Current Reserves (if pool exists) */}
                {poolExists && reserve0 > 0n && (
                  <div className="flex justify-between">
                    <span className="text-feather-white/60">Current Reserves</span>
                    <span>
                      {formatUnits(reserve0, token0.decimals).slice(0, 8)} {token0.symbol} / {formatUnits(reserve1, token1.decimals).slice(0, 8)} {token1.symbol}
                    </span>
                  </div>
                )}

                {/* Estimated Share */}
                {estimatedPoolShare !== null && (
                  <div className="flex justify-between">
                    <span className="text-feather-white/60">Est. Pool Share</span>
                    <span className="text-electric-cyan">~{estimatedPoolShare.toFixed(2)}%</span>
                  </div>
                )}
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
              <div className="p-3 bg-electric-teal/10 border border-electric-teal/30 rounded-lg space-y-2" data-testid="add-liquidity-success">
                <p className="text-electric-teal text-sm">
                  Liquidity added successfully!
                </p>
                <TransactionLink hash={txHash} label="View transaction" />
              </div>
            )}

            {/* Submit Button */}
            <div className="flex gap-2">
              <Button
                type="submit"
                loading={isLoading}
                disabled={!token0 || !token1 || step === 'complete'}
                className="flex-1"
                data-testid="add-liquidity-submit"
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
        </div>
      </CardContent>
    </Card>
  );
}
