'use client';

import { useState, useCallback } from 'react';
import { useAccount, usePublicClient, useWriteContract, useWalletClient } from 'wagmi';
import { parseUnits } from 'viem';
import { ERC20_ABI } from '@/lib/contracts/erc20Abi';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import type { FaucetToken } from '@/lib/faucetTokens';

// Faucet token ABI with faucet function
const FAUCET_TOKEN_ABI = [
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
  requestTokens: (token: FaucetToken) => Promise<void>;
  requestAllTokens: (tokens: FaucetToken[]) => Promise<void>;
  addTokenToWallet: (token: FaucetToken) => Promise<void>;
  isRequesting: boolean;
  requestingToken: `0x${string}` | null;
  error: string | null;
}

export function useFaucet(): UseFaucetResult {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { data: walletClient } = useWalletClient();
  const { success: successToast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);
  const updateTransaction = useTransactionStore(state => state.updateTransaction);

  const [isRequesting, setIsRequesting] = useState(false);
  const [requestingToken, setRequestingToken] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Request tokens from the faucet
   */
  const requestTokens = useCallback(async (token: FaucetToken): Promise<void> => {
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
        abi: FAUCET_TOKEN_ABI,
        functionName: 'faucet',
      });

      addTransaction({
        hash,
        type: 'faucet',
        description: `Request ${token.symbol} from faucet`,
      });

      await publicClient.waitForTransactionReceipt({ hash });
      updateTransaction(hash, { status: 'confirmed' });

      successToast(`Received ${token.symbol}`, `${token.faucetAmount} ${token.symbol} has been added to your wallet`);
    } catch (err) {
      console.error('[useFaucet] Error:', err);
      const message = err instanceof Error ? err.message : 'Failed to request tokens';

      // Check for cooldown error
      if (message.includes('cooldown') || message.includes('Faucet:')) {
        errorToast('Cooldown active', 'Please wait 1 hour between faucet requests');
      } else {
        setError(message);
        errorToast('Faucet request failed', message);
      }
    } finally {
      setIsRequesting(false);
      setRequestingToken(null);
    }
  }, [address, writeContractAsync, publicClient, addTransaction, updateTransaction, successToast, errorToast]);

  /**
   * Request all tokens at once
   */
  const requestAllTokens = useCallback(async (tokens: FaucetToken[]): Promise<void> => {
    if (!address || !publicClient) {
      errorToast('Wallet not connected', 'Please connect your wallet first');
      return;
    }

    setIsRequesting(true);
    setError(null);

    let successCount = 0;
    let failCount = 0;

    for (const token of tokens) {
      setRequestingToken(token.address);

      try {
        console.log(`[useFaucet] Requesting ${token.symbol} from faucet...`);

        const hash = await writeContractAsync({
          address: token.address,
          abi: FAUCET_TOKEN_ABI,
          functionName: 'faucet',
        });

        addTransaction({
          hash,
          type: 'faucet',
          description: `Request ${token.symbol} from faucet`,
        });

        await publicClient.waitForTransactionReceipt({ hash });
        updateTransaction(hash, { status: 'confirmed' });
        successCount++;
      } catch (err) {
        console.error(`[useFaucet] Error requesting ${token.symbol}:`, err);
        failCount++;
        // Continue to next token even if one fails
      }
    }

    setIsRequesting(false);
    setRequestingToken(null);

    // Show summary toast
    if (successCount > 0 && failCount === 0) {
      successToast('All tokens received!', `Successfully received ${successCount} tokens`);
    } else if (successCount > 0) {
      successToast('Partial success', `Received ${successCount} tokens, ${failCount} failed (may be on cooldown)`);
    } else {
      errorToast('Faucet request failed', 'All token requests failed. You may be on cooldown.');
    }
  }, [address, writeContractAsync, publicClient, addTransaction, updateTransaction, successToast, errorToast]);

  /**
   * Add token to wallet using EIP-747
   */
  const addTokenToWallet = useCallback(async (token: FaucetToken): Promise<void> => {
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
    requestAllTokens,
    addTokenToWallet,
    isRequesting,
    requestingToken,
    error,
  };
}
