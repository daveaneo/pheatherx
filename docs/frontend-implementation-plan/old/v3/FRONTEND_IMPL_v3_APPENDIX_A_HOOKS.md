# Appendix A: Hooks & Utilities

**Parent Document:** [FRONTEND_IMPLEMENTATION_PLAN_v3.md](./FRONTEND_IMPLEMENTATION_PLAN_v3.md)

---

## Overview

This appendix provides complete implementation details for all custom React hooks and utilities, including the new additions from the v2 audit:

- **FHE Client with Retry Logic** (NEW)
- **Deposit Hook with Token Approval** (NEW)
- **Gas Estimation Hook** (NEW)
- **Block Explorer Utilities** (NEW)
- **Native ETH Handling** (NEW)

---

## 1. FHE Implementation

### 1.1 Types

```typescript
// src/types/fhe.ts

export interface FheSession {
  permit: FhePermit;
  client: FhenixClientInstance;
  contractAddress: `0x${string}`;
  createdAt: number;
  expiresAt: number;
}

export interface FhePermit {
  signature: `0x${string}`;
  publicKey: `0x${string}`;
}

export interface EncryptedValue {
  data: Uint8Array;
  type: 'ebool' | 'euint8' | 'euint16' | 'euint32' | 'euint64' | 'euint128' | 'euint256';
}

export type FheSessionStatus =
  | 'disconnected'
  | 'initializing'
  | 'ready'
  | 'expired'
  | 'error';
```

### 1.2 FHE Client Wrapper with Retry Logic (UPDATED)

```typescript
// src/lib/fhe/client.ts

import { FhenixClient } from 'cofhejs';
import type { FheSession, EncryptedValue } from '@/types/fhe';
import { FHE_RETRY_ATTEMPTS, FHE_RETRY_BASE_DELAY_MS } from '@/lib/constants';

export class FheatherXFheClient {
  private session: FheSession | null = null;
  private provider: any;
  private signer: any;

  constructor(provider: any, signer: any) {
    this.provider = provider;
    this.signer = signer;
  }

  /**
   * Initialize FHE session for a specific contract
   * This prompts the user to sign a permit message
   */
  async initSession(contractAddress: `0x${string}`): Promise<FheSession> {
    try {
      // Create Fhenix client
      const client = new FhenixClient({ provider: this.provider });

      // Generate permit - this prompts user signature
      const permit = await client.generatePermit(
        contractAddress,
        this.provider,
        this.signer
      );

      const session: FheSession = {
        permit,
        client,
        contractAddress,
        createdAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      };

      this.session = session;
      return session;
    } catch (error) {
      console.error('Failed to initialize FHE session:', error);
      throw new FheSessionError('Failed to initialize privacy session', error);
    }
  }

  isSessionValid(): boolean {
    if (!this.session) return false;
    if (Date.now() > this.session.expiresAt) return false;
    return true;
  }

  getSession(): FheSession | null {
    return this.isSessionValid() ? this.session : null;
  }

  getSessionExpiry(): number | null {
    return this.session?.expiresAt ?? null;
  }

  /**
   * Encrypt a uint128 value for the bound contract
   */
  async encryptUint128(value: bigint): Promise<Uint8Array> {
    this.assertSession();

    try {
      return await this.session!.client.encrypt_uint128(
        value,
        this.session!.contractAddress
      );
    } catch (error) {
      throw new FheEncryptionError('Failed to encrypt uint128', error);
    }
  }

  /**
   * Encrypt a boolean value for the bound contract
   */
  async encryptBool(value: boolean): Promise<Uint8Array> {
    this.assertSession();

    try {
      return await this.session!.client.encrypt_bool(
        value,
        this.session!.contractAddress
      );
    } catch (error) {
      throw new FheEncryptionError('Failed to encrypt bool', error);
    }
  }

  /**
   * Decrypt (unseal) an encrypted value with retry logic (NEW)
   * This requires network consensus and may take 5-30 seconds
   */
  async unseal(
    ciphertext: string,
    maxRetries: number = FHE_RETRY_ATTEMPTS
  ): Promise<bigint> {
    this.assertSession();

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.session!.client.unseal(
          this.session!.contractAddress,
          ciphertext,
          this.session!.permit
        );
      } catch (error) {
        lastError = error;
        console.warn(`FHE unseal attempt ${attempt}/${maxRetries} failed:`, error);

        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = FHE_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    throw new FheDecryptionError(
      `Failed to decrypt value after ${maxRetries} attempts`,
      lastError
    );
  }

  /**
   * Clear the current session
   */
  clearSession(): void {
    this.session = null;
  }

  private assertSession(): void {
    if (!this.isSessionValid()) {
      throw new FheSessionError('No valid FHE session. Call initSession() first.');
    }
  }
}

// Custom errors
export class FheSessionError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'FheSessionError';
  }
}

export class FheEncryptionError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'FheEncryptionError';
  }
}

export class FheDecryptionError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'FheDecryptionError';
  }
}
```

