'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { FHEATHERX_V6_ABI } from '@/lib/contracts/fheatherXv6Abi';

interface UsePoolReserveSyncResult {
  /** Whether a sync is currently in progress */
  isSyncing: boolean;
  /** Whether sync was attempted */
  syncAttempted: boolean;
  /** Error message if sync failed */
  syncError: string | null;
  /** Manually trigger a sync */
  triggerSync: () => void;
}

/**
 * Hook to trigger reserve sync for FHE pools
 *
 * FHE pools maintain encrypted reserves (source of truth) and plaintext cache.
 * The plaintext cache is updated via async decryption when trySyncReserves() is called.
 *
 * This hook:
 * 1. Detects when a pool is initialized but has 0 reserves in the plaintext cache
 * 2. Automatically triggers trySyncReserves() to update the cache
 * 3. Tracks sync status and errors
 *
 * @param poolId - The pool ID (bytes32)
 * @param hookAddress - The hook contract address
 * @param isInitialized - Whether the pool is initialized
 * @param reserve0 - Current plaintext reserve0 value
 * @param refetchReserves - Function to refetch reserves after sync
 */
export function usePoolReserveSync(
  poolId: `0x${string}` | undefined,
  hookAddress: `0x${string}` | undefined,
  isInitialized: boolean,
  reserve0: bigint,
  refetchReserves?: () => void
): UsePoolReserveSyncResult {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncAttempted, setSyncAttempted] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Track last poolId to reset state on pool change
  const lastPoolIdRef = useRef<string | undefined>(undefined);

  // Reset state when pool changes
  useEffect(() => {
    if (poolId !== lastPoolIdRef.current) {
      lastPoolIdRef.current = poolId;
      setIsSyncing(false);
      setSyncAttempted(false);
      setSyncError(null);
    }
  }, [poolId]);

  // Write contract hook for trySyncReserves
  const { writeContract, data: txHash, isPending, error: writeError, reset: resetWrite } = useWriteContract();

  // Wait for transaction confirmation
  const { isLoading: isConfirming, isSuccess: isConfirmed, error: txError } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Handle transaction completion
  useEffect(() => {
    if (isConfirmed) {
      setIsSyncing(false);
      // Refetch reserves after sync completes
      if (refetchReserves) {
        // Give the blockchain a moment to process the async decryption
        setTimeout(() => {
          refetchReserves();
        }, 2000);
      }
    }
  }, [isConfirmed, refetchReserves]);

  // Handle errors
  useEffect(() => {
    const err = writeError || txError;
    if (err) {
      setIsSyncing(false);
      setSyncError(err.message || 'Sync failed');
    }
  }, [writeError, txError]);

  const triggerSync = useCallback(() => {
    if (!poolId || !hookAddress || isSyncing || isPending || isConfirming) return;

    setSyncAttempted(true);
    setSyncError(null);
    setIsSyncing(true);
    resetWrite();

    try {
      writeContract({
        address: hookAddress,
        abi: FHEATHERX_V6_ABI,
        functionName: 'trySyncReserves',
        args: [poolId],
      });
    } catch (err) {
      setIsSyncing(false);
      setSyncError(err instanceof Error ? err.message : 'Failed to trigger sync');
    }
  }, [poolId, hookAddress, isSyncing, isPending, isConfirming, writeContract, resetWrite]);

  // Auto-trigger sync when pool is initialized but reserves are 0
  useEffect(() => {
    // Only auto-sync if:
    // 1. Pool is initialized (exists)
    // 2. Reserves are 0 (need sync)
    // 3. Haven't already attempted sync for this pool
    // 4. Not currently syncing
    if (
      isInitialized &&
      reserve0 === 0n &&
      poolId &&
      hookAddress &&
      !syncAttempted &&
      !isSyncing &&
      !isPending &&
      !isConfirming
    ) {
      // Small delay to avoid rapid re-triggers
      const timer = setTimeout(() => {
        triggerSync();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isInitialized, reserve0, poolId, hookAddress, syncAttempted, isSyncing, isPending, isConfirming, triggerSync]);

  return {
    isSyncing: isSyncing || isPending || isConfirming,
    syncAttempted,
    syncError,
    triggerSync,
  };
}
