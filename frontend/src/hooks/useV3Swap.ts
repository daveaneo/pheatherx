'use client';

import { useState, useCallback } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { parseAbi } from 'viem';
import { PHEATHERX_V3_ABI } from '@/lib/contracts/pheatherXv3Abi';
import { PHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { useBucketStore } from '@/stores/bucketStore';

// ============================================================================
// Types
// ============================================================================

export type SwapStep =
  | 'idle'
  | 'validating'
  | 'approving'
  | 'swapping'
  | 'confirming'
  | 'complete'
  | 'error';

export interface SwapParams {
  /** True = sell token0 for token1, False = sell token1 for token0 */
  zeroForOne: boolean;
  /** Amount of input token */
  amountIn: bigint;
  /** Minimum output amount (slippage protection) */
  minAmountOut: bigint;
}

export interface SwapResult {
  hash: `0x${string}`;
  amountOut: bigint;
}

export interface UseV3SwapReturn {
  swap: (params: SwapParams) => Promise<SwapResult | null>;
  step: SwapStep;
  isSwapping: boolean;
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

export function useV3Swap(): UseV3SwapReturn {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [step, setStep] = useState<SwapStep>('idle');
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const setReserves = useBucketStore(state => state.setReserves);

  const reset = useCallback(() => {
    setStep('idle');
    setHash(null);
    setError(null);
  }, []);

  const swap = useCallback(
    async (params: SwapParams): Promise<SwapResult | null> => {
      const { zeroForOne, amountIn, minAmountOut } = params;

      // Reset state
      reset();
      setStep('validating');

      try {
        // Validation
        if (!address || !chainId || !publicClient || !walletClient) {
          throw new Error('Wallet not connected');
        }

        if (amountIn <= 0n) {
          throw new Error('Amount must be greater than 0');
        }

        const contractAddress = PHEATHERX_ADDRESSES[chainId];
        if (!contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
          throw new Error(`FheatherX contract not deployed on chain ${chainId}`);
        }

        // Get token addresses from contract
        const [token0, token1] = await Promise.all([
          publicClient.readContract({
            address: contractAddress,
            abi: PHEATHERX_V3_ABI,
            functionName: 'token0',
          }) as Promise<`0x${string}`>,
          publicClient.readContract({
            address: contractAddress,
            abi: PHEATHERX_V3_ABI,
            functionName: 'token1',
          }) as Promise<`0x${string}`>,
        ]);

        // Determine input token based on swap direction
        const inputToken = zeroForOne ? token0 : token1;

        // Step 1: Check and request approval if needed
        setStep('approving');
        const currentAllowance = await publicClient.readContract({
          address: inputToken,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, contractAddress],
        }) as bigint;

        if (currentAllowance < amountIn) {
          console.log('[V3Swap] Requesting approval for:', amountIn.toString());
          const approvalHash = await walletClient.writeContract({
            address: inputToken,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [contractAddress, amountIn],
          });

          // Wait for approval confirmation
          await publicClient.waitForTransactionReceipt({ hash: approvalHash });
          console.log('[V3Swap] Approval confirmed');
        }

        // Step 2: Execute swap
        setStep('swapping');
        console.log('[V3Swap] Executing swap:', { zeroForOne, amountIn: amountIn.toString(), minAmountOut: minAmountOut.toString() });

        const swapHash = await walletClient.writeContract({
          address: contractAddress,
          abi: PHEATHERX_V3_ABI,
          functionName: 'swap',
          args: [zeroForOne, amountIn, minAmountOut],
        });

        setHash(swapHash);
        setStep('confirming');

        // Wait for confirmation
        const receipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
        console.log('[V3Swap] Transaction confirmed:', receipt.status);

        if (receipt.status === 'reverted') {
          throw new Error('Transaction reverted - possibly slippage exceeded');
        }

        // Parse swap event to get actual output
        let amountOut = 0n;
        for (const log of receipt.logs) {
          // Look for Swap event
          if (log.topics[0] === '0x0000000000000000000000000000000000000000000000000000000000000000') {
            // This would need proper event parsing - simplified for now
          }
        }

        // Refresh reserves after swap
        const [newReserve0, newReserve1] = await Promise.all([
          publicClient.readContract({
            address: contractAddress,
            abi: PHEATHERX_V3_ABI,
            functionName: 'reserve0',
          }) as Promise<bigint>,
          publicClient.readContract({
            address: contractAddress,
            abi: PHEATHERX_V3_ABI,
            functionName: 'reserve1',
          }) as Promise<bigint>,
        ]);
        setReserves(newReserve0, newReserve1);

        setStep('complete');
        return { hash: swapHash, amountOut };
      } catch (err) {
        console.error('[V3Swap] Error:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setStep('error');
        return null;
      }
    },
    [address, chainId, publicClient, walletClient, reset, setReserves]
  );

  return {
    swap,
    step,
    isSwapping: step !== 'idle' && step !== 'complete' && step !== 'error',
    hash,
    error,
    reset,
  };
}