### 1.3 Mock FHE Client (for non-Fhenix networks)

```typescript
// src/lib/fhe/mockClient.ts

import type { FheSession } from '@/types/fhe';
import { FHE_RETRY_ATTEMPTS, FHE_RETRY_BASE_DELAY_MS } from '@/lib/constants';

export class MockFheClient {
  private session: FheSession | null = null;

  async initSession(contractAddress: `0x${string}`): Promise<FheSession> {
    await new Promise(resolve => setTimeout(resolve, 500));

    const session: FheSession = {
      permit: {
        signature: '0x' + '00'.repeat(65),
        publicKey: '0x' + '00'.repeat(32),
      } as any,
      client: null as any,
      contractAddress,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };

    this.session = session;
    return session;
  }

  isSessionValid(): boolean {
    return this.session !== null && Date.now() < this.session.expiresAt;
  }

  getSession(): FheSession | null {
    return this.isSessionValid() ? this.session : null;
  }

  getSessionExpiry(): number | null {
    return this.session?.expiresAt ?? null;
  }

  async encryptUint128(value: bigint): Promise<Uint8Array> {
    const bytes = new Uint8Array(16);
    let v = value;
    for (let i = 15; i >= 0; i--) {
      bytes[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    return bytes;
  }

  async encryptBool(value: boolean): Promise<Uint8Array> {
    return new Uint8Array([value ? 1 : 0]);
  }

  async unseal(
    ciphertext: string,
    maxRetries: number = FHE_RETRY_ATTEMPTS
  ): Promise<bigint> {
    // Simulate decryption delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    // Return mock value
    return BigInt(Math.floor(Math.random() * 10)) * BigInt(1e18);
  }

  clearSession(): void {
    this.session = null;
  }
}
```

### 1.4 FHE Session Hook

```typescript
// src/hooks/useFheSession.ts

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { useEthersSigner } from './useEthersSigner';
import { useEthersProvider } from './useEthersProvider';
import { FheatherXFheClient } from '@/lib/fhe/client';
import { MockFheClient } from '@/lib/fhe/mockClient';
import { useFheStore } from '@/stores/fheStore';
import { FHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { fheSupport } from '@/lib/chains';

export function useFheSession() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const provider = useEthersProvider();
  const signer = useEthersSigner();

  const clientRef = useRef<FheatherXFheClient | MockFheClient | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);

  const {
    sessionStatus,
    sessionError,
    sessionExpiresAt,
    setSessionStatus,
    setSessionExpiry,
    reset,
  } = useFheStore();

  const hookAddress = FHEATHERX_ADDRESSES[chainId];
  const networkFheSupport = fheSupport[chainId];
  const isMock = networkFheSupport !== 'full';

  const initialize = useCallback(async () => {
    if (!provider || !hookAddress || !isConnected) {
      setSessionStatus('disconnected');
      return;
    }

    if (isInitializing) return;
    setIsInitializing(true);
    setSessionStatus('initializing');

    try {
      let client: FheatherXFheClient | MockFheClient;

      if (isMock) {
        client = new MockFheClient();
      } else {
        if (!signer) {
          throw new Error('Signer not available');
        }
        client = new FheatherXFheClient(provider, signer);
      }

      const session = await client.initSession(hookAddress);

      clientRef.current = client;
      setSessionStatus('ready');
      setSessionExpiry(session.expiresAt);
    } catch (error) {
      console.error('FHE session init failed:', error);
      setSessionStatus('error', error instanceof Error ? error.message : 'Unknown error');
      clientRef.current = null;
    } finally {
      setIsInitializing(false);
    }
  }, [provider, signer, hookAddress, isConnected, isMock, setSessionStatus, setSessionExpiry, isInitializing]);

  // Auto-check expiry
  useEffect(() => {
    if (!sessionExpiresAt) return;

    const checkExpiry = () => {
      if (Date.now() > sessionExpiresAt) {
        setSessionStatus('expired');
      }
    };

    checkExpiry();
    const interval = setInterval(checkExpiry, 60000);

    return () => clearInterval(interval);
  }, [sessionExpiresAt, setSessionStatus]);

  // Reset on wallet disconnect
  useEffect(() => {
    if (!isConnected) {
      reset();
      clientRef.current = null;
    }
  }, [isConnected, reset]);

  // Reset on chain change
  useEffect(() => {
    reset();
    clientRef.current = null;
  }, [chainId, reset]);

  return {
    status: sessionStatus,
    error: sessionError,
    expiresAt: sessionExpiresAt,
    isReady: sessionStatus === 'ready',
    isInitializing: sessionStatus === 'initializing',
    isMock,
    client: clientRef.current,
    initialize,
    encrypt: clientRef.current?.encryptUint128.bind(clientRef.current),
    encryptBool: clientRef.current?.encryptBool.bind(clientRef.current),
    unseal: clientRef.current?.unseal.bind(clientRef.current),
  };
}
```

