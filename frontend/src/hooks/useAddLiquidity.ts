'use client';

import { useState, useCallback } from 'react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { PHEATHERX_ABI } from '@/lib/contracts/abi';
import { ERC20_ABI } from '@/lib/contracts/erc20Abi';
import { isNativeEth } from '@/lib/tokens';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import { useSelectedPool } from '@/stores/poolStore';

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
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { success: successToast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);
  const updateTransaction = useTransactionStore(state => state.updateTransaction);

  // Get selected pool from store
  const { hookAddress: selectedHookAddress, token0, token1 } = useSelectedPool();

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
        console.log('[useAddLiquidity] Processing Token0, amount:', amount0.toString());

        // Check allowance
        setStep('checking-token0');
        if (!isNativeEth(token0Address)) {
          const allowance = await publicClient.readContract({
            address: token0Address,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [address, hookAddress],
          }) as bigint;

          console.log('[useAddLiquidity] Token0 allowance:', allowance.toString());

          if (allowance < amount0) {
            setStep('approving-token0');
            console.log('[useAddLiquidity] Approving Token0...');

            const approveHash = await writeContractAsync({
              address: token0Address,
              abi: ERC20_ABI,
              functionName: 'approve',
              args: [hookAddress, amount0],
            });

            addTransaction({
              hash: approveHash,
              type: 'approve',
              description: `Approve ${token0?.symbol || 'Token0'} for liquidity`,
            });

            await publicClient.waitForTransactionReceipt({ hash: approveHash });
            updateTransaction(approveHash, { status: 'confirmed' });
            console.log('[useAddLiquidity] Token0 approved');
          }
        }

        // Deposit Token0
        setStep('depositing-token0');
        console.log('[useAddLiquidity] Depositing Token0...');

        const deposit0Hash = await writeContractAsync({
          address: hookAddress,
          abi: PHEATHERX_ABI,
          functionName: 'deposit',
          args: [true, amount0],
          ...(isNativeEth(token0Address) ? { value: amount0 } : {}),
        });

        console.log('[useAddLiquidity] Token0 deposit tx:', deposit0Hash);
        setToken0TxHash(deposit0Hash);

        addTransaction({
          hash: deposit0Hash,
          type: 'deposit',
          description: `Add ${token0?.symbol || 'Token0'} liquidity`,
        });

        await publicClient.waitForTransactionReceipt({ hash: deposit0Hash });
        updateTransaction(deposit0Hash, { status: 'confirmed' });
        console.log('[useAddLiquidity] Token0 deposited');
      }

      // Token 1
      if (amount1 > 0n) {
        console.log('[useAddLiquidity] Processing Token1, amount:', amount1.toString());

        // Check allowance
        setStep('checking-token1');
        if (!isNativeEth(token1Address)) {
          const allowance = await publicClient.readContract({
            address: token1Address,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [address, hookAddress],
          }) as bigint;

          console.log('[useAddLiquidity] Token1 allowance:', allowance.toString());

          if (allowance < amount1) {
            setStep('approving-token1');
            console.log('[useAddLiquidity] Approving Token1...');

            const approveHash = await writeContractAsync({
              address: token1Address,
              abi: ERC20_ABI,
              functionName: 'approve',
              args: [hookAddress, amount1],
            });

            addTransaction({
              hash: approveHash,
              type: 'approve',
              description: `Approve ${token1?.symbol || 'Token1'} for liquidity`,
            });

            await publicClient.waitForTransactionReceipt({ hash: approveHash });
            updateTransaction(approveHash, { status: 'confirmed' });
            console.log('[useAddLiquidity] Token1 approved');
          }
        }

        // Deposit Token1
        setStep('depositing-token1');
        console.log('[useAddLiquidity] Depositing Token1...');

        const deposit1Hash = await writeContractAsync({
          address: hookAddress,
          abi: PHEATHERX_ABI,
          functionName: 'deposit',
          args: [false, amount1],
          ...(isNativeEth(token1Address) ? { value: amount1 } : {}),
        });

        console.log('[useAddLiquidity] Token1 deposit tx:', deposit1Hash);
        setToken1TxHash(deposit1Hash);

        addTransaction({
          hash: deposit1Hash,
          type: 'deposit',
          description: `Add ${token1?.symbol || 'Token1'} liquidity`,
        });

        await publicClient.waitForTransactionReceipt({ hash: deposit1Hash });
        updateTransaction(deposit1Hash, { status: 'confirmed' });
        console.log('[useAddLiquidity] Token1 deposited');
      }

      console.log('[useAddLiquidity] Complete');
      setStep('complete');
      successToast('Liquidity added successfully');
    } catch (err) {
      console.error('[useAddLiquidity] Error:', err);
      const message = err instanceof Error ? err.message : 'Failed to add liquidity';
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
