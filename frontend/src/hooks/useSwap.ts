'use client';

import { useState, useCallback } from 'react';
import { useAccount, useChainId, useWriteContract, usePublicClient } from 'wagmi';
import { erc20Abi } from 'viem';
import { SWAP_ROUTER_ABI, type PoolKey, type SwapParams } from '@/lib/contracts/router';
import { encodeSwapHookData } from '@/lib/contracts/encoding';
import { SWAP_ROUTER_ADDRESSES, POOL_FEE, TICK_SPACING } from '@/lib/contracts/addresses';
import { MIN_SQRT_RATIO, MAX_SQRT_RATIO } from '@/lib/constants';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import { usePoolStore } from '@/stores/poolStore';

type SwapStep = 'idle' | 'simulating' | 'approving' | 'swapping' | 'complete' | 'error';

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

  const buildPoolKey = useCallback((poolKeyString?: string): PoolKey | null => {
    // Get pool info from the store
    const pool = poolKeyString
      ? getPoolByKey(poolKeyString)
      : getSelectedPool();

    if (!pool) return null;

    return {
      currency0: pool.token0,
      currency1: pool.token1,
      fee: POOL_FEE,
      tickSpacing: TICK_SPACING,
      hooks: pool.hook,
    };
  }, [getPoolByKey, getSelectedPool]);

  /**
   * Get a quote for a swap
   */
  const getQuote = useCallback(async (
    zeroForOne: boolean,
    amountIn: bigint
  ): Promise<SwapQuote | null> => {
    if (!publicClient || !routerAddress || !address) return null;

    const poolKey = buildPoolKey();
    if (!poolKey) {
      console.error('No pool found for quote');
      return null;
    }

    setStep('simulating');
    setError(null);

    try {
      const sqrtPriceLimit = zeroForOne ? MIN_SQRT_RATIO + 1n : MAX_SQRT_RATIO - 1n;

      // In Uniswap v4, negative amountSpecified = exact input, positive = exact output
      const swapParams: SwapParams = {
        zeroForOne,
        amountSpecified: -amountIn, // Negative for exact input swap
        sqrtPriceLimitX96: sqrtPriceLimit,
      };

      const hookData = encodeSwapHookData(address);

      // TestSettings for PoolSwapTest router
      const testSettings = {
        takeClaims: false,
        settleUsingBurn: false,
      };

      // Simulate the swap
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await publicClient.simulateContract({
        address: routerAddress,
        abi: SWAP_ROUTER_ABI,
        functionName: 'swap',
        // Type assertion needed due to complex tuple type inference
        args: [poolKey, swapParams, testSettings, hookData] as any,
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
  }, [publicClient, routerAddress, address, buildPoolKey]);

  /**
   * Execute a swap
   */
  const swap = useCallback(async (
    zeroForOne: boolean,
    amountIn: bigint,
    minAmountOut: bigint
  ): Promise<`0x${string}`> => {
    if (!address || !routerAddress || !publicClient) {
      throw new Error('Wallet not connected');
    }

    const poolKey = buildPoolKey();
    if (!poolKey) {
      throw new Error('No pool selected');
    }

    setError(null);

    try {
      // Determine which token we're selling
      const tokenIn = zeroForOne ? poolKey.currency0 : poolKey.currency1;

      // Check user's token balance first
      const userBalance = await publicClient.readContract({
        address: tokenIn,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      });

      console.log('=== BALANCE CHECK ===');
      console.log('Token:', tokenIn);
      console.log('User balance:', userBalance.toString());
      console.log('Required amount:', amountIn.toString());

      if (userBalance < amountIn) {
        const errorMsg = `Insufficient balance. You have ${userBalance.toString()} but need ${amountIn.toString()}. Use the faucet to get more tokens.`;
        setError(errorMsg);
        setStep('error');
        errorToast('Insufficient balance', 'Use the faucet to get more tokens');
        throw new Error(errorMsg);
      }

      // Check current allowance
      const allowance = await publicClient.readContract({
        address: tokenIn,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, routerAddress],
      });

      console.log('=== APPROVAL CHECK ===');
      console.log('Token:', tokenIn);
      console.log('Current allowance:', allowance.toString());
      console.log('Required amount:', amountIn.toString());

      // If allowance is insufficient, request approval
      if (allowance < amountIn) {
        setStep('approving');
        console.log('Requesting approval...');
        console.log('Token address:', tokenIn);
        console.log('Spender (router):', routerAddress);
        console.log('Amount to approve:', amountIn.toString());

        try {
          console.log('Calling writeContractAsync for approve...');
          console.log('Approve call params:', {
            address: tokenIn,
            functionName: 'approve',
            args: [routerAddress, amountIn.toString()],
          });

          // Create a timeout promise to detect if wallet interaction hangs
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error('Wallet interaction timed out after 60 seconds. Please check your wallet for pending requests.'));
            }, 60000);
          });

          const approvePromise = writeContractAsync({
            address: tokenIn,
            abi: erc20Abi,
            functionName: 'approve',
            args: [routerAddress, amountIn],
            // Explicitly set gas to avoid MetaMask simulation issues
            // ERC20 approve typically uses ~46k gas, we set 100k to be safe
            gas: 100000n,
          });

          console.log('Waiting for wallet confirmation...');
          const approveHash = await Promise.race([approvePromise, timeoutPromise]);
          console.log('writeContractAsync returned:', approveHash);

          console.log('Approval tx:', approveHash);
          addTransaction({
            hash: approveHash,
            type: 'approve',
            description: `Approve router to spend tokens`,
          });

          // Wait for approval confirmation
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
          updateTransaction(approveHash, { status: 'confirmed' });
          console.log('Approval confirmed');
        } catch (approveErr: unknown) {
          console.error('=== APPROVAL ERROR ===');
          console.error('Full error:', approveErr);
          console.error('Error details:', {
            name: approveErr instanceof Error ? approveErr.name : 'Unknown',
            message: approveErr instanceof Error ? approveErr.message : String(approveErr),
            code: (approveErr as { code?: number })?.code,
            details: (approveErr as { details?: string })?.details,
            cause: (approveErr as { cause?: unknown })?.cause,
            shortMessage: (approveErr as { shortMessage?: string })?.shortMessage,
            stack: approveErr instanceof Error ? approveErr.stack : undefined,
          });

          let message = 'Approval failed';
          if (approveErr instanceof Error) {
            if (approveErr.message.includes('User rejected') || approveErr.message.includes('user rejected')) {
              message = 'Approval rejected by user';
            } else if ((approveErr as unknown as { shortMessage?: string }).shortMessage) {
              message = (approveErr as unknown as { shortMessage: string }).shortMessage;
            } else {
              message = approveErr.message;
            }
          }

          setError(message);
          setStep('error');
          errorToast('Approval failed', message);
          throw approveErr;
        }
      }

      setStep('swapping');

      const sqrtPriceLimit = zeroForOne ? MIN_SQRT_RATIO + 1n : MAX_SQRT_RATIO - 1n;

      // In Uniswap v4, negative amountSpecified = exact input, positive = exact output
      const swapParams: SwapParams = {
        zeroForOne,
        amountSpecified: -amountIn, // Negative for exact input swap
        sqrtPriceLimitX96: sqrtPriceLimit,
      };

      const hookData = encodeSwapHookData(address);

      // TestSettings for PoolSwapTest router
      // takeClaims: false = receive tokens directly (not ERC6909 claims)
      // settleUsingBurn: false = use token transfers (not burn)
      const testSettings = {
        takeClaims: false,
        settleUsingBurn: false,
      };

      // Debug logging
      console.log('=== SWAP DEBUG ===');
      console.log('Router address:', routerAddress);
      console.log('Pool key:', JSON.stringify(poolKey, (_, v) => typeof v === 'bigint' ? v.toString() : v));
      console.log('Swap params:', JSON.stringify(swapParams, (_, v) => typeof v === 'bigint' ? v.toString() : v));
      console.log('Test settings:', testSettings);
      console.log('Hook data:', hookData);
      console.log('User address:', address);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hash = await writeContractAsync({
        address: routerAddress,
        abi: SWAP_ROUTER_ABI,
        functionName: 'swap',
        // Type assertion needed due to complex tuple type inference
        args: [poolKey, swapParams, testSettings, hookData] as any,
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
      console.error('=== SWAP ERROR ===');
      console.error('Full error:', err);

      // Extract more detailed error message
      let message = 'Swap failed';
      if (err instanceof Error) {
        message = err.message;
        // Check for common error patterns
        if (message.includes('User rejected') || message.includes('user rejected')) {
          message = 'Transaction rejected by user';
        } else if (message.includes('insufficient funds')) {
          message = 'Insufficient funds for gas';
        } else if (message.includes('ERC20InsufficientBalance')) {
          message = 'Insufficient token balance. Use the faucet to get more tokens.';
        } else if (message.includes('InsufficientLiquidity')) {
          message = 'Insufficient liquidity in the pool for this swap';
        } else if (message.includes('Simulation failed') || message.includes('simulation failed')) {
          message = 'Transaction simulation failed. Check your balance and try again.';
        } else if (message.includes('execution reverted')) {
          // Try to extract revert reason
          const revertMatch = message.match(/execution reverted:?\s*(.+?)(?:\n|$)/i);
          if (revertMatch) {
            message = `Contract reverted: ${revertMatch[1]}`;
          }
        }
      }

      setError(message);
      setStep('error');
      errorToast('Swap failed', message);
      throw err;
    }
  }, [address, routerAddress, publicClient, writeContractAsync, buildPoolKey, addTransaction, updateTransaction, successToast, errorToast]);

  return {
    getQuote,
    swap,
    step,
    isSwapping: step === 'simulating' || step === 'approving' || step === 'swapping',
    swapHash,
    error,
    quote,
    reset,
  };
}