### 1.5 Balance Reveal with Retry (UPDATED)

```typescript
// src/hooks/useBalanceReveal.ts

'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAccount, useChainId, useReadContract } from 'wagmi';
import { useFheSession } from './useFheSession';
import { useFheStore } from '@/stores/fheStore';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { FHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { FHE_RETRY_ATTEMPTS } from '@/lib/constants';

type RevealStatus = 'idle' | 'fetching' | 'decrypting' | 'revealed' | 'error';

interface UseBalanceRevealResult {
  status: RevealStatus;
  value: bigint | null;
  error: string | null;
  progress: number;
  reveal: () => Promise<bigint | undefined>;
  hide: () => void;
  isRevealing: boolean;
  isRevealed: boolean;
}

export function useBalanceReveal(isToken0: boolean): UseBalanceRevealResult {
  const { address } = useAccount();
  const chainId = useChainId();
  const hookAddress = FHEATHERX_ADDRESSES[chainId];

  const { client, isReady, isMock } = useFheSession();
  const { cacheBalance, getCachedBalance } = useFheStore();

  const [status, setStatus] = useState<RevealStatus>('idle');
  const [value, setValue] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const cacheKey = `${address}-${chainId}-${isToken0 ? 'token0' : 'token1'}`;

  const { refetch: refetchBalance } = useReadContract({
    address: hookAddress,
    abi: FHEATHERX_ABI,
    functionName: isToken0 ? 'getUserBalanceToken0' : 'getUserBalanceToken1',
    args: address ? [address] : undefined,
    query: { enabled: false },
  });

  // Check cache on mount
  useEffect(() => {
    const cached = getCachedBalance(cacheKey);
    if (cached) {
      setValue(cached.value);
      setStatus('revealed');
    }
  }, [cacheKey, getCachedBalance]);

  const reveal = useCallback(async () => {
    if (!address || !hookAddress) {
      setError('Wallet not connected');
      setStatus('error');
      return;
    }

    // Check cache first
    const cached = getCachedBalance(cacheKey);
    if (cached) {
      setValue(cached.value);
      setStatus('revealed');
      setProgress(100);
      return cached.value;
    }

    try {
      setError(null);
      setStatus('fetching');
      setProgress(10);

      // Mock mode
      if (isMock) {
        await new Promise(r => setTimeout(r, 800));
        setProgress(50);
        await new Promise(r => setTimeout(r, 700));

        const mockValue = BigInt(Math.floor(Math.random() * 5 + 1)) * BigInt(1e18);
        setValue(mockValue);
        cacheBalance(cacheKey, mockValue);
        setStatus('revealed');
        setProgress(100);
        return mockValue;
      }

      // Real FHE mode
      if (!client || !isReady) {
        throw new Error('FHE session not ready. Please initialize first.');
      }

      // Step 1: Fetch encrypted balance
      const { data: encrypted } = await refetchBalance();
      setProgress(30);

      if (!encrypted) {
        throw new Error('Failed to fetch encrypted balance');
      }

      // Step 2: Start decryption with retry
      setStatus('decrypting');

      // Progress simulation
      const progressInterval = setInterval(() => {
        setProgress(p => Math.min(p + 5, 90));
      }, 500);

      // Step 3: Unseal with automatic retry (handled in client)
      const decrypted = await client.unseal(encrypted as string, FHE_RETRY_ATTEMPTS);

      clearInterval(progressInterval);
      setProgress(100);

      // Step 4: Cache and return
      setValue(decrypted);
      cacheBalance(cacheKey, decrypted);
      setStatus('revealed');

      return decrypted;
    } catch (err) {
      console.error('Balance reveal failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to reveal balance');
      setStatus('error');
      setProgress(0);
    }
  }, [address, hookAddress, client, isReady, isMock, cacheKey, cacheBalance, getCachedBalance, refetchBalance]);

  const hide = useCallback(() => {
    setValue(null);
    setStatus('idle');
    setProgress(0);
    setError(null);
  }, []);

  return {
    status,
    value,
    error,
    progress,
    reveal,
    hide,
    isRevealing: status === 'fetching' || status === 'decrypting',
    isRevealed: status === 'revealed',
  };
}
```

---

## 2. Deposit Hook with Token Approval (NEW)

### 2.1 ERC20 ABI

```typescript
// src/lib/contracts/erc20Abi.ts

export const ERC20_ABI = [
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;
```

### 2.2 Native ETH Utilities

