'use client';

import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { FHERC20_ABI } from '@/lib/contracts/fherc20Abi';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import type { Token } from '@/lib/tokens';

type UnwrapStep = 'idle' | 'unwrapping' | 'complete' | 'error';

interface UseUnwrapResult {
  unwrap: (amount: bigint) => Promise<`0x${string}`>;
  step: UnwrapStep;
  isUnwrapping: boolean;
  unwrapHash: `0x${string}` | null;
  error: string | null;
  reset: () => void;
}

/**
 * Hook to unwrap FHERC20 tokens back to ERC20
 *
 * @param fherc20Token - The FHERC20 token to unwrap
 * @param erc20Token - The underlying ERC20 token
 */
export function useUnwrap(
  fherc20Token: Token | undefined,
  erc20Token: Token | undefined
): UseUnwrapResult {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { success: successToast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);
  const updateTransaction = useTransactionStore(state => state.updateTransaction);

  const [step, setStep] = useState<UnwrapStep>('idle');
  const [unwrapHash, setUnwrapHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fherc20Address = fherc20Token?.address;

  const reset = useCallback(() => {
    setStep('idle');
    setUnwrapHash(null);
    setError(null);
  }, []);

  /**
   * Unwrap FHERC20 tokens back to ERC20
   * Note: This requires having an initialized encrypted balance
   */
  const unwrap = useCallback(async (amount: bigint): Promise<`0x${string}`> => {
    if (!address || !fherc20Address) {
      throw new Error('Missing addresses');
    }

    setStep('unwrapping');
    setError(null);

    try {
      const hash = await writeContractAsync({
        address: fherc20Address,
        abi: FHERC20_ABI,
        functionName: 'unwrap',
        args: [amount],
      });

      setUnwrapHash(hash);

      addTransaction({
        hash,
        type: 'unwrap',
        description: `Unwrap ${fherc20Token?.symbol || 'FHERC20'} to ${erc20Token?.symbol || 'ERC20'}`,
      });

      await publicClient?.waitForTransactionReceipt({ hash });

      updateTransaction(hash, { status: 'confirmed' });
      setStep('complete');
      successToast(
        'Unwrap complete',
        `Your ${fherc20Token?.symbol} has been converted to ${erc20Token?.symbol}`
      );
      return hash;
    } catch (err) {
      let message = 'Unwrap failed';

      if (err instanceof Error) {
        // Parse common error scenarios
        if (err.message.includes('User rejected') || err.message.includes('user rejected')) {
          message = 'Transaction cancelled.';
        } else if (err.message.includes('insufficient') || err.message.includes('Insufficient')) {
          message = 'Insufficient encrypted balance. Make sure you have wrapped tokens.';
        } else if (err.message.includes('not initialized')) {
          message = 'Encrypted balance not initialized. Please wrap tokens first.';
        } else {
          message = err.message;
        }
      }

      setError(message);
      setStep('error');
      errorToast('Unwrap failed', message);
      throw err;
    }
  }, [address, fherc20Address, fherc20Token?.symbol, erc20Token?.symbol, publicClient, writeContractAsync, addTransaction, updateTransaction, successToast, errorToast]);

  return {
    unwrap,
    step,
    isUnwrapping: step === 'unwrapping',
    unwrapHash,
    error,
    reset,
  };
}
