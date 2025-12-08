'use client';

import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient, useReadContract } from 'wagmi';
import { FHERC20_ABI } from '@/lib/contracts/fherc20Abi';
import { ERC20_ABI } from '@/lib/contracts/erc20Abi';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import type { Token } from '@/lib/tokens';

type WrapStep = 'idle' | 'checking' | 'approving' | 'wrapping' | 'complete' | 'error';

interface UseWrapResult {
  wrap: (amount: bigint) => Promise<`0x${string}`>;
  checkNeedsApproval: (amount: bigint) => Promise<boolean>;
  approve: (amount: bigint) => Promise<`0x${string}`>;
  wrapWithApproval: (amount: bigint) => Promise<void>;
  step: WrapStep;
  isApproving: boolean;
  isWrapping: boolean;
  approvalHash: `0x${string}` | null;
  wrapHash: `0x${string}` | null;
  error: string | null;
  reset: () => void;
}

/**
 * Hook to wrap ERC20 tokens to FHERC20
 *
 * @param erc20Token - The ERC20 token to wrap
 * @param fherc20Token - The FHERC20 token (wrapper)
 */
export function useWrap(
  erc20Token: Token | undefined,
  fherc20Token: Token | undefined
): UseWrapResult {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { success: successToast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);
  const updateTransaction = useTransactionStore(state => state.updateTransaction);

  const [step, setStep] = useState<WrapStep>('idle');
  const [approvalHash, setApprovalHash] = useState<`0x${string}` | null>(null);
  const [wrapHash, setWrapHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const erc20Address = erc20Token?.address;
  const fherc20Address = fherc20Token?.address;

  const reset = useCallback(() => {
    setStep('idle');
    setApprovalHash(null);
    setWrapHash(null);
    setError(null);
  }, []);

  /**
   * Check if approval is needed for wrapping
   */
  const checkNeedsApproval = useCallback(async (amount: bigint): Promise<boolean> => {
    if (!address || !erc20Address || !fherc20Address || !publicClient) {
      return false;
    }

    try {
      const allowance = await publicClient.readContract({
        address: erc20Address,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, fherc20Address],
      });

      return (allowance as bigint) < amount;
    } catch (err) {
      console.error('Failed to check allowance:', err);
      return true;
    }
  }, [address, erc20Address, fherc20Address, publicClient]);

  /**
   * Approve FHERC20 contract to spend ERC20 tokens
   */
  const approve = useCallback(async (amount: bigint): Promise<`0x${string}`> => {
    if (!address || !erc20Address || !fherc20Address) {
      throw new Error('Missing addresses');
    }

    setStep('approving');
    setError(null);

    try {
      const hash = await writeContractAsync({
        address: erc20Address,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [fherc20Address, amount],
      });

      setApprovalHash(hash);

      addTransaction({
        hash,
        type: 'approve',
        description: `Approve ${erc20Token?.symbol || 'token'} for wrapping`,
      });

      await publicClient?.waitForTransactionReceipt({ hash });

      updateTransaction(hash, { status: 'confirmed' });
      successToast('Approval confirmed');
      return hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Approval failed';
      setError(message);
      setStep('error');
      errorToast('Approval failed', message);
      throw err;
    }
  }, [address, erc20Address, fherc20Address, erc20Token?.symbol, publicClient, writeContractAsync, addTransaction, updateTransaction, successToast, errorToast]);

  /**
   * Wrap ERC20 tokens to FHERC20
   */
  const wrap = useCallback(async (amount: bigint): Promise<`0x${string}`> => {
    if (!address || !fherc20Address) {
      throw new Error('Missing addresses');
    }

    setStep('wrapping');
    setError(null);

    try {
      const hash = await writeContractAsync({
        address: fherc20Address,
        abi: FHERC20_ABI,
        functionName: 'wrap',
        args: [amount],
      });

      setWrapHash(hash);

      addTransaction({
        hash,
        type: 'wrap',
        description: `Wrap ${erc20Token?.symbol || 'tokens'} to ${fherc20Token?.symbol || 'FHERC20'}`,
      });

      await publicClient?.waitForTransactionReceipt({ hash });

      updateTransaction(hash, { status: 'confirmed' });
      setStep('complete');
      successToast(
        'Wrap complete',
        `Your ${erc20Token?.symbol} has been converted to ${fherc20Token?.symbol}`
      );
      return hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Wrap failed';
      setError(message);
      setStep('error');
      errorToast('Wrap failed', message);
      throw err;
    }
  }, [address, fherc20Address, erc20Token?.symbol, fherc20Token?.symbol, publicClient, writeContractAsync, addTransaction, updateTransaction, successToast, errorToast]);

  /**
   * Combined approve and wrap flow
   */
  const wrapWithApproval = useCallback(async (amount: bigint): Promise<void> => {
    setStep('checking');
    setError(null);

    try {
      const needsApproval = await checkNeedsApproval(amount);

      if (needsApproval) {
        await approve(amount);
      }

      await wrap(amount);
    } catch {
      // Error already handled in individual functions
    }
  }, [checkNeedsApproval, approve, wrap]);

  return {
    wrap,
    checkNeedsApproval,
    approve,
    wrapWithApproval,
    step,
    isApproving: step === 'approving',
    isWrapping: step === 'wrapping',
    approvalHash,
    wrapHash,
    error,
    reset,
  };
}