```typescript
// src/lib/tokens.ts

import { NATIVE_ETH_ADDRESS } from '@/lib/constants';

export function isNativeEth(address: string): boolean {
  return (
    address.toLowerCase() === NATIVE_ETH_ADDRESS.toLowerCase() ||
    address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  );
}

export interface Token {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  isNative?: boolean;
}

// Token lists per chain
export const TOKEN_LIST: Record<number, Token[]> = {
  31337: [
    { address: NATIVE_ETH_ADDRESS, symbol: 'ETH', name: 'Ether', decimals: 18, isNative: true },
    // Add test tokens
  ],
  84532: [
    { address: NATIVE_ETH_ADDRESS, symbol: 'ETH', name: 'Ether', decimals: 18, isNative: true },
    // Add Base Sepolia tokens
  ],
};
```

### 2.3 Complete Deposit Hook

```typescript
// src/hooks/useDeposit.ts

'use client';

import { useState, useCallback } from 'react';
import { useAccount, useChainId, useWriteContract, useReadContract, usePublicClient, useWaitForTransactionReceipt } from 'wagmi';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { ERC20_ABI } from '@/lib/contracts/erc20Abi';
import { FHEATHERX_ADDRESSES, TOKEN_ADDRESSES } from '@/lib/contracts/addresses';
import { isNativeEth } from '@/lib/tokens';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';

type DepositStep = 'idle' | 'checking' | 'approving' | 'depositing' | 'complete' | 'error';

interface UseDepositResult {
  // Actions
  checkNeedsApproval: (isToken0: boolean, amount: bigint) => Promise<boolean>;
  approve: (isToken0: boolean, amount: bigint) => Promise<`0x${string}`>;
  deposit: (isToken0: boolean, amount: bigint) => Promise<`0x${string}`>;
  approveAndDeposit: (isToken0: boolean, amount: bigint) => Promise<void>;

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
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { toast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);

  const hookAddress = FHEATHERX_ADDRESSES[chainId];
  const token0Address = TOKEN_ADDRESSES[chainId]?.token0;
  const token1Address = TOKEN_ADDRESSES[chainId]?.token1;

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

  const getTokenAddress = (isToken0: boolean): `0x${string}` => {
    return isToken0 ? token0Address : token1Address;
  };

  /**
   * Check if approval is needed for the deposit
   */
  const checkNeedsApproval = useCallback(async (
    isToken0: boolean,
    amount: bigint
  ): Promise<boolean> => {
    if (!address || !hookAddress || !publicClient) return false;

    const tokenAddress = getTokenAddress(isToken0);

    // Native ETH doesn't need approval
    if (isNativeEth(tokenAddress)) {
      return false;
    }

    try {
      const allowance = await publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, hookAddress],
      });

      return allowance < amount;
    } catch (err) {
      console.error('Failed to check allowance:', err);
      return true; // Assume approval needed if check fails
    }
  }, [address, hookAddress, publicClient, token0Address, token1Address]);

  /**
   * Approve ERC20 token spending
   */
  const approve = useCallback(async (
    isToken0: boolean,
    amount: bigint
  ): Promise<`0x${string}`> => {
    if (!address || !hookAddress) {
      throw new Error('Wallet not connected');
    }

    const tokenAddress = getTokenAddress(isToken0);

    if (isNativeEth(tokenAddress)) {
      throw new Error('Native ETH does not require approval');
    }

    setStep('approving');
    setError(null);

    try {
      const hash = await writeContractAsync({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [hookAddress, amount],
      });

      setApprovalHash(hash);

      addTransaction({
        hash,
        type: 'deposit',
        description: `Approve ${isToken0 ? 'Token0' : 'Token1'} for deposit`,
      });

      // Wait for confirmation
      await publicClient?.waitForTransactionReceipt({ hash });

      toast({ title: 'Approval confirmed', variant: 'success' });
      return hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Approval failed';
      setError(message);
      setStep('error');
      errorToast('Approval failed', message);
      throw err;
    }
  }, [address, hookAddress, publicClient, writeContractAsync, addTransaction, toast, errorToast, token0Address, token1Address]);

  /**
   * Deposit tokens into the hook
   */
  const deposit = useCallback(async (
    isToken0: boolean,
    amount: bigint
  ): Promise<`0x${string}`> => {
    if (!address || !hookAddress) {
      throw new Error('Wallet not connected');
    }

    const tokenAddress = getTokenAddress(isToken0);
    const isNative = isNativeEth(tokenAddress);

    setStep('depositing');
    setError(null);

    try {
      const hash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_ABI,
        functionName: 'deposit',
        args: [isToken0, amount],
        // Send value for native ETH
        value: isNative ? amount : undefined,
      });

      setDepositHash(hash);

      addTransaction({
        hash,
        type: 'deposit',
        description: `Deposit ${isToken0 ? 'Token0' : 'Token1'}`,
      });

      // Wait for confirmation
      await publicClient?.waitForTransactionReceipt({ hash });

      setStep('complete');
      toast({ title: 'Deposit confirmed', variant: 'success' });
      return hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Deposit failed';
      setError(message);
      setStep('error');
      errorToast('Deposit failed', message);
      throw err;
    }
  }, [address, hookAddress, publicClient, writeContractAsync, addTransaction, toast, errorToast, token0Address, token1Address]);

  /**
   * Combined approve and deposit flow
   */
  const approveAndDeposit = useCallback(async (
    isToken0: boolean,
    amount: bigint
  ): Promise<void> => {
    setStep('checking');
    setError(null);

    try {
      // Check if approval needed
      const needsApproval = await checkNeedsApproval(isToken0, amount);

      if (needsApproval) {
        await approve(isToken0, amount);
      }

      await deposit(isToken0, amount);
    } catch (err) {
      // Error already handled in individual functions
      console.error('Approve and deposit failed:', err);
    }
  }, [checkNeedsApproval, approve, deposit]);

  return {
    checkNeedsApproval,
    approve,
    deposit,
    approveAndDeposit,
    step,
    isApproving: step === 'approving',
    isDepositing: step === 'depositing',
    approvalHash,
    depositHash,
    error,
    reset,
  };
}
```

