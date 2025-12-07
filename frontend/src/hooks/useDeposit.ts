'use client';

import { useState, useCallback } from 'react';
import { useAccount, useChainId, useWriteContract, usePublicClient, useWalletClient } from 'wagmi';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { ERC20_ABI } from '@/lib/contracts/erc20Abi';
import { isNativeEth } from '@/lib/tokens';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import { useSelectedPool } from '@/stores/poolStore';

type DepositStep = 'idle' | 'checking' | 'approving' | 'depositing' | 'complete' | 'error';

// Debug logger for deposit flow
const debugLog = (stage: string, data?: unknown) => {
  console.log(`[Deposit Debug] ${stage}`, data !== undefined ? data : '');
};

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
  const { address, isConnected, connector } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { writeContractAsync } = useWriteContract();
  const { success: successToast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);
  const updateTransaction = useTransactionStore(state => state.updateTransaction);

  // Get addresses from selected pool (multi-pool support)
  const { hookAddress, token0, token1 } = useSelectedPool();
  const token0Address = token0?.address;
  const token1Address = token1?.address;

  // Log connection state on mount
  debugLog('Hook initialized', {
    address,
    isConnected,
    connectorName: connector?.name,
    chainId,
    hookAddress,
    token0Address,
    token1Address,
    hasWalletClient: !!walletClient,
    hasPublicClient: !!publicClient,
  });

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

  const getTokenAddress = useCallback((isToken0: boolean): `0x${string}` | undefined => {
    return isToken0 ? token0Address : token1Address;
  }, [token0Address, token1Address]);

  /**
   * Check if approval is needed for the deposit
   */
  const checkNeedsApproval = useCallback(async (
    isToken0: boolean,
    amount: bigint
  ): Promise<boolean> => {
    debugLog('checkNeedsApproval called', { isToken0, amount: amount.toString() });

    const tokenAddress = getTokenAddress(isToken0);
    if (!address || !hookAddress || !publicClient || !tokenAddress) {
      debugLog('checkNeedsApproval: missing deps', { address, hookAddress, hasPublicClient: !!publicClient, tokenAddress });
      return false;
    }

    debugLog('checkNeedsApproval: token address', { tokenAddress, isToken0 });

    // Native ETH doesn't need approval
    if (isNativeEth(tokenAddress)) {
      debugLog('checkNeedsApproval: native ETH, no approval needed');
      return false;
    }

    try {
      debugLog('checkNeedsApproval: reading allowance from chain');
      const allowance = await publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, hookAddress],
      });

      const needsApproval = (allowance as bigint) < amount;
      debugLog('checkNeedsApproval: result', {
        allowance: (allowance as bigint).toString(),
        amount: amount.toString(),
        needsApproval
      });
      return needsApproval;
    } catch (err) {
      debugLog('checkNeedsApproval: ERROR', err);
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
    debugLog('approve called', { isToken0, amount: amount.toString() });

    const tokenAddress = getTokenAddress(isToken0);
    if (!address || !hookAddress || !tokenAddress) {
      debugLog('approve: missing deps', { address, hookAddress, tokenAddress });
      throw new Error('Wallet not connected or no pool selected');
    }

    debugLog('approve: token address', { tokenAddress });

    if (isNativeEth(tokenAddress)) {
      debugLog('approve: native ETH, skipping');
      throw new Error('Native ETH does not require approval');
    }

    setStep('approving');
    setError(null);

    try {
      debugLog('approve: calling writeContractAsync', {
        tokenAddress,
        spender: hookAddress,
        amount: amount.toString()
      });

      const hash = await writeContractAsync({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [hookAddress, amount],
      });

      debugLog('approve: tx submitted', { hash });
      setApprovalHash(hash);

      addTransaction({
        hash,
        type: 'approve',
        description: `Approve ${isToken0 ? 'Token0' : 'Token1'} for deposit`,
      });

      debugLog('approve: waiting for receipt');
      // Wait for confirmation
      await publicClient?.waitForTransactionReceipt({ hash });

      debugLog('approve: confirmed');
      updateTransaction(hash, { status: 'confirmed' });
      successToast('Approval confirmed');
      return hash;
    } catch (err: unknown) {
      debugLog('approve: ERROR', {
        error: err,
        name: err instanceof Error ? err.name : 'Unknown',
        message: err instanceof Error ? err.message : String(err),
        // Check for specific wallet errors
        code: (err as { code?: number })?.code,
        details: (err as { details?: string })?.details,
      });
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
    debugLog('deposit called', { isToken0, amount: amount.toString() });

    const tokenAddress = getTokenAddress(isToken0);
    if (!address || !hookAddress || !tokenAddress) {
      debugLog('deposit: missing deps', { address, hookAddress, tokenAddress });
      throw new Error('Wallet not connected or no pool selected');
    }

    const isNative = isNativeEth(tokenAddress);
    debugLog('deposit: token info', { tokenAddress, isNative });

    setStep('depositing');
    setError(null);

    try {
      debugLog('deposit: calling writeContractAsync', {
        hookAddress,
        isToken0,
        amount: amount.toString(),
      });

      // Note: deposit function is nonpayable, so no value is sent
      // Native ETH support would require a different contract function (depositETH)
      const hash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_ABI,
        functionName: 'deposit' as const,
        args: [isToken0, amount] as const,
      });

      debugLog('deposit: tx submitted', { hash });
      setDepositHash(hash);

      addTransaction({
        hash,
        type: 'deposit',
        description: `Deposit ${isToken0 ? 'Token0' : 'Token1'}`,
      });

      debugLog('deposit: waiting for receipt');
      // Wait for confirmation
      await publicClient?.waitForTransactionReceipt({ hash });

      debugLog('deposit: confirmed');
      updateTransaction(hash, { status: 'confirmed' });
      setStep('complete');
      successToast('Deposit confirmed');
      return hash;
    } catch (err: unknown) {
      debugLog('deposit: ERROR', {
        error: err,
        name: err instanceof Error ? err.name : 'Unknown',
        message: err instanceof Error ? err.message : String(err),
        // Check for specific wallet errors
        code: (err as { code?: number })?.code,
        details: (err as { details?: string })?.details,
        cause: (err as { cause?: unknown })?.cause,
        shortMessage: (err as { shortMessage?: string })?.shortMessage,
      });

      // Better error message parsing
      let message = 'Deposit failed';
      if (err instanceof Error) {
        // Check for common wallet rejection patterns
        if (err.message.includes('User rejected') || err.message.includes('user rejected')) {
          message = 'Transaction was not signed. Please check your wallet - it may need you to approve the request.';
        } else if (err.message.includes('insufficient funds')) {
          message = 'Insufficient funds for this transaction';
        } else {
          message = err.message;
        }
      }

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
    debugLog('approveAndDeposit called', { isToken0, amount: amount.toString() });
    setStep('checking');
    setError(null);

    try {
      // Check if approval needed
      debugLog('approveAndDeposit: checking approval');
      const needsApproval = await checkNeedsApproval(isToken0, amount);
      debugLog('approveAndDeposit: needsApproval =', needsApproval);

      if (needsApproval) {
        debugLog('approveAndDeposit: starting approval');
        await approve(isToken0, amount);
        debugLog('approveAndDeposit: approval complete');
      }

      debugLog('approveAndDeposit: starting deposit');
      await deposit(isToken0, amount);
      debugLog('approveAndDeposit: deposit complete');
    } catch (err) {
      // Error already handled in individual functions
      debugLog('approveAndDeposit: ERROR in flow', err);
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
