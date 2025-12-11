'use client';

import { useState, useCallback } from 'react';
import { useAccount, usePublicClient, useChainId } from 'wagmi';
import { FHEATHERX_V6_ABI, type InEuint128, V6_DEFAULTS } from '@/lib/contracts/fheatherXv6Abi';
import { FHERC20_ABI } from '@/lib/contracts/fherc20Abi';
import { useFheSession } from './useFheSession';
import { FHE_TYPES } from '@/lib/fhe-constants';
import { POOL_MANAGER_ABI } from '@/lib/contracts/poolManagerAbi';
import { ERC20_ABI } from '@/lib/contracts/erc20Abi';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import { useSmartWriteContract } from './useTestWriteContract';
import { getPoolIdFromTokens, createPoolKey } from '@/lib/poolId';
import { POOL_MANAGER_ADDRESSES, SQRT_PRICE_1_1 } from '@/lib/contracts/addresses';
import type { Token } from '@/lib/tokens';

// Pool type based on token types
type PoolType = 'ERC:ERC' | 'ERC:FHE' | 'FHE:FHE';

/**
 * Determine pool type from token types
 */
function getPoolType(token0: Token, token1: Token): PoolType {
  const t0IsFhe = token0.type === 'fheerc20';
  const t1IsFhe = token1.type === 'fheerc20';

  if (t0IsFhe && t1IsFhe) return 'FHE:FHE';
  if (t0IsFhe || t1IsFhe) return 'ERC:FHE';
  return 'ERC:ERC';
}

// Debug logger for add liquidity flow
const debugLog = (stage: string, data?: unknown) => {
  console.log(`[AddLiquidity Debug] ${stage}`, data !== undefined ? data : '');
};

type AddLiquidityStep =
  | 'idle'
  | 'checking-pool'
  | 'initializing-pool'
  | 'checking-balances'       // Check both plaintext and encrypted balances
  | 'wrapping-token0'         // wrap() for FHE:FHE pools
  | 'wrapping-token1'         // wrap() for FHE:FHE pools
  | 'unwrapping-token0'       // unwrap() for ERC:FHE pools
  | 'unwrapping-token1'       // unwrap() for ERC:FHE pools
  | 'checking-token0'
  | 'approving-token0'
  | 'approving-token0-encrypted'  // approveEncrypted() for FHE:FHE pools
  | 'checking-token1'
  | 'approving-token1'
  | 'approving-token1-encrypted'  // approveEncrypted() for FHE:FHE pools
  | 'encrypting'              // Encrypting amounts for FHE:FHE pools
  | 'adding-liquidity'
  | 'complete'
  | 'error';

interface UseAddLiquidityResult {
  /**
   * Auto-routing add liquidity - detects pool type and routes to correct method.
   * - FHE:FHE pools → addLiquidityEncrypted (wraps plaintext if needed)
   * - ERC:FHE pools → addLiquidity (unwraps encrypted if needed)
   * - ERC:ERC pools → addLiquidity
   */
  addLiquidityAuto: (
    token0: Token,
    token1: Token,
    hookAddress: `0x${string}`,
    amount0: bigint,
    amount1: bigint,
    isPoolInitialized?: boolean
  ) => Promise<void>;
  // Plaintext liquidity (works with all pool types, requires plaintext balance)
  addLiquidity: (
    token0: Token,
    token1: Token,
    hookAddress: `0x${string}`,
    amount0: bigint,
    amount1: bigint,
    isPoolInitialized?: boolean
  ) => Promise<void>;
  // Encrypted liquidity (requires both tokens to be FHERC20, requires encrypted balance)
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

