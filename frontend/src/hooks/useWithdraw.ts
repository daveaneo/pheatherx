'use client';

import { useState, useCallback } from 'react';
import { useAccount, useChainId, useWriteContract, usePublicClient } from 'wagmi';
import { PHEATHERX_ABI } from '@/lib/contracts/abi';
import { PHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';

type WithdrawStep = 'idle' | 'withdrawing' | 'complete' | 'error';

interface UseWithdrawResult {
  withdraw: (isToken0: boolean, amount: bigint) => Promise<`0x${string}`>;
  step: WithdrawStep;
  isWithdrawing: boolean;
  withdrawHash: `0x${string}` | null;
  error: string | null;
  reset: () => void;
}

export function useWithdraw(): UseWithdrawResult {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { success: successToast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);
  const updateTransaction = useTransactionStore(state => state.updateTransaction);

  const hookAddress = PHEATHERX_ADDRESSES[chainId];

  const [step, setStep] = useState<WithdrawStep>('idle');
  const [withdrawHash, setWithdrawHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('idle');
    setWithdrawHash(null);
    setError(null);
  }, []);

  /**
   * Withdraw tokens from the hook
   * Note: Withdraw amount is public (uint256) - only balances are encrypted
   */
  const withdraw = useCallback(async (
    isToken0: boolean,
    amount: bigint
  ): Promise<`0x${string}`> => {
    if (!address || !hookAddress) {
      throw new Error('Wallet not connected');
    }

    setStep('withdrawing');
    setError(null);

    try {
      const hash = await writeContractAsync({
        address: hookAddress,
        abi: PHEATHERX_ABI,
        functionName: 'withdraw',
        args: [isToken0, amount],
      });

      setWithdrawHash(hash);

      addTransaction({
        hash,
        type: 'withdraw',
        description: `Withdraw ${isToken0 ? 'Token0' : 'Token1'}`,
      });

      // Wait for confirmation
      await publicClient?.waitForTransactionReceipt({ hash });

      updateTransaction(hash, { status: 'confirmed' });
      setStep('complete');
      successToast('Withdrawal confirmed');
      return hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Withdrawal failed';
      setError(message);
      setStep('error');
      errorToast('Withdrawal failed', message);
      throw err;
    }
  }, [address, hookAddress, publicClient, writeContractAsync, addTransaction, updateTransaction, successToast, errorToast]);

  return {
    withdraw,
    step,
    isWithdrawing: step === 'withdrawing',
    withdrawHash,
    error,
    reset,
  };
}
