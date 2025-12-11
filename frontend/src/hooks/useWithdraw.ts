'use client';

/**
 * useWithdraw - v6 Limit Order Withdrawal Hook
 *
 * In v6, withdraw() is for withdrawing UNFILLED limit orders.
 * For AMM liquidity, use useRemoveLiquidity instead.
 *
 * v6 withdraw signature:
 * withdraw(PoolId poolId, int24 tick, BucketSide side, InEuint128 encryptedAmount)
 *
 * Key behavior:
 * - Withdraws unfilled portion of a limit order
 * - Amount is encrypted for privacy
 * - Use claim() to get filled proceeds
 * - Use exit() to do both withdraw + claim
 */

import { useState, useCallback } from 'react';
import { useAccount, useChainId, useWriteContract, usePublicClient } from 'wagmi';
import { FHEATHERX_V6_ABI, BucketSide, type InEuint128, type BucketSideType } from '@/lib/contracts/fheatherXv6Abi';
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

interface UseWithdrawResult {
  /**
   * Withdraw unfilled tokens from a limit order bucket
   * @param poolId - The pool ID (bytes32)
   * @param tick - The tick of the order
   * @param side - BucketSide.BUY (0) or BucketSide.SELL (1)
   * @param amount - The amount to withdraw (will be encrypted)
   */
  withdraw: (
    poolId: `0x${string}`,
    tick: number,
    side: BucketSideType,
    amount: bigint
  ) => Promise<`0x${string}`>;
  /**
   * Claim filled proceeds from a limit order
   * @param poolId - The pool ID (bytes32)
   * @param tick - The tick of the order
   * @param side - BucketSide.BUY (0) or BucketSide.SELL (1)
   */
  claim: (
    poolId: `0x${string}`,
    tick: number,
    side: BucketSideType
  ) => Promise<`0x${string}`>;
  /**
   * Exit completely - withdraw all unfilled + claim all proceeds
   * @param poolId - The pool ID (bytes32)
   * @param tick - The tick of the order
   * @param side - BucketSide.BUY (0) or BucketSide.SELL (1)
   */
  exit: (
    poolId: `0x${string}`,
    tick: number,
    side: BucketSideType
  ) => Promise<`0x${string}`>;
  step: WithdrawStep;
  isWithdrawing: boolean;
  withdrawHash: `0x${string}` | null;
  error: string | null;
  reset: () => void;
}