  /**
   * Helper to unwrap FHERC20 tokens if needed for plaintext operations.
   * Returns true if unwrap was performed or not needed, false if error.
   */
  const ensurePlaintextBalance = useCallback(async (
    token: Token,
    amount: bigint,
    stepName: 'unwrapping-token0' | 'unwrapping-token1'
  ): Promise<boolean> => {
    if (!address || !publicClient) return false;
    if (token.type !== 'fheerc20') return true; // Not FHERC20, no unwrap needed

    // Check plaintext balance
    const plaintextBalance = await publicClient.readContract({
      address: token.address,
      abi: FHERC20_ABI,
      functionName: 'balanceOf',
      args: [address],
    }) as bigint;

    debugLog(`${token.symbol} plaintext balance`, { balance: plaintextBalance.toString(), needed: amount.toString() });

    if (plaintextBalance >= amount) {
      return true; // Already have enough plaintext balance
    }

    // Need to unwrap - check encrypted balance
    const encryptedHandle = await publicClient.readContract({
      address: token.address,
      abi: FHERC20_ABI,
      functionName: 'balanceOfEncrypted',
      args: [address],
    }) as bigint;

    if (encryptedHandle === 0n) {
      throw new Error(`Insufficient ${token.symbol} balance (no encrypted balance to unwrap)`);
    }

    // Calculate how much to unwrap
    const amountToUnwrap = amount - plaintextBalance;
    debugLog(`Unwrapping ${token.symbol}`, { amount: amountToUnwrap.toString() });

    setStep(stepName);
    const unwrapHash = await writeContractAsync({
      address: token.address,
      abi: FHERC20_ABI,
      functionName: 'unwrap',
      args: [amountToUnwrap],
    });

    addTransaction({
      hash: unwrapHash,
      type: 'approve', // Using approve type for unwrap tx
      description: `Unwrap ${token.symbol}`,
    });

    await publicClient.waitForTransactionReceipt({ hash: unwrapHash });
    updateTransaction(unwrapHash, { status: 'confirmed' });
    debugLog(`${token.symbol} unwrap confirmed`);

    return true;
  }, [address, publicClient, writeContractAsync, addTransaction, updateTransaction]);

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

    const poolType = getPoolType(token0, token1);
    debugLog('Starting add liquidity', {
      token0: token0.symbol,
      token1: token1.symbol,
      hookAddress,
      amount0: amount0.toString(),
      amount1: amount1.toString(),
      isPoolInitialized,
      poolType,
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

      // For ERC:FHE pools, unwrap FHERC20 tokens if needed
      setStep('checking-balances');
      await ensurePlaintextBalance(token0, amount0, 'unwrapping-token0');
      await ensurePlaintextBalance(token1, amount1, 'unwrapping-token1');

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
  }, [address, writeContractAsync, publicClient, chainId, addTransaction, updateTransaction, successToast, errorToast, ensurePlaintextBalance]);

  /**
   * Helper to wrap plaintext tokens to encrypted if needed for FHE:FHE pools.
   */
  const ensureEncryptedBalance = useCallback(async (
    token: Token,
    amount: bigint,
    stepName: 'wrapping-token0' | 'wrapping-token1'
  ): Promise<boolean> => {
    if (!address || !publicClient) return false;
    if (token.type !== 'fheerc20') {
      throw new Error(`${token.symbol} is not an FHERC20 token - cannot use encrypted liquidity`);
    }

    // Check encrypted balance (handle)
    const encryptedHandle = await publicClient.readContract({
      address: token.address,
      abi: FHERC20_ABI,
      functionName: 'balanceOfEncrypted',
      args: [address],
    }) as bigint;

    // If handle is non-zero, assume we have encrypted balance
    // We can't easily check the actual amount without decryption
    // For simplicity, if user has any encrypted balance, proceed
    // The contract will fail if insufficient
    if (encryptedHandle !== 0n) {
      debugLog(`${token.symbol} has encrypted balance (handle exists)`);
      return true;
    }

    // No encrypted balance - need to wrap plaintext
    const plaintextBalance = await publicClient.readContract({
      address: token.address,
      abi: FHERC20_ABI,
      functionName: 'balanceOf',
      args: [address],
    }) as bigint;

    debugLog(`${token.symbol} plaintext balance for wrapping`, { balance: plaintextBalance.toString(), needed: amount.toString() });

    if (plaintextBalance < amount) {
      throw new Error(`Insufficient ${token.symbol} balance to wrap`);
    }

    // Wrap the tokens
    setStep(stepName);
    debugLog(`Wrapping ${token.symbol}`, { amount: amount.toString() });

    const wrapHash = await writeContractAsync({
      address: token.address,
      abi: FHERC20_ABI,
      functionName: 'wrap',
      args: [amount],
    });

    addTransaction({
      hash: wrapHash,
      type: 'approve',
      description: `Wrap ${token.symbol}`,
    });

    await publicClient.waitForTransactionReceipt({ hash: wrapHash });
    updateTransaction(wrapHash, { status: 'confirmed' });
    debugLog(`${token.symbol} wrap confirmed`);

    return true;
  }, [address, publicClient, writeContractAsync, addTransaction, updateTransaction]);

