'use client';

/**
 * usePlaceOrder - v6 Limit Order Hook
 *
 * In v6, limit orders are placed via deposit() function:
 * deposit(PoolId poolId, int24 tick, BucketSide side, InEuint128 encryptedAmount, uint256 deadline, int24 maxTickDrift)
 *
 * This hook provides a user-friendly API that wraps the v6 deposit function
 * for placing limit orders.
 */

import { useState, useCallback } from 'react';
import { useAccount, useChainId, useWriteContract, usePublicClient } from 'wagmi';
import { FHEATHERX_V6_ABI, BucketSide, V6_DEFAULTS, type InEuint128, type BucketSideType } from '@/lib/contracts/fheatherXv6Abi';
import { ERC20_ABI } from '@/lib/contracts/erc20Abi';
import { orderTypeToFlags, type OrderType } from '@/lib/orders';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import { useSelectedPool } from '@/stores/poolStore';
import { useFheSession } from './useFheSession';
import { getPoolIdFromTokens } from '@/lib/poolId';

type PlaceOrderStep = 'idle' | 'checking' | 'approving' | 'encrypting' | 'submitting' | 'complete' | 'error';

// Debug logger
const debugLog = (stage: string, data?: unknown) => {
  console.log(`[PlaceOrder v6 Debug] ${stage}`, data !== undefined ? data : '');
};

interface UsePlaceOrderResult {
  /**
   * Place a limit order
   * @param orderType - The type of order (limit-buy, limit-sell, stop-loss, take-profit)
   * @param triggerTick - The tick at which the order triggers
   * @param amount - The amount to deposit (will be encrypted)
   */
  placeOrder: (
    orderType: OrderType,
    triggerTick: number,
    amount: bigint
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
  const { encrypt, isReady, isMock } = useFheSession();

  // Get pool info from selected pool (multi-pool support)
  const { hookAddress, token0, token1 } = useSelectedPool();

  const [step, setStep] = useState<PlaceOrderStep>('idle');
  const [orderHash, setOrderHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('idle');
    setOrderHash(null);
    setError(null);
  }, []);

  /**
   * Place a new limit order via v6 deposit()
   */
  const placeOrder = useCallback(async (
    orderType: OrderType,
    triggerTick: number,
    amount: bigint
  ): Promise<`0x${string}`> => {
    debugLog('placeOrder called', { orderType, triggerTick, amount: amount.toString() });

    if (!address || !hookAddress || !token0 || !token1) {
      throw new Error('Wallet not connected or no pool selected');
    }

    if (!isMock && (!encrypt || !isReady)) {
      throw new Error('FHE session not ready. Please initialize FHE first.');
    }

    setStep('checking');
    setError(null);

    try {
      // Get order type flags to determine side and deposit token
      const { isBuyOrder, depositToken: depositTokenType } = orderTypeToFlags(orderType);

      // v6 BucketSide: BUY=0, SELL=1
      const side: BucketSideType = isBuyOrder ? BucketSide.BUY : BucketSide.SELL;

      // Determine which token is being deposited
      // BUY orders deposit token1 (to buy token0)
      // SELL orders deposit token0 (to sell for token1)
      const depositToken = depositTokenType === 'token0' ? token0 : token1;

      debugLog('Order details', {
        orderType,
        side,
        depositToken: depositToken.symbol,
        isBuyOrder,
      });

      // Compute poolId
      const poolId = getPoolIdFromTokens(token0, token1, hookAddress);
      debugLog('Computed poolId', poolId);

      // Check and approve token if needed
      const allowance = await publicClient?.readContract({
        address: depositToken.address,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, hookAddress],
      }) as bigint;

      debugLog('Allowance check', { allowance: allowance?.toString(), amount: amount.toString() });

      if (allowance === undefined || allowance < amount) {
        setStep('approving');
        debugLog('Approving token', { token: depositToken.symbol, amount: amount.toString() });

        const approveHash = await writeContractAsync({
          address: depositToken.address,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [hookAddress, amount],
        });

        addTransaction({
          hash: approveHash,
          type: 'approve',
          description: `Approve ${depositToken.symbol} for limit order`,
        });

        await publicClient?.waitForTransactionReceipt({ hash: approveHash });
        updateTransaction(approveHash, { status: 'confirmed' });
      }

      // Encrypt the amount
      setStep('encrypting');
      debugLog('Encrypting amount');

      let encryptedAmount: InEuint128;

      if (isMock) {
        // Mock encryption for testing
        encryptedAmount = {
          ctHash: amount,
          securityZone: 0,
          utype: 7, // euint128 type
          signature: '0x' as `0x${string}`,
        };
      } else {
        // Real FHE encryption
        const encrypted = await encrypt!(amount);
        encryptedAmount = {
          ctHash: BigInt('0x' + Buffer.from(encrypted).toString('hex')),
          securityZone: 0,
          utype: 7,
          signature: '0x' as `0x${string}`,
        };
      }

      // Calculate deadline (1 hour from now)
      const deadline = BigInt(Math.floor(Date.now() / 1000) + V6_DEFAULTS.DEADLINE_OFFSET);
      // For limit orders, maxTickDrift is effectively disabled (use full tick range)
      // Limit orders wait at a specific tick - no slippage protection needed
      const maxTickDrift = 887272; // MAX_TICK - allows any price movement

      setStep('submitting');

      debugLog('Calling deposit', {
        poolId,
        tick: triggerTick,
        side,
        encryptedAmount,
        deadline: deadline.toString(),
        maxTickDrift,
      });

      const hash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_V6_ABI,
        functionName: 'deposit',
        args: [poolId, triggerTick, side, encryptedAmount, deadline, maxTickDrift],
      });

      debugLog('Deposit tx submitted', { hash });
      setOrderHash(hash);

      addTransaction({
        hash,
        type: 'deposit',
        description: `Place ${orderType} order at tick ${triggerTick}`,
      });

      // Wait for confirmation
      await publicClient?.waitForTransactionReceipt({ hash });

      updateTransaction(hash, { status: 'confirmed' });
      setStep('complete');
      successToast('Order placed successfully');
      return hash;
    } catch (err: unknown) {
      debugLog('placeOrder ERROR', err);

      let message = 'Failed to place order';
      const errAny = err as { shortMessage?: string; message?: string };
      const errString = errAny.shortMessage || errAny.message || String(err);

      if (errString.includes('User rejected') || errString.includes('user rejected')) {
        message = 'Transaction was cancelled';
      } else if (errString.includes('InputTokenMustBeFherc20')) {
        message = 'Limit orders require FHERC20 tokens for MEV protection';
      } else if (errString.includes('DeadlineExpired')) {
        message = 'Transaction deadline expired';
      } else if (errString.includes('PriceMoved')) {
        message = 'Price moved beyond maxTickDrift. Try again with higher slippage.';
      } else if (errString.includes('InvalidTick')) {
        message = 'Invalid tick value. Tick must be a multiple of tick spacing.';
      } else {
        message = errString;
      }

      setError(message);
      setStep('error');
      errorToast('Order failed', message);
      throw err;
    }
  }, [address, hookAddress, token0, token1, publicClient, writeContractAsync, encrypt, isReady, isMock, addTransaction, updateTransaction, successToast, errorToast]);

  return {
    placeOrder,
    step,
    isSubmitting: step === 'checking' || step === 'approving' || step === 'encrypting' || step === 'submitting',
    orderHash,
    error,
    reset,
  };
}
