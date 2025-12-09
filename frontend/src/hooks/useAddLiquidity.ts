'use client';

import { useState, useCallback } from 'react';
import { useAccount, usePublicClient, useChainId } from 'wagmi';
import { FHEATHERX_V6_ABI, type InEuint128, V6_DEFAULTS } from '@/lib/contracts/fheatherXv6Abi';
import { useFheSession } from './useFheSession';
import { POOL_MANAGER_ABI } from '@/lib/contracts/poolManagerAbi';
import { ERC20_ABI } from '@/lib/contracts/erc20Abi';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import { useSmartWriteContract } from './useTestWriteContract';
import { getPoolIdFromTokens, createPoolKey } from '@/lib/poolId';
import { POOL_MANAGER_ADDRESSES, SQRT_PRICE_1_1 } from '@/lib/contracts/addresses';
import type { Token } from '@/lib/tokens';

// Debug logger for add liquidity flow
const debugLog = (stage: string, data?: unknown) => {
  console.log(`[AddLiquidity Debug] ${stage}`, data !== undefined ? data : '');
};

type AddLiquidityStep =
  | 'idle'
  | 'checking-pool'
  | 'initializing-pool'
  | 'checking-token0'
  | 'approving-token0'
  | 'checking-token1'
  | 'approving-token1'
  | 'adding-liquidity'
  | 'complete'
  | 'error';

interface UseAddLiquidityResult {
  // Plaintext liquidity (works with all pool types)
  addLiquidity: (
    token0: Token,
    token1: Token,
    hookAddress: `0x${string}`,
    amount0: bigint,
    amount1: bigint,
    isPoolInitialized?: boolean
  ) => Promise<void>;
  // Encrypted liquidity (requires both tokens to be FHERC20)
  addLiquidityEncrypted: (
    token0: Token,
    token1: Token,
    hookAddress: `0x${string}`,
    amount0: bigint,
    amount1: bigint,
    isPoolInitialized?: boolean
  ) => Promise<void>;
  step: AddLiquidityStep;
  isLoading: boolean;
  txHash: `0x${string}` | null;
  lpAmountReceived: bigint | null;
  error: string | null;
  reset: () => void;
}

