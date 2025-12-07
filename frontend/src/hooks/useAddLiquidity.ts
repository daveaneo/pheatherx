'use client';

import { useState, useCallback } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { ERC20_ABI } from '@/lib/contracts/erc20Abi';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import { useSelectedPool } from '@/stores/poolStore';
import { useSmartWriteContract } from './useTestWriteContract';

// Debug logger for add liquidity flow
const debugLog = (stage: string, data?: unknown) => {
  console.log(`[AddLiquidity Debug] ${stage}`, data !== undefined ? data : '');
};

type AddLiquidityStep =
  | 'idle'
  | 'checking-token0'
  | 'approving-token0'
  | 'depositing-token0'
  | 'checking-token1'
  | 'approving-token1'
  | 'depositing-token1'
  | 'complete'
  | 'error';

interface UseAddLiquidityResult {
  addLiquidity: (amount0: bigint, amount1: bigint, poolHookAddress?: `0x${string}`) => Promise<void>;
  step: AddLiquidityStep;
  isLoading: boolean;
  token0TxHash: `0x${string}` | null;
  token1TxHash: `0x${string}` | null;
  error: string | null;
  reset: () => void;
}

export function useAddLiquidity(): UseAddLiquidityResult {
  const { address, isConnected, connector } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { writeContractAsync } = useSmartWriteContract();
  const { success: successToast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);
  const updateTransaction = useTransactionStore(state => state.updateTransaction);

  // Get selected pool from store
  const { hookAddress: selectedHookAddress, token0, token1 } = useSelectedPool();

  // Log connection state on mount
  debugLog('Hook initialized', {
    address,
    isConnected,
    connectorName: connector?.name,
    hookAddress: selectedHookAddress,
    token0Address: token0?.address,
    token1Address: token1?.address,
    hasWalletClient: !!walletClient,
    hasPublicClient: !!publicClient,
  });

  const [step, setStep] = useState<AddLiquidityStep>('idle');
  const [token0TxHash, setToken0TxHash] = useState<`0x${string}` | null>(null);
  const [token1TxHash, setToken1TxHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('idle');
    setToken0TxHash(null);
    setToken1TxHash(null);
    setError(null);
  }, []);

  const addLiquidity = useCallback(async (
    amount0: bigint,
    amount1: bigint,
    poolHookAddress?: `0x${string}`
  ): Promise<void> => {
    setError(null);

    // Use provided hook address or fall back to selected pool
    const hookAddress = poolHookAddress || selectedHookAddress;
    const token0Address = token0?.address;
    const token1Address = token1?.address;

    // Validate wallet connection
    if (!address) {
      const message = 'Wallet not connected';
      setError(message);
      setStep('error');
      errorToast('Connection Error', message);
      return;
    }

    if (!publicClient) {
      const message = 'Public client not available';
      setError(message);
      setStep('error');
      errorToast('Connection Error', message);
      return;
    }

    // Validate addresses
    if (!token0Address || !token1Address) {
      const message = 'Token addresses not configured for this pool';
      setError(message);
      setStep('error');
      errorToast('Configuration Error', message);
      return;
    }

    if (!hookAddress) {
      const message = 'No pool selected';
      setError(message);
      setStep('error');
      errorToast('Configuration Error', message);
      return;
    }

    try {
      // Token 0
      if (amount0 > 0n) {
        debugLog('Processing Token0', { amount: amount0.toString(), tokenAddress: token0Address });

        // Check allowance
        setStep('checking-token0');
        debugLog('Checking Token0 allowance');

        const allowance = await publicClient.readContract({
          address: token0Address,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, hookAddress],
        }) as bigint;

        debugLog('Token0 allowance', { allowance: allowance.toString(), needsApproval: allowance < amount0 });

        if (allowance < amount0) {
          setStep('approving-token0');
          debugLog('Approving Token0', { amount: amount0.toString() });

          const approveHash = await writeContractAsync({
            address: token0Address,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [hookAddress, amount0],
          });

          debugLog('Token0 approval tx submitted', { hash: approveHash });

          addTransaction({
            hash: approveHash,
            type: 'approve',
            description: `Approve ${token0?.symbol || 'Token0'} for liquidity`,
          });

          debugLog('Waiting for Token0 approval confirmation');
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
          updateTransaction(approveHash, { status: 'confirmed' });
          debugLog('Token0 approval confirmed');
        }

        // Deposit Token0 (no value - ERC20 deposit is nonpayable)
        setStep('depositing-token0');
        debugLog('Depositing Token0', { hookAddress, isToken0: true, amount: amount0.toString() });

        const deposit0Hash = await writeContractAsync({
          address: hookAddress,
          abi: FHEATHERX_ABI,
          functionName: 'deposit',
          args: [true, amount0],
        });

        debugLog('Token0 deposit tx submitted', { hash: deposit0Hash });
        setToken0TxHash(deposit0Hash);

        addTransaction({
          hash: deposit0Hash,
          type: 'deposit',
          description: `Add ${token0?.symbol || 'Token0'} liquidity`,
        });

        debugLog('Waiting for Token0 deposit confirmation');
        await publicClient.waitForTransactionReceipt({ hash: deposit0Hash });
        updateTransaction(deposit0Hash, { status: 'confirmed' });
        debugLog('Token0 deposit confirmed');
      }

      // Token 1
      if (amount1 > 0n) {
        debugLog('Processing Token1', { amount: amount1.toString(), tokenAddress: token1Address });

        // Check allowance
        setStep('checking-token1');
        debugLog('Checking Token1 allowance');

        const allowance = await publicClient.readContract({
          address: token1Address,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, hookAddress],
        }) as bigint;

        debugLog('Token1 allowance', { allowance: allowance.toString(), needsApproval: allowance < amount1 });

        if (allowance < amount1) {
          setStep('approving-token1');
          debugLog('Approving Token1', { amount: amount1.toString() });

          const approveHash = await writeContractAsync({
            address: token1Address,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [hookAddress, amount1],
          });

          debugLog('Token1 approval tx submitted', { hash: approveHash });

          addTransaction({
            hash: approveHash,
            type: 'approve',
            description: `Approve ${token1?.symbol || 'Token1'} for liquidity`,
          });

          debugLog('Waiting for Token1 approval confirmation');
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
          updateTransaction(approveHash, { status: 'confirmed' });
          debugLog('Token1 approval confirmed');
        }

        // Deposit Token1 (no value - ERC20 deposit is nonpayable)
        setStep('depositing-token1');
        debugLog('Depositing Token1', { hookAddress, isToken0: false, amount: amount1.toString() });

        const deposit1Hash = await writeContractAsync({
          address: hookAddress,
          abi: FHEATHERX_ABI,
          functionName: 'deposit',
          args: [false, amount1],
        });

        debugLog('Token1 deposit tx submitted', { hash: deposit1Hash });
        setToken1TxHash(deposit1Hash);

        addTransaction({
          hash: deposit1Hash,
          type: 'deposit',
          description: `Add ${token1?.symbol || 'Token1'} liquidity`,
        });

        debugLog('Waiting for Token1 deposit confirmation');
        await publicClient.waitForTransactionReceipt({ hash: deposit1Hash });
        updateTransaction(deposit1Hash, { status: 'confirmed' });
        debugLog('Token1 deposit confirmed');
      }

      debugLog('Add liquidity complete');
      setStep('complete');
      successToast('Liquidity added successfully');
    } catch (err: unknown) {
      debugLog('ERROR in add liquidity flow', {
        error: err,
        name: err instanceof Error ? err.name : 'Unknown',
        message: err instanceof Error ? err.message : String(err),
        code: (err as { code?: number })?.code,
        details: (err as { details?: string })?.details,
        cause: (err as { cause?: unknown })?.cause,
        shortMessage: (err as { shortMessage?: string })?.shortMessage,
      });

      // Better error message parsing
      let message = 'Failed to add liquidity';
      if (err instanceof Error) {
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
      errorToast('Failed to add liquidity', message);
    }
  }, [address, writeContractAsync, publicClient, selectedHookAddress, token0, token1, addTransaction, updateTransaction, successToast, errorToast]);

  const isLoading = step !== 'idle' && step !== 'complete' && step !== 'error';

  return {
    addLiquidity,
    step,
    isLoading,
    token0TxHash,
    token1TxHash,
    error,
    reset,
  };
}
