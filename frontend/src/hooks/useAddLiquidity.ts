'use client';

import { useState, useCallback } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { FHEATHERX_V5_ABI } from '@/lib/contracts/fheatherXv5Abi';
import { ERC20_ABI } from '@/lib/contracts/erc20Abi';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import { useSmartWriteContract } from './useTestWriteContract';
import { getPoolIdFromTokens } from '@/lib/poolId';
import type { Token } from '@/lib/tokens';

// Debug logger for add liquidity flow
const debugLog = (stage: string, data?: unknown) => {
  console.log(`[AddLiquidity Debug] ${stage}`, data !== undefined ? data : '');
};

type AddLiquidityStep =
  | 'idle'
  | 'checking-token0'
  | 'approving-token0'
  | 'checking-token1'
  | 'approving-token1'
  | 'adding-liquidity'
  | 'complete'
  | 'error';

interface UseAddLiquidityResult {
  addLiquidity: (
    token0: Token,
    token1: Token,
    hookAddress: `0x${string}`,
    amount0: bigint,
    amount1: bigint
  ) => Promise<void>;
  step: AddLiquidityStep;
  isLoading: boolean;
  txHash: `0x${string}` | null;
  lpAmountReceived: bigint | null;
  error: string | null;
  reset: () => void;
}

export function useAddLiquidity(): UseAddLiquidityResult {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useSmartWriteContract();
  const { success: successToast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);
  const updateTransaction = useTransactionStore(state => state.updateTransaction);

  const [step, setStep] = useState<AddLiquidityStep>('idle');
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [lpAmountReceived, setLpAmountReceived] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('idle');
    setTxHash(null);
    setLpAmountReceived(null);
    setError(null);
  }, []);

  const addLiquidity = useCallback(async (
    token0: Token,
    token1: Token,
    hookAddress: `0x${string}`,
    amount0: bigint,
    amount1: bigint
  ): Promise<void> => {
    setError(null);
    setTxHash(null);
    setLpAmountReceived(null);

    debugLog('Starting add liquidity', {
      token0: token0.symbol,
      token1: token1.symbol,
      hookAddress,
      amount0: amount0.toString(),
      amount1: amount1.toString(),
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

    // Validate amounts
    if (amount0 === 0n && amount1 === 0n) {
      const message = 'Enter at least one token amount';
      setError(message);
      setStep('error');
      errorToast('Invalid Input', message);
      return;
    }

    try {
      // Compute poolId
      const poolId = getPoolIdFromTokens(token0, token1, hookAddress);
      debugLog('Computed poolId', poolId);

      // Check and approve token0 if needed
      if (amount0 > 0n) {
        setStep('checking-token0');
        debugLog('Checking token0 allowance');

        const allowance0 = await publicClient.readContract({
          address: token0.address,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, hookAddress],
        }) as bigint;

        debugLog('Token0 allowance', { allowance: allowance0.toString(), needsApproval: allowance0 < amount0 });

        if (allowance0 < amount0) {
          setStep('approving-token0');
          debugLog('Approving token0', { amount: amount0.toString() });

          const approveHash = await writeContractAsync({
            address: token0.address,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [hookAddress, amount0],
          });

          debugLog('Token0 approval tx submitted', { hash: approveHash });

          addTransaction({
            hash: approveHash,
            type: 'approve',
            description: `Approve ${token0.symbol} for liquidity`,
          });

          await publicClient.waitForTransactionReceipt({ hash: approveHash });
          updateTransaction(approveHash, { status: 'confirmed' });
          debugLog('Token0 approval confirmed');
        }
      }

      // Check and approve token1 if needed
      if (amount1 > 0n) {
        setStep('checking-token1');
        debugLog('Checking token1 allowance');

        const allowance1 = await publicClient.readContract({
          address: token1.address,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, hookAddress],
        }) as bigint;

        debugLog('Token1 allowance', { allowance: allowance1.toString(), needsApproval: allowance1 < amount1 });

        if (allowance1 < amount1) {
          setStep('approving-token1');
          debugLog('Approving token1', { amount: amount1.toString() });

          const approveHash = await writeContractAsync({
            address: token1.address,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [hookAddress, amount1],
          });

          debugLog('Token1 approval tx submitted', { hash: approveHash });

          addTransaction({
            hash: approveHash,
            type: 'approve',
            description: `Approve ${token1.symbol} for liquidity`,
          });

          await publicClient.waitForTransactionReceipt({ hash: approveHash });
          updateTransaction(approveHash, { status: 'confirmed' });
          debugLog('Token1 approval confirmed');
        }
      }

      // Add liquidity using v5 AMM function
      setStep('adding-liquidity');
      debugLog('Adding liquidity', { poolId, amount0: amount0.toString(), amount1: amount1.toString() });

      const addLiquidityHash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_V5_ABI,
        functionName: 'addLiquidity',
        args: [poolId, amount0, amount1],
      });

      debugLog('Add liquidity tx submitted', { hash: addLiquidityHash });
      setTxHash(addLiquidityHash);

      addTransaction({
        hash: addLiquidityHash,
        type: 'deposit',
        description: `Add ${token0.symbol}/${token1.symbol} liquidity`,
      });

      // Wait for confirmation and get LP tokens received
      const receipt = await publicClient.waitForTransactionReceipt({ hash: addLiquidityHash });
      updateTransaction(addLiquidityHash, { status: 'confirmed' });
      debugLog('Add liquidity confirmed', { receipt });

      // Try to parse LP amount from logs
      // Look for LiquidityAdded event: event LiquidityAdded(bytes32 indexed poolId, address indexed user, uint256 amount0, uint256 amount1, uint256 lpAmount)
      for (const log of receipt.logs) {
        try {
          // Check if this is the LiquidityAdded event (topic0)
          const eventSignature = '0x' + 'LiquidityAdded(bytes32,address,uint256,uint256,uint256)';
          // For now, just mark success - full event parsing would require viem's decodeEventLog
          debugLog('Log found', { address: log.address, topics: log.topics });
        } catch {
          // Continue if log parsing fails
        }
      }

      setStep('complete');
      successToast('Liquidity added successfully');

    } catch (err: unknown) {
      debugLog('ERROR in add liquidity flow', {
        error: err,
        name: err instanceof Error ? err.name : 'Unknown',
        message: err instanceof Error ? err.message : String(err),
      });

      // Better error message parsing
      let message = 'Failed to add liquidity';
      if (err instanceof Error) {
        if (err.message.includes('User rejected') || err.message.includes('user rejected')) {
          message = 'Transaction was cancelled';
        } else if (err.message.includes('insufficient funds')) {
          message = 'Insufficient funds for this transaction';
        } else if (err.message.includes('insufficient balance')) {
          message = 'Insufficient token balance';
        } else {
          message = err.message;
        }
      }

      setError(message);
      setStep('error');
      errorToast('Failed to add liquidity', message);
    }
  }, [address, writeContractAsync, publicClient, addTransaction, updateTransaction, successToast, errorToast]);

  const isLoading = step !== 'idle' && step !== 'complete' && step !== 'error';

  return {
    addLiquidity,
    step,
    isLoading,
    txHash,
    lpAmountReceived,
    error,
    reset,
  };
}