---

## 3. Gas Estimation Hook (NEW)

```typescript
// src/hooks/useGasEstimate.ts

import { usePublicClient } from 'wagmi';
import { formatEther, type Abi } from 'viem';

interface GasEstimateRequest {
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  account?: `0x${string}`;
}

interface GasEstimate {
  gas: bigint;
  gasPrice: bigint;
  estimatedCost: bigint;
  estimatedCostEth: string;
  estimatedCostFormatted: string;
  estimatedCostUsd?: number;
}

export function useGasEstimate() {
  const publicClient = usePublicClient();

  const estimate = async (
    request: GasEstimateRequest,
    ethPriceUsd?: number
  ): Promise<GasEstimate | null> => {
    if (!publicClient) return null;

    try {
      const [gas, gasPrice] = await Promise.all([
        publicClient.estimateContractGas({
          address: request.address,
          abi: request.abi,
          functionName: request.functionName,
          args: request.args,
          value: request.value,
          account: request.account,
        }),
        publicClient.getGasPrice(),
      ]);

      const estimatedCost = gas * gasPrice;
      const estimatedCostEth = formatEther(estimatedCost);

      // Format for display (e.g., "~0.002 ETH")
      const ethValue = parseFloat(estimatedCostEth);
      const estimatedCostFormatted = ethValue < 0.0001
        ? '<0.0001 ETH'
        : `~${ethValue.toFixed(4)} ETH`;

      return {
        gas,
        gasPrice,
        estimatedCost,
        estimatedCostEth,
        estimatedCostFormatted,
        estimatedCostUsd: ethPriceUsd
          ? ethValue * ethPriceUsd
          : undefined,
      };
    } catch (error) {
      console.warn('Gas estimation failed:', error);
      return null; // Estimation failed - tx likely to fail
    }
  };

  /**
   * Estimate gas for multiple operations
   */
  const estimateMultiple = async (
    requests: GasEstimateRequest[],
    ethPriceUsd?: number
  ): Promise<(GasEstimate | null)[]> => {
    return Promise.all(requests.map(req => estimate(req, ethPriceUsd)));
  };

  return { estimate, estimateMultiple };
}
```

---

## 4. Block Explorer Utilities (NEW)

```typescript
// src/lib/explorer.ts

import { supportedChains } from '@/lib/chains';

/**
 * Get block explorer URL for a transaction
 */
export function getExplorerTxUrl(
  chainId: number,
  txHash: `0x${string}`
): string | null {
  const chain = supportedChains.find(c => c.id === chainId);
  const explorer = chain?.blockExplorers?.default;
  if (!explorer) return null;
  return `${explorer.url}/tx/${txHash}`;
}

/**
 * Get block explorer URL for an address
 */
export function getExplorerAddressUrl(
  chainId: number,
  address: `0x${string}`
): string | null {
  const chain = supportedChains.find(c => c.id === chainId);
  const explorer = chain?.blockExplorers?.default;
  if (!explorer) return null;
  return `${explorer.url}/address/${address}`;
}

/**
 * Get block explorer URL for a block
 */
export function getExplorerBlockUrl(
  chainId: number,
  blockNumber: bigint | number
): string | null {
  const chain = supportedChains.find(c => c.id === chainId);
  const explorer = chain?.blockExplorers?.default;
  if (!explorer) return null;
  return `${explorer.url}/block/${blockNumber}`;
}

/**
 * Get explorer name for display
 */
export function getExplorerName(chainId: number): string | null {
  const chain = supportedChains.find(c => c.id === chainId);
  return chain?.blockExplorers?.default?.name ?? null;
}
```

---

## 5. Withdraw Hook

