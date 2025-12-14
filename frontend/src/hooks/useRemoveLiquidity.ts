'use client';

/**
 * useRemoveLiquidity - Multi-Version Liquidity Removal Hook
 *
 * Supports three contract types:
 * - native: Standard Uniswap v4 Position Manager (ERC:ERC pools)
 * - v8fhe: Full privacy FHE pools (encrypted LP removal)
 * - v8mixed: Mixed pools (plaintext LP removal)
 *
 * v8FHE signatures:
 * - removeLiquidity(PoolId poolId, InEuint128 lpAmount) returns (euint128, euint128) - encrypted only
 *
 * v8Mixed signatures:
 * - removeLiquidity(PoolId poolId, uint256 lpAmount) returns (uint256, uint256) - plaintext only
 */

import { useState, useCallback } from 'react';
import { useAccount, usePublicClient, useChainId } from 'wagmi';
import { type InEuint128 } from '@/lib/contracts/fheatherXv6Abi';
import { FHEATHERX_V8_FHE_ABI } from '@/lib/contracts/fheatherXv8FHE-abi';
import { FHEATHERX_V8_MIXED_ABI } from '@/lib/contracts/fheatherXv8Mixed-abi';
import { UNISWAP_V4_POSITION_MANAGER_ABI } from '@/lib/contracts/uniswapV4-abi';
import { POSITION_MANAGER_ADDRESSES } from '@/lib/contracts/addresses';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import { useSmartWriteContract } from './useTestWriteContract';
import { useFheSession } from './useFheSession';
import { getPoolIdFromTokens } from '@/lib/poolId';
import { FHE_TYPES } from '@/lib/fhe-constants';
import { useSelectedPool } from '@/stores/poolStore';
import type { Token } from '@/lib/tokens';
import type { ContractType } from '@/types/pool';

// Pool type based on token types
type PoolType = 'ERC:ERC' | 'ERC:FHE' | 'FHE:FHE';

/**
 * Determine pool type from token types
 */
