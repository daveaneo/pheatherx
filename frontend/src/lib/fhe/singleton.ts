/**
 * Global FHE Client Singleton
 *
 * This module provides FHE functionality via server-side API routes
 * because cofhejs/web has WASM initialization issues in browsers.
 * The server runs cofhejs/node which works correctly.
 */

import type { FheSession } from '@/types/fhe';
import { FHE_SESSION_DURATION_MS } from '@/lib/constants';

// Session state
let currentSessionId: string | null = null;
let currentSession: FheSession | null = null;
let sessionExpiry: number | null = null;
let initializationInProgress: Promise<FheSession> | null = null;

// Event listeners for status
type StatusListener = (status: 'idle' | 'initializing' | 'ready' | 'error', error?: Error) => void;
const statusListeners: Set<StatusListener> = new Set();

let currentStatus: 'idle' | 'initializing' | 'ready' | 'error' = 'idle';

function notifyListeners(status: typeof currentStatus, error?: Error) {
  currentStatus = status;
  statusListeners.forEach(listener => listener(status, error));
}

/**
 * Get the current status
 */
export function getLoadStatus(): 'idle' | 'loading' | 'loaded' | 'error' {
  // Map to legacy status names for compatibility
  switch (currentStatus) {
    case 'idle': return 'idle';
    case 'initializing': return 'loading';
    case 'ready': return 'loaded';
    case 'error': return 'error';
  }
}

/**
 * Subscribe to status changes
 */
export function onLoadStatusChange(listener: (status: 'loading' | 'loaded' | 'error', error?: Error) => void): () => void {
  const wrappedListener: StatusListener = (status, error) => {
    if (status === 'initializing') listener('loading', error);
    else if (status === 'ready') listener('loaded', error);
    else if (status === 'error') listener('error', error);
  };
  statusListeners.add(wrappedListener);
  return () => statusListeners.delete(wrappedListener);
}

/**
 * Check if cofhejs is ready (session initialized)
 */
export function isCofheReady(): boolean {
  return currentStatus === 'ready' && isSessionValid();
}

/**
 * Get the current FHE session (if valid)
 */
export function getSession(): FheSession | null {
  if (!currentSession) return null;
  if (sessionExpiry && Date.now() > sessionExpiry) {
    currentSession = null;
    sessionExpiry = null;
    currentSessionId = null;
    return null;
  }
  return currentSession;
}

/**
 * Check if session is valid
 */
export function isSessionValid(): boolean {
  return getSession() !== null;
}

/**
 * Get session expiry time
 */
export function getSessionExpiry(): number | null {
  return sessionExpiry;
}

/**
 * Preload - for API-based approach, this is a no-op
 * The actual initialization happens in initializeSession
 */
export function preloadCofhe(): Promise<any> {
  // No preloading needed for API approach
  // Just mark as ready to proceed
  return Promise.resolve({ ready: true });
}

/**
 * Get cofhe module - for API approach, returns a stub
 */
export async function getCofhe(): Promise<any> {
  return { ready: true, api: true };
}

/**
 * Initialize FHE session via server-side API
 */
export async function initializeSession(
  provider: any,
  signer: any,
  contractAddress: `0x${string}`
): Promise<FheSession> {
  // If already have a valid session, return it
  if (currentSession && sessionExpiry && Date.now() < sessionExpiry) {
    return currentSession;
  }

  // If initialization is already in progress, wait for it
  if (initializationInProgress) {
    console.log('[FHE] Waiting for existing initialization...');
    return initializationInProgress;
  }

  // Start new initialization
  initializationInProgress = (async () => {
    notifyListeners('initializing');

    try {
      // Get chain ID from provider
      const network = await provider.getNetwork();
      const chainId = Number(network.chainId);

      // Get user address from signer
      const userAddress = await signer.getAddress();

      console.log('[FHE] Initializing session via API...', { chainId, userAddress });

      // Call server-side API to initialize
      const response = await fetch('/api/fhe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'initialize',
          chainId,
          userAddress,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || result.error || 'Failed to initialize FHE session');
      }

      console.log('[FHE] Session initialized:', result.sessionId);

      // Store session
      currentSessionId = result.sessionId;
      sessionExpiry = result.expiresAt;

      const session: FheSession = {
        permit: result.permit,
        client: { sessionId: result.sessionId, api: true },
        contractAddress,
        createdAt: Date.now(),
        expiresAt: result.expiresAt,
      };

      currentSession = session;
      notifyListeners('ready');

      return session;
    } catch (error) {
      console.error('[FHE] Session init failed:', error);
      notifyListeners('error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      initializationInProgress = null;
    }
  })();

  return initializationInProgress;
}

/**
 * Clear the current session
 */
export function clearSession(): void {
  currentSession = null;
  sessionExpiry = null;
  currentSessionId = null;
  initializationInProgress = null;
  notifyListeners('idle');
}

/**
 * Encrypt a uint128 value via server-side API
 */
export async function encryptUint128(value: bigint): Promise<Uint8Array> {
  if (!currentSessionId) {
    throw new Error('No valid FHE session');
  }

  const response = await fetch('/api/fhe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'encrypt',
      chainId: 0, // Not needed for encrypt
      data: {
        sessionId: currentSessionId,
        value: value.toString(),
        type: 'uint128',
      },
    }),
  });

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error || 'Failed to encrypt');
  }

  // Convert ciphertext string to bytes
  const ctHash = BigInt(result.ciphertext);
  return bigintToBytes(ctHash);
}

/**
 * Encrypt a boolean value via server-side API
 */
export async function encryptBool(value: boolean): Promise<Uint8Array> {
  if (!currentSessionId) {
    throw new Error('No valid FHE session');
  }

  const response = await fetch('/api/fhe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'encrypt',
      chainId: 0,
      data: {
        sessionId: currentSessionId,
        value,
        type: 'bool',
      },
    }),
  });

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error || 'Failed to encrypt');
  }

  const ctHash = BigInt(result.ciphertext);
  return bigintToBytes(ctHash);
}

/**
 * Unseal (decrypt) a ciphertext via server-side API
 */
export async function unseal(ciphertext: string, maxRetries: number = 3): Promise<bigint> {
  if (!currentSessionId) {
    throw new Error('No valid FHE session');
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch('/api/fhe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'unseal',
          chainId: 0,
          data: {
            sessionId: currentSessionId,
            ciphertext,
            type: 'uint128',
          },
        }),
      });

      const result = await response.json();

      if (!result.success) {
        const errorMsg = typeof result.error === 'string'
          ? result.error
          : result.error?.message || JSON.stringify(result.error) || 'Failed to unseal';
        throw new Error(errorMsg);
      }

      return BigInt(result.value);
    } catch (error) {
      lastError = error;
      console.warn(`FHE unseal attempt ${attempt}/${maxRetries} failed:`, error);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw new Error(`Failed to decrypt after ${maxRetries} attempts`);
}

// Helper to convert bigint to Uint8Array (32 bytes)
function bigintToBytes(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