export function useWithdraw(): UseWithdrawResult {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { success: successToast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);
  const updateTransaction = useTransactionStore(state => state.updateTransaction);
  const { encrypt, isReady: fheReady, isMock: fheMock } = useFheSession();

  // Get hook address from selected pool
  const { hookAddress } = useSelectedPool();

  const [step, setStep] = useState<WithdrawStep>('idle');
  const [withdrawHash, setWithdrawHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('idle');
    setWithdrawHash(null);
    setError(null);
  }, []);

  /**
   * Withdraw unfilled tokens from a limit order bucket
   */
  const withdraw = useCallback(async (
    poolId: `0x${string}`,
    tick: number,
    side: BucketSideType,
    amount: bigint
  ): Promise<`0x${string}`> => {
    debugLog('withdraw called', { poolId, tick, side, amount: amount.toString() });

    if (!address || !hookAddress) {
      throw new Error('Wallet not connected or no pool selected');
    }

    // Check FHE session
    if (!fheMock && (!encrypt || !fheReady)) {
      throw new Error('FHE session not ready. Please initialize FHE first.');
    }

    setStep('encrypting');
    setError(null);

    try {
      // Encrypt the amount
      let encryptedAmount: InEuint128;

      if (fheMock) {
        // Mock encryption for testing (no CoFHE validation)
        encryptedAmount = {
          ctHash: amount,
          securityZone: 0,
          utype: FHE_TYPES.EUINT128,
          signature: '0x' as `0x${string}`,
        };
      } else {
        // Real FHE encryption - returns full struct with signature
        encryptedAmount = await encrypt!(amount);
      }

      setStep('withdrawing');

      const hash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_V6_ABI,
        functionName: 'withdraw',
        args: [poolId, tick, side, encryptedAmount],
      });

      debugLog('withdraw: tx submitted', { hash });
      setWithdrawHash(hash);

      addTransaction({
        hash,
        type: 'withdraw',
        description: `Withdraw ${side === BucketSide.BUY ? 'buy' : 'sell'} order at tick ${tick}`,
      });

      await publicClient?.waitForTransactionReceipt({ hash });

      updateTransaction(hash, { status: 'confirmed' });
      setStep('complete');
      successToast('Withdrawal confirmed');
      return hash;
    } catch (err: unknown) {
      debugLog('withdraw: ERROR', err);
      const message = err instanceof Error ? err.message : 'Withdrawal failed';
      setError(message);
      setStep('error');
      errorToast('Withdrawal failed', message);
      throw err;
    }
  }, [address, hookAddress, publicClient, writeContractAsync, encrypt, fheReady, fheMock, addTransaction, updateTransaction, successToast, errorToast]);

  /**
   * Claim filled proceeds from a limit order
   * Note: claim() does NOT require encrypted amount - it claims all available proceeds
   */
  const claim = useCallback(async (
    poolId: `0x${string}`,
    tick: number,
    side: BucketSideType
  ): Promise<`0x${string}`> => {
    debugLog('claim called', { poolId, tick, side });

    if (!address || !hookAddress) {
      throw new Error('Wallet not connected or no pool selected');
    }

    setStep('withdrawing');
    setError(null);

    try {
      const hash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_V6_ABI,
        functionName: 'claim',
        args: [poolId, tick, side],
      });

      debugLog('claim: tx submitted', { hash });
      setWithdrawHash(hash);

      addTransaction({
        hash,
        type: 'withdraw',
        description: `Claim ${side === BucketSide.BUY ? 'buy' : 'sell'} order proceeds at tick ${tick}`,
      });

      await publicClient?.waitForTransactionReceipt({ hash });

      updateTransaction(hash, { status: 'confirmed' });
      setStep('complete');
      successToast('Proceeds claimed');
      return hash;
    } catch (err: unknown) {
      debugLog('claim: ERROR', err);
      const message = err instanceof Error ? err.message : 'Claim failed';
      setError(message);
      setStep('error');
      errorToast('Claim failed', message);
      throw err;
    }
  }, [address, hookAddress, publicClient, writeContractAsync, addTransaction, updateTransaction, successToast, errorToast]);

  /**
   * Exit completely - claim all proceeds
   * Note: exit() was removed from contract for size optimization.
   * This now calls claim() only. For full exit, call withdraw() first, then claim().
   */
  const exit = useCallback(async (
    poolId: `0x${string}`,
    tick: number,
    side: BucketSideType
  ): Promise<`0x${string}`> => {
    debugLog('exit called (now uses claim)', { poolId, tick, side });

    if (!address || !hookAddress) {
      throw new Error('Wallet not connected or no pool selected');
    }

    setStep('withdrawing');
    setError(null);

    try {
      // exit() was removed - use claim() instead
      const hash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_V6_ABI,
        functionName: 'claim',
        args: [poolId, tick, side],
      });

      debugLog('exit (claim): tx submitted', { hash });
      setWithdrawHash(hash);

      addTransaction({
        hash,
        type: 'withdraw',
        description: `Claim ${side === BucketSide.BUY ? 'buy' : 'sell'} order at tick ${tick}`,
      });

      await publicClient?.waitForTransactionReceipt({ hash });

      updateTransaction(hash, { status: 'confirmed' });
      setStep('complete');
      successToast('Proceeds claimed');
      return hash;
    } catch (err: unknown) {
      debugLog('exit (claim): ERROR', err);
      const message = err instanceof Error ? err.message : 'Claim failed';
      setError(message);
      setStep('error');
      errorToast('Claim failed', message);
      throw err;
    }
  }, [address, hookAddress, publicClient, writeContractAsync, addTransaction, updateTransaction, successToast, errorToast]);

  return {
    withdraw,
    claim,
    exit,
    step,
    isWithdrawing: step === 'encrypting' || step === 'withdrawing',
    withdrawHash,
    error,
    reset,
  };
}

// Re-export BucketSide for convenience
export { BucketSide };
