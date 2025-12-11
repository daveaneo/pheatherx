'use client';

/**
 * useDeposit - v6 Limit Order Deposit Hook
 *
 * In v6, deposit() is for placing LIMIT ORDERS, not AMM liquidity.
 * For AMM liquidity, use useAddLiquidity instead.
 *
 * v6 deposit signature:
 * deposit(PoolId poolId, int24 tick, BucketSide side, InEuint128 encryptedAmount, uint256 deadline, int24 maxTickDrift)
 *
 * Key constraints:
 * - Input token must be FHERC20 (for MEV protection)
 * - Amount is always encrypted
 */

import { useState, useCallback } from 'react';
import { useAccount, useChainId, useWriteContract, usePublicClient } from 'wagmi';
import { FHEATHERX_V6_ABI, BucketSide, V6_DEFAULTS, type InEuint128, type BucketSideType } from '@/lib/contracts/fheatherXv6Abi';
import { ERC20_ABI } from '@/lib/contracts/erc20Abi';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import { useSelectedPool } from '@/stores/poolStore';
import { useFheSession } from './useFheSession';
import { getPoolIdFromTokens } from '@/lib/poolId';
import { FHE_TYPES } from '@/lib/fhe-constants';
import type { Token } from '@/lib/tokens';

type DepositStep = 'idle' | 'checking' | 'approving' | 'encrypting' | 'depositing' | 'complete' | 'error';

// Debug logger for deposit flow
const debugLog = (stage: string, data?: unknown) => {
  console.log(`[Deposit v6 Debug] ${stage}`, data !== undefined ? data : '');
};

interface UseDepositResult {
  // Actions
  checkNeedsApproval: (token: Token, amount: bigint) => Promise<boolean>;
  approve: (token: Token, amount: bigint) => Promise<`0x${string}`>;
  /**
   * Deposit tokens into a limit order bucket
   * @param poolId - The pool ID (bytes32)
   * @param tick - The trigger tick for the order
   * @param side - BucketSide.BUY (0) or BucketSide.SELL (1)
   * @param token - The token being deposited (must be FHERC20)
   * @param amount - The amount to deposit (will be encrypted)
   * @param deadline - Optional deadline timestamp (defaults to 1 hour from now)
   * @param maxTickDrift - Optional max tick drift allowed (defaults to 10)
   */
  deposit: (
    poolId: `0x${string}`,
    tick: number,
    side: BucketSideType,
    token: Token,
    amount: bigint,
    deadline?: bigint,
    maxTickDrift?: number
  ) => Promise<`0x${string}`>;
  /**
   * Combined approve and deposit flow
   */
  approveAndDeposit: (
    poolId: `0x${string}`,
    tick: number,
    side: BucketSideType,
    token: Token,
    amount: bigint,
    deadline?: bigint,
    maxTickDrift?: number
  ) => Promise<void>;

  // State
  step: DepositStep;
  isApproving: boolean;
  isDepositing: boolean;
  approvalHash: `0x${string}` | null;
  depositHash: `0x${string}` | null;
  error: string | null;
  reset: () => void;
}

