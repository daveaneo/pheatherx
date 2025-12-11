'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { parseUnits, formatUnits } from 'viem';
import { useChainId, useAccount, useBalance } from 'wagmi';
import { Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TransactionModal } from '@/components/ui';
import { TransactionLink } from '@/components/common/TransactionLink';
import { useTransactionModal } from '@/hooks/useTransactionModal';
import { TokenPairSelector } from './TokenPairSelector';
import { useAddLiquidity } from '@/hooks/useAddLiquidity';
import { usePoolInfo } from '@/hooks/usePoolInfo';
import { useFherc20Balance } from '@/hooks/useFherc20Balance';
import { usePoolReserveSync } from '@/hooks/usePoolReserveSync';
import { useFheSession } from '@/hooks/useFheSession';
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
    // Contract requires BOTH amounts to be > 0
    return a0 > 0 && a1 > 0;
  },
  { message: 'Enter both token amounts', path: ['amount0'] }
);

type AddLiquidityFormValues = z.infer<typeof addLiquiditySchema>;

interface AddLiquidityFormProps {
  /** Pre-select a pool by hook address */
  selectedPoolHook?: `0x${string}`;
  onSuccess?: () => void;
}

export function AddLiquidityForm({ selectedPoolHook, onSuccess }: AddLiquidityFormProps) {
  const chainId = useChainId();
  const tokens = useMemo(() => getTokensForChain(chainId), [chainId]);

  // Token pair state - default to first two tokens if available
  const [token0, setToken0] = useState<Token | undefined>(
    tokens.length >= 2 ? sortTokens(tokens[0], tokens[1])[0] : undefined
  );
  const [token1, setToken1] = useState<Token | undefined>(
    tokens.length >= 2 ? sortTokens(tokens[0], tokens[1])[1] : undefined
  );

  // Get user address for balance queries
  const { address } = useAccount();

  // FHE session status
  const { isReady: isFheReady } = useFheSession();

  // Fetch user's ERC20 token balances (standard)
  const { data: balance0Erc20 } = useBalance({
    address,
    token: token0?.address,
    query: { enabled: !!token0 && !!address && token0?.type !== 'fheerc20' }
  });

  const { data: balance1Erc20 } = useBalance({
    address,
    token: token1?.address,
    query: { enabled: !!token1 && !!address && token1?.type !== 'fheerc20' }
  });

  // Fetch FHERC20 balances (auto-reveals when FHE session ready)
  const fheBalance0 = useFherc20Balance(token0, address);
  const fheBalance1 = useFherc20Balance(token1, address);

  // Compute effective balances (FHERC20 decrypted or standard ERC20)
  const effectiveBalance0 = useMemo(() => {
    if (token0?.type === 'fheerc20') {
      return fheBalance0.balance !== null
        ? { value: fheBalance0.balance, decimals: token0.decimals }
        : null;
    }
    return balance0Erc20 ? { value: balance0Erc20.value, decimals: balance0Erc20.decimals } : null;
  }, [token0, fheBalance0.balance, balance0Erc20]);

  const effectiveBalance1 = useMemo(() => {
    if (token1?.type === 'fheerc20') {
      return fheBalance1.balance !== null
        ? { value: fheBalance1.balance, decimals: token1.decimals }
        : null;
    }
    return balance1Erc20 ? { value: balance1Erc20.value, decimals: balance1Erc20.decimals } : null;
  }, [token1, fheBalance1.balance, balance1Erc20]);

  // Get pool info for selected pair (includes hook address lookup with fallback)
  const { poolExists, isInitialized, reserve0, reserve1, totalLpSupply, isLoading: isLoadingPool, hookAddress, poolId, refetch: refetchPoolInfo } = usePoolInfo(token0, token1);

  // Auto-sync reserves for FHE pools with 0 plaintext reserves
  const { isSyncing, syncError } = usePoolReserveSync(
    poolId,
    hookAddress,
    isInitialized,
    reserve0,
    refetchPoolInfo
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset: resetForm,
    watch,
    setValue,
  } = useForm<AddLiquidityFormValues>({
    resolver: zodResolver(addLiquiditySchema),
    defaultValues: {
      amount0: '',
      amount1: '',
    },
  });

  const {
    addLiquidityAuto,
    step,
    isLoading,
    txHash,
    error,
    reset: resetHook,
  } = useAddLiquidity();

  const txModal = useTransactionModal();

  // Watch amounts for estimated share calculation
  const watchedAmount0 = watch('amount0');
  const watchedAmount1 = watch('amount1');

  // Track which input the user is actively editing (to avoid circular updates)
  const [activeInput, setActiveInput] = useState<'amount0' | 'amount1' | null>(null);

  // Reset form when token pair changes
  useEffect(() => {
    resetForm();
    resetHook();
    setActiveInput(null);
  }, [token0?.address, token1?.address, resetForm, resetHook]);

  // Auto-calculate paired amount based on reserve ratio (for initialized pools)
  useEffect(() => {
    if (!isInitialized || !token0 || !token1 || reserve0 === 0n || reserve1 === 0n) return;

    if (activeInput === 'amount0' && watchedAmount0) {
      const amount0 = parseFloat(watchedAmount0);
      if (amount0 > 0) {
        // Calculate amount1 = amount0 * (reserve1 / reserve0), accounting for decimals
        const reserve0Normalized = Number(formatUnits(reserve0, token0.decimals));
        const reserve1Normalized = Number(formatUnits(reserve1, token1.decimals));
        const ratio = reserve1Normalized / reserve0Normalized;
        const calculatedAmount1 = (amount0 * ratio).toFixed(token1.decimals > 6 ? 6 : token1.decimals);
        setValue('amount1', calculatedAmount1, { shouldValidate: false });
      }
    } else if (activeInput === 'amount1' && watchedAmount1) {
      const amount1 = parseFloat(watchedAmount1);
      if (amount1 > 0) {
        // Calculate amount0 = amount1 * (reserve0 / reserve1), accounting for decimals
        const reserve0Normalized = Number(formatUnits(reserve0, token0.decimals));
        const reserve1Normalized = Number(formatUnits(reserve1, token1.decimals));
        const ratio = reserve0Normalized / reserve1Normalized;
        const calculatedAmount0 = (amount1 * ratio).toFixed(token0.decimals > 6 ? 6 : token0.decimals);
        setValue('amount0', calculatedAmount0, { shouldValidate: false });
      }
    }
  }, [activeInput, watchedAmount0, watchedAmount1, isInitialized, reserve0, reserve1, token0, token1, setValue]);

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

    // Open modal and show pending state
    const actionLabel = isInitialized ? 'Add Liquidity' : 'Create Pool & Add Liquidity';
    txModal.setPending(
      actionLabel,
      `Adding ${data.amount0} ${token0.symbol} and ${data.amount1} ${token1.symbol}...`
    );
    txModal.openModal();

    try {
      // Use addLiquidityAuto which routes to correct method based on pool type:
      // - FHE:FHE pools → addLiquidityEncrypted (with auto-wrap if needed)
      // - ERC:FHE pools → addLiquidity (with auto-unwrap if needed)
      // - ERC:ERC pools → addLiquidity
      await addLiquidityAuto(token0, token1, hookAddress, amount0, amount1, isInitialized);

      // Success is handled via useEffect watching step/txHash
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Transaction failed';
      txModal.setError(errorMessage);
    }
  };

  // Watch for transaction completion
  useEffect(() => {
    if (step === 'complete' && txHash && txModal.isOpen) {
      txModal.setSuccess(txHash, [
        { label: 'Pool', value: `${token0?.symbol || 'Token0'}/${token1?.symbol || 'Token1'}` },
        { label: 'Status', value: 'Liquidity added successfully' },
      ]);
    }
  }, [step, txHash, txModal, token0?.symbol, token1?.symbol]);

  const handleReset = () => {
    resetForm();
    resetHook();
  };

  // Handle percentage button clicks
  const handlePercentageClick = (percent: number, isToken0: boolean) => {
    const balance = isToken0 ? effectiveBalance0 : effectiveBalance1;
    const token = isToken0 ? token0 : token1;
    if (!balance || !token) return;

    const amount = (balance.value * BigInt(percent)) / 100n;
    const formatted = formatUnits(amount, token.decimals);
    // Set active input first so the ratio calculation triggers
    setActiveInput(isToken0 ? 'amount0' : 'amount1');
    setValue(isToken0 ? 'amount0' : 'amount1', formatted);
  };

  // Calculate price ratio for new pools based on entered amounts
  const priceRatioText = useMemo(() => {
    if (!watchedAmount0 || !watchedAmount1 || !token0 || !token1) return null;

    const a0 = parseFloat(watchedAmount0);
    const a1 = parseFloat(watchedAmount1);

    if (a0 <= 0 || a1 <= 0) return null;

    const ratio = a1 / a0;
    return `Creating pool at ${ratio.toFixed(4)} ${token1.symbol} per ${token0.symbol}`;
  }, [watchedAmount0, watchedAmount1, token0, token1]);

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
      case 'checking-pool':
        return 'Checking pool...';
      case 'initializing-pool':
        return 'Creating pool...';
      case 'checking-balances':
        return 'Checking balances...';
      case 'wrapping-token0':
        return `Wrapping ${token0?.symbol || 'Token0'}...`;
      case 'wrapping-token1':
        return `Wrapping ${token1?.symbol || 'Token1'}...`;
      case 'unwrapping-token0':
        return `Unwrapping ${token0?.symbol || 'Token0'}...`;
      case 'unwrapping-token1':
        return `Unwrapping ${token1?.symbol || 'Token1'}...`;
      case 'checking-token0':
        return 'Checking allowance...';
      case 'approving-token0':
        return `Approving ${token0?.symbol || 'Token0'}...`;
      case 'approving-token0-encrypted':
        return `Approving ${token0?.symbol || 'Token0'} (encrypted)...`;
      case 'checking-token1':
        return 'Checking allowance...';
      case 'approving-token1':
        return `Approving ${token1?.symbol || 'Token1'}...`;
      case 'approving-token1-encrypted':
        return `Approving ${token1?.symbol || 'Token1'} (encrypted)...`;
      case 'encrypting':
        return 'Encrypting amounts...';
      case 'adding-liquidity':
        return 'Adding liquidity...';
      case 'complete':
        return 'Done';
      case 'error':
        return 'Try Again';
      default:
        // If pool is not initialized, we'll create it automatically
        if (!isInitialized) {
          return 'Create Pool & Add Liquidity';
        }
        return 'Add Liquidity';
    }
  };

  // Can add liquidity as long as we have a hook address (we'll auto-initialize if needed)
  const canAddLiquidity = !!hookAddress;

  // Show loading state while pools are being discovered (but only briefly)
  const isLoadingPools = usePoolStore(state => state.isLoadingPools);

  if (isLoadingPools) {
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

  // If no hook address available, show error
  if (!hookAddress) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Add Liquidity</CardTitle>
        </CardHeader>
        <CardContent className="py-8">
          <div className="text-center text-feather-white/60">
            <p>No FheatherX contract deployed on this network</p>
            <p className="text-sm mt-2">Switch to a supported network or deploy contracts</p>
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
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-medium">
                  {token0?.symbol || 'Token0'} Amount
                </label>
                <span className="text-xs text-feather-white/60">
                  Balance:{' '}
                  {token0?.type === 'fheerc20' ? (
                    fheBalance0.isLoading ? (
                      <span className="inline-flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span className="text-iridescent-violet">decrypting...</span>
                      </span>
                    ) : effectiveBalance0 ? (
                      parseFloat(formatUnits(effectiveBalance0.value, effectiveBalance0.decimals)).toFixed(4)
                    ) : (
                      <span className="text-iridescent-violet">encrypted</span>
                    )
                  ) : effectiveBalance0 ? (
                    parseFloat(formatUnits(effectiveBalance0.value, effectiveBalance0.decimals)).toFixed(4)
                  ) : (
                    '0'
                  )}{' '}
                  {token0?.symbol}
                </span>
              </div>
              <Input
                {...register('amount0')}
                type="text"
                inputMode="decimal"
                placeholder="0.0"
                error={!!errors.amount0}
                disabled={!token0 || isLoading}
                onFocus={() => setActiveInput('amount0')}
                data-testid="add-liquidity-amount0"
              />
              <div className="flex gap-1 mt-1">
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => handlePercentageClick(pct, true)}
                    className="px-2 py-0.5 text-xs bg-ash-gray/50 hover:bg-ash-gray rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!effectiveBalance0 || isLoading}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
              {errors.amount0 && (
                <p className="text-deep-magenta text-sm mt-1">
                  {errors.amount0.message}
                </p>
              )}
            </div>

            {/* Token 1 Input */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-medium">
                  {token1?.symbol || 'Token1'} Amount
                </label>
                <span className="text-xs text-feather-white/60">
                  Balance:{' '}
                  {token1?.type === 'fheerc20' ? (
                    fheBalance1.isLoading ? (
                      <span className="inline-flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span className="text-iridescent-violet">decrypting...</span>
                      </span>
                    ) : effectiveBalance1 ? (
                      parseFloat(formatUnits(effectiveBalance1.value, effectiveBalance1.decimals)).toFixed(4)
                    ) : (
                      <span className="text-iridescent-violet">encrypted</span>
                    )
                  ) : effectiveBalance1 ? (
                    parseFloat(formatUnits(effectiveBalance1.value, effectiveBalance1.decimals)).toFixed(4)
                  ) : (
                    '0'
                  )}{' '}
                  {token1?.symbol}
                </span>
              </div>
              <Input
                {...register('amount1')}
                type="text"
                inputMode="decimal"
                placeholder="0.0"
                error={!!errors.amount1}
                disabled={!token1 || isLoading}
                onFocus={() => setActiveInput('amount1')}
                data-testid="add-liquidity-amount1"
              />
              <div className="flex gap-1 mt-1">
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => handlePercentageClick(pct, false)}
                    className="px-2 py-0.5 text-xs bg-ash-gray/50 hover:bg-ash-gray rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!effectiveBalance1 || isLoading}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
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
                  <span className={isInitialized ? 'text-green-400' : !isLoadingPool ? 'text-blue-400' : 'text-feather-white/60'}>
                    {isLoadingPool ? 'Loading...' : isInitialized ? 'Active' : 'New Pool'}
                  </span>
                </div>

                {/* Info for new pool */}
                {!isLoadingPool && !isInitialized && (
                  <div className="text-blue-400 text-xs">
                    {priceRatioText || 'Enter amounts to set initial price ratio'}
                  </div>
                )}

                {/* Reserve syncing status for FHE pools */}
                {isInitialized && reserve0 === 0n && isSyncing && (
                  <div className="flex justify-between items-center">
                    <span className="text-feather-white/60">Reserves</span>
                    <span className="inline-flex items-center gap-1 text-iridescent-violet">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Syncing encrypted reserves...
                    </span>
                  </div>
                )}

                {/* Reserves unavailable (FHE pool, sync not triggered or failed) */}
                {isInitialized && reserve0 === 0n && !isSyncing && (
                  <div className="text-amber-400 text-xs">
                    {syncError
                      ? `Sync error: ${syncError}`
                      : 'Reserves syncing... Enter both amounts manually'}
                  </div>
                )}

                {/* Current Price (if pool exists and reserves available) */}
                {isInitialized && reserve0 > 0n && reserve1 > 0n && (
                  <div className="flex justify-between">
                    <span className="text-feather-white/60">Current Price</span>
                    <span>
                      1 {token0.symbol} = {(Number(formatUnits(reserve1, token1.decimals)) / Number(formatUnits(reserve0, token0.decimals))).toFixed(4)} {token1.symbol}
                    </span>
                  </div>
                )}

                {/* Current Reserves (if pool exists and reserves available) */}
                {isInitialized && reserve0 > 0n && (
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
                disabled={!token0 || !token1 || !canAddLiquidity || step === 'complete'}
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

      {/* Transaction Modal */}
      <TransactionModal
        isOpen={txModal.isOpen}
        onClose={txModal.closeModal}
        data={txModal.modalData}
      />
    </Card>
  );
}