  /**
   * Helper to ensure encrypted approval for FHE:FHE pools.
   * Uses "approve max once" strategy.
   */
  const ensureEncryptedApproval = useCallback(async (
    token: Token,
    spender: `0x${string}`,
    stepName: 'approving-token0-encrypted' | 'approving-token1-encrypted'
  ): Promise<void> => {
    if (!address || !publicClient || !encrypt) return;

    // Check if already approved (non-zero allowance handle)
    const allowanceHandle = await publicClient.readContract({
      address: token.address,
      abi: FHERC20_ABI,
      functionName: 'allowanceEncrypted',
      args: [address, spender],
    }) as bigint;

    if (allowanceHandle !== 0n) {
      debugLog(`${token.symbol} already has encrypted approval`);
      return;
    }

    // Need to approve - use max uint128
    setStep(stepName);
    debugLog(`Approving ${token.symbol} (encrypted) for max amount`);

    // Max uint128 value
    const maxUint128 = 2n ** 128n - 1n;

    let encMaxAmount: InEuint128;
    if (fheMock) {
      encMaxAmount = {
        ctHash: maxUint128,
        securityZone: 0,
        utype: FHE_TYPES.EUINT128,
        signature: '0x' as `0x${string}`,
      };
    } else {
      encMaxAmount = await encrypt(maxUint128);
    }

    const approveHash = await writeContractAsync({
      address: token.address,
      abi: FHERC20_ABI,
      functionName: 'approveEncrypted',
      args: [spender, encMaxAmount],
    });

    addTransaction({
      hash: approveHash,
      type: 'approve',
      description: `Approve ${token.symbol} (encrypted)`,
    });

    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    updateTransaction(approveHash, { status: 'confirmed' });
    debugLog(`${token.symbol} encrypted approval confirmed`);
  }, [address, publicClient, writeContractAsync, encrypt, fheMock, addTransaction, updateTransaction]);