export function useDeposit(): UseDepositResult {
  const { address, isConnected, connector } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { success: successToast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);
  const updateTransaction = useTransactionStore(state => state.updateTransaction);
  const { encrypt, isReady: fheReady, isMock: fheMock } = useFheSession();

  // Get addresses from selected pool (multi-pool support)
  const { hookAddress, token0, token1 } = useSelectedPool();

  debugLog('Hook initialized', {
    address,
    isConnected,
    connectorName: connector?.name,
    chainId,
    hookAddress,
    fheReady,
    fheMock,
  });

  const [step, setStep] = useState<DepositStep>('idle');
  const [approvalHash, setApprovalHash] = useState<`0x${string}` | null>(null);
  const [depositHash, setDepositHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('idle');
    setApprovalHash(null);
    setDepositHash(null);
    setError(null);
  }, []);

  /**
   * Check if approval is needed for the deposit
   */
  const checkNeedsApproval = useCallback(async (
    token: Token,
    amount: bigint
  ): Promise<boolean> => {
    debugLog('checkNeedsApproval called', { token: token.symbol, amount: amount.toString() });

    if (!address || !hookAddress || !publicClient) {
      debugLog('checkNeedsApproval: missing deps');
      return false;
    }

    try {
      const allowance = await publicClient.readContract({
        address: token.address,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, hookAddress],
      });

      const needsApproval = (allowance as bigint) < amount;
      debugLog('checkNeedsApproval: result', {
        allowance: (allowance as bigint).toString(),
        amount: amount.toString(),
        needsApproval
      });
      return needsApproval;
    } catch (err) {
      debugLog('checkNeedsApproval: ERROR', err);
      return true;
    }
  }, [address, hookAddress, publicClient]);

  /**
   * Approve ERC20 token spending
   */
  const approve = useCallback(async (
    token: Token,
    amount: bigint
  ): Promise<`0x${string}`> => {
    debugLog('approve called', { token: token.symbol, amount: amount.toString() });

    if (!address || !hookAddress) {
      throw new Error('Wallet not connected or no pool selected');
    }

    setStep('approving');
    setError(null);

    try {
      const hash = await writeContractAsync({
        address: token.address,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [hookAddress, amount],
      });

      debugLog('approve: tx submitted', { hash });
      setApprovalHash(hash);

      addTransaction({
        hash,
        type: 'approve',
        description: `Approve ${token.symbol} for limit order`,
      });

      await publicClient?.waitForTransactionReceipt({ hash });

      debugLog('approve: confirmed');
      updateTransaction(hash, { status: 'confirmed' });
      successToast('Approval confirmed');
      return hash;
    } catch (err: unknown) {
      debugLog('approve: ERROR', err);
      const message = err instanceof Error ? err.message : 'Approval failed';
      setError(message);
      setStep('error');
      errorToast('Approval failed', message);
      throw err;
    }
  }, [address, hookAddress, publicClient, writeContractAsync, addTransaction, updateTransaction, successToast, errorToast]);

  /**
   * Deposit tokens into a limit order bucket
   */
  const deposit = useCallback(async (
    poolId: `0x${string}`,
    tick: number,
    side: BucketSideType,
    token: Token,
    amount: bigint,
    deadline?: bigint,
    maxTickDrift?: number
  ): Promise<`0x${string}`> => {
    debugLog('deposit called', {
      poolId,
      tick,
      side,
      token: token.symbol,
      amount: amount.toString(),
      deadline: deadline?.toString(),
      maxTickDrift
    });

    if (!address || !hookAddress) {
      throw new Error('Wallet not connected or no pool selected');
    }

    // Check FHE session
    if (!fheMock && (!encrypt || !fheReady)) {
      throw new Error('FHE session not ready. Please initialize FHE first.');
    }

    setStep('encrypting');
    setError(null);

    try {
      // Encrypt the amount
      let encryptedAmount: InEuint128;

      if (fheMock) {
        // Mock encryption for testing
        encryptedAmount = {
          ctHash: amount,
          securityZone: 0,
          utype: FHE_TYPES.EUINT128,
          signature: '0x' as `0x${string}`,
        };
        debugLog('deposit: using mock encryption');
      } else {
        // Real FHE encryption
        const encrypted = await encrypt!(amount);
        // TODO: Parse actual encrypted response format from CoFHE
        encryptedAmount = {
          ctHash: BigInt('0x' + Buffer.from(encrypted).toString('hex')),
          securityZone: 0,
          utype: FHE_TYPES.EUINT128,
          signature: '0x' as `0x${string}`,
        };
        debugLog('deposit: encrypted amount');
      }

      setStep('depositing');

      // Calculate deadline if not provided (1 hour from now)
      const effectiveDeadline = deadline ?? BigInt(Math.floor(Date.now() / 1000) + V6_DEFAULTS.DEADLINE_OFFSET);
      const effectiveMaxTickDrift = maxTickDrift ?? V6_DEFAULTS.MAX_TICK_DRIFT;

      debugLog('deposit: calling contract', {
        poolId,
        tick,
        side,
        encryptedAmount,
        deadline: effectiveDeadline.toString(),
        maxTickDrift: effectiveMaxTickDrift
      });

      const hash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_V6_ABI,
        functionName: 'deposit',
        args: [poolId, tick, side, encryptedAmount, effectiveDeadline, effectiveMaxTickDrift],
      });

      debugLog('deposit: tx submitted', { hash });
      setDepositHash(hash);

      addTransaction({
        hash,
        type: 'deposit',
        description: `Place ${side === BucketSide.BUY ? 'buy' : 'sell'} limit order at tick ${tick}`,
      });

      await publicClient?.waitForTransactionReceipt({ hash });

      debugLog('deposit: confirmed');
      updateTransaction(hash, { status: 'confirmed' });
      setStep('complete');
      successToast('Limit order placed');
      return hash;
    } catch (err: unknown) {
      debugLog('deposit: ERROR', err);

      let message = 'Deposit failed';
      if (err instanceof Error) {
        if (err.message.includes('User rejected') || err.message.includes('user rejected')) {
          message = 'Transaction was cancelled';
        } else if (err.message.includes('InputTokenMustBeFherc20')) {
          message = 'Limit orders require FHERC20 tokens for MEV protection';
        } else if (err.message.includes('DeadlineExpired')) {
          message = 'Transaction deadline expired';
        } else if (err.message.includes('PriceMoved')) {
          message = 'Price moved beyond maxTickDrift. Try again with a higher drift tolerance.';
        } else if (err.message.includes('InvalidTick')) {
          message = 'Invalid tick value. Tick must be a multiple of tick spacing.';
        } else {
          message = err.message;
        }
      }

      setError(message);
      setStep('error');
      errorToast('Limit order failed', message);
      throw err;
    }
  }, [address, hookAddress, publicClient, writeContractAsync, encrypt, fheReady, fheMock, addTransaction, updateTransaction, successToast, errorToast]);

  /**
   * Combined approve and deposit flow
   */
  const approveAndDeposit = useCallback(async (
    poolId: `0x${string}`,
    tick: number,
    side: BucketSideType,
    token: Token,
    amount: bigint,
    deadline?: bigint,
    maxTickDrift?: number
  ): Promise<void> => {
    debugLog('approveAndDeposit called');
    setStep('checking');
    setError(null);

    try {
      const needsApproval = await checkNeedsApproval(token, amount);
      debugLog('approveAndDeposit: needsApproval =', needsApproval);

      if (needsApproval) {
        await approve(token, amount);
      }

      await deposit(poolId, tick, side, token, amount, deadline, maxTickDrift);
    } catch (err) {
      debugLog('approveAndDeposit: ERROR in flow', err);
    }
  }, [checkNeedsApproval, approve, deposit]);

  return {
    checkNeedsApproval,
    approve,
    deposit,
    approveAndDeposit,
    step,
    isApproving: step === 'approving',
    isDepositing: step === 'encrypting' || step === 'depositing',
    approvalHash,
    depositHash,
    error,
    reset,
  };
}

// Re-export BucketSide for convenience
export { BucketSide };
