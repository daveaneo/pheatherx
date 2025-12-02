'use client';

import { useState, useCallback } from 'react';
import { useAccount, useChainId, useWriteContract, usePublicClient } from 'wagmi';
import { SWAP_ROUTER_ABI, type PoolKey, type SwapParams } from '@/lib/contracts/router';
import { encodeSwapHookData } from '@/lib/contracts/encoding';
import { SWAP_ROUTER_ADDRESSES, POOL_FEE, TICK_SPACING } from '@/lib/contracts/addresses';
import { MIN_SQRT_RATIO, MAX_SQRT_RATIO } from '@/lib/constants';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import { usePoolStore } from '@/stores/poolStore';

type SwapStep = 'idle' | 'simulating' | 'swapping' | 'complete' | 'error';

interface SwapQuote {
  amountIn: bigint;
  amountOut: bigint;
  priceImpact: number;
  route: string;
}

interface UseSwapResult {
  // Actions
  getQuote: (zeroForOne: boolean, amountIn: bigint, hookAddress?: `0x${string}`) => Promise<SwapQuote | null>;
  swap: (zeroForOne: boolean, amountIn: bigint, minAmountOut: bigint, hookAddress?: `0x${string}`) => Promise<`0x${string}`>;

  // State
  step: SwapStep;
  isSwapping: boolean;
  swapHash: `0x${string}` | null;
  error: string | null;
  quote: SwapQuote | null;
  reset: () => void;
}

export function useSwap(): UseSwapResult {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { success: successToast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);
  const updateTransaction = useTransactionStore(state => state.updateTransaction);

  // Get pool info from store
  const getPoolByAddress = usePoolStore(state => state.getPoolByAddress);
  const getSelectedPool = usePoolStore(state => state.getSelectedPool);

  const routerAddress = SWAP_ROUTER_ADDRESSES[chainId];

  const [step, setStep] = useState<SwapStep>('idle');
  const [swapHash, setSwapHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<SwapQuote | null>(null);

  const reset = useCallback(() => {
    setStep('idle');
    setSwapHash(null);
    setError(null);
    setQuote(null);
  }, []);

  const getPoolKey = useCallback((hookAddress?: `0x${string}`): PoolKey | null => {
    // Get pool info from the store
    const pool = hookAddress
      ? getPoolByAddress(hookAddress)
      : getSelectedPool();

    if (!pool) return null;

    return {
      currency0: pool.token0,
      currency1: pool.token1,
      fee: POOL_FEE,
      tickSpacing: TICK_SPACING,
      hooks: pool.hook,
    };
  }, [getPoolByAddress, getSelectedPool]);

  /**
   * Get a quote for a swap
   */
  const getQuote = useCallback(async (
    zeroForOne: boolean,
    amountIn: bigint,
    hookAddress?: `0x${string}`
  ): Promise<SwapQuote | null> => {
    if (!publicClient || !routerAddress || !address) return null;

    const poolKey = getPoolKey(hookAddress);
    if (!poolKey) {
      console.error('No pool found for quote');
      return null;
    }

    setStep('simulating');
    setError(null);

    try {
      const sqrtPriceLimit = zeroForOne ? MIN_SQRT_RATIO + 1n : MAX_SQRT_RATIO - 1n;

      const swapParams: SwapParams = {
        zeroForOne,
        amountSpecified: amountIn, // Positive = exact input
        sqrtPriceLimitX96: sqrtPriceLimit,
      };

      const hookData = encodeSwapHookData(address);

      // Simulate the swap
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await publicClient.simulateContract({
        address: routerAddress,
        abi: SWAP_ROUTER_ABI,
        functionName: 'swap',
        // Type assertion needed due to complex tuple type inference
        args: [poolKey, swapParams, hookData] as any,
        account: address,
      });

      // Calculate output from delta
      const delta = result.result as bigint;
      const amountOut = delta < 0n ? -delta : delta;

      // Simple price impact calculation
      const priceImpact = Number(amountIn > 0n ? (amountIn - amountOut) * 10000n / amountIn : 0n) / 100;

      const swapQuote: SwapQuote = {
        amountIn,
        amountOut,
        priceImpact: Math.abs(priceImpact),
        route: zeroForOne ? 'Token0 -> Token1' : 'Token1 -> Token0',
      };

      setQuote(swapQuote);
      setStep('idle');
      return swapQuote;
    } catch (err) {
      console.error('Quote failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to get quote');
      setStep('error');
      return null;
    }
  }, [publicClient, routerAddress, address, getPoolKey]);

  /**
   * Execute a swap
   */
  const swap = useCallback(async (
    zeroForOne: boolean,
    amountIn: bigint,
    minAmountOut: bigint,
    hookAddress?: `0x${string}`
  ): Promise<`0x${string}`> => {
    if (!address || !routerAddress) {
      throw new Error('Wallet not connected');
    }

    const poolKey = getPoolKey(hookAddress);
    if (!poolKey) {
      throw new Error('No pool selected');
    }

    setStep('swapping');
    setError(null);

    try {
      const sqrtPriceLimit = zeroForOne ? MIN_SQRT_RATIO + 1n : MAX_SQRT_RATIO - 1n;

      const swapParams: SwapParams = {
        zeroForOne,
        amountSpecified: amountIn,
        sqrtPriceLimitX96: sqrtPriceLimit,
      };

      const hookData = encodeSwapHookData(address);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hash = await writeContractAsync({
        address: routerAddress,
        abi: SWAP_ROUTER_ABI,
        functionName: 'swap',
        // Type assertion needed due to complex tuple type inference
        args: [poolKey, swapParams, hookData] as any,
      });

      setSwapHash(hash);

      addTransaction({
        hash,
        type: 'swap',
        description: zeroForOne ? 'Swap Token0 for Token1' : 'Swap Token1 for Token0',
      });

      // Wait for confirmation
      await publicClient?.waitForTransactionReceipt({ hash });

      updateTransaction(hash, { status: 'confirmed' });
      setStep('complete');
      successToast('Swap confirmed');
      return hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Swap failed';
      setError(message);
      setStep('error');
      errorToast('Swap failed', message);
      throw err;
    }
  }, [address, routerAddress, publicClient, writeContractAsync, getPoolKey, addTransaction, updateTransaction, successToast, errorToast]);

  return {
    getQuote,
    swap,
    step,
    isSwapping: step === 'simulating' || step === 'swapping',
    swapHash,
    error,
    quote,
    reset,
  };
}