function getPoolType(token0: Token, token1: Token): PoolType {
  const t0IsFhe = token0.type === 'fheerc20';
  const t1IsFhe = token1.type === 'fheerc20';

  if (t0IsFhe && t1IsFhe) return 'FHE:FHE';
  if (t0IsFhe || t1IsFhe) return 'ERC:FHE';
  return 'ERC:ERC';
}

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
  /**
   * Auto-routing remove liquidity - detects pool type and routes to correct method.
   * - FHE:FHE pools → removeLiquidityEncrypted (tokens returned to encrypted balance)
   * - ERC:FHE pools → removeLiquidity (tokens returned to plaintext balance)
   * - ERC:ERC pools → removeLiquidity
   */
  removeLiquidityAuto: (
    token0: Token,
    token1: Token,
    hookAddress: `0x${string}`,
    lpAmount: bigint
  ) => Promise<void>;
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
  const { contractType } = useSelectedPool();

  /**
   * Get ABI based on contract type
   */
  const getAbiForContractType = useCallback((type: ContractType) => {
    switch (type) {
      case 'v8fhe':
        return FHEATHERX_V8_FHE_ABI;
      case 'v8mixed':
        return FHEATHERX_V8_MIXED_ABI;
      case 'native':
      default:
        return UNISWAP_V4_POSITION_MANAGER_ABI;
    }
  }, []);

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
      const abi = getAbiForContractType(contractType);
      debugLog('Removing liquidity', { poolId, lpAmount: lpAmount.toString(), contractType });

      const removeLiquidityHash = await writeContractAsync({
        address: hookAddress,
        abi,
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
  }, [address, writeContractAsync, publicClient, addTransaction, updateTransaction, successToast, errorToast, contractType, getAbiForContractType]);

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
        // Mock encryption for testing (no CoFHE validation)
        encLpAmount = {
          ctHash: lpAmount,
          securityZone: 0,
          utype: FHE_TYPES.EUINT128,
          signature: '0x' as `0x${string}`,
        };
      } else {
        // Real FHE encryption - returns full struct with signature
        encLpAmount = await encrypt!(lpAmount);
      }

      setStep('removing-liquidity');
      // v8FHE uses removeLiquidity (encrypted-only), v6 uses removeLiquidityEncrypted
      const functionName = contractType === 'v8fhe' ? 'removeLiquidity' : 'removeLiquidityEncrypted';
      const abi = getAbiForContractType(contractType);
      debugLog('Removing liquidity encrypted', { poolId, encLpAmount, functionName, contractType });

      const removeLiquidityHash = await writeContractAsync({
        address: hookAddress,
        abi,
        functionName,
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

      // For encrypted operations, the reserves are updated asynchronously via FHE decrypt.
      // We need to call trySyncReserves to harvest the resolved decrypt results.
      // Note: Reserve sync only applies to FHE pools (v8fhe/v8mixed), not native pools.
      if (contractType === 'v8fhe' || contractType === 'v8mixed') {
        debugLog('Starting reserve sync polling for FHE pool');

        // Use the appropriate v8 ABI for reserve sync
        const fheAbi = contractType === 'v8fhe' ? FHEATHERX_V8_FHE_ABI : FHEATHERX_V8_MIXED_ABI;

        // Get initial reserves for comparison - v8 uses getReserves
        let initialReserves: [bigint, bigint] | null = null;
        try {
          initialReserves = await publicClient.readContract({
            address: hookAddress,
            abi: fheAbi,
            functionName: 'getReserves',
            args: [poolId],
          }) as [bigint, bigint];
          debugLog('Initial reserves before sync', {
            reserve0: initialReserves[0].toString(),
            reserve1: initialReserves[1].toString(),
          });
        } catch {
          // Ignore
        }

        // Poll for up to 60 seconds with 5 second intervals
        const maxAttempts = 12;
        const pollInterval = 5000;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          // Wait before trying to sync
          await new Promise(resolve => setTimeout(resolve, pollInterval));

          try {
            // Call trySyncReserves to harvest any resolved decrypts
            await writeContractAsync({
              address: hookAddress,
              abi: fheAbi,
              functionName: 'trySyncReserves',
              args: [poolId],
            });
            debugLog(`Reserve sync attempt ${attempt + 1} completed`);
          } catch (syncErr) {
            // trySyncReserves might fail if no new decrypts resolved, that's OK
            debugLog(`Reserve sync attempt ${attempt + 1} - no new decrypts`, syncErr);
          }

          // Check if reserves have been updated
          try {
            const reserves = await publicClient.readContract({
              address: hookAddress,
              abi: fheAbi,
              functionName: 'getReserves',
              args: [poolId],
            }) as [bigint, bigint];

            debugLog(`Reserve check attempt ${attempt + 1}`, {
              reserve0: reserves[0].toString(),
              reserve1: reserves[1].toString(),
            });

            // Check if reserves changed from initial values (decrypt resolved)
            if (initialReserves &&
                (reserves[0] !== initialReserves[0] || reserves[1] !== initialReserves[1])) {
              debugLog('Reserves synced successfully - values changed');
              break;
            }
          } catch {
            // Ignore read errors
          }
        }
      }

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
  }, [address, writeContractAsync, publicClient, encrypt, fheReady, fheMock, addTransaction, updateTransaction, successToast, errorToast, contractType, getAbiForContractType]);

  /**
   * Auto-routing remove liquidity - detects pool type and contract version, routes to correct method.
   *
   * v6 behavior:
   * - FHE:FHE pools → removeLiquidityEncrypted (tokens returned to encrypted balance)
   * - ERC:FHE pools → removeLiquidity (tokens returned to plaintext balance)
   * - ERC:ERC pools → removeLiquidity
   *
   * v8FHE behavior:
   * - Always uses encrypted removeLiquidity (only FHE:FHE pools supported)
   *
   * v8Mixed behavior:
   * - Always uses plaintext removeLiquidity (one ERC20, one FHERC20)
   */
  const removeLiquidityAuto = useCallback(async (
    token0: Token,
    token1: Token,
    hookAddress: `0x${string}`,
    lpAmount: bigint
  ): Promise<void> => {
    const poolType = getPoolType(token0, token1);
    debugLog('removeLiquidityAuto routing', { poolType, contractType, token0: token0.symbol, token1: token1.symbol });

    // v8 contract routing
    if (contractType === 'v8fhe') {
      // v8FHE only supports FHE:FHE pools with encrypted LP
      debugLog('Using v8FHE encrypted removeLiquidity');
      return removeLiquidityEncrypted(token0, token1, hookAddress, lpAmount);
    }

    if (contractType === 'v8mixed') {
      // v8Mixed only supports plaintext LP (one ERC20 token)
      debugLog('Using v8Mixed plaintext removeLiquidity');
      return removeLiquidity(token0, token1, hookAddress, lpAmount);
    }

    // v6 behavior (default)
    if (poolType === 'FHE:FHE') {
      // Both tokens are FHERC20 - use encrypted removal (tokens go to encrypted balance)
      return removeLiquidityEncrypted(token0, token1, hookAddress, lpAmount);
    } else {
      // ERC:ERC or ERC:FHE - use plaintext removal (tokens go to plaintext balance)
      return removeLiquidity(token0, token1, hookAddress, lpAmount);
    }
  }, [removeLiquidity, removeLiquidityEncrypted, contractType]);

  const isLoading = step !== 'idle' && step !== 'complete' && step !== 'error';

  return {
    removeLiquidityAuto,
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
