'use client';

import { useState, useCallback } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { BucketSide } from '@/types/bucket';
import { PHEATHERX_V3_ABI } from '@/lib/contracts/pheatherXv3Abi';
import { PHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { encryptUint128, isSessionValid } from '@/lib/fhe/singleton';
import { useBucketStore } from '@/stores/bucketStore';
import { isValidTick } from '@/lib/constants';

// ============================================================================
// Types
// ============================================================================

export type WithdrawStep =
  | 'idle'
  | 'validating'
  | 'encrypting'
  | 'withdrawing'
  | 'confirming'
  | 'complete'
  | 'error';

export interface WithdrawParams {
  tick: number;
  side: BucketSide;
  amount: bigint;
}

export interface UseV3WithdrawReturn {
  withdraw: (params: WithdrawParams) => Promise<`0x${string}` | null>;
  step: WithdrawStep;
  isWithdrawing: boolean;
  hash: `0x${string}` | null;
  error: Error | null;
  reset: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useV3Withdraw(): UseV3WithdrawReturn {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [step, setStep] = useState<WithdrawStep>('idle');
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const setLoadingPositions = useBucketStore(state => state.setLoadingPositions);

  const reset = useCallback(() => {
    setStep('idle');
    setHash(null);
    setError(null);
  }, []);

  const withdraw = useCallback(
    async (params: WithdrawParams): Promise<`0x${string}` | null> => {
      const { tick, side, amount } = params;

      // Reset state
      reset();
      setStep('validating');

      try {
        // Validation
        if (!address || !chainId || !publicClient || !walletClient) {
          throw new Error('Wallet not connected');
        }

        if (!isValidTick(tick)) {
          throw new Error(`Invalid tick: ${tick}. Must be multiple of TICK_SPACING within range.`);
        }

        if (amount <= 0n) {
          throw new Error('Amount must be greater than 0');
        }

        if (!isSessionValid()) {
          throw new Error('FHE session not initialized. Please initialize first.');
        }

        const contractAddress = PHEATHERX_ADDRESSES[chainId];
        if (!contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
          throw new Error(`FheatherX contract not deployed on chain ${chainId}`);
        }

        // Step 1: Encrypt amount
        setStep('encrypting');
        console.log('[V3Withdraw] Encrypting amount:', amount.toString());
        const encryptedBytes = await encryptUint128(amount);

        // Convert to hex for the InEuint128 tuple
        const encryptedHex = `0x${Array.from(encryptedBytes)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')}` as `0x${string}`;

        // Step 2: Execute withdraw
        setStep('withdrawing');
        console.log('[V3Withdraw] Withdrawing from tick:', tick, 'side:', side);

        const withdrawHash = await walletClient.writeContract({
          address: contractAddress,
          abi: PHEATHERX_V3_ABI,
          functionName: 'withdraw',
          args: [
            tick,
            side,
            { data: encryptedHex }, // InEuint128 tuple
          ],
        });

        setHash(withdrawHash);
        setStep('confirming');

        // Wait for confirmation
        const receipt = await publicClient.waitForTransactionReceipt({ hash: withdrawHash });
        console.log('[V3Withdraw] Transaction confirmed:', receipt.status);

        if (receipt.status === 'reverted') {
          throw new Error('Transaction reverted');
        }

        // Mark positions as needing refresh
        setLoadingPositions(true);

        setStep('complete');
        return withdrawHash;
      } catch (err) {
        console.error('[V3Withdraw] Error:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setStep('error');
        return null;
      }
    },
    [address, chainId, publicClient, walletClient, reset, setLoadingPositions]
  );

  return {
    withdraw,
    step,
    isWithdrawing: step !== 'idle' && step !== 'complete' && step !== 'error',
    hash,
    error,
    reset,
  };
}
