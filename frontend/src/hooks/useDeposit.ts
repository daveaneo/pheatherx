'use client';

import { useState, useCallback } from 'react';
import { useAccount, useChainId, useWriteContract, usePublicClient } from 'wagmi';
import { PHEATHERX_ABI } from '@/lib/contracts/abi';
import { ERC20_ABI } from '@/lib/contracts/erc20Abi';
import { PHEATHERX_ADDRESSES, TOKEN_ADDRESSES } from '@/lib/contracts/addresses';
import { isNativeEth } from '@/lib/tokens';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';

type DepositStep = 'idle' | 'checking' | 'approving' | 'depositing' | 'complete' | 'error';

interface UseDepositResult {
  // Actions
  checkNeedsApproval: (isToken0: boolean, amount: bigint) => Promise<boolean>;
  approve: (isToken0: boolean, amount: bigint) => Promise<`0x${string}`>;
  deposit: (isToken0: boolean, amount: bigint) => Promise<`0x${string}`>;
  approveAndDeposit: (isToken0: boolean, amount: bigint) => Promise<void>;

  // State
  step: DepositStep;
  isApproving: boolean;
  isDepositing: boolean;
  approvalHash: `0x${string}` | null;
  depositHash: `0x${string}` | null;
  error: string | null;
  reset: () => void;
}

export function useDeposit(): UseDepositResult {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { success: successToast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);
  const updateTransaction = useTransactionStore(state => state.updateTransaction);

  const hookAddress = PHEATHERX_ADDRESSES[chainId];
  const token0Address = TOKEN_ADDRESSES[chainId]?.token0;
  const token1Address = TOKEN_ADDRESSES[chainId]?.token1;

  const [step, setStep] = useState<DepositStep>('idle');
  const [approvalHash, setApprovalHash] = useState<`0x${string}` | null>(null);
  const [depositHash, setDepositHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('idle');
    setApprovalHash(null);
    setDepositHash(null);
    setError(null);
  }, []);

  const getTokenAddress = useCallback((isToken0: boolean): `0x${string}` => {
    return isToken0 ? token0Address : token1Address;
  }, [token0Address, token1Address]);

  /**
   * Check if approval is needed for the deposit
   */
  const checkNeedsApproval = useCallback(async (
    isToken0: boolean,
    amount: bigint
  ): Promise<boolean> => {
    if (!address || !hookAddress || !publicClient) return false;

    const tokenAddress = getTokenAddress(isToken0);

    // Native ETH doesn't need approval
    if (isNativeEth(tokenAddress)) {
      return false;
    }

    try {
      const allowance = await publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, hookAddress],
      });

      return (allowance as bigint) < amount;
    } catch (err) {
      console.error('Failed to check allowance:', err);
      return true; // Assume approval needed if check fails
    }
  }, [address, hookAddress, publicClient, getTokenAddress]);

  /**
   * Approve ERC20 token spending
   */
  const approve = useCallback(async (
    isToken0: boolean,
    amount: bigint
  ): Promise<`0x${string}`> => {
    if (!address || !hookAddress) {
      throw new Error('Wallet not connected');
    }

    const tokenAddress = getTokenAddress(isToken0);

    if (isNativeEth(tokenAddress)) {
      throw new Error('Native ETH does not require approval');
    }

    setStep('approving');
    setError(null);

    try {
      const hash = await writeContractAsync({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [hookAddress, amount],
      });

      setApprovalHash(hash);

      addTransaction({
        hash,
        type: 'approve',
        description: `Approve ${isToken0 ? 'Token0' : 'Token1'} for deposit`,
      });

      // Wait for confirmation
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
  }, [address, hookAddress, publicClient, writeContractAsync, addTransaction, updateTransaction, successToast, errorToast, getTokenAddress]);

  /**
   * Deposit tokens into the hook
   */
  const deposit = useCallback(async (
    isToken0: boolean,
    amount: bigint
  ): Promise<`0x${string}`> => {
    if (!address || !hookAddress) {
      throw new Error('Wallet not connected');
    }

    const tokenAddress = getTokenAddress(isToken0);
    const isNative = isNativeEth(tokenAddress);

    setStep('depositing');
    setError(null);

    try {
      const hash = await writeContractAsync({
        address: hookAddress,
        abi: PHEATHERX_ABI,
        functionName: 'deposit',
        args: [isToken0, amount],
        // Send value for native ETH
        ...(isNative ? { value: amount } : {}),
      });

      setDepositHash(hash);

      addTransaction({
        hash,
        type: 'deposit',
        description: `Deposit ${isToken0 ? 'Token0' : 'Token1'}`,
      });

      // Wait for confirmation
      await publicClient?.waitForTransactionReceipt({ hash });

      updateTransaction(hash, { status: 'confirmed' });
      setStep('complete');
      successToast('Deposit confirmed');
      return hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Deposit failed';
      setError(message);
      setStep('error');
      errorToast('Deposit failed', message);
      throw err;
    }
  }, [address, hookAddress, publicClient, writeContractAsync, addTransaction, updateTransaction, successToast, errorToast, getTokenAddress]);

  /**
   * Combined approve and deposit flow
   */
  const approveAndDeposit = useCallback(async (
    isToken0: boolean,
    amount: bigint
  ): Promise<void> => {
    setStep('checking');
    setError(null);

    try {
      // Check if approval needed
      const needsApproval = await checkNeedsApproval(isToken0, amount);

      if (needsApproval) {
        await approve(isToken0, amount);
      }

      await deposit(isToken0, amount);
    } catch (err) {
      // Error already handled in individual functions
      console.error('Approve and deposit failed:', err);
    }
  }, [checkNeedsApproval, approve, deposit]);

  return {
    checkNeedsApproval,
    approve,
    deposit,
    approveAndDeposit,
    step,
    isApproving: step === 'approving',
    isDepositing: step === 'depositing',
    approvalHash,
    depositHash,
    error,
    reset,
  };
}
