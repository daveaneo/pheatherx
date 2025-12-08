'use client';

import { useState, useCallback } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { FHEATHERX_V5_ABI } from '@/lib/contracts/fheatherXv5Abi';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import { useSmartWriteContract } from './useTestWriteContract';
import { getPoolIdFromTokens } from '@/lib/poolId';
import type { Token } from '@/lib/tokens';

// Debug logger for remove liquidity flow
const debugLog = (stage: string, data?: unknown) => {
  console.log(`[RemoveLiquidity Debug] ${stage}`, data !== undefined ? data : '');
};

type RemoveLiquidityStep =
  | 'idle'
  | 'removing-liquidity'
  | 'complete'
  | 'error';

interface UseRemoveLiquidityResult {
  removeLiquidity: (
    token0: Token,
    token1: Token,
    hookAddress: `0x${string}`,
    lpAmount: bigint
  ) => Promise<void>;
  step: RemoveLiquidityStep;
  isLoading: boolean;
  txHash: `0x${string}` | null;
  amount0Received: bigint | null;
  amount1Received: bigint | null;
  error: string | null;
  reset: () => void;
}

export function useRemoveLiquidity(): UseRemoveLiquidityResult {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useSmartWriteContract();
  const { success: successToast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);
  const updateTransaction = useTransactionStore(state => state.updateTransaction);

  const [step, setStep] = useState<RemoveLiquidityStep>('idle');
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [amount0Received, setAmount0Received] = useState<bigint | null>(null);
  const [amount1Received, setAmount1Received] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('idle');
    setTxHash(null);
    setAmount0Received(null);
    setAmount1Received(null);
    setError(null);
  }, []);

  const removeLiquidity = useCallback(async (
    token0: Token,
    token1: Token,
    hookAddress: `0x${string}`,
    lpAmount: bigint
  ): Promise<void> => {
    setError(null);
    setTxHash(null);
    setAmount0Received(null);
    setAmount1Received(null);

    debugLog('Starting remove liquidity', {
      token0: token0.symbol,
      token1: token1.symbol,
      hookAddress,
      lpAmount: lpAmount.toString(),
    });

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

    // Validate LP amount
    if (lpAmount === 0n) {
      const message = 'Enter LP amount to remove';
      setError(message);
      setStep('error');
      errorToast('Invalid Input', message);
      return;
    }

    try {
      // Compute poolId
      const poolId = getPoolIdFromTokens(token0, token1, hookAddress);
      debugLog('Computed poolId', poolId);

      // Remove liquidity using v5 AMM function
      setStep('removing-liquidity');
      debugLog('Removing liquidity', { poolId, lpAmount: lpAmount.toString() });

      const removeLiquidityHash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_V5_ABI,
        functionName: 'removeLiquidity',
        args: [poolId, lpAmount],
      });

      debugLog('Remove liquidity tx submitted', { hash: removeLiquidityHash });
      setTxHash(removeLiquidityHash);

      addTransaction({
        hash: removeLiquidityHash,
        type: 'withdraw',
        description: `Remove ${token0.symbol}/${token1.symbol} liquidity`,
      });

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash: removeLiquidityHash });
      updateTransaction(removeLiquidityHash, { status: 'confirmed' });
      debugLog('Remove liquidity confirmed', { receipt });

      // Try to parse amounts from logs
      // Look for LiquidityRemoved event: event LiquidityRemoved(bytes32 indexed poolId, address indexed user, uint256 amount0, uint256 amount1, uint256 lpAmount)
      for (const log of receipt.logs) {
        try {
          debugLog('Log found', { address: log.address, topics: log.topics });
        } catch {
          // Continue if log parsing fails
        }
      }

      setStep('complete');
      successToast('Liquidity removed successfully');

    } catch (err: unknown) {
      debugLog('ERROR in remove liquidity flow', {
        error: err,
        name: err instanceof Error ? err.name : 'Unknown',
        message: err instanceof Error ? err.message : String(err),
      });

      // Better error message parsing
      let message = 'Failed to remove liquidity';
      if (err instanceof Error) {
        if (err.message.includes('User rejected') || err.message.includes('user rejected')) {
          message = 'Transaction was cancelled';
        } else if (err.message.includes('insufficient LP')) {
          message = 'Insufficient LP token balance';
        } else {
          message = err.message;
        }
      }

      setError(message);
      setStep('error');
      errorToast('Failed to remove liquidity', message);
    }
  }, [address, writeContractAsync, publicClient, addTransaction, updateTransaction, successToast, errorToast]);

  const isLoading = step !== 'idle' && step !== 'complete' && step !== 'error';

  return {
    removeLiquidity,
    step,
    isLoading,
    txHash,
    amount0Received,
    amount1Received,
    error,
    reset,
  };
}