```typescript
// src/hooks/useWithdraw.ts

'use client';

import { useState, useCallback } from 'react';
import { useAccount, useChainId, useWriteContract, usePublicClient } from 'wagmi';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { FHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';

interface UseWithdrawResult {
  withdraw: (isToken0: boolean, amount: bigint) => Promise<`0x${string}`>;
  isWithdrawing: boolean;
  withdrawHash: `0x${string}` | null;
  error: string | null;
  reset: () => void;
}

export function useWithdraw(): UseWithdrawResult {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { toast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);

  const hookAddress = FHEATHERX_ADDRESSES[chainId];

  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawHash, setWithdrawHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setIsWithdrawing(false);
    setWithdrawHash(null);
    setError(null);
  }, []);

  const withdraw = useCallback(async (
    isToken0: boolean,
    amount: bigint
  ): Promise<`0x${string}`> => {
    if (!address || !hookAddress) {
      throw new Error('Wallet not connected');
    }

    setIsWithdrawing(true);
    setError(null);

    try {
      const hash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_ABI,
        functionName: 'withdraw',
        args: [isToken0, amount],
      });

      setWithdrawHash(hash);

      addTransaction({
        hash,
        type: 'withdraw',
        description: `Withdraw ${isToken0 ? 'Token0' : 'Token1'}`,
      });

      await publicClient?.waitForTransactionReceipt({ hash });

      toast({ title: 'Withdrawal confirmed', variant: 'success' });
      return hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Withdrawal failed';
      setError(message);
      errorToast('Withdrawal failed', message);
      throw err;
    } finally {
      setIsWithdrawing(false);
    }
  }, [address, hookAddress, publicClient, writeContractAsync, addTransaction, toast, errorToast]);

  return {
    withdraw,
    isWithdrawing,
    withdrawHash,
    error,
    reset,
  };
}
```

---

## 6. Swap Hook

```typescript
// src/hooks/useSwap.ts

'use client';

import { useState, useCallback } from 'react';
import { useAccount, useChainId, useWriteContract, usePublicClient } from 'wagmi';
import { encodeFunctionData } from 'viem';
import { SWAP_ROUTER_ABI } from '@/lib/contracts/router';
import { SWAP_ROUTER_ADDRESSES, POOL_KEYS } from '@/lib/contracts/addresses';
import { MIN_SQRT_RATIO, MAX_SQRT_RATIO } from '@/lib/constants';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import { useGasEstimate } from './useGasEstimate';

interface SwapParams {
  zeroForOne: boolean;
  amountSpecified: bigint;
  sqrtPriceLimitX96?: bigint;
  hookData?: `0x${string}`;
}

interface UseSwapResult {
  swap: (params: SwapParams) => Promise<`0x${string}`>;
  simulate: (params: SwapParams) => Promise<bigint | null>;
  estimateGas: (params: SwapParams) => Promise<string | null>;
  isSwapping: boolean;
  swapHash: `0x${string}` | null;
  error: string | null;
  reset: () => void;
}

export function useSwap(): UseSwapResult {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { toast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);
  const { estimate } = useGasEstimate();

  const routerAddress = SWAP_ROUTER_ADDRESSES[chainId];
  const poolKey = POOL_KEYS[chainId];

  const [isSwapping, setIsSwapping] = useState(false);
  const [swapHash, setSwapHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setIsSwapping(false);
    setSwapHash(null);
    setError(null);
  }, []);

  const buildSwapArgs = (params: SwapParams) => {
    const sqrtPriceLimit = params.sqrtPriceLimitX96
      ?? (params.zeroForOne ? MIN_SQRT_RATIO + 1n : MAX_SQRT_RATIO - 1n);

    return {
      key: poolKey,
      params: {
        zeroForOne: params.zeroForOne,
        amountSpecified: params.amountSpecified,
        sqrtPriceLimitX96: sqrtPriceLimit,
      },
      hookData: params.hookData ?? '0x',
    };
  };

  const swap = useCallback(async (params: SwapParams): Promise<`0x${string}`> => {
    if (!address || !routerAddress) {
      throw new Error('Wallet not connected');
    }

    setIsSwapping(true);
    setError(null);

    try {
      const args = buildSwapArgs(params);

      const hash = await writeContractAsync({
        address: routerAddress,
        abi: SWAP_ROUTER_ABI,
        functionName: 'swap',
        args: [args.key, args.params, args.hookData],
      });

      setSwapHash(hash);

      addTransaction({
        hash,
        type: 'swap',
        description: `Swap ${params.zeroForOne ? 'Token0 → Token1' : 'Token1 → Token0'}`,
      });

      await publicClient?.waitForTransactionReceipt({ hash });

      toast({ title: 'Swap confirmed', variant: 'success' });
      return hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Swap failed';
      setError(message);
      errorToast('Swap failed', message);
      throw err;
    } finally {
      setIsSwapping(false);
    }
  }, [address, routerAddress, poolKey, publicClient, writeContractAsync, addTransaction, toast, errorToast]);

  const simulate = useCallback(async (params: SwapParams): Promise<bigint | null> => {
    if (!publicClient || !routerAddress) return null;

    try {
      const args = buildSwapArgs(params);
      const result = await publicClient.simulateContract({
        address: routerAddress,
        abi: SWAP_ROUTER_ABI,
        functionName: 'swap',
        args: [args.key, args.params, args.hookData],
        account: address,
      });

      return result.result as bigint;
    } catch (err) {
      console.warn('Swap simulation failed:', err);
      return null;
    }
  }, [publicClient, routerAddress, poolKey, address]);

  const estimateGas = useCallback(async (params: SwapParams): Promise<string | null> => {
    if (!routerAddress) return null;

    const args = buildSwapArgs(params);
    const result = await estimate({
      address: routerAddress,
      abi: SWAP_ROUTER_ABI,
      functionName: 'swap',
      args: [args.key, args.params, args.hookData],
      account: address,
    });

    return result?.estimatedCostFormatted ?? null;
  }, [routerAddress, poolKey, address, estimate]);

  return {
    swap,
    simulate,
    estimateGas,
    isSwapping,
    swapHash,
    error,
    reset,
  };
}
```