  /**
   * Add liquidity with encrypted amounts (requires both tokens to be FHERC20)
   * Automatically wraps plaintext balance if needed.
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

    // Validate pool type - both must be FHERC20
    if (token0.type !== 'fheerc20' || token1.type !== 'fheerc20') {
      const message = 'Both tokens must be FHERC20 for encrypted liquidity';
      setError(message);
      setStep('error');
      errorToast('Invalid Pool', message);
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

      // Ensure we have encrypted balances (wrap if needed)
      setStep('checking-balances');
      await ensureEncryptedBalance(token0, amount0, 'wrapping-token0');
      await ensureEncryptedBalance(token1, amount1, 'wrapping-token1');

      // Ensure encrypted approvals (approve max once strategy)
      await ensureEncryptedApproval(token0, hookAddress, 'approving-token0-encrypted');
      await ensureEncryptedApproval(token1, hookAddress, 'approving-token1-encrypted');

      // Encrypt amounts
      setStep('encrypting');
      debugLog('Encrypting amounts');

      let encAmount0: InEuint128;
      let encAmount1: InEuint128;

      if (fheMock) {
        // Mock encryption for testing (no CoFHE validation)
        encAmount0 = {
          ctHash: amount0,
          securityZone: 0,
          utype: FHE_TYPES.EUINT128,
          signature: '0x' as `0x${string}`,
        };
        encAmount1 = {
          ctHash: amount1,
          securityZone: 0,
          utype: FHE_TYPES.EUINT128,
          signature: '0x' as `0x${string}`,
        };
      } else {
        // Real FHE encryption - returns full struct with signature
        encAmount0 = await encrypt!(amount0);
        encAmount1 = await encrypt!(amount1);
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

      // For encrypted liquidity, the reserves are updated asynchronously via FHE decrypt.
      // We need to call trySyncReserves to harvest the resolved decrypt results.
      // Start polling to sync reserves (async decrypt takes time).
      debugLog('Starting reserve sync polling for FHE pool');

      // Get initial reserves for comparison
      let initialReserves: [bigint, bigint, bigint] | null = null;
      try {
        initialReserves = await publicClient.readContract({
          address: hookAddress,
          abi: FHEATHERX_V6_ABI,
          functionName: 'getPoolReserves',
          args: [poolId],
        }) as [bigint, bigint, bigint];
        debugLog('Initial reserves before sync', {
          reserve0: initialReserves[0].toString(),
          reserve1: initialReserves[1].toString(),
        });
      } catch {
        // Ignore
      }

      // Poll for up to 60 seconds with 5 second intervals
      const maxAttempts = 12;
      const pollInterval = 5000;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Wait before trying to sync
        await new Promise(resolve => setTimeout(resolve, pollInterval));

        try {
          // Call trySyncReserves to harvest any resolved decrypts
          await writeContractAsync({
            address: hookAddress,
            abi: FHEATHERX_V6_ABI,
            functionName: 'trySyncReserves',
            args: [poolId],
          });
          debugLog(`Reserve sync attempt ${attempt + 1} completed`);
        } catch (syncErr) {
          // trySyncReserves might fail if no new decrypts resolved, that's OK
          debugLog(`Reserve sync attempt ${attempt + 1} - no new decrypts`, syncErr);
        }

        // Check if reserves have been updated by reading them
        try {
          const reserves = await publicClient.readContract({
            address: hookAddress,
            abi: FHEATHERX_V6_ABI,
            functionName: 'getPoolReserves',
            args: [poolId],
          }) as [bigint, bigint, bigint];

          debugLog(`Reserve check attempt ${attempt + 1}`, {
            reserve0: reserves[0].toString(),
            reserve1: reserves[1].toString(),
            lpSupply: reserves[2].toString(),
          });

          // Check if reserves changed from initial values (decrypt resolved)
          if (initialReserves &&
              (reserves[0] !== initialReserves[0] || reserves[1] !== initialReserves[1])) {
            debugLog('Reserves synced successfully - values changed');
            break;
          }
        } catch {
          // Ignore read errors
        }
      }

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
  }, [address, writeContractAsync, publicClient, encrypt, fheReady, fheMock, addTransaction, updateTransaction, successToast, errorToast, ensureEncryptedBalance, ensureEncryptedApproval]);

  /**
   * Auto-routing add liquidity - detects pool type and routes to correct method.
   * - FHE:FHE pools → addLiquidityEncrypted (wraps plaintext if needed)
   * - ERC:FHE pools → addLiquidity (unwraps encrypted if needed)
   * - ERC:ERC pools → addLiquidity
   */
  const addLiquidityAuto = useCallback(async (
    token0: Token,
    token1: Token,
    hookAddress: `0x${string}`,
    amount0: bigint,
    amount1: bigint,
    isPoolInitialized: boolean = true
  ): Promise<void> => {
    const poolType = getPoolType(token0, token1);
    debugLog('addLiquidityAuto routing', { poolType, token0: token0.symbol, token1: token1.symbol });

    if (poolType === 'FHE:FHE') {
      // Both tokens are FHERC20 - use encrypted liquidity for privacy
      return addLiquidityEncrypted(token0, token1, hookAddress, amount0, amount1, isPoolInitialized);
    } else {
      // ERC:ERC or ERC:FHE - use plaintext liquidity (with auto-unwrap for FHERC20)
      return addLiquidity(token0, token1, hookAddress, amount0, amount1, isPoolInitialized);
    }
  }, [addLiquidity, addLiquidityEncrypted]);

  const isLoading = step !== 'idle' && step !== 'complete' && step !== 'error';

  return {
    addLiquidityAuto,
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
