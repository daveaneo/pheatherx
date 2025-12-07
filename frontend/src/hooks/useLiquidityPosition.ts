'use client';

import { useAccount, useReadContracts } from 'wagmi';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { useSelectedPool } from '@/stores/poolStore';

interface LiquidityPosition {
  balance0: bigint;
  balance1: bigint;
  // Raw encrypted handles (for FHE decryption)
  encryptedBalance0: bigint;
  encryptedBalance1: bigint;
  // Whether the values are encrypted (need FHE reveal)
  isEncrypted: boolean;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

// Threshold to detect if a value looks like an encrypted FHE handle
// Real balances would be < 10^30 (even 1 trillion tokens with 18 decimals = 10^30)
// FHE handles are typically much larger (256-bit values)
const MAX_REASONABLE_BALANCE = BigInt('1000000000000000000000000000000'); // 10^30

function isLikelyEncrypted(value: bigint): boolean {
  // A value > 10^30 is almost certainly an encrypted FHE handle
  return value > MAX_REASONABLE_BALANCE;
}

export function useLiquidityPosition(): LiquidityPosition {
  const { address } = useAccount();
  // Get hook address from selected pool
  const { hookAddress } = useSelectedPool();

  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: [
      {
        address: hookAddress,
        abi: FHEATHERX_ABI,
        functionName: 'getUserBalanceToken0',
        args: address ? [address] : undefined,
      },
      {
        address: hookAddress,
        abi: FHEATHERX_ABI,
        functionName: 'getUserBalanceToken1',
        args: address ? [address] : undefined,
      },
    ],
    query: {
      enabled: !!hookAddress && !!address,
      refetchInterval: 10000,
    },
  });

  const rawBalance0 = (data?.[0]?.result as bigint) ?? 0n;
  const rawBalance1 = (data?.[1]?.result as bigint) ?? 0n;

  // Check if values look like FHE encrypted handles
  const balance0Encrypted = isLikelyEncrypted(rawBalance0);
  const balance1Encrypted = isLikelyEncrypted(rawBalance1);
  const isEncrypted = balance0Encrypted || balance1Encrypted;

  // Return 0 for display if encrypted, to avoid showing garbage numbers
  // The actual decryption should be done via useBalanceReveal hook
  return {
    balance0: balance0Encrypted ? 0n : rawBalance0,
    balance1: balance1Encrypted ? 0n : rawBalance1,
    encryptedBalance0: rawBalance0,
    encryptedBalance1: rawBalance1,
    isEncrypted,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}