---

## 7. Order Hooks

### 7.1 Place Order Hook

```typescript
// src/hooks/usePlaceOrder.ts

'use client';

import { useState, useCallback } from 'react';
import { useAccount, useChainId, useWriteContract, usePublicClient } from 'wagmi';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { FHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { PROTOCOL_FEE_WEI } from '@/lib/constants';
import { useFheSession } from './useFheSession';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';
import type { OrderType } from '@/lib/orders';

interface PlaceOrderParams {
  orderType: OrderType;
  triggerTick: number;
  amount: bigint;
  slippageBps: number;
}

interface UsePlaceOrderResult {
  placeOrder: (params: PlaceOrderParams) => Promise<`0x${string}`>;
  isPlacing: boolean;
  txHash: `0x${string}` | null;
  error: string | null;
  reset: () => void;
}

export function usePlaceOrder(): UsePlaceOrderResult {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { client: fheClient, isReady: fheReady, isMock } = useFheSession();
  const { toast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);

  const hookAddress = FHEATHERX_ADDRESSES[chainId];

  const [isPlacing, setIsPlacing] = useState(false);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setIsPlacing(false);
    setTxHash(null);
    setError(null);
  }, []);

  const placeOrder = useCallback(async (params: PlaceOrderParams): Promise<`0x${string}`> => {
    if (!address || !hookAddress) {
      throw new Error('Wallet not connected');
    }

    if (!fheReady && !isMock) {
      throw new Error('FHE session not ready');
    }

    setIsPlacing(true);
    setError(null);

    try {
      // Derive isBuyOrder and isStopOrder from orderType
      const isBuyOrder = params.orderType === 'limit-buy' || params.orderType === 'stop-loss';
      const isStopOrder = params.orderType === 'stop-loss' || params.orderType === 'take-profit';

      // Encrypt parameters
      let encryptedAmount: Uint8Array;
      let encryptedSlippage: Uint8Array;

      if (fheClient) {
        encryptedAmount = await fheClient.encryptUint128(params.amount);
        encryptedSlippage = await fheClient.encryptUint128(BigInt(params.slippageBps));
      } else {
        // Mock encryption for testing
        encryptedAmount = new Uint8Array(16);
        encryptedSlippage = new Uint8Array(16);
      }

      const hash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_ABI,
        functionName: 'placeOrder',
        args: [
          params.triggerTick,
          isBuyOrder,
          isStopOrder,
          encryptedAmount,
          encryptedSlippage,
        ],
        value: PROTOCOL_FEE_WEI,
      });

      setTxHash(hash);

      addTransaction({
        hash,
        type: 'placeOrder',
        description: `Place ${params.orderType} order`,
      });

      await publicClient?.waitForTransactionReceipt({ hash });

      toast({ title: 'Order placed', variant: 'success' });
      return hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to place order';
      setError(message);
      errorToast('Order failed', message);
      throw err;
    } finally {
      setIsPlacing(false);
    }
  }, [address, hookAddress, fheClient, fheReady, isMock, publicClient, writeContractAsync, addTransaction, toast, errorToast]);

  return {
    placeOrder,
    isPlacing,
    txHash,
    error,
    reset,
  };
}
```

### 7.2 Cancel Order Hook

