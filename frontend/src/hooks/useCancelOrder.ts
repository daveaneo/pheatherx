'use client';

import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import { useSelectedPool } from '@/stores/poolStore';

type CancelOrderStep = 'idle' | 'cancelling' | 'complete' | 'error';

interface UseCancelOrderResult {
  cancelOrder: (orderId: bigint) => Promise<`0x${string}`>;
  step: CancelOrderStep;
  isCancelling: boolean;
  cancelHash: `0x${string}` | null;
  error: string | null;
  reset: () => void;
}

export function useCancelOrder(): UseCancelOrderResult {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { success: successToast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);
  const updateTransaction = useTransactionStore(state => state.updateTransaction);

  // Get hook address from selected pool (multi-pool support)
  const { hookAddress } = useSelectedPool();

  const [step, setStep] = useState<CancelOrderStep>('idle');
  const [cancelHash, setCancelHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('idle');
    setCancelHash(null);
    setError(null);
  }, []);

  /**
   * Cancel an existing order
   */
  const cancelOrder = useCallback(async (orderId: bigint): Promise<`0x${string}`> => {
    if (!address || !hookAddress) {
      throw new Error('Wallet not connected');
    }

    setStep('cancelling');
    setError(null);

    try {
      const hash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_ABI,
        functionName: 'cancelOrder',
        args: [orderId],
      });

      setCancelHash(hash);

      addTransaction({
        hash,
        type: 'cancelOrder',
        description: `Cancel order #${orderId.toString()}`,
      });

      // Wait for confirmation
      await publicClient?.waitForTransactionReceipt({ hash });

      updateTransaction(hash, { status: 'confirmed' });
      setStep('complete');
      successToast('Order cancelled');
      return hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to cancel order';
      setError(message);
      setStep('error');
      errorToast('Cancel failed', message);
      throw err;
    }
  }, [address, hookAddress, publicClient, writeContractAsync, addTransaction, updateTransaction, successToast, errorToast]);

  return {
    cancelOrder,
    step,
    isCancelling: step === 'cancelling',
    cancelHash,
    error,
    reset,
  };
}
