# Appendix A: FHE Integration Details

**Parent Document:** [FRONTEND_IMPLEMENTATION_PLAN_v2.md](./FRONTEND_IMPLEMENTATION_PLAN_v2.md)

---

## Overview

This appendix provides complete implementation details for FHE (Fully Homomorphic Encryption) integration in the FheatherX frontend. FHE enables encrypted computations on-chain, but requires careful client-side handling.

---

## 1. FHE Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Flow                                │
└─────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Connect Wallet │────▶│ Init FHE Session│────▶│  Ready to Trade │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                    User signs permit message
                               │
                               ▼
                    ┌─────────────────────┐
                    │  Session Created    │
                    │  - Permit stored    │
                    │  - Client ready     │
                    │  - 24hr expiry      │
                    └─────────────────────┘
```

---

## 2. FHE Client Implementation

### 2.1 Types

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
  // Permit structure from cofhejs
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

### 2.2 FHE Client Wrapper

```typescript
// src/lib/fhe/client.ts

import { FhenixClient } from 'cofhejs';
import type { FheSession, EncryptedValue } from '@/types/fhe';

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
      // The permit authorizes decryption of data for this user from this contract
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

  /**
   * Check if current session is valid
   */
  isSessionValid(): boolean {
    if (!this.session) return false;
    if (Date.now() > this.session.expiresAt) return false;
    return true;
  }

  /**
   * Get current session (or null if invalid)
   */
  getSession(): FheSession | null {
    return this.isSessionValid() ? this.session : null;
  }

  /**
   * Get session expiry time
   */
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
   * Decrypt (unseal) an encrypted value
   * This requires network consensus and may take 5-30 seconds
   */
  async unseal(ciphertext: string): Promise<bigint> {
    this.assertSession();

    try {
      return await this.session!.client.unseal(
        this.session!.contractAddress,
        ciphertext,
        this.session!.permit
      );
    } catch (error) {
      throw new FheDecryptionError('Failed to decrypt value', error);
    }
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

### 2.3 Mock FHE Client

For non-Fhenix networks (local, Base Sepolia):

```typescript
// src/lib/fhe/mockClient.ts

import type { FheSession } from '@/types/fhe';

export class MockFheClient {
  private session: FheSession | null = null;

  async initSession(contractAddress: `0x${string}`): Promise<FheSession> {
    // Simulate delay
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
    // Mock: just encode the value as bytes
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

  async unseal(ciphertext: string): Promise<bigint> {
    // Mock: simulate decryption delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Return a mock value (in real app, would need to track what was encrypted)
    return BigInt(Math.floor(Math.random() * 10)) * BigInt(1e18);
  }

  clearSession(): void {
    this.session = null;
  }
}
```

---

## 3. Encoding Utilities

### 3.1 Encrypted Value Encoding

```typescript
// src/lib/fhe/encoding.ts

/**
 * Encode encrypted boolean for contract call
 * The exact format depends on Fhenix's ABI encoding
 */
export function encodeEncryptedBool(encrypted: Uint8Array): `0x${string}` {
  return `0x${Buffer.from(encrypted).toString('hex')}`;
}

/**
 * Encode encrypted uint128 for contract call
 */
export function encodeEncryptedUint128(encrypted: Uint8Array): `0x${string}` {
  return `0x${Buffer.from(encrypted).toString('hex')}`;
}

/**
 * Encode hookData for swap with encrypted parameters
 * This is passed through beforeSwap() for additional privacy
 */
export async function encodeSwapHookData(
  client: FheatherXFheClient,
  params: {
    minOutput?: bigint;
    // Add other privacy parameters as needed
  }
): Promise<`0x${string}`> {
  if (!params.minOutput) {
    return '0x';
  }

  const encMinOutput = await client.encryptUint128(params.minOutput);

  // Encode as ABI-compatible bytes
  // Format: [4 bytes length][encrypted data]
  const data = new Uint8Array(4 + encMinOutput.length);
  const view = new DataView(data.buffer);
  view.setUint32(0, encMinOutput.length, false); // big-endian length
  data.set(encMinOutput, 4);

  return `0x${Buffer.from(data).toString('hex')}`;
}
```

---

## 4. FHE Session Hook

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

  // Initialize or reinitialize session
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
    const interval = setInterval(checkExpiry, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [sessionExpiresAt, setSessionStatus]);

  // Reset on wallet disconnect or chain change
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
    // Status
    status: sessionStatus,
    error: sessionError,
    expiresAt: sessionExpiresAt,
    isReady: sessionStatus === 'ready',
    isInitializing: sessionStatus === 'initializing',
    isMock,

    // Client
    client: clientRef.current,

    // Actions
    initialize,

    // Convenience methods
    encrypt: clientRef.current?.encryptUint128.bind(clientRef.current),
    encryptBool: clientRef.current?.encryptBool.bind(clientRef.current),
    unseal: clientRef.current?.unseal.bind(clientRef.current),
  };
}
```

---

## 5. Balance Reveal Implementation

```typescript
// src/hooks/useBalanceReveal.ts

