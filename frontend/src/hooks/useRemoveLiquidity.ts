'use client';

import { useState, useCallback } from 'react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import { useSelectedPool } from '@/stores/poolStore';

type RemoveLiquidityStep =
  | 'idle'
  | 'withdrawing-token0'
  | 'withdrawing-token1'
  | 'complete'
  | 'error';

interface UseRemoveLiquidityResult {
  removeLiquidity: (amount0: bigint, amount1: bigint) => Promise<void>;
  step: RemoveLiquidityStep;
  isLoading: boolean;
  token0TxHash: `0x${string}` | null;
  token1TxHash: `0x${string}` | null;
  error: string | null;
  reset: () => void;
}

export function useRemoveLiquidity(): UseRemoveLiquidityResult {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { success: successToast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);
  const updateTransaction = useTransactionStore(state => state.updateTransaction);

  // Get hook address and tokens from selected pool
  const { hookAddress, token0, token1 } = useSelectedPool();

  const [step, setStep] = useState<RemoveLiquidityStep>('idle');
  const [token0TxHash, setToken0TxHash] = useState<`0x${string}` | null>(null);
  const [token1TxHash, setToken1TxHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('idle');
    setToken0TxHash(null);
    setToken1TxHash(null);
    setError(null);
  }, []);

  const withdraw = useCallback(async (
    isToken0: boolean,
    amount: bigint,
    tokenLabel: string
  ): Promise<`0x${string}`> => {
    if (!address || !hookAddress) {
      throw new Error('Wallet not connected');
    }

    try {
      const hash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_ABI,
        functionName: 'withdraw',
        args: [isToken0, amount],
      });

      addTransaction({
        hash,
        type: 'withdraw',
        description: `Remove ${tokenLabel} liquidity`,
      });

      await publicClient?.waitForTransactionReceipt({ hash });
      updateTransaction(hash, { status: 'confirmed' });
      return hash;
    } catch (err) {
      throw err;
    }
  }, [address, hookAddress, writeContractAsync, publicClient, addTransaction, updateTransaction]);

  const removeLiquidity = useCallback(async (
    amount0: bigint,
    amount1: bigint
  ): Promise<void> => {
    setError(null);

    if (!hookAddress) {
      setError('No pool selected');
      setStep('error');
      return;
    }

    try {
      // Withdraw Token 0
      if (amount0 > 0n) {
        setStep('withdrawing-token0');
        const hash0 = await withdraw(true, amount0, token0?.symbol || 'Token0');
        setToken0TxHash(hash0);
      }

      // Withdraw Token 1
      if (amount1 > 0n) {
        setStep('withdrawing-token1');
        const hash1 = await withdraw(false, amount1, token1?.symbol || 'Token1');
        setToken1TxHash(hash1);
      }

      setStep('complete');
      successToast('Liquidity removed successfully');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove liquidity';
      setError(message);
      setStep('error');
      errorToast('Failed to remove liquidity', message);
    }
  }, [hookAddress, token0, token1, withdraw, successToast, errorToast]);

  const isLoading = step !== 'idle' && step !== 'complete' && step !== 'error';

  return {
    removeLiquidity,
    step,
    isLoading,
    token0TxHash,
    token1TxHash,
    error,
    reset,
  };
}
