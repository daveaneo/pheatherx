'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useReadContract } from 'wagmi';
import { useFheSession } from './useFheSession';
import { useFheStore } from '@/stores/fheStore';
import { FHERC20_ABI } from '@/lib/contracts/fherc20Abi';
import { FHE_RETRY_ATTEMPTS } from '@/lib/constants';
import type { Token } from '@/lib/tokens';

interface UseFherc20BalanceResult {
  /** The decrypted encrypted balance (null if not yet revealed) */
  balance: bigint | null;
  /** The plaintext (unwrapped) balance - directly from balanceOf() */
  plaintextBalance: bigint | null;
  /** Whether the encrypted balance is currently being revealed */
  isLoading: boolean;
  /** Whether the encrypted balance has been successfully revealed */
  isRevealed: boolean;
  /** Error message if reveal failed */
  error: string | null;
  /** Manually trigger a reveal of encrypted balance */
  reveal: () => Promise<void>;
  /** Refetch the plaintext balance */
  refetchPlaintext: () => Promise<void>;
}

/**
 * Hook for auto-revealing FHERC20 token balances
 *
 * For FHERC20 tokens (type === 'fheerc20'), this hook:
 * 1. Reads the encrypted balance handle from the token contract
 * 2. Auto-unseals (decrypts) when FHE session is ready
 * 3. Caches the result to avoid repeated decryption
 *
 * For non-FHERC20 tokens, returns null values (use standard useBalance instead)
 *
 * @param token - The token to fetch balance for (or undefined)
 * @param userAddress - The user's wallet address
 */
export function useFherc20Balance(
  token: Token | undefined,
  userAddress: `0x${string}` | undefined
): UseFherc20BalanceResult {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { unseal, isReady, isMock } = useFheSession();
  const { cacheBalance, getCachedBalance } = useFheStore();

  // Track if we've attempted auto-reveal to prevent loops
  const hasAttemptedRef = useRef(false);
  const lastTokenAddressRef = useRef<string | undefined>(undefined);

  const isFherc20 = token?.type === 'fheerc20';
  const cacheKey = token && userAddress ? `fherc20-${userAddress}-${token.address}` : '';

  // Reset state when token changes
  useEffect(() => {
    if (token?.address !== lastTokenAddressRef.current) {
      lastTokenAddressRef.current = token?.address;
      hasAttemptedRef.current = false;
      setBalance(null);
      setError(null);
    }
  }, [token?.address]);

  // Read encrypted balance handle from FHERC20 contract
  const { data: encryptedHandle, refetch: refetchEncrypted } = useReadContract({
    address: token?.address,
    abi: FHERC20_ABI,
    functionName: 'balanceOfEncrypted',
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: isFherc20 && !!token && !!userAddress,
    },
  });

  // Read plaintext (unwrapped) balance from FHERC20 contract
  // This is the standard ERC20 balanceOf - shows tokens that have been unwrapped
  const { data: plaintextBalanceData, refetch: refetchPlaintextBalance } = useReadContract({
    address: token?.address,
    abi: FHERC20_ABI,
    functionName: 'balanceOf',
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: isFherc20 && !!token && !!userAddress,
    },
  });

  const plaintextBalance = isFherc20 && plaintextBalanceData !== undefined
    ? BigInt(plaintextBalanceData as bigint)
    : null;

  const refetchPlaintext = useCallback(async () => {
    await refetchPlaintextBalance();
  }, [refetchPlaintextBalance]);

  const reveal = useCallback(async () => {
    if (!isFherc20 || !token || !userAddress) return;

    // Check cache first
    if (cacheKey) {
      const cached = getCachedBalance(cacheKey);
      if (cached) {
        setBalance(cached.value);
        return;
      }
    }

    try {
      setError(null);
      setIsLoading(true);

      // Mock mode
      if (isMock) {
        await new Promise(r => setTimeout(r, 500));
        const mockValue = BigInt(100) * BigInt(10 ** token.decimals);
        setBalance(mockValue);
        if (cacheKey) cacheBalance(cacheKey, mockValue);
        return;
      }

      // Real FHE mode
      if (!unseal || !isReady) {
        throw new Error('FHE session not ready');
      }

      // Refetch to get latest encrypted handle
      const { data: freshHandle } = await refetchEncrypted();
      const handle = freshHandle ?? encryptedHandle;

      if (handle === undefined || handle === null) {
        throw new Error('Failed to fetch encrypted balance');
      }

      const handleBigInt = typeof handle === 'bigint' ? handle : BigInt(String(handle));

      // If handle is 0, balance is 0 (no encrypted value exists)
      if (handleBigInt === 0n) {
        setBalance(0n);
        if (cacheKey) cacheBalance(cacheKey, 0n);
        return;
      }

      // Unseal (decrypt) the balance
      const handleHex = `0x${handleBigInt.toString(16)}`;
      const decrypted = await unseal(handleHex, FHE_RETRY_ATTEMPTS);

      setBalance(decrypted);
      if (cacheKey) cacheBalance(cacheKey, decrypted);
    } catch (err) {
      console.error('[useFherc20Balance] Reveal failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to reveal balance');
    } finally {
      setIsLoading(false);
    }
  }, [isFherc20, token, userAddress, cacheKey, getCachedBalance, cacheBalance, isMock, unseal, isReady, refetchEncrypted, encryptedHandle]);

  // Auto-reveal when FHE session becomes ready
  useEffect(() => {
    if (!isFherc20 || !token || !userAddress) return;
    if (balance !== null) return; // Already revealed
    if (hasAttemptedRef.current) return; // Already attempted
    if (!isReady && !isMock) return; // Session not ready

    // Check cache first
    if (cacheKey) {
      const cached = getCachedBalance(cacheKey);
      if (cached) {
        setBalance(cached.value);
        return;
      }
    }

    // Auto-reveal
    hasAttemptedRef.current = true;
    reveal();
  }, [isFherc20, token, userAddress, isReady, isMock, balance, cacheKey, getCachedBalance, reveal]);

  return {
    balance: isFherc20 ? balance : null,
    plaintextBalance,
    isLoading: isFherc20 ? isLoading : false,
    isRevealed: isFherc20 ? balance !== null : false,
    error: isFherc20 ? error : null,
    reveal,
    refetchPlaintext,
  };
}
