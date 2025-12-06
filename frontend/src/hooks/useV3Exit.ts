'use client';

import { useState, useCallback } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { BucketSide } from '@/types/bucket';
import { PHEATHERX_V3_ABI } from '@/lib/contracts/pheatherXv3Abi';
import { PHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { useBucketStore } from '@/stores/bucketStore';
import { isValidTick } from '@/lib/constants';

// ============================================================================
// Types
// ============================================================================

export type ExitStep =
  | 'idle'
  | 'validating'
  | 'exiting'
  | 'confirming'
  | 'complete'
  | 'error';

export interface ExitParams {
  tick: number;
  side: BucketSide;
}

export interface UseV3ExitReturn {
  exit: (params: ExitParams) => Promise<`0x${string}` | null>;
  step: ExitStep;
  isExiting: boolean;
  hash: `0x${string}` | null;
  error: Error | null;
  reset: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for exiting a position completely (claim + withdraw all unfilled)
 * This calls the contract's exit() function which:
 * - Withdraws all unfilled liquidity back to the user
 * - Claims all proceeds from filled orders
 * - Clears the user's position
 */
export function useV3Exit(): UseV3ExitReturn {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [step, setStep] = useState<ExitStep>('idle');
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const { setLoadingPositions, removePosition } = useBucketStore();

  const reset = useCallback(() => {
    setStep('idle');
    setHash(null);
    setError(null);
  }, []);

  const exit = useCallback(
    async (params: ExitParams): Promise<`0x${string}` | null> => {
      const { tick, side } = params;

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

        const contractAddress = PHEATHERX_ADDRESSES[chainId];
        if (!contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
          throw new Error(`PheatherX contract not deployed on chain ${chainId}`);
        }

        // Execute exit
        setStep('exiting');
        console.log('[V3Exit] Exiting position at tick:', tick, 'side:', side);

        const exitHash = await walletClient.writeContract({
          address: contractAddress,
          abi: PHEATHERX_V3_ABI,
          functionName: 'exit',
          args: [tick, side],
        });

        setHash(exitHash);
        setStep('confirming');

        // Wait for confirmation
        const receipt = await publicClient.waitForTransactionReceipt({ hash: exitHash });
        console.log('[V3Exit] Transaction confirmed:', receipt.status);

        if (receipt.status === 'reverted') {
          throw new Error('Transaction reverted');
        }

        // Remove the position from local store since it's now empty
        removePosition(tick, side);
        setLoadingPositions(true);

        setStep('complete');
        return exitHash;
      } catch (err) {
        console.error('[V3Exit] Error:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setStep('error');
        return null;
      }
    },
    [address, chainId, publicClient, walletClient, reset, setLoadingPositions, removePosition]
  );

  return {
    exit,
    step,
    isExiting: step !== 'idle' && step !== 'complete' && step !== 'error',
    hash,
    error,
    reset,
  };
}
