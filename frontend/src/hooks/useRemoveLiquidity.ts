'use client';

/**
 * useRemoveLiquidity - v6 AMM Liquidity Removal Hook
 *
 * v6 signatures:
 * - removeLiquidity(PoolId poolId, uint256 lpAmount) returns (uint256 amount0, uint256 amount1)
 * - removeLiquidityEncrypted(PoolId poolId, InEuint128 lpAmount) returns (uint256 amount0, uint256 amount1)
 *
 * Note: removeLiquidityEncrypted requires both pool tokens to be FHERC20
 */

import { useState, useCallback } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { FHEATHERX_V6_ABI, type InEuint128 } from '@/lib/contracts/fheatherXv6Abi';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import { useSmartWriteContract } from './useTestWriteContract';
import { useFheSession } from './useFheSession';
import { getPoolIdFromTokens } from '@/lib/poolId';
import type { Token } from '@/lib/tokens';

// Debug logger for remove liquidity flow
const debugLog = (stage: string, data?: unknown) => {
  console.log(`[RemoveLiquidity v6 Debug] ${stage}`, data !== undefined ? data : '');
};

type RemoveLiquidityStep =
  | 'idle'
  | 'encrypting'
  | 'removing-liquidity'
  | 'complete'
  | 'error';

interface UseRemoveLiquidityResult {
  // Plaintext removal (works with all pool types)
  removeLiquidity: (
    token0: Token,
    token1: Token,
    hookAddress: `0x${string}`,
    lpAmount: bigint
  ) => Promise<void>;
  // Encrypted removal (requires both tokens to be FHERC20)
  removeLiquidityEncrypted: (
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
  const { encrypt, isReady: fheReady, isMock: fheMock } = useFheSession();

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

  /**
   * Remove liquidity using plaintext LP amount
   */
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

    if (lpAmount === 0n) {
      const message = 'Enter LP amount to remove';
      setError(message);
      setStep('error');
      errorToast('Invalid Input', message);
      return;
    }

    try {
      const poolId = getPoolIdFromTokens(token0, token1, hookAddress);
      debugLog('Computed poolId', poolId);

      setStep('removing-liquidity');
      debugLog('Removing liquidity', { poolId, lpAmount: lpAmount.toString() });

      const removeLiquidityHash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_V6_ABI,
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

      const receipt = await publicClient.waitForTransactionReceipt({ hash: removeLiquidityHash });
      updateTransaction(removeLiquidityHash, { status: 'confirmed' });
      debugLog('Remove liquidity confirmed', { receipt });

      setStep('complete');
      successToast('Liquidity removed successfully');

    } catch (err: unknown) {
      debugLog('ERROR in remove liquidity flow', {
        error: err,
        name: err instanceof Error ? err.name : 'Unknown',
        message: err instanceof Error ? err.message : String(err),
      });

      let message = 'Failed to remove liquidity';
      const errAny = err as { shortMessage?: string; message?: string };
      const errString = errAny.shortMessage || errAny.message || String(err);

      if (errString.includes('User rejected') || errString.includes('user rejected')) {
        message = 'Transaction was cancelled';
      } else if (errString.includes('insufficient LP') || errString.includes('InsufficientBalance')) {
        message = 'Insufficient LP token balance';
      } else if (errString.includes('ZeroAmount')) {
        message = 'LP amount must be greater than 0';
      } else {
        message = errString;
      }

      setError(message);
      setStep('error');
      errorToast('Failed to remove liquidity', message);
    }
  }, [address, writeContractAsync, publicClient, addTransaction, updateTransaction, successToast, errorToast]);

  /**
   * Remove liquidity with encrypted LP amount (requires FHE:FHE pool)
   */
  const removeLiquidityEncrypted = useCallback(async (
    token0: Token,
    token1: Token,
    hookAddress: `0x${string}`,
    lpAmount: bigint
  ): Promise<void> => {
    setError(null);
    setTxHash(null);
    setAmount0Received(null);
    setAmount1Received(null);

    debugLog('Starting remove liquidity encrypted', {
      token0: token0.symbol,
      token1: token1.symbol,
      hookAddress,
      lpAmount: lpAmount.toString(),
    });

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

    if (!fheMock && (!encrypt || !fheReady)) {
      const message = 'FHE session not ready. Please initialize FHE first.';
      setError(message);
      setStep('error');
      errorToast('FHE Error', message);
      return;
    }

    if (lpAmount === 0n) {
      const message = 'Enter LP amount to remove';
      setError(message);
      setStep('error');
      errorToast('Invalid Input', message);
      return;
    }

    try {
      const poolId = getPoolIdFromTokens(token0, token1, hookAddress);
      debugLog('Computed poolId for encrypted removal', poolId);

      setStep('encrypting');
      debugLog('Encrypting LP amount');

      let encLpAmount: InEuint128;

      if (fheMock) {
        encLpAmount = {
          ctHash: lpAmount,
          securityZone: 0,
          utype: 7,
          signature: '0x' as `0x${string}`,
        };
      } else {
        const encrypted = await encrypt!(lpAmount);
        encLpAmount = {
          ctHash: BigInt('0x' + Buffer.from(encrypted).toString('hex')),
          securityZone: 0,
          utype: 7,
          signature: '0x' as `0x${string}`,
        };
      }

      setStep('removing-liquidity');
      debugLog('Removing liquidity encrypted', { poolId, encLpAmount });

      const removeLiquidityHash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_V6_ABI,
        functionName: 'removeLiquidityEncrypted',
        args: [poolId, encLpAmount],
      });

      debugLog('Remove liquidity encrypted tx submitted', { hash: removeLiquidityHash });
      setTxHash(removeLiquidityHash);

      addTransaction({
        hash: removeLiquidityHash,
        type: 'withdraw',
        description: `Remove ${token0.symbol}/${token1.symbol} encrypted liquidity`,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: removeLiquidityHash });
      updateTransaction(removeLiquidityHash, { status: 'confirmed' });
      debugLog('Remove liquidity encrypted confirmed', { receipt });

      setStep('complete');
      successToast('Encrypted liquidity removed successfully');

    } catch (err: unknown) {
      debugLog('ERROR in remove liquidity encrypted flow', err);

      let message = 'Failed to remove encrypted liquidity';
      const errAny = err as { shortMessage?: string; message?: string };
      const errString = errAny.shortMessage || errAny.message || String(err);

      if (errString.includes('User rejected') || errString.includes('user rejected')) {
        message = 'Transaction was cancelled';
      } else if (errString.includes('BothTokensMustBeFherc20')) {
        message = 'Encrypted liquidity removal requires both tokens to be FHERC20. Use plaintext removeLiquidity instead.';
      } else if (errString.includes('InsufficientBalance')) {
        message = 'Insufficient LP token balance';
      } else {
        message = errString;
      }

      setError(message);
      setStep('error');
      errorToast('Failed to remove encrypted liquidity', message);
    }
  }, [address, writeContractAsync, publicClient, encrypt, fheReady, fheMock, addTransaction, updateTransaction, successToast, errorToast]);

  const isLoading = step !== 'idle' && step !== 'complete' && step !== 'error';

  return {
    removeLiquidity,
    removeLiquidityEncrypted,
    step,
    isLoading,
    txHash,
    amount0Received,
    amount1Received,
    error,
    reset,
  };
}
