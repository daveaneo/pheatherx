'use client';

import { useState, useCallback } from 'react';
import { useAccount, usePublicClient, useWriteContract, useWalletClient } from 'wagmi';
import { parseUnits } from 'viem';
import { ERC20_ABI } from '@/lib/contracts/erc20Abi';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import type { Token } from '@/types/pool';

// Mock token ABI with faucet function
const MOCK_TOKEN_ABI = [
  ...ERC20_ABI,
  {
    type: 'function',
    name: 'faucet',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'mint',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'FAUCET_AMOUNT',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

interface UseFaucetResult {
  requestTokens: (token: Token) => Promise<void>;
  addTokenToWallet: (token: Token) => Promise<void>;
  isRequesting: boolean;
  requestingToken: `0x${string}` | null;
  error: string | null;
}

export function useFaucet(): UseFaucetResult {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { data: walletClient } = useWalletClient(); // Still needed for watchAsset
  const { success: successToast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);
  const updateTransaction = useTransactionStore(state => state.updateTransaction);

  const [isRequesting, setIsRequesting] = useState(false);
  const [requestingToken, setRequestingToken] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Request tokens from the faucet
   */
  const requestTokens = useCallback(async (token: Token): Promise<void> => {
    if (!address || !publicClient) {
      errorToast('Wallet not connected', 'Please connect your wallet first');
      return;
    }

    setIsRequesting(true);
    setRequestingToken(token.address);
    setError(null);

    try {
      console.log(`[useFaucet] Requesting ${token.symbol} from faucet...`);

      // Call the faucet function
      const hash = await writeContractAsync({
        address: token.address,
        abi: MOCK_TOKEN_ABI,
        functionName: 'faucet',
      });

      addTransaction({
        hash,
        type: 'faucet',
        description: `Request ${token.symbol} from faucet`,
      });

      await publicClient.waitForTransactionReceipt({ hash });
      updateTransaction(hash, { status: 'confirmed' });

      successToast(`Received ${token.symbol}`, `1000 ${token.symbol} has been added to your wallet`);
    } catch (err) {
      console.error('[useFaucet] Error:', err);
      const message = err instanceof Error ? err.message : 'Failed to request tokens';
      setError(message);
      errorToast('Faucet request failed', message);
    } finally {
      setIsRequesting(false);
      setRequestingToken(null);
    }
  }, [address, writeContractAsync, publicClient, addTransaction, updateTransaction, successToast, errorToast]);

  /**
   * Add token to wallet using EIP-747 (works with all wallets via wagmi)
   */
  const addTokenToWallet = useCallback(async (token: Token): Promise<void> => {
    if (!walletClient) {
      errorToast('Wallet not connected', 'Please connect your wallet first');
      return;
    }

    try {
      console.log(`[useFaucet] Adding ${token.symbol} to wallet...`);

      await walletClient.watchAsset({
        type: 'ERC20',
        options: {
          address: token.address,
          symbol: token.symbol,
          decimals: token.decimals,
        },
      });

      successToast(`Added ${token.symbol}`, `${token.symbol} is now visible in your wallet`);
    } catch (err) {
      console.error('[useFaucet] Error adding to wallet:', err);
      const message = err instanceof Error ? err.message : 'Failed to add token to wallet';
      errorToast('Failed to add token', message);
    }
  }, [walletClient, successToast, errorToast]);

  return {
    requestTokens,
    addTokenToWallet,
    isRequesting,
    requestingToken,
    error,
  };
}
