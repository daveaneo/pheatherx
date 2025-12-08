'use client';

import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { FHEATHERX_V5_ABI, BucketSide, type BucketSideType } from '@/lib/contracts/fheatherXv5Abi';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import { useSelectedPool } from '@/stores/poolStore';

type ClosePositionStep = 'idle' | 'closing' | 'complete' | 'error';

export interface Position {
  poolId: `0x${string}`;
  tick: number;
  side: BucketSideType;
  /** Display label for the position */
  label?: string;
}

interface UseClosePositionResult {
  closePosition: (poolId: `0x${string}`, tick: number, side: BucketSideType) => Promise<`0x${string}`>;
  step: ClosePositionStep;
  isClosing: boolean;
  txHash: `0x${string}` | null;
  error: string | null;
  reset: () => void;
}

/**
 * Hook to close a position (exit) from a limit order bucket.
 *
 * Calls the contract's `exit(poolId, tick, side)` function which:
 * 1. Withdraws any unfilled deposit tokens
 * 2. Claims all proceeds from filled orders
 * 3. Resets the user's position in that bucket
 */
export function useClosePosition(): UseClosePositionResult {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { success: successToast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);
  const updateTransaction = useTransactionStore(state => state.updateTransaction);

  // Get hook address from selected pool (multi-pool support)
  const { hookAddress } = useSelectedPool();

  const [step, setStep] = useState<ClosePositionStep>('idle');
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('idle');
    setTxHash(null);
    setError(null);
  }, []);

  /**
   * Close/exit a position at the given tick and side
   */
  const closePosition = useCallback(async (
    poolId: `0x${string}`,
    tick: number,
    side: BucketSideType
  ): Promise<`0x${string}`> => {
    if (!address || !hookAddress) {
      throw new Error('Wallet not connected');
    }

    setStep('closing');
    setError(null);

    try {
      const sideLabel = side === BucketSide.BUY ? 'Buy' : 'Sell';
      const price = Math.pow(1.0001, tick).toFixed(4);

      const hash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_V5_ABI,
        functionName: 'exit',
        args: [poolId, tick, side],
      });

      setTxHash(hash);

      addTransaction({
        hash,
        type: 'closePosition',
        description: `Close ${sideLabel} position at tick ${tick} (~$${price})`,
      });

      // Wait for confirmation
      await publicClient?.waitForTransactionReceipt({ hash });

      updateTransaction(hash, { status: 'confirmed' });
      setStep('complete');
      successToast('Position closed successfully', 'Your tokens have been returned to your wallet.');
      return hash;
    } catch (err) {
      let message = 'Failed to close position';

      if (err instanceof Error) {
        // Parse common error scenarios
        if (err.message.includes('User rejected') || err.message.includes('user rejected')) {
          message = 'Transaction cancelled.';
        } else if (err.message.includes('insufficient funds') || err.message.includes('Insufficient')) {
          message = 'Not enough gas. Please try again with more ETH.';
        } else if (err.message.includes('Pausable: paused') || err.message.includes('paused')) {
          message = 'Trading is temporarily paused.';
        } else if (err.message.includes('execution reverted')) {
          message = 'Transaction failed. Position may already be closed.';
        } else {
          message = err.message;
        }
      }

      setError(message);
      setStep('error');
      errorToast('Close position failed', message);
      throw err;
    }
  }, [address, hookAddress, publicClient, writeContractAsync, addTransaction, updateTransaction, successToast, errorToast]);

  return {
    closePosition,
    step,
    isClosing: step === 'closing',
    txHash,
    error,
    reset,
  };
}
