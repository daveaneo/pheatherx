'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useAccount, useChainId, usePublicClient } from 'wagmi';
import { useFheSession } from './useFheSession';
import { useFheStore } from '@/stores/fheStore';
import { usePoolStore } from '@/stores/poolStore';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { FHE_RETRY_ATTEMPTS } from '@/lib/constants';
import type { Pool } from '@/types/pool';

type RevealStatus = 'idle' | 'fetching' | 'decrypting' | 'revealed' | 'error';

interface PoolBalance {
  hookAddress: `0x${string}`;
  isToken0: boolean;
  decryptedValue: bigint | null;
}

interface UseAggregatedBalanceRevealResult {
  status: RevealStatus;
  totalBalance: bigint | null;
  poolBalances: PoolBalance[];
  error: string | null;
  progress: number;
  reveal: () => Promise<bigint | undefined>;
  hide: () => void;
  isRevealing: boolean;
  isRevealed: boolean;
}

/**
 * Hook to reveal and aggregate encrypted balances for a token across all pools
 *
 * For each pool where the token appears as token0 or token1, queries the
 * corresponding getUserBalanceToken0/1 function, decrypts, and sums.
 */
export function useAggregatedBalanceReveal(
  tokenAddress: `0x${string}`
): UseAggregatedBalanceRevealResult {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const pools = usePoolStore(state => state.pools);

  const { unseal, isReady, isMock } = useFheSession();
  const { cacheBalance, getCachedBalance } = useFheStore();

  const [status, setStatus] = useState<RevealStatus>('idle');
  const [totalBalance, setTotalBalance] = useState<bigint | null>(null);
  const [poolBalances, setPoolBalances] = useState<PoolBalance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // Find all pools where this token appears
  const relevantPools = useMemo(() => {
    return pools
      .filter(pool =>
        pool.token0.toLowerCase() === tokenAddress.toLowerCase() ||
        pool.token1.toLowerCase() === tokenAddress.toLowerCase()
      )
      .map(pool => ({
        pool,
        isToken0: pool.token0.toLowerCase() === tokenAddress.toLowerCase(),
      }));
  }, [pools, tokenAddress]);

  // Generate cache key for this token across all pools
  const cacheKey = `${address}-${chainId}-${tokenAddress}-aggregated`;

  // Check cache on mount
  useEffect(() => {
    const cached = getCachedBalance(cacheKey);
    if (cached) {
      setTotalBalance(cached.value);
      setStatus('revealed');
    }
  }, [cacheKey, getCachedBalance]);

  const reveal = useCallback(async () => {
    if (!address || !publicClient) {
      setError('Wallet not connected');
      setStatus('error');
      return;
    }

    if (relevantPools.length === 0) {
      // No pools contain this token - balance is 0
      setTotalBalance(0n);
      setPoolBalances([]);
      setStatus('revealed');
      setProgress(100);
      return 0n;
    }

    // Check cache first
    const cached = getCachedBalance(cacheKey);
    if (cached) {
      setTotalBalance(cached.value);
      setStatus('revealed');
      setProgress(100);
      return cached.value;
    }

    try {
      setError(null);
      setStatus('fetching');
      setProgress(10);

      const balances: PoolBalance[] = [];
      let aggregatedTotal = 0n;

      // Mock mode
      if (isMock) {
        await new Promise(r => setTimeout(r, 500));
        setProgress(50);

        for (const { pool, isToken0 } of relevantPools) {
          const mockValue = BigInt(Math.floor(Math.random() * 50 + 1)) * BigInt(1e18);
          balances.push({
            hookAddress: pool.hook,
            isToken0,
            decryptedValue: mockValue,
          });
          aggregatedTotal += mockValue;
        }

        await new Promise(r => setTimeout(r, 500));
        setPoolBalances(balances);
        setTotalBalance(aggregatedTotal);
        cacheBalance(cacheKey, aggregatedTotal);
        setStatus('revealed');
        setProgress(100);
        return aggregatedTotal;
      }

      // Real FHE mode
      if (!unseal || !isReady) {
        throw new Error('FHE session not ready. Please initialize first.');
      }

      const progressPerPool = 80 / relevantPools.length;

      // Query and decrypt each pool's balance
      for (let i = 0; i < relevantPools.length; i++) {
        const { pool, isToken0 } = relevantPools[i];

        // Fetch encrypted balance from this pool's hook
        const encrypted = await publicClient.readContract({
          address: pool.hook,
          abi: FHEATHERX_ABI,
          functionName: isToken0 ? 'getUserBalanceToken0' : 'getUserBalanceToken1',
          args: [address],
        });

        setProgress(10 + (i + 0.5) * progressPerPool);

        // Handle zero balance
        const encryptedBigInt = typeof encrypted === 'bigint' ? encrypted : BigInt(String(encrypted));

        if (encryptedBigInt === 0n) {
          balances.push({
            hookAddress: pool.hook,
            isToken0,
            decryptedValue: 0n,
          });
          continue;
        }

        // Decrypt
        setStatus('decrypting');
        const encryptedHex = `0x${encryptedBigInt.toString(16)}`;
        const decrypted = await unseal(encryptedHex, FHE_RETRY_ATTEMPTS);

        balances.push({
          hookAddress: pool.hook,
          isToken0,
          decryptedValue: decrypted,
        });
        aggregatedTotal += decrypted;

        setProgress(10 + (i + 1) * progressPerPool);
      }

      setPoolBalances(balances);
      setTotalBalance(aggregatedTotal);
      cacheBalance(cacheKey, aggregatedTotal);
      setStatus('revealed');
      setProgress(100);

      return aggregatedTotal;
    } catch (err) {
      console.error('Aggregated balance reveal failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to reveal balance');
      setStatus('error');
      setProgress(0);
    }
  }, [
    address,
    publicClient,
    relevantPools,
    unseal,
    isReady,
    isMock,
    cacheKey,
    cacheBalance,
    getCachedBalance,
  ]);

  const hide = useCallback(() => {
    setTotalBalance(null);
    setPoolBalances([]);
    setStatus('idle');
    setProgress(0);
    setError(null);
  }, []);

  return {
    status,
    totalBalance,
    poolBalances,
    error,
    progress,
    reveal,
    hide,
    isRevealing: status === 'fetching' || status === 'decrypting',
    isRevealed: status === 'revealed',
  };
}
