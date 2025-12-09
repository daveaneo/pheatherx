'use client';

/**
 * useSwap - v6 Multi-Mode Swap Hook
 *
 * v6 swap functions:
 * - swap(bool zeroForOne, uint256 amountIn, uint256 minAmountOut) - uses defaultPoolId
 * - swapForPool(PoolId poolId, bool zeroForOne, uint256 amountIn, uint256 minAmountOut)
 * - swapEncrypted(PoolId poolId, InEbool direction, InEuint128 amountIn, InEuint128 minOutput)
 *
 * This hook also maintains support for router-based swaps for backward compatibility
 */

import { useState, useCallback } from 'react';
import { useAccount, useChainId, useWriteContract, usePublicClient } from 'wagmi';
import { erc20Abi } from 'viem';
import { FHEATHERX_V6_ABI, type InEuint128, type InEbool } from '@/lib/contracts/fheatherXv6Abi';
import { SWAP_ROUTER_ABI, type PoolKey, type SwapParams } from '@/lib/contracts/router';
import { encodeSwapHookData } from '@/lib/contracts/encoding';
import { SWAP_ROUTER_ADDRESSES, POOL_FEE, TICK_SPACING } from '@/lib/contracts/addresses';
import { MIN_SQRT_RATIO, MAX_SQRT_RATIO } from '@/lib/constants';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import { usePoolStore, useSelectedPool } from '@/stores/poolStore';
import { useFheSession } from './useFheSession';
import { getPoolIdFromTokens } from '@/lib/poolId';
import type { Token } from '@/lib/tokens';

type SwapStep = 'idle' | 'simulating' | 'approving' | 'encrypting' | 'swapping' | 'complete' | 'error';

// Debug logger
const debugLog = (stage: string, data?: unknown) => {
  console.log(`[Swap v6 Debug] ${stage}`, data !== undefined ? data : '');
};

interface SwapQuote {
  amountIn: bigint;
  amountOut: bigint;
  priceImpact: number;
  route: string;
}

interface UseSwapResult {
  // Quote
  getQuote: (zeroForOne: boolean, amountIn: bigint) => Promise<SwapQuote | null>;

  // Swap methods
  /**
   * Direct plaintext swap using hook's defaultPoolId
   */
  swap: (zeroForOne: boolean, amountIn: bigint, minAmountOut: bigint) => Promise<`0x${string}`>;
  /**
   * Direct plaintext swap for specific pool
   */
  swapForPool: (
    poolId: `0x${string}`,
    zeroForOne: boolean,
    amountIn: bigint,
    minAmountOut: bigint
  ) => Promise<`0x${string}`>;
  /**
   * Encrypted swap - hides direction, amount, and minOutput
   */
  swapEncrypted: (
    poolId: `0x${string}`,
    zeroForOne: boolean,
    amountIn: bigint,
    minAmountOut: bigint
  ) => Promise<`0x${string}`>;
  /**
   * Router-based swap (legacy, uses V4 PoolSwapTest router)
   */
  swapViaRouter: (zeroForOne: boolean, amountIn: bigint, minAmountOut: bigint) => Promise<`0x${string}`>;

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
  const { encrypt, encryptBool, isReady: fheReady, isMock: fheMock } = useFheSession();

  // Get pool info
  const { hookAddress, token0, token1 } = useSelectedPool();
  const getPoolByKey = usePoolStore(state => state.getPoolByKey);
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

  /**
   * Check and approve token spending for the hook
   */
  const checkAndApproveToken = useCallback(async (
    tokenAddress: `0x${string}`,
    spender: `0x${string}`,
    amount: bigint
  ): Promise<void> => {
    if (!address || !publicClient) return;

    const allowance = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [address, spender],
    });

