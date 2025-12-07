'use client';

import { useState, useCallback } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { encodeFunctionData, parseAbi } from 'viem';
import { BucketSide } from '@/types/bucket';
import { FHEATHERX_V3_ABI } from '@/lib/contracts/fheatherXv3Abi';
import { FHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { encryptUint128, isSessionValid } from '@/lib/fhe/singleton';
import { useBucketStore } from '@/stores/bucketStore';
import { getDeadline, DEFAULT_MAX_TICK_DRIFT, isValidTick } from '@/lib/constants';

// ============================================================================
// Types
// ============================================================================

export type DepositStep =
  | 'idle'
  | 'validating'
  | 'encrypting'
  | 'approving'
  | 'depositing'
  | 'confirming'
  | 'complete'
  | 'error';

export interface DepositParams {
  tick: number;
  amount: bigint;
  side: BucketSide;
  deadline?: bigint;
  maxTickDrift?: number;
}

export interface UseV3DepositReturn {
  deposit: (params: DepositParams) => Promise<`0x${string}` | null>;
  step: DepositStep;
  isDepositing: boolean;
  hash: `0x${string}` | null;
  error: Error | null;
  reset: () => void;
}

// ERC20 ABI for approval
const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

// ============================================================================
// Hook Implementation
// ============================================================================

export function useV3Deposit(): UseV3DepositReturn {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [step, setStep] = useState<DepositStep>('idle');
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const setLoadingPositions = useBucketStore(state => state.setLoadingPositions);

  const reset = useCallback(() => {
    setStep('idle');
    setHash(null);
    setError(null);
  }, []);

  const deposit = useCallback(
    async (params: DepositParams): Promise<`0x${string}` | null> => {
      const {
        tick,
        amount,
        side,
        deadline = getDeadline(),
        maxTickDrift = DEFAULT_MAX_TICK_DRIFT,
      } = params;

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

        const contractAddress = FHEATHERX_ADDRESSES[chainId];
        if (!contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
          throw new Error(`FheatherX contract not deployed on chain ${chainId}`);
        }

        // Get token addresses from contract
        const [token0, token1] = await Promise.all([
          publicClient.readContract({
            address: contractAddress,
            abi: FHEATHERX_V3_ABI,
            functionName: 'token0',
          }) as Promise<`0x${string}`>,
          publicClient.readContract({
            address: contractAddress,
            abi: FHEATHERX_V3_ABI,
            functionName: 'token1',
          }) as Promise<`0x${string}`>,
        ]);

        // Determine which token to deposit based on side
        // SELL bucket: deposit token0, BUY bucket: deposit token1
        const depositToken = side === BucketSide.SELL ? token0 : token1;

        // Step 1: Encrypt amount
        setStep('encrypting');
        console.log('[V3Deposit] Encrypting amount:', amount.toString());
        const encryptedBytes = await encryptUint128(amount);

        // Convert to hex for the InEuint128 tuple
        const encryptedHex = `0x${Array.from(encryptedBytes)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')}` as `0x${string}`;

        // Step 2: Check and request approval if needed
        setStep('approving');
        const currentAllowance = await publicClient.readContract({
          address: depositToken,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, contractAddress],
        }) as bigint;

        if (currentAllowance < amount) {
          console.log('[V3Deposit] Requesting approval for:', amount.toString());
          const approvalHash = await walletClient.writeContract({
            address: depositToken,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [contractAddress, amount],
          });

          // Wait for approval confirmation
          await publicClient.waitForTransactionReceipt({ hash: approvalHash });
          console.log('[V3Deposit] Approval confirmed');
        }

        // Step 3: Execute deposit
        setStep('depositing');
        console.log('[V3Deposit] Depositing to tick:', tick, 'side:', side);

        const depositHash = await walletClient.writeContract({
          address: contractAddress,
          abi: FHEATHERX_V3_ABI,
          functionName: 'deposit',
          args: [
            tick,
            { data: encryptedHex }, // InEuint128 tuple
            side,
            deadline,
            maxTickDrift,
          ],
        });

        setHash(depositHash);
        setStep('confirming');

        // Wait for confirmation
        const receipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
        console.log('[V3Deposit] Transaction confirmed:', receipt.status);

        if (receipt.status === 'reverted') {
          throw new Error('Transaction reverted');
        }

        // Mark positions as needing refresh
        setLoadingPositions(true);

        setStep('complete');
        return depositHash;
      } catch (err) {
        console.error('[V3Deposit] Error:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setStep('error');
        return null;
      }
    },
    [address, chainId, publicClient, walletClient, reset, setLoadingPositions]
  );

  return {
    deposit,
    step,
    isDepositing: step !== 'idle' && step !== 'complete' && step !== 'error',
    hash,
    error,
    reset,
  };
}
