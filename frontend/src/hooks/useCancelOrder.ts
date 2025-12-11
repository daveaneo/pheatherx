'use client';

/**
 * useCancelOrder - v6 Withdraw Hook
 *
 * In v6, orders are cancelled via withdraw() function:
 * withdraw(PoolId poolId, int24 tick, BucketSide side, InEuint128 encryptedAmount)
 *
 * This withdraws unfilled shares from a position at a specific tick/side.
 */

import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { FHEATHERX_V6_ABI, type InEuint128 } from '@/lib/contracts/fheatherXv6Abi';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import { useSelectedPool } from '@/stores/poolStore';
import { useFheSession } from './useFheSession';
import { FHE_TYPES } from '@/lib/fhe-constants';

type WithdrawStep = 'idle' | 'encrypting' | 'withdrawing' | 'complete' | 'error';

// Debug logger
const debugLog = (stage: string, data?: unknown) => {
  console.log(`[Withdraw v6 Debug] ${stage}`, data !== undefined ? data : '');
};

interface UseCancelOrderResult {
  /**
   * Withdraw/cancel an order at a specific tick and side
   * @param poolId - The pool ID
   * @param tick - The tick of the position
   * @param side - The bucket side (0 = BUY, 1 = SELL)
   * @param amount - Optional specific amount to withdraw (defaults to max for full withdrawal)
   */
  withdraw: (
    poolId: `0x${string}`,
    tick: number,
    side: number,
    amount?: bigint
  ) => Promise<`0x${string}`>;
  /** @deprecated Use withdraw() instead - legacy compatibility */
  cancelOrder: (orderId: bigint) => Promise<`0x${string}`>;
  step: WithdrawStep;
  isCancelling: boolean;
  cancelHash: `0x${string}` | null;
  error: string | null;
  reset: () => void;
}

// Max uint128 for full withdrawal
const MAX_UINT128 = 2n ** 128n - 1n;

export function useCancelOrder(): UseCancelOrderResult {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { success: successToast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);
  const updateTransaction = useTransactionStore(state => state.updateTransaction);
  const { encrypt, isReady, isMock } = useFheSession();

  // Get hook address from selected pool (multi-pool support)
  const { hookAddress } = useSelectedPool();

  const [step, setStep] = useState<WithdrawStep>('idle');
  const [cancelHash, setCancelHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('idle');
    setCancelHash(null);
    setError(null);
  }, []);

  /**
   * Withdraw unfilled shares from a position
   */
  const withdraw = useCallback(async (
    poolId: `0x${string}`,
    tick: number,
    side: number,
    amount?: bigint
  ): Promise<`0x${string}`> => {
    debugLog('withdraw called', { poolId, tick, side, amount: amount?.toString() });

    if (!address || !hookAddress) {
      throw new Error('Wallet not connected');
    }

    if (!isMock && (!encrypt || !isReady)) {
      throw new Error('FHE session not ready. Please initialize FHE first.');
    }

    setStep('encrypting');
    setError(null);

    try {
      // Use provided amount or max for full withdrawal
      const withdrawAmount = amount ?? MAX_UINT128;
      debugLog('Withdrawal amount', withdrawAmount.toString());

      // Encrypt the withdrawal amount
      let encryptedAmount: InEuint128;

      if (isMock) {
        // Mock encryption for testing
        encryptedAmount = {
          ctHash: withdrawAmount,
          securityZone: 0,
          utype: FHE_TYPES.EUINT128,
          signature: '0x' as `0x${string}`,
        };
      } else {
        // Real FHE encryption
        encryptedAmount = await encrypt!(withdrawAmount);
      }

      debugLog('Encrypted amount', encryptedAmount);

      setStep('withdrawing');

      debugLog('Calling withdraw', {
        hookAddress,
        poolId,
        tick,
        side,
        encryptedAmount,
      });

      const hash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_V6_ABI,
        functionName: 'withdraw',
        args: [poolId, tick, side, encryptedAmount],
      });

      debugLog('Withdraw tx submitted', { hash });
      setCancelHash(hash);

      addTransaction({
        hash,
        type: 'withdraw',
        description: `Withdraw ${side === 0 ? 'BUY' : 'SELL'} order at tick ${tick}`,
      });

      // Wait for confirmation
      await publicClient?.waitForTransactionReceipt({ hash });

      updateTransaction(hash, { status: 'confirmed' });
      setStep('complete');
      successToast('Order withdrawn successfully');
      return hash;
    } catch (err: unknown) {
      debugLog('withdraw ERROR', err);

      let message = 'Failed to withdraw order';
      const errAny = err as { shortMessage?: string; message?: string };
      const errString = errAny.shortMessage || errAny.message || String(err);

      if (errString.includes('User rejected') || errString.includes('user rejected')) {
        message = 'Transaction was cancelled';
      } else if (errString.includes('NoPosition')) {
        message = 'No position found at this tick/side';
      } else if (errString.includes('InsufficientShares')) {
        message = 'Insufficient shares to withdraw';
      } else {
        message = errString;
      }

      setError(message);
      setStep('error');
      errorToast('Withdraw failed', message);
      throw err;
    }
  }, [address, hookAddress, publicClient, writeContractAsync, encrypt, isReady, isMock, addTransaction, updateTransaction, successToast, errorToast]);

  /**
   * @deprecated Legacy cancelOrder - use withdraw() instead
   */
  const cancelOrder = useCallback(async (_orderId: bigint): Promise<`0x${string}`> => {
    throw new Error('cancelOrder is deprecated in v6. Use withdraw(poolId, tick, side) instead.');
  }, []);

  return {
    withdraw,
    cancelOrder,
    step,
    isCancelling: step === 'encrypting' || step === 'withdrawing',
    cancelHash,
    error,
    reset,
  };
}