'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAccount, useChainId, useReadContract } from 'wagmi';
import { useFheSession } from './useFheSession';
import { useFheStore } from '@/stores/fheStore';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { FHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';

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

  // Fetch encrypted balance from contract
  const { data: encryptedBalance, refetch: refetchBalance } = useReadContract({
    address: hookAddress,
    abi: FHEATHERX_ABI,
    functionName: isToken0 ? 'getUserBalanceToken0' : 'getUserBalanceToken1',
    args: address ? [address] : undefined,
    query: {
      enabled: false, // Manual fetch only
    },
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

      // Mock mode - return simulated balance
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

      // Step 1: Fetch encrypted balance from contract
      const { data: encrypted } = await refetchBalance();
      setProgress(30);

      if (!encrypted) {
        throw new Error('Failed to fetch encrypted balance');
      }

      // Step 2: Start decryption
      setStatus('decrypting');

      // Progress simulation (actual progress not available from FHE network)
      const progressInterval = setInterval(() => {
        setProgress(p => Math.min(p + 5, 90));
      }, 500);

      // Step 3: Unseal (decrypt)
      const decrypted = await client.unseal(encrypted as string);

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

## 6. FHE-Aware Components

### 6.1 Encrypted Balance Display

```typescript
// src/components/common/EncryptedBalance.tsx

'use client';

import { formatUnits } from 'viem';
import { useBalanceReveal } from '@/hooks/useBalanceReveal';
import { Button } from '@/components/ui/Button';
import { Progress } from '@/components/ui/Progress';

interface EncryptedBalanceProps {
  isToken0: boolean;
  decimals: number;
  symbol: string;
  showRevealButton?: boolean;
}

export function EncryptedBalance({
  isToken0,
  decimals,
  symbol,
  showRevealButton = true,
}: EncryptedBalanceProps) {
  const { status, value, error, progress, reveal, hide, isRevealing, isRevealed } =
    useBalanceReveal(isToken0);

  if (status === 'error') {
    return (
      <div className="text-deep-magenta text-sm">
        {error}
        <button onClick={reveal} className="ml-2 underline">
          Retry
        </button>
      </div>
    );
  }

  if (isRevealing) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-feather-white/60 text-sm">Decrypting...</span>
        </div>
        <Progress value={progress} className="h-1" />
      </div>
    );
  }

  if (isRevealed && value !== null) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono">
          {formatUnits(value, decimals)} {symbol}
        </span>
        <button
          onClick={hide}
          className="text-xs text-iridescent-violet hover:underline"
        >
          Hide
        </button>
      </div>
    );
  }

  // Default: hidden state
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-iridescent-violet">••••••</span>
      {showRevealButton && (
        <button
          onClick={reveal}
          className="text-xs text-phoenix-ember hover:underline"
        >
          Reveal
        </button>
      )}
    </div>
  );
}
```

### 6.2 FHE Session Provider

```typescript
// src/components/providers/FheProvider.tsx

'use client';

import { createContext, useContext, useEffect, ReactNode } from 'react';
import { useAccount } from 'wagmi';
import { useFheSession } from '@/hooks/useFheSession';

interface FheContextValue {
  status: string;
  isReady: boolean;
  isMock: boolean;
  initialize: () => Promise<void>;
}

const FheContext = createContext<FheContextValue | null>(null);

export function FheProvider({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount();
  const fheSession = useFheSession();

  // Auto-initialize on wallet connect (optional)
  useEffect(() => {
    if (isConnected && fheSession.status === 'disconnected') {
      // Optionally auto-init, or wait for user action
      // fheSession.initialize();
    }
  }, [isConnected, fheSession.status]);

  return (
    <FheContext.Provider value={fheSession}>
      {children}
    </FheContext.Provider>
  );
}

export function useFhe() {
  const context = useContext(FheContext);
  if (!context) {
    throw new Error('useFhe must be used within FheProvider');
  }
  return context;
}
```

---

## 7. Security Considerations

### 7.1 Permit Handling

```typescript
// DO NOT persist permits to localStorage
// Permits should only exist in memory during the session

// ❌ Bad
localStorage.setItem('fhePermit', JSON.stringify(permit));

// ✅ Good
// Keep permit only in React ref or Zustand store (non-persisted)
const permitRef = useRef<FhePermit | null>(null);
```

### 7.2 Session Expiry

```typescript
// Always check session validity before operations
async function encryptValue(value: bigint) {
  if (!client.isSessionValid()) {
    throw new Error('Session expired. Please re-initialize.');
  }
  return client.encryptUint128(value);
}
```

### 7.3 Error Recovery

```typescript
// Wrap FHE operations in try-catch with user-friendly recovery
try {
  const encrypted = await client.encryptUint128(amount);
} catch (error) {
  if (error instanceof FheSessionError) {
    // Prompt user to re-initialize session
    showModal('sessionExpired');
  } else if (error instanceof FheEncryptionError) {
    // Show retry option
    showToast('Encryption failed. Please try again.');
  } else {
    // Generic error
    showToast('Something went wrong.');
  }
}
```

---

## 8. Testing FHE Integration

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

  it('encrypts bool', async () => {
    const client = new MockFheClient();
    await client.initSession('0x1234567890123456789012345678901234567890');

    const encryptedTrue = await client.encryptBool(true);
    const encryptedFalse = await client.encryptBool(false);

    expect(encryptedTrue[0]).toBe(1);
    expect(encryptedFalse[0]).toBe(0);
  });

  it('throws when not initialized', async () => {
    const client = new MockFheClient();

    await expect(client.encryptUint128(BigInt(100))).rejects.toThrow();
  });

  it('clears session', async () => {
    const client = new MockFheClient();
    await client.initSession('0x1234567890123456789012345678901234567890');

    expect(client.isSessionValid()).toBe(true);

    client.clearSession();

    expect(client.isSessionValid()).toBe(false);
  });
});
```

---

*End of Appendix A*
