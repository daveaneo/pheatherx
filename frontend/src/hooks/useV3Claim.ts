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

export type ClaimStep =
  | 'idle'
  | 'validating'
  | 'claiming'
  | 'confirming'
  | 'complete'
  | 'error';

export interface ClaimParams {
  tick: number;
  side: BucketSide;
}

export interface UseV3ClaimReturn {
  claim: (params: ClaimParams) => Promise<`0x${string}` | null>;
  step: ClaimStep;
  isClaiming: boolean;
  hash: `0x${string}` | null;
  error: Error | null;
  reset: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useV3Claim(): UseV3ClaimReturn {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [step, setStep] = useState<ClaimStep>('idle');
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const setLoadingPositions = useBucketStore(state => state.setLoadingPositions);

  const reset = useCallback(() => {
    setStep('idle');
    setHash(null);
    setError(null);
  }, []);

  const claim = useCallback(
    async (params: ClaimParams): Promise<`0x${string}` | null> => {
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

        // Execute claim
        setStep('claiming');
        console.log('[V3Claim] Claiming from tick:', tick, 'side:', side);

        const claimHash = await walletClient.writeContract({
          address: contractAddress,
          abi: PHEATHERX_V3_ABI,
          functionName: 'claim',
          args: [tick, side],
        });

        setHash(claimHash);
        setStep('confirming');

        // Wait for confirmation
        const receipt = await publicClient.waitForTransactionReceipt({ hash: claimHash });
        console.log('[V3Claim] Transaction confirmed:', receipt.status);

        if (receipt.status === 'reverted') {
          throw new Error('Transaction reverted');
        }

        // Mark positions as needing refresh
        setLoadingPositions(true);

        setStep('complete');
        return claimHash;
      } catch (err) {
        console.error('[V3Claim] Error:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setStep('error');
        return null;
      }
    },
    [address, chainId, publicClient, walletClient, reset, setLoadingPositions]
  );

  return {
    claim,
    step,
    isClaiming: step !== 'idle' && step !== 'complete' && step !== 'error',
    hash,
    error,
    reset,
  };
}
