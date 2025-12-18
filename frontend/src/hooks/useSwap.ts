'use client';

/**
 * useSwap - Multi-Version Swap Hook
 *
 * Supports three contract types:
 * - native: Standard Uniswap v4 (ERC:ERC pools, no FHE)
 * - v8fhe: Full privacy FHE pools (FHE:FHE)
 * - v8mixed: Mixed pools (FHE:ERC or ERC:FHE)
 *
 * Native swaps:
 * - Use Universal Router with V4_SWAP commands
 * - Standard Uniswap v4 interface
 *
 * v8 swaps:
 * - Swaps happen through PoolManager via router (hook intercepts via beforeSwap)
 * - getQuote(poolId, zeroForOne, amountIn) for quotes
 *
 * This hook routes to the correct swap method based on contract type.
 */

import { useState, useCallback } from 'react';
import { useAccount, useChainId, useWriteContract, usePublicClient } from 'wagmi';
import { erc20Abi } from 'viem';
import { FHEATHERX_V6_ABI, type InEuint128, type InEbool } from '@/lib/contracts/fheatherXv6Abi';
import { FHEATHERX_V8_FHE_ABI } from '@/lib/contracts/fheatherXv8FHE-abi';
import { FHEATHERX_V8_MIXED_ABI } from '@/lib/contracts/fheatherXv8Mixed-abi';
import { PRIVATE_SWAP_ROUTER_ABI } from '@/lib/contracts/privateSwapRouter-abi';
import { UNISWAP_V4_UNIVERSAL_ROUTER_ABI } from '@/lib/contracts/uniswapV4-abi';
import { SWAP_ROUTER_ABI, type PoolKey, type SwapParams } from '@/lib/contracts/router';
import { encodeSwapHookData } from '@/lib/contracts/encoding';
import { SWAP_ROUTER_ADDRESSES, UNIVERSAL_ROUTER_ADDRESSES, PRIVATE_SWAP_ROUTER_ADDRESSES, POOL_FEE, TICK_SPACING } from '@/lib/contracts/addresses';
import { MIN_SQRT_RATIO, MAX_SQRT_RATIO } from '@/lib/constants';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import { usePoolStore, useSelectedPool } from '@/stores/poolStore';
import { useFheSession } from './useFheSession';
import { FHE_TYPES } from '@/lib/fhe-constants';
import { getPoolIdFromTokens } from '@/lib/poolId';
import type { Token } from '@/lib/tokens';
import type { ContractType } from '@/types/pool';

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
   * Direct plaintext swap (uses current pool's poolId)
   */
  swap: (zeroForOne: boolean, amountIn: bigint, minAmountOut: bigint) => Promise<`0x${string}`>;
  /**
   * Direct plaintext swap for specific pool (explicit poolId)
   */
  swapForPool: (
    poolId: `0x${string}`,
    zeroForOne: boolean,
    amountIn: bigint,
    minAmountOut: bigint
  ) => Promise<`0x${string}`>;
  /**
   * Encrypted swap - hides direction, amount, and minOutput (legacy v6)
   */
  swapEncrypted: (
    poolId: `0x${string}`,
    zeroForOne: boolean,
    amountIn: bigint,
    minAmountOut: bigint
  ) => Promise<`0x${string}`>;
  /**
   * Private swap via PrivateSwapRouter - for v8 pools
   * - v8fhe: Full privacy (encrypted direction + amounts)
   * - v8mixed: Partial privacy (plaintext direction, encrypted amounts)
   */
  swapPrivate: (zeroForOne: boolean, amountIn: bigint, minAmountOut: bigint) => Promise<`0x${string}`>;
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
  const { hookAddress, token0, token1, contractType } = useSelectedPool();
  const getPoolByKey = usePoolStore(state => state.getPoolByKey);
  const getSelectedPool = usePoolStore(state => state.getSelectedPool);

  const routerAddress = SWAP_ROUTER_ADDRESSES[chainId];
  const privateSwapRouterAddress = PRIVATE_SWAP_ROUTER_ADDRESSES[chainId];

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
   * Check and approve token spending for the hook (ERC20 approve)
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
        chainId,
        gas: 500000n, // FHERC20 tokens need more gas due to FHE operations
      });

      addTransaction({
        hash: approveHash,
        type: 'approve',
        description: 'Approve token for swap',
      });

      await publicClient.waitForTransactionReceipt({ hash: approveHash });
      updateTransaction(approveHash, { status: 'confirmed' });
    }
  }, [address, publicClient, writeContractAsync, chainId, addTransaction, updateTransaction]);

  /**
   * Check and approve encrypted token spending for FHERC20 tokens
   * Required for v8fhe pools where hook calls _transferFromEncrypted()
   */
  const checkAndApproveEncrypted = useCallback(async (
    tokenAddress: `0x${string}`,
    spender: `0x${string}`,
    _amount: bigint
  ): Promise<void> => {
    if (!address || !publicClient) return;

    // For encrypted approvals, we approve max uint128 to avoid repeated approvals
    // The encrypted allowance is checked on-chain during _transferFromEncrypted()
    setStep('approving');
    debugLog('Approving encrypted token', { tokenAddress, spender });

    // Encrypt max uint128 for approval
    const maxU128 = BigInt('340282366920938463463374607431768211455'); // type(uint128).max

    let encApproval: InEuint128;
    if (fheMock) {
      encApproval = {
        ctHash: maxU128,
        securityZone: 0,
        utype: FHE_TYPES.EUINT128,
        signature: '0x' as `0x${string}`,
      };
    } else {
      if (!encrypt || !fheReady) {
        throw new Error('FHE session not ready for encrypted approval');
      }
      encApproval = await encrypt(maxU128);
    }

    // FHERC20 ABI for approveEncrypted
    const FHERC20_APPROVE_ABI = [
      {
        name: 'approveEncrypted',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'spender', type: 'address' },
          { name: 'amount', type: 'tuple', components: [
            { name: 'ctHash', type: 'uint256' },
            { name: 'securityZone', type: 'uint8' },
            { name: 'utype', type: 'uint8' },
            { name: 'signature', type: 'bytes' },
          ]},
        ],
        outputs: [{ type: 'bool' }],
      },
    ] as const;

    const approveHash = await writeContractAsync({
      address: tokenAddress,
      abi: FHERC20_APPROVE_ABI,
      functionName: 'approveEncrypted',
      args: [spender, encApproval],
      chainId,
      gas: 1000000n, // Encrypted approvals need more gas
    });

    addTransaction({
      hash: approveHash,
      type: 'approve',
      description: 'Approve encrypted token for swap',
    });

    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    updateTransaction(approveHash, { status: 'confirmed' });
  }, [address, publicClient, writeContractAsync, chainId, addTransaction, updateTransaction, encrypt, fheReady, fheMock]);

  /**
   * Get ABI based on contract type
   */
  const getAbiForContractType = useCallback((type: ContractType) => {
    switch (type) {
      case 'v8fhe':
        return FHEATHERX_V8_FHE_ABI;
      case 'v8mixed':
        return FHEATHERX_V8_MIXED_ABI;
      case 'native':
      default:
        return UNISWAP_V4_UNIVERSAL_ROUTER_ABI;
    }
  }, []);

  /**
   * Get a quote using the hook's getQuote function (v8) or Quoter contract (native)
   */
  const getQuote = useCallback(async (
    zeroForOne: boolean,
    amountIn: bigint
  ): Promise<SwapQuote | null> => {
    if (!publicClient || !token0 || !token1 || amountIn === 0n) return null;

    // Native pools require hookAddress to be undefined, FHE pools require it
    if (contractType !== 'native' && !hookAddress) return null;

    setStep('simulating');
    setError(null);

    try {
      // Compute poolId from tokens and hook (use zero address for native)
      const hook = hookAddress || '0x0000000000000000000000000000000000000000' as `0x${string}`;
      const poolId = getPoolIdFromTokens(token0, token1, hook);
      debugLog('getQuote: computed poolId', { poolId, token0: token0.address, token1: token1.address, contractType });

      let amountOut: bigint;

      if (contractType === 'native') {
        // Native Uniswap v4: TODO - Use Quoter contract for quotes
        // For now, return a simple x*y=k estimate (inaccurate for concentrated liquidity)
        debugLog('getQuote: native pools - using estimate (Quoter not yet implemented)');
        // Rough estimate assuming 0.3% fee
        amountOut = amountIn * 997n / 1000n;
      } else {
        // v8 FHE pools use getQuote(poolId, zeroForOne, amountIn)
        const abi = getAbiForContractType(contractType);
        amountOut = await publicClient.readContract({
          address: hookAddress!,
          abi,
          functionName: 'getQuote',
          args: [poolId, zeroForOne, amountIn],
        }) as bigint;
      }

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
  }, [publicClient, hookAddress, token0, token1, contractType, getAbiForContractType]);

  /**
   * Direct plaintext swap
   * - native: Uses Universal Router (standard Uniswap v4)
   * - v8fhe/v8mixed: Uses router with FHE hook
   */
  const swap = useCallback(async (
    zeroForOne: boolean,
    amountIn: bigint,
    minAmountOut: bigint
  ): Promise<`0x${string}`> => {
    debugLog('swap called', { zeroForOne, amountIn: amountIn.toString(), minAmountOut: minAmountOut.toString(), contractType });

    if (!address || !publicClient || !token0 || !token1) {
      throw new Error('Wallet not connected or no pool selected');
    }

    // FHE pools require hookAddress
    if (contractType !== 'native' && !hookAddress) {
      throw new Error('No FHE hook configured for this pool');
    }

    setError(null);

    // Native pools use Universal Router
    if (contractType === 'native') {
      debugLog('swap: using Universal Router for native pool');

      const universalRouterAddress = UNIVERSAL_ROUTER_ADDRESSES[chainId];
      if (!universalRouterAddress || universalRouterAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error('Universal Router not configured for this chain');
      }

      try {
        const tokenIn = zeroForOne ? token0.address : token1.address;
        await checkAndApproveToken(tokenIn, universalRouterAddress, amountIn);

        setStep('swapping');

        // TODO: Implement Universal Router command encoding for native swaps
        // For now, fall back to PoolSwapTest router if available
        if (routerAddress) {
          const poolKey: PoolKey = {
            currency0: token0.address,
            currency1: token1.address,
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: '0x0000000000000000000000000000000000000000' as `0x${string}`, // No hook for native
          };

          const sqrtPriceLimit = zeroForOne ? MIN_SQRT_RATIO + 1n : MAX_SQRT_RATIO - 1n;

          const swapParams: SwapParams = {
            zeroForOne,
            amountSpecified: -amountIn,
            sqrtPriceLimitX96: sqrtPriceLimit,
          };

          const testSettings = {
            takeClaims: false,
            settleUsingBurn: false,
          };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const hash = await writeContractAsync({
            address: routerAddress,
            abi: SWAP_ROUTER_ABI,
            functionName: 'swap',
            args: [poolKey, swapParams, testSettings, '0x'] as any,
            chainId,
          });

          debugLog('swap (native via PoolSwapTest): tx submitted', { hash });
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
        }

        throw new Error('Native swap not yet fully implemented - Universal Router command encoding needed');
      } catch (err: unknown) {
        debugLog('swap (native): ERROR', err);
        const message = err instanceof Error ? err.message : 'Swap failed';
        setError(message);
        setStep('error');
        errorToast('Swap failed', message);
        throw err;
      }
    }

    // v8FHE pools REQUIRE encrypted swaps (both tokens are FHERC20)
    // Route through swapPrivate() which uses PrivateSwapRouter with encrypted transfers
    if (contractType === 'v8fhe') {
      debugLog('swap: v8FHE requires encrypted swap, redirecting to swapPrivate');
      return swapPrivate(zeroForOne, amountIn, minAmountOut);
    }

    // v8Mixed pools can use router-based plaintext swaps
    // (hook intercepts via beforeSwap and handles appropriately)
    if (contractType === 'v8mixed') {
      debugLog('swap: using router for v8mixed contract');

      if (!routerAddress) {
        throw new Error('Router not configured for this chain');
      }

      try {
        const tokenIn = zeroForOne ? token0.address : token1.address;
        // v8 hooks transfer directly from user, so approve the HOOK (not router)
        await checkAndApproveToken(tokenIn, hookAddress!, amountIn);

        setStep('swapping');

        const poolKey: PoolKey = {
          currency0: token0.address,
          currency1: token1.address,
          fee: POOL_FEE,
          tickSpacing: TICK_SPACING,
          hooks: hookAddress!,
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
          chainId,
        });

        debugLog('swap (v8mixed via router): tx submitted', { hash });
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
        debugLog('swap (v8mixed via router): ERROR', err);
        const message = err instanceof Error ? err.message : 'Swap failed';
        setError(message);
        setStep('error');
        errorToast('Swap failed', message);
        throw err;
      }
    }

    // Fallback (shouldn't reach here)
    throw new Error(`Unsupported contract type: ${contractType}`);
  // Note: swapPrivate is called for v8fhe but not in deps to avoid circular dependency
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, hookAddress, publicClient, token0, token1, writeContractAsync, chainId, checkAndApproveToken, addTransaction, updateTransaction, successToast, errorToast, contractType, routerAddress]);

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
        chainId,
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
  }, [address, hookAddress, publicClient, token0, token1, writeContractAsync, chainId, checkAndApproveToken, addTransaction, updateTransaction, successToast, errorToast]);

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
        // Mock encryption for testing (no CoFHE validation)
        encDirection = {
          ctHash: zeroForOne ? 1n : 0n,
          securityZone: 0,
          utype: FHE_TYPES.EBOOL,
          signature: '0x' as `0x${string}`,
        };
        encAmountIn = {
          ctHash: amountIn,
          securityZone: 0,
          utype: FHE_TYPES.EUINT128,
          signature: '0x' as `0x${string}`,
        };
        encMinOutput = {
          ctHash: minAmountOut,
          securityZone: 0,
          utype: FHE_TYPES.EUINT128,
          signature: '0x' as `0x${string}`,
        };
      } else {
        // Real FHE encryption - returns full struct with signature
        encDirection = await encryptBool!(zeroForOne);
        encAmountIn = await encrypt!(amountIn);
        encMinOutput = await encrypt!(minAmountOut);
      }

      setStep('swapping');

      const hash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_V6_ABI,
        functionName: 'swapEncrypted',
        args: [poolId, encDirection, encAmountIn, encMinOutput],
        chainId,
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
  }, [address, hookAddress, publicClient, token0, token1, writeContractAsync, chainId, checkAndApproveToken, encrypt, encryptBool, fheReady, fheMock, addTransaction, updateTransaction, successToast, errorToast]);

  /**
   * Private swap via PrivateSwapRouter - for v8 pools
   * - v8fhe: Full privacy (encrypted direction + amounts)
   * - v8mixed: Partial privacy (plaintext direction, encrypted amounts)
   */
  const swapPrivate = useCallback(async (
    zeroForOne: boolean,
    amountIn: bigint,
    minAmountOut: bigint
  ): Promise<`0x${string}`> => {
    debugLog('swapPrivate called', { zeroForOne, amountIn: amountIn.toString(), contractType });

    if (!address || !hookAddress || !publicClient || !token0 || !token1) {
      throw new Error('Wallet not connected or no pool selected');
    }

    if (!privateSwapRouterAddress || privateSwapRouterAddress === '0x0000000000000000000000000000000000000000') {
      throw new Error('PrivateSwapRouter not configured for this chain');
    }

    if (contractType !== 'v8fhe' && contractType !== 'v8mixed') {
      throw new Error('Private swaps only supported for v8fhe and v8mixed pools');
    }

    if (!fheMock && (!encrypt || !fheReady)) {
      throw new Error('FHE session not ready. Please initialize FHE first.');
    }

    setError(null);

    try {
      // Approve tokens to the HOOK (not router) - hook handles transfers
      const tokenIn = zeroForOne ? token0.address : token1.address;

      // v8fhe pools REQUIRE encrypted approvals for _transferFromEncrypted()
      // v8mixed may use regular approvals depending on token type
      if (contractType === 'v8fhe') {
        debugLog('swapPrivate (v8fhe): using encrypted approval');
        await checkAndApproveEncrypted(tokenIn, hookAddress, amountIn);
      } else {
        await checkAndApproveToken(tokenIn, hookAddress, amountIn);
      }

      setStep('encrypting');
      debugLog('Encrypting swap parameters for private swap');

      let encAmountIn: InEuint128;
      let encMinOutput: InEuint128;

      if (fheMock) {
        // Mock encryption for testing
        encAmountIn = {
          ctHash: amountIn,
          securityZone: 0,
          utype: FHE_TYPES.EUINT128,
          signature: '0x' as `0x${string}`,
        };
        encMinOutput = {
          ctHash: minAmountOut,
          securityZone: 0,
          utype: FHE_TYPES.EUINT128,
          signature: '0x' as `0x${string}`,
        };
      } else {
        // Real FHE encryption
        encAmountIn = await encrypt!(amountIn);
        encMinOutput = await encrypt!(minAmountOut);
      }

      setStep('swapping');

      // Build the pool key
      const poolKey: PoolKey = {
        currency0: token0.address,
        currency1: token1.address,
        fee: POOL_FEE,
        tickSpacing: TICK_SPACING,
        hooks: hookAddress,
      };

      let hash: `0x${string}`;

      if (contractType === 'v8fhe') {
        // Full privacy: encrypt direction as well
        let encDirection: InEbool;

        if (fheMock) {
          encDirection = {
            ctHash: zeroForOne ? 1n : 0n,
            securityZone: 0,
            utype: FHE_TYPES.EBOOL,
            signature: '0x' as `0x${string}`,
          };
        } else {
          encDirection = await encryptBool!(zeroForOne);
        }

        debugLog('swapPrivate (v8fhe): calling swapEncrypted on router');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hash = await writeContractAsync({
          address: privateSwapRouterAddress,
          abi: PRIVATE_SWAP_ROUTER_ABI,
          functionName: 'swapEncrypted',
          args: [poolKey, encDirection, encAmountIn, encMinOutput] as any,
          chainId,
        });
      } else {
        // v8mixed: Partial privacy (plaintext direction)
        debugLog('swapPrivate (v8mixed): calling swapMixed on router');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hash = await writeContractAsync({
          address: privateSwapRouterAddress,
          abi: PRIVATE_SWAP_ROUTER_ABI,
          functionName: 'swapMixed',
          args: [poolKey, zeroForOne, encAmountIn, encMinOutput] as any,
          chainId,
        });
      }

      debugLog('swapPrivate: tx submitted', { hash });
      setSwapHash(hash);

      addTransaction({
        hash,
        type: 'swap',
        description: `Private swap ${token0.symbol}/${token1.symbol}`,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      updateTransaction(hash, { status: 'confirmed' });
      setStep('complete');
      successToast('Private swap confirmed');
      return hash;
    } catch (err: unknown) {
      debugLog('swapPrivate: ERROR', err);
      const message = err instanceof Error ? err.message : 'Private swap failed';
      setError(message);
      setStep('error');
      errorToast('Private swap failed', message);
      throw err;
    }
  }, [address, hookAddress, publicClient, token0, token1, writeContractAsync, chainId, checkAndApproveToken, checkAndApproveEncrypted, encrypt, encryptBool, fheReady, fheMock, contractType, privateSwapRouterAddress, addTransaction, updateTransaction, successToast, errorToast]);

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
        chainId,
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
  }, [address, routerAddress, publicClient, hookAddress, token0, token1, writeContractAsync, chainId, checkAndApproveToken, addTransaction, updateTransaction, successToast, errorToast]);

  return {
    getQuote,
    swap,
    swapForPool,
    swapEncrypted,
    swapPrivate,
    swapViaRouter,
    step,
    isSwapping: step === 'simulating' || step === 'approving' || step === 'encrypting' || step === 'swapping',
    swapHash,
    error,
    quote,
    reset,
  };
}