```typescript
// src/hooks/useCancelOrder.ts

'use client';

import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAccount, useChainId, useWriteContract, usePublicClient } from 'wagmi';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { FHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { queryKeys } from '@/lib/queryKeys';
import { useOrdersStore } from '@/stores/ordersStore';
import { useToast } from '@/stores/uiStore';
import { useTransactionStore } from '@/stores/transactionStore';

export function useCancelOrder() {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const { addPendingCancellation, removePendingCancellation } = useOrdersStore();
  const { toast, error: errorToast } = useToast();
  const addTransaction = useTransactionStore(state => state.addTransaction);

  const hookAddress = FHEATHERX_ADDRESSES[chainId];

  return useMutation({
    mutationFn: async (orderId: bigint) => {
      const hash = await writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_ABI,
        functionName: 'cancelOrder',
        args: [orderId],
      });

      addTransaction({
        hash,
        type: 'cancelOrder',
        description: `Cancel order #${orderId}`,
      });

      await publicClient?.waitForTransactionReceipt({ hash });
      return hash;
    },

    onMutate: async (orderId) => {
      // Optimistic update
      addPendingCancellation(orderId);

      await queryClient.cancelQueries({
        queryKey: queryKeys.activeOrders(address!, hookAddress),
      });

      const previousOrders = queryClient.getQueryData(
        queryKeys.activeOrders(address!, hookAddress)
      );

      queryClient.setQueryData(
        queryKeys.activeOrders(address!, hookAddress),
        (old: bigint[] | undefined) => old?.filter(id => id !== orderId)
      );

      return { previousOrders };
    },

    onSuccess: (_, orderId) => {
      removePendingCancellation(orderId);
      toast({ title: 'Order cancelled', variant: 'success' });
    },

    onError: (error, orderId, context) => {
      removePendingCancellation(orderId);
      if (context?.previousOrders) {
        queryClient.setQueryData(
          queryKeys.activeOrders(address!, hookAddress),
          context.previousOrders
        );
      }
      errorToast('Failed to cancel order', error.message);
    },

    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.activeOrders(address!, hookAddress),
      });
    },
  });
}
```

---

## 8. Ethers Compatibility Hooks

For cofhejs compatibility with wagmi v2:

```typescript
// src/hooks/useEthersProvider.ts

import { useMemo } from 'react';
import { usePublicClient } from 'wagmi';
import { providers } from 'ethers';

export function useEthersProvider() {
  const publicClient = usePublicClient();

  return useMemo(() => {
    if (!publicClient) return undefined;

    const { chain, transport } = publicClient;
    const network = {
      chainId: chain.id,
      name: chain.name,
      ensAddress: chain.contracts?.ensRegistry?.address,
    };

    if (transport.type === 'fallback') {
      return new providers.FallbackProvider(
        (transport.transports as any[]).map(
          ({ value }) => new providers.JsonRpcProvider(value?.url, network)
        )
      );
    }

    return new providers.JsonRpcProvider(transport.url, network);
  }, [publicClient]);
}

// src/hooks/useEthersSigner.ts

import { useMemo } from 'react';
import { useWalletClient } from 'wagmi';
import { providers } from 'ethers';

export function useEthersSigner() {
  const { data: walletClient } = useWalletClient();

  return useMemo(() => {
    if (!walletClient) return undefined;

    const { account, chain, transport } = walletClient;
    const network = {
      chainId: chain.id,
      name: chain.name,
      ensAddress: chain.contracts?.ensRegistry?.address,
    };

    const provider = new providers.Web3Provider(transport, network);
    return provider.getSigner(account.address);
  }, [walletClient]);
}
```

---

## 9. Testing

```typescript
// src/lib/fhe/__tests__/client.test.ts

import { describe, it, expect, vi } from 'vitest';
import { MockFheClient } from '../mockClient';

describe('MockFheClient', () => {
  it('initializes session', async () => {
    const client = new MockFheClient();
    const session = await client.initSession('0x1234567890123456789012345678901234567890');

    expect(session).toBeDefined();
    expect(session.contractAddress).toBe('0x1234567890123456789012345678901234567890');
    expect(client.isSessionValid()).toBe(true);
  });

  it('encrypts uint128', async () => {
    const client = new MockFheClient();
    await client.initSession('0x1234567890123456789012345678901234567890');

    const encrypted = await client.encryptUint128(BigInt(1e18));

    expect(encrypted).toBeInstanceOf(Uint8Array);
    expect(encrypted.length).toBe(16);
  });

  it('handles unseal with retry', async () => {
    const client = new MockFheClient();
    await client.initSession('0x1234567890123456789012345678901234567890');

    const result = await client.unseal('0x123', 3);

    expect(typeof result).toBe('bigint');
  });

  it('clears session', async () => {
    const client = new MockFheClient();
    await client.initSession('0x1234567890123456789012345678901234567890');

    expect(client.isSessionValid()).toBe(true);
    client.clearSession();
    expect(client.isSessionValid()).toBe(false);
  });
});

// src/hooks/__tests__/useGasEstimate.test.ts

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// Note: Full tests require wagmi provider setup
describe('useGasEstimate', () => {
  it('returns null when client unavailable', async () => {
    // Test implementation
  });
});
```

---

*End of Appendix A*
