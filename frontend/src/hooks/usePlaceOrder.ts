'use client';

import { useState, useCallback } from 'react';
import { useAccount, useChainId, useWriteContract, usePublicClient } from 'wagmi';
import { PHEATHERX_ABI } from '@/lib/contracts/abi';
import { PHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { PROTOCOL_FEE_WEI } from '@/lib/constants';
import { orderTypeToFlags, type OrderType } from '@/lib/orders';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import { useFheSession } from './useFheSession';

type PlaceOrderStep = 'idle' | 'encrypting' | 'submitting' | 'complete' | 'error';

interface UsePlaceOrderResult {
  placeOrder: (
    orderType: OrderType,
    triggerTick: number,
    amount: bigint,
    slippageBps: number
  ) => Promise<`0x${string}`>;
  step: PlaceOrderStep;
  isSubmitting: boolean;
  orderHash: `0x${string}` | null;
  error: string | null;
  reset: () => void;
}

export function usePlaceOrder(): UsePlaceOrderResult {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { success: successToast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);
  const updateTransaction = useTransactionStore(state => state.updateTransaction);
  const { encrypt, encryptBool, isReady, isMock } = useFheSession();

  const hookAddress = PHEATHERX_ADDRESSES[chainId];

  const [step, setStep] = useState<PlaceOrderStep>('idle');
  const [orderHash, setOrderHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('idle');
    setOrderHash(null);
    setError(null);
  }, []);

  /**
   * Place a new order
   */
  const placeOrder = useCallback(async (
    orderType: OrderType,
    triggerTick: number,
    amount: bigint,
    slippageBps: number
  ): Promise<`0x${string}`> => {
    if (!address || !hookAddress) {
      throw new Error('Wallet not connected');
    }

    if (!isMock && (!encrypt || !encryptBool || !isReady)) {
      throw new Error('FHE session not ready');
    }

    setStep('encrypting');
    setError(null);

    try {
      // Get order type flags
      const { isBuyOrder } = orderTypeToFlags(orderType);

      // Encrypt the order parameters
      let encryptedDirection: Uint8Array;
      let encryptedAmount: Uint8Array;
      let encryptedMinOutput: Uint8Array;

      if (isMock) {
        // Mock: just convert to bytes for testing
        encryptedDirection = new Uint8Array([isBuyOrder ? 1 : 0]);

        encryptedAmount = new Uint8Array(16);
        let v = amount;
        for (let i = 15; i >= 0; i--) {
          encryptedAmount[i] = Number(v & 0xffn);
          v >>= 8n;
        }

        // Calculate minOutput with slippage (100% - slippage%)
        const minOutput = (amount * BigInt(10000 - slippageBps)) / BigInt(10000);
        encryptedMinOutput = new Uint8Array(16);
        let m = minOutput;
        for (let i = 15; i >= 0; i--) {
          encryptedMinOutput[i] = Number(m & 0xffn);
          m >>= 8n;
        }
      } else {
        encryptedDirection = await encryptBool!(isBuyOrder);
        encryptedAmount = await encrypt!(amount);
        // Calculate minOutput with slippage
        const minOutput = (amount * BigInt(10000 - slippageBps)) / BigInt(10000);
        encryptedMinOutput = await encrypt!(minOutput);
      }

      setStep('submitting');

      // Convert Uint8Arrays to hex strings for contract call
      const toHex = (arr: Uint8Array): `0x${string}` =>
        `0x${Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')}`;

      const hash = await writeContractAsync({
        address: hookAddress,
        abi: PHEATHERX_ABI,
        functionName: 'placeOrder',
        args: [triggerTick, toHex(encryptedDirection), toHex(encryptedAmount), toHex(encryptedMinOutput)],
        value: PROTOCOL_FEE_WEI,
      });

      setOrderHash(hash);

      addTransaction({
        hash,
        type: 'placeOrder',
        description: `Place ${orderType} order`,
      });

      // Wait for confirmation
      await publicClient?.waitForTransactionReceipt({ hash });

      updateTransaction(hash, { status: 'confirmed' });
      setStep('complete');
      successToast('Order placed successfully');
      return hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to place order';
      setError(message);
      setStep('error');
      errorToast('Order failed', message);
      throw err;
    }
  }, [address, hookAddress, encrypt, encryptBool, isReady, isMock, publicClient, writeContractAsync, addTransaction, updateTransaction, successToast, errorToast]);

  return {
    placeOrder,
    step,
    isSubmitting: step === 'encrypting' || step === 'submitting',
    orderHash,
    error,
    reset,
  };
}