export function useAddLiquidity(): UseAddLiquidityResult {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const chainId = useChainId();
  const { writeContractAsync } = useSmartWriteContract();
  const { success: successToast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);
  const updateTransaction = useTransactionStore(state => state.updateTransaction);
  const { encrypt, isReady: fheReady, isMock: fheMock } = useFheSession();

  const [step, setStep] = useState<AddLiquidityStep>('idle');
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [lpAmountReceived, setLpAmountReceived] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('idle');
    setTxHash(null);
    setLpAmountReceived(null);
    setError(null);
  }, []);

  const addLiquidity = useCallback(async (
    token0: Token,
    token1: Token,
    hookAddress: `0x${string}`,
    amount0: bigint,
    amount1: bigint,
    isPoolInitialized: boolean = true
  ): Promise<void> => {
    setError(null);
    setTxHash(null);
    setLpAmountReceived(null);

    debugLog('Starting add liquidity', {
      token0: token0.symbol,
      token1: token1.symbol,
      hookAddress,
      amount0: amount0.toString(),
      amount1: amount1.toString(),
      isPoolInitialized,
    });

    // Validate wallet connection
    if (!address) {
      const message = 'Wallet not connected';
      setError(message);
      setStep('error');
      errorToast('Connection Error', message);
      return;
    }

    if (!publicClient) {
      const message = 'Public client not available';
      setError(message);
      setStep('error');
      errorToast('Connection Error', message);
      return;
    }

    // Validate amounts - contract requires BOTH to be > 0
    if (amount0 === 0n || amount1 === 0n) {
      const message = 'Both token amounts must be greater than 0';
      setError(message);
      setStep('error');
      errorToast('Invalid Input', message);
      return;
    }

    try {
      // Compute poolId and poolKey
      const poolId = getPoolIdFromTokens(token0, token1, hookAddress);
      const poolKey = createPoolKey(token0, token1, hookAddress);
      debugLog('Computed poolId', poolId);

      // Initialize pool if needed
      if (!isPoolInitialized) {
        setStep('initializing-pool');
        debugLog('Initializing pool via PoolManager');

        const poolManagerAddress = POOL_MANAGER_ADDRESSES[chainId];
        if (!poolManagerAddress || poolManagerAddress === '0x0000000000000000000000000000000000000000') {
          throw new Error('PoolManager address not configured for this network');
        }

        const initHash = await writeContractAsync({
          address: poolManagerAddress,
          abi: POOL_MANAGER_ABI,
          functionName: 'initialize',
          args: [
            {
              currency0: poolKey.currency0,
              currency1: poolKey.currency1,
              fee: poolKey.fee,
              tickSpacing: poolKey.tickSpacing,
              hooks: poolKey.hooks,
            },
            SQRT_PRICE_1_1,
          ],
        });

        debugLog('Pool initialization tx submitted', { hash: initHash });

        addTransaction({
          hash: initHash,
          type: 'deposit',
          description: `Initialize ${token0.symbol}/${token1.symbol} pool`,
        });

        await publicClient.waitForTransactionReceipt({ hash: initHash });
        updateTransaction(initHash, { status: 'confirmed' });
        debugLog('Pool initialized successfully');
      }

      // Check and approve token0 if needed
      if (amount0 > 0n) {
        setStep('checking-token0');
        debugLog('Checking token0 allowance');

        const allowance0 = await publicClient.readContract({
          address: token0.address,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, hookAddress],
        }) as bigint;

        debugLog('Token0 allowance', { allowance: allowance0.toString(), needsApproval: allowance0 < amount0 });

        if (allowance0 < amount0) {
          setStep('approving-token0');
          debugLog('Approving token0', { amount: amount0.toString() });

          const approveHash = await writeContractAsync({
            address: token0.address,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [hookAddress, amount0],
          });

          debugLog('Token0 approval tx submitted', { hash: approveHash });

          addTransaction({
            hash: approveHash,
            type: 'approve',
            description: `Approve ${token0.symbol} for liquidity`,
          });

          await publicClient.waitForTransactionReceipt({ hash: approveHash });
          updateTransaction(approveHash, { status: 'confirmed' });
          debugLog('Token0 approval confirmed');
        }
      }

      // Check and approve token1 if needed
      if (amount1 > 0n) {
        setStep('checking-token1');
        debugLog('Checking token1 allowance');

        const allowance1 = await publicClient.readContract({
          address: token1.address,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, hookAddress],
        }) as bigint;

        debugLog('Token1 allowance', { allowance: allowance1.toString(), needsApproval: allowance1 < amount1 });

        if (allowance1 < amount1) {
          setStep('approving-token1');
          debugLog('Approving token1', { amount: amount1.toString() });

          const approveHash = await writeContractAsync({
            address: token1.address,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [hookAddress, amount1],
          });

          debugLog('Token1 approval tx submitted', { hash: approveHash });

          addTransaction({
            hash: approveHash,
            type: 'approve',
            description: `Approve ${token1.symbol} for liquidity`,
          });

          await publicClient.waitForTransactionReceipt({ hash: approveHash });
          updateTransaction(approveHash, { status: 'confirmed' });
          debugLog('Token1 approval confirmed');
        }
      }

      // Add liquidity using v6 AMM function (plaintext)
      setStep('adding-liquidity');
      debugLog('Adding liquidity', { poolId, amount0: amount0.toString(), amount1: amount1.toString() });

      const addLiquidityHash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_V6_ABI,
        functionName: 'addLiquidity',
        args: [poolId, amount0, amount1],
      });

      debugLog('Add liquidity tx submitted', { hash: addLiquidityHash });
      setTxHash(addLiquidityHash);

      addTransaction({
        hash: addLiquidityHash,
        type: 'deposit',
        description: `Add ${token0.symbol}/${token1.symbol} liquidity`,
      });

      // Wait for confirmation and get LP tokens received
      const receipt = await publicClient.waitForTransactionReceipt({ hash: addLiquidityHash });
      updateTransaction(addLiquidityHash, { status: 'confirmed' });
      debugLog('Add liquidity confirmed', { receipt });

      // Try to parse LP amount from logs
      // Look for LiquidityAdded event: event LiquidityAdded(bytes32 indexed poolId, address indexed user, uint256 amount0, uint256 amount1, uint256 lpAmount)
      for (const log of receipt.logs) {
        try {
          // Check if this is the LiquidityAdded event (topic0)
          const eventSignature = '0x' + 'LiquidityAdded(bytes32,address,uint256,uint256,uint256)';
          // For now, just mark success - full event parsing would require viem's decodeEventLog
          debugLog('Log found', { address: log.address, topics: log.topics });
        } catch {
          // Continue if log parsing fails
        }
      }

      setStep('complete');
      successToast('Liquidity added successfully');

    } catch (err: unknown) {
      debugLog('ERROR in add liquidity flow', {
        error: err,
        name: err instanceof Error ? err.name : 'Unknown',
        message: err instanceof Error ? err.message : String(err),
        cause: (err as { cause?: unknown })?.cause,
        shortMessage: (err as { shortMessage?: string })?.shortMessage,
        details: (err as { details?: string })?.details,
      });

      // Better error message parsing
      let message = 'Failed to add liquidity';
      const errAny = err as { shortMessage?: string; message?: string };
      const errString = errAny.shortMessage || errAny.message || String(err);

      if (errString.includes('User rejected') || errString.includes('user rejected')) {
        message = 'Transaction was cancelled';
      } else if (errString.includes('insufficient funds')) {
        message = 'Insufficient funds for this transaction';
      } else if (errString.includes('insufficient balance')) {
        message = 'Insufficient token balance';
      } else if (errString.includes('ZeroAmount')) {
        message = 'Both token amounts must be greater than 0';
      } else if (errString.includes('PoolNotInitialized')) {
        message = 'Pool not initialized. The pool must be created through Uniswap v4 PoolManager first.';
      } else if (errString.includes('InsufficientLiquidity')) {
        message = 'Insufficient liquidity in the pool';
      } else {
        message = errString;
      }

      setError(message);
      setStep('error');
      errorToast('Failed to add liquidity', message);
    }
  }, [address, writeContractAsync, publicClient, chainId, addTransaction, updateTransaction, successToast, errorToast]);

  /**
   * Add liquidity with encrypted amounts (requires both tokens to be FHERC20)
   */
  const addLiquidityEncrypted = useCallback(async (
    token0: Token,
    token1: Token,
    hookAddress: `0x${string}`,
    amount0: bigint,
    amount1: bigint,
    isPoolInitialized: boolean = true
  ): Promise<void> => {
    setError(null);
    setTxHash(null);
    setLpAmountReceived(null);

    debugLog('Starting add liquidity encrypted', {
      token0: token0.symbol,
      token1: token1.symbol,
      hookAddress,
      amount0: amount0.toString(),
      amount1: amount1.toString(),
    });

    if (!address) {
      const message = 'Wallet not connected';
      setError(message);
      setStep('error');
      errorToast('Connection Error', message);
      return;
    }

    if (!publicClient) {
      const message = 'Public client not available';
      setError(message);
      setStep('error');
      errorToast('Connection Error', message);
      return;
    }

    // Check FHE session
    if (!fheMock && (!encrypt || !fheReady)) {
      const message = 'FHE session not ready. Please initialize FHE first.';
      setError(message);
      setStep('error');
      errorToast('FHE Error', message);
      return;
    }

    // Validate amounts
    if (amount0 === 0n || amount1 === 0n) {
      const message = 'Both token amounts must be greater than 0';
      setError(message);
      setStep('error');
      errorToast('Invalid Input', message);
      return;
    }

    try {
      // Compute poolId
      const poolId = getPoolIdFromTokens(token0, token1, hookAddress);
      debugLog('Computed poolId for encrypted', poolId);

      // TODO: Add pool initialization check similar to plaintext version

      // Check and approve token0
      if (amount0 > 0n) {
        setStep('checking-token0');
        const allowance0 = await publicClient.readContract({
          address: token0.address,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, hookAddress],
        }) as bigint;

        if (allowance0 < amount0) {
          setStep('approving-token0');
          const approveHash = await writeContractAsync({
            address: token0.address,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [hookAddress, amount0],
          });

          addTransaction({
            hash: approveHash,
            type: 'approve',
            description: `Approve ${token0.symbol} for encrypted liquidity`,
          });

          await publicClient.waitForTransactionReceipt({ hash: approveHash });
          updateTransaction(approveHash, { status: 'confirmed' });
        }
      }

      // Check and approve token1
      if (amount1 > 0n) {
        setStep('checking-token1');
        const allowance1 = await publicClient.readContract({
          address: token1.address,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, hookAddress],
        }) as bigint;

        if (allowance1 < amount1) {
          setStep('approving-token1');
          const approveHash = await writeContractAsync({
            address: token1.address,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [hookAddress, amount1],
          });

          addTransaction({
            hash: approveHash,
            type: 'approve',
            description: `Approve ${token1.symbol} for encrypted liquidity`,
          });

          await publicClient.waitForTransactionReceipt({ hash: approveHash });
          updateTransaction(approveHash, { status: 'confirmed' });
        }
      }

      // Encrypt amounts
      setStep('adding-liquidity');
      debugLog('Encrypting amounts');

      let encAmount0: InEuint128;
      let encAmount1: InEuint128;

      if (fheMock) {
        // Mock encryption for testing
        encAmount0 = {
          ctHash: amount0,
          securityZone: 0,
          utype: 7, // euint128 type
          signature: '0x' as `0x${string}`,
        };
        encAmount1 = {
          ctHash: amount1,
          securityZone: 0,
          utype: 7,
          signature: '0x' as `0x${string}`,
        };
      } else {
        // Real FHE encryption
        const encrypted0 = await encrypt!(amount0);
        const encrypted1 = await encrypt!(amount1);
        // TODO: Parse actual encrypted response format
        encAmount0 = {
          ctHash: BigInt('0x' + Buffer.from(encrypted0).toString('hex')),
          securityZone: 0,
          utype: 7,
          signature: '0x' as `0x${string}`,
        };
        encAmount1 = {
          ctHash: BigInt('0x' + Buffer.from(encrypted1).toString('hex')),
          securityZone: 0,
          utype: 7,
          signature: '0x' as `0x${string}`,
        };
      }

      debugLog('Calling addLiquidityEncrypted', { poolId, encAmount0, encAmount1 });

      const addLiquidityHash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_V6_ABI,
        functionName: 'addLiquidityEncrypted',
        args: [poolId, encAmount0, encAmount1],
      });

      debugLog('Add liquidity encrypted tx submitted', { hash: addLiquidityHash });
      setTxHash(addLiquidityHash);

      addTransaction({
        hash: addLiquidityHash,
        type: 'deposit',
        description: `Add ${token0.symbol}/${token1.symbol} encrypted liquidity`,
      });

      await publicClient.waitForTransactionReceipt({ hash: addLiquidityHash });
      updateTransaction(addLiquidityHash, { status: 'confirmed' });

      setStep('complete');
      successToast('Encrypted liquidity added successfully');

    } catch (err: unknown) {
      debugLog('ERROR in add liquidity encrypted flow', err);

      let message = 'Failed to add encrypted liquidity';
      const errAny = err as { shortMessage?: string; message?: string };
      const errString = errAny.shortMessage || errAny.message || String(err);

      if (errString.includes('User rejected') || errString.includes('user rejected')) {
        message = 'Transaction was cancelled';
      } else if (errString.includes('BothTokensMustBeFherc20')) {
        message = 'Encrypted liquidity requires both tokens to be FHERC20. Use plaintext addLiquidity instead.';
      } else if (errString.includes('ZeroAmount')) {
        message = 'Both token amounts must be greater than 0';
      } else {
        message = errString;
      }

      setError(message);
      setStep('error');
      errorToast('Failed to add encrypted liquidity', message);
    }
  }, [address, writeContractAsync, publicClient, encrypt, fheReady, fheMock, addTransaction, updateTransaction, successToast, errorToast]);

  const isLoading = step !== 'idle' && step !== 'complete' && step !== 'error';

  return {
    addLiquidity,
    addLiquidityEncrypted,
    step,
    isLoading,
    txHash,
    lpAmountReceived,
    error,
    reset,
  };
}
