'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAccount, useChainId, useReadContract } from 'wagmi';
import { useFheSession } from './useFheSession';
import { useFheStore } from '@/stores/fheStore';
import { PHEATHERX_ABI } from '@/lib/contracts/abi';
import { PHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { FHE_RETRY_ATTEMPTS } from '@/lib/constants';

type RevealStatus = 'idle' | 'fetching' | 'decrypting' | 'revealed' | 'error';

interface UseBalanceRevealResult {
  status: RevealStatus;
  value: bigint | null;
  error: string | null;
  progress: number;
  reveal: () => Promise<bigint | undefined>;
  hide: () => void;
  isRevealing: boolean;
  isRevealed: boolean;
}

export function useBalanceReveal(isToken0: boolean): UseBalanceRevealResult {
  const { address } = useAccount();
  const chainId = useChainId();
  const hookAddress = PHEATHERX_ADDRESSES[chainId];

  const { unseal, isReady, isMock } = useFheSession();
  const { cacheBalance, getCachedBalance } = useFheStore();

  const [status, setStatus] = useState<RevealStatus>('idle');
  const [value, setValue] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const cacheKey = `${address}-${chainId}-${isToken0 ? 'token0' : 'token1'}`;

  const { refetch: refetchBalance } = useReadContract({
    address: hookAddress,
    abi: PHEATHERX_ABI,
    functionName: isToken0 ? 'getUserBalanceToken0' : 'getUserBalanceToken1',
    args: address ? [address] : undefined,
    query: { enabled: false },
  });

  // Check cache on mount
  useEffect(() => {
    const cached = getCachedBalance(cacheKey);
    if (cached) {
      setValue(cached.value);
      setStatus('revealed');
    }
  }, [cacheKey, getCachedBalance]);

  const reveal = useCallback(async () => {
    if (!address || !hookAddress) {
      setError('Wallet not connected');
      setStatus('error');
      return;
    }

    // Check cache first
    const cached = getCachedBalance(cacheKey);
    if (cached) {
      setValue(cached.value);
      setStatus('revealed');
      setProgress(100);
      return cached.value;
    }

    try {
      setError(null);
      setStatus('fetching');
      setProgress(10);

      // Mock mode
      if (isMock) {
        await new Promise(r => setTimeout(r, 800));
        setProgress(50);
        await new Promise(r => setTimeout(r, 700));

        const mockValue = BigInt(Math.floor(Math.random() * 5 + 1)) * BigInt(1e18);
        setValue(mockValue);
        cacheBalance(cacheKey, mockValue);
        setStatus('revealed');
        setProgress(100);
        return mockValue;
      }

      // Real FHE mode
      if (!unseal || !isReady) {
        throw new Error('FHE session not ready. Please initialize first.');
      }

      // Step 1: Fetch encrypted balance
      const { data: encrypted } = await refetchBalance();
      setProgress(30);

      if (!encrypted) {
        throw new Error('Failed to fetch encrypted balance');
      }

      // Step 2: Start decryption with retry
      setStatus('decrypting');

      // Progress simulation
      const progressInterval = setInterval(() => {
        setProgress(p => Math.min(p + 5, 90));
      }, 500);

      // Step 3: Unseal with automatic retry (handled in singleton)
      // Convert encrypted bigint to hex string for unsealing
      const encryptedHex = typeof encrypted === 'bigint'
        ? `0x${encrypted.toString(16)}`
        : String(encrypted);
      const decrypted = await unseal(encryptedHex, FHE_RETRY_ATTEMPTS);

      clearInterval(progressInterval);
      setProgress(100);

      // Step 4: Cache and return
      setValue(decrypted);
      cacheBalance(cacheKey, decrypted);
      setStatus('revealed');

      return decrypted;
    } catch (err) {
      console.error('Balance reveal failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to reveal balance');
      setStatus('error');
      setProgress(0);
    }
  }, [address, hookAddress, unseal, isReady, isMock, cacheKey, cacheBalance, getCachedBalance, refetchBalance]);

  const hide = useCallback(() => {
    setValue(null);
    setStatus('idle');
    setProgress(0);
    setError(null);
  }, []);

  return {
    status,
    value,
    error,
    progress,
    reveal,
    hide,
    isRevealing: status === 'fetching' || status === 'decrypting',
    isRevealed: status === 'revealed',
  };
}
