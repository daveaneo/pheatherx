'use client';

import { useCallback, useMemo, useState } from 'react';
import { useChainId, useWriteContract } from 'wagmi';
import { createWalletClient, http, type Abi, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { isTestMode, TEST_WALLET_PRIVATE_KEY } from '@/lib/wagmiConfig';
import { ethereumSepolia, arbSepolia, fhenixTestnet, localAnvil } from '@/lib/chains';

// RPC URLs for each chain
const rpcUrls: Record<number, string> = {
  [localAnvil.id]: 'http://127.0.0.1:8545',
  [ethereumSepolia.id]: 'https://ethereum-sepolia-rpc.publicnode.com',
  [arbSepolia.id]: 'https://sepolia-rollup.arbitrum.io/rpc',
  [fhenixTestnet.id]: 'https://api.testnet.fhenix.zone:7747',
};

// All supported chains (localAnvil first for test mode default)
const chains = [localAnvil, ethereumSepolia, arbSepolia, fhenixTestnet];

/**
 * Custom hook that provides writeContractAsync functionality.
 * In test mode, it uses viem directly with the test wallet private key.
 * In normal mode, it uses wagmi's useWriteContract.
 * This allows the same code to work in both Playwright tests and production.
 */
export function useSmartWriteContract() {
  const chainId = useChainId();
  const wagmiWriteContract = useWriteContract();
  const [testModePending, setTestModePending] = useState(false);
  const [testModeError, setTestModeError] = useState<Error | null>(null);

  // Check if we're in test mode at hook initialization time
  const inTestMode = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return isTestMode() && !!TEST_WALLET_PRIVATE_KEY;
  }, []);

  const writeContractAsync = useCallback(async <TAbi extends Abi>(params: {
    address: `0x${string}`;
    abi: TAbi;
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
  }): Promise<`0x${string}`> => {
    // In test mode, use viem wallet client directly
    if (inTestMode && TEST_WALLET_PRIVATE_KEY) {
      setTestModePending(true);
      setTestModeError(null);

      try {
        console.log('[Test Mode] Using viem wallet client for transaction');

        const account = privateKeyToAccount(TEST_WALLET_PRIVATE_KEY);
        const chain = chains.find(c => c.id === chainId) || localAnvil;
        const rpcUrl = rpcUrls[chainId] || rpcUrls[localAnvil.id];

        const walletClient = createWalletClient({
          account,
          chain,
          transport: http(rpcUrl),
        });

        // Encode the function call data
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = encodeFunctionData({
          abi: params.abi as Abi,
          functionName: params.functionName,
          args: params.args,
        } as any);

        // Send the transaction
        const hash = await walletClient.sendTransaction({
          to: params.address,
          data,
          value: params.value,
        });

        console.log('[Test Mode] Transaction sent:', hash);
        setTestModePending(false);
        return hash;
      } catch (err) {
        setTestModeError(err instanceof Error ? err : new Error(String(err)));
        setTestModePending(false);
        throw err;
      }
    }

    // In normal mode, use wagmi's writeContractAsync
    // Cast to any to handle the generic type mismatch
    return wagmiWriteContract.writeContractAsync(params as Parameters<typeof wagmiWriteContract.writeContractAsync>[0]);
  }, [chainId, inTestMode, wagmiWriteContract]);

  return {
    writeContractAsync,
    isPending: inTestMode ? testModePending : wagmiWriteContract.isPending,
    error: inTestMode ? testModeError : wagmiWriteContract.error,
  };
}