    if (allowance < amount) {
      setStep('approving');
      debugLog('Approving token', { tokenAddress, spender, amount: amount.toString() });

      const approveHash = await writeContractAsync({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [spender, amount],
        gas: 100000n,
      });

      addTransaction({
        hash: approveHash,
        type: 'approve',
        description: 'Approve token for swap',
      });

      await publicClient.waitForTransactionReceipt({ hash: approveHash });
      updateTransaction(approveHash, { status: 'confirmed' });
    }
  }, [address, publicClient, writeContractAsync, addTransaction, updateTransaction]);

  /**
   * Get a quote using the hook's getQuote function
   */
  const getQuote = useCallback(async (
    zeroForOne: boolean,
    amountIn: bigint
  ): Promise<SwapQuote | null> => {
    if (!publicClient || !hookAddress || amountIn === 0n) return null;

    setStep('simulating');
    setError(null);

    try {
      // Use hook's getQuote function
      const amountOut = await publicClient.readContract({
        address: hookAddress,
        abi: FHEATHERX_V6_ABI,
        functionName: 'getQuote',
        args: [zeroForOne, amountIn],
      }) as bigint;

      // Calculate price impact
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
      debugLog('Quote failed', err);
      setError(err instanceof Error ? err.message : 'Failed to get quote');
      setStep('error');
      return null;
    }
  }, [publicClient, hookAddress]);

  /**
   * Direct plaintext swap using hook's defaultPoolId
   */
  const swap = useCallback(async (
    zeroForOne: boolean,
    amountIn: bigint,
    minAmountOut: bigint
  ): Promise<`0x${string}`> => {
    debugLog('swap called', { zeroForOne, amountIn: amountIn.toString(), minAmountOut: minAmountOut.toString() });

    if (!address || !hookAddress || !publicClient || !token0 || !token1) {
      throw new Error('Wallet not connected or no pool selected');
    }

    setError(null);

    try {
      // Get token to approve (input token)
      const tokenIn = zeroForOne ? token0.address : token1.address;

      // Check and approve token
      await checkAndApproveToken(tokenIn, hookAddress, amountIn);

      setStep('swapping');

      const hash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_V6_ABI,
        functionName: 'swap',
        args: [zeroForOne, amountIn, minAmountOut],
      });

      debugLog('swap: tx submitted', { hash });
      setSwapHash(hash);

      addTransaction({
        hash,
        type: 'swap',
        description: zeroForOne ? `Swap ${token0.symbol} for ${token1.symbol}` : `Swap ${token1.symbol} for ${token0.symbol}`,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      updateTransaction(hash, { status: 'confirmed' });
      setStep('complete');
      successToast('Swap confirmed');
      return hash;
    } catch (err: unknown) {
      debugLog('swap: ERROR', err);
      const message = err instanceof Error ? err.message : 'Swap failed';
      setError(message);
      setStep('error');
      errorToast('Swap failed', message);
      throw err;
    }
  }, [address, hookAddress, publicClient, token0, token1, writeContractAsync, checkAndApproveToken, addTransaction, updateTransaction, successToast, errorToast]);

  /**
   * Direct plaintext swap for specific pool
   */
  const swapForPool = useCallback(async (
    poolId: `0x${string}`,
    zeroForOne: boolean,
    amountIn: bigint,
    minAmountOut: bigint
  ): Promise<`0x${string}`> => {
    debugLog('swapForPool called', { poolId, zeroForOne, amountIn: amountIn.toString() });

    if (!address || !hookAddress || !publicClient || !token0 || !token1) {
      throw new Error('Wallet not connected or no pool selected');
    }

    setError(null);

    try {
      const tokenIn = zeroForOne ? token0.address : token1.address;
      await checkAndApproveToken(tokenIn, hookAddress, amountIn);

      setStep('swapping');

      const hash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_V6_ABI,
        functionName: 'swapForPool',
        args: [poolId, zeroForOne, amountIn, minAmountOut],
      });

      debugLog('swapForPool: tx submitted', { hash });
      setSwapHash(hash);

      addTransaction({
        hash,
        type: 'swap',
        description: `Swap in pool ${poolId.slice(0, 10)}...`,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      updateTransaction(hash, { status: 'confirmed' });
      setStep('complete');
      successToast('Swap confirmed');
      return hash;
    } catch (err: unknown) {
      debugLog('swapForPool: ERROR', err);
      const message = err instanceof Error ? err.message : 'Swap failed';
      setError(message);
      setStep('error');
      errorToast('Swap failed', message);
      throw err;
    }
  }, [address, hookAddress, publicClient, token0, token1, writeContractAsync, checkAndApproveToken, addTransaction, updateTransaction, successToast, errorToast]);

  /**
   * Encrypted swap - hides direction, amount, and minOutput
   */
  const swapEncrypted = useCallback(async (
    poolId: `0x${string}`,
    zeroForOne: boolean,
    amountIn: bigint,
    minAmountOut: bigint
  ): Promise<`0x${string}`> => {
    debugLog('swapEncrypted called', { poolId, zeroForOne, amountIn: amountIn.toString() });

    if (!address || !hookAddress || !publicClient || !token0 || !token1) {
      throw new Error('Wallet not connected or no pool selected');
    }

    if (!fheMock && (!encrypt || !encryptBool || !fheReady)) {
      throw new Error('FHE session not ready. Please initialize FHE first.');
    }

    setError(null);

    try {
      const tokenIn = zeroForOne ? token0.address : token1.address;
      await checkAndApproveToken(tokenIn, hookAddress, amountIn);

      setStep('encrypting');
      debugLog('Encrypting swap parameters');

      let encDirection: InEbool;
      let encAmountIn: InEuint128;
      let encMinOutput: InEuint128;

      if (fheMock) {
        // Mock encryption for testing
        encDirection = {
          ctHash: zeroForOne ? 1n : 0n,
          securityZone: 0,
          utype: 0, // ebool type
          signature: '0x' as `0x${string}`,
        };
        encAmountIn = {
          ctHash: amountIn,
          securityZone: 0,
          utype: 7,
          signature: '0x' as `0x${string}`,
        };
        encMinOutput = {
          ctHash: minAmountOut,
          securityZone: 0,
          utype: 7,
          signature: '0x' as `0x${string}`,
        };
      } else {
        // Real FHE encryption
        const encDir = await encryptBool!(zeroForOne);
        const encAmt = await encrypt!(amountIn);
        const encMin = await encrypt!(minAmountOut);

        encDirection = {
          ctHash: BigInt('0x' + Buffer.from(encDir).toString('hex')),
          securityZone: 0,
          utype: 0,
          signature: '0x' as `0x${string}`,
        };
        encAmountIn = {
          ctHash: BigInt('0x' + Buffer.from(encAmt).toString('hex')),
          securityZone: 0,
          utype: 7,
          signature: '0x' as `0x${string}`,
        };
        encMinOutput = {
          ctHash: BigInt('0x' + Buffer.from(encMin).toString('hex')),
          securityZone: 0,
          utype: 7,
          signature: '0x' as `0x${string}`,
        };
      }

      setStep('swapping');

      const hash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_V6_ABI,
        functionName: 'swapEncrypted',
        args: [poolId, encDirection, encAmountIn, encMinOutput],
      });

      debugLog('swapEncrypted: tx submitted', { hash });
      setSwapHash(hash);

      addTransaction({
        hash,
        type: 'swap',
        description: 'Encrypted swap',
      });

      await publicClient.waitForTransactionReceipt({ hash });

      updateTransaction(hash, { status: 'confirmed' });
      setStep('complete');
      successToast('Encrypted swap confirmed');
      return hash;
    } catch (err: unknown) {
      debugLog('swapEncrypted: ERROR', err);
      const message = err instanceof Error ? err.message : 'Encrypted swap failed';
      setError(message);
      setStep('error');
      errorToast('Encrypted swap failed', message);
      throw err;
    }
  }, [address, hookAddress, publicClient, token0, token1, writeContractAsync, checkAndApproveToken, encrypt, encryptBool, fheReady, fheMock, addTransaction, updateTransaction, successToast, errorToast]);

  /**
   * Router-based swap (legacy, uses V4 PoolSwapTest router)
   */
  const swapViaRouter = useCallback(async (
    zeroForOne: boolean,
    amountIn: bigint,
    minAmountOut: bigint
  ): Promise<`0x${string}`> => {
    debugLog('swapViaRouter called', { zeroForOne, amountIn: amountIn.toString() });

    if (!address || !routerAddress || !publicClient || !hookAddress || !token0 || !token1) {
      throw new Error('Wallet not connected');
    }

    setError(null);

    try {
      const tokenIn = zeroForOne ? token0.address : token1.address;
      await checkAndApproveToken(tokenIn, routerAddress, amountIn);

      setStep('swapping');

      const poolKey: PoolKey = {
        currency0: token0.address,
        currency1: token1.address,
        fee: POOL_FEE,
        tickSpacing: TICK_SPACING,
        hooks: hookAddress,
      };

      const sqrtPriceLimit = zeroForOne ? MIN_SQRT_RATIO + 1n : MAX_SQRT_RATIO - 1n;

      const swapParams: SwapParams = {
        zeroForOne,
        amountSpecified: -amountIn, // Negative for exact input
        sqrtPriceLimitX96: sqrtPriceLimit,
      };

      const hookData = encodeSwapHookData(address);

      const testSettings = {
        takeClaims: false,
        settleUsingBurn: false,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hash = await writeContractAsync({
        address: routerAddress,
        abi: SWAP_ROUTER_ABI,
        functionName: 'swap',
        args: [poolKey, swapParams, testSettings, hookData] as any,
      });

      debugLog('swapViaRouter: tx submitted', { hash });
      setSwapHash(hash);

      addTransaction({
        hash,
        type: 'swap',
        description: zeroForOne ? `Swap ${token0.symbol} for ${token1.symbol} (router)` : `Swap ${token1.symbol} for ${token0.symbol} (router)`,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      updateTransaction(hash, { status: 'confirmed' });
      setStep('complete');
      successToast('Swap confirmed');
      return hash;
    } catch (err: unknown) {
      debugLog('swapViaRouter: ERROR', err);
      const message = err instanceof Error ? err.message : 'Swap failed';
      setError(message);
      setStep('error');
      errorToast('Swap failed', message);
      throw err;
    }
  }, [address, routerAddress, publicClient, hookAddress, token0, token1, writeContractAsync, checkAndApproveToken, addTransaction, updateTransaction, successToast, errorToast]);

  return {
    getQuote,
    swap,
    swapForPool,
    swapEncrypted,
    swapViaRouter,
    step,
    isSwapping: step === 'simulating' || step === 'approving' || step === 'encrypting' || step === 'swapping',
    swapHash,
    error,
    quote,
    reset,
  };
}
