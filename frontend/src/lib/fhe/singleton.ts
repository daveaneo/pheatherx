/**
 * Global FHE Client Singleton
 *
 * This module provides a single global instance of the FHE client that:
 * 1. Starts loading cofhejs in the background on app mount
 * 2. Persists across page navigation
 * 3. Caches the loaded module for instant access
 */

import type { FheSession } from '@/types/fhe';
import { FHE_SESSION_DURATION_MS } from '@/lib/constants';

// Module state
let cofheModule: typeof import('cofhejs/web') | null = null;
let loadingPromise: Promise<typeof import('cofhejs/web') | null> | null = null;
let isInitialized = false;
let currentSession: FheSession | null = null;
let sessionExpiry: number | null = null;

// Event listeners for load status
type LoadListener = (status: 'loading' | 'loaded' | 'error', error?: Error) => void;
const loadListeners: Set<LoadListener> = new Set();

/**
 * Get the current loading status
 */
export function getLoadStatus(): 'idle' | 'loading' | 'loaded' | 'error' {
  if (cofheModule) return 'loaded';
  if (loadingPromise) return 'loading';
  return 'idle';
}

/**
 * Subscribe to load status changes
 */
export function onLoadStatusChange(listener: LoadListener): () => void {
  loadListeners.add(listener);
  return () => loadListeners.delete(listener);
}

function notifyListeners(status: 'loading' | 'loaded' | 'error', error?: Error) {
  loadListeners.forEach(listener => listener(status, error));
}

/**
 * Start loading cofhejs in the background
 * Safe to call multiple times - will only load once
 */
export function preloadCofhe(): Promise<typeof import('cofhejs/web') | null> {
  // Already loaded
  if (cofheModule) {
    return Promise.resolve(cofheModule);
  }

  // Already loading
  if (loadingPromise) {
    return loadingPromise;
  }

  // Only load in browser
  if (typeof window === 'undefined') {
    return Promise.resolve(null);
  }

  notifyListeners('loading');

  loadingPromise = (async () => {
    try {
      // Use Function constructor to create a truly dynamic import
      // that bundlers cannot statically analyze
      const dynamicImport = new Function('specifier', 'return import(specifier)');
      cofheModule = await dynamicImport('cofhejs/web');
      notifyListeners('loaded');
      return cofheModule;
    } catch (error) {
      console.error('Failed to load cofhejs:', error);
      notifyListeners('error', error instanceof Error ? error : new Error('Failed to load cofhejs'));
      loadingPromise = null; // Allow retry
      return null;
    }
  })();

  return loadingPromise;
}

/**
 * Get the cofhejs module (waits if still loading)
 */
export async function getCofhe(): Promise<typeof import('cofhejs/web') | null> {
  if (cofheModule) return cofheModule;
  if (loadingPromise) return loadingPromise;
  return preloadCofhe();
}

/**
 * Check if cofhejs is ready (loaded and available)
 */
export function isCofheReady(): boolean {
  return cofheModule !== null;
}

/**
 * Get the current FHE session (if valid)
 */
export function getSession(): FheSession | null {
  if (!currentSession) return null;
  if (sessionExpiry && Date.now() > sessionExpiry) {
    currentSession = null;
    sessionExpiry = null;
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
 * Initialize FHE session with the given provider/signer
 */
export async function initializeSession(
  provider: any,
  signer: any,
  contractAddress: `0x${string}`
): Promise<FheSession> {
  const cofhe = await getCofhe();

  if (!cofhe) {
    throw new Error('cofhejs not available');
  }

  const { cofhejs } = cofhe;

  // Initialize cofhejs with ethers provider/signer
  const result = await cofhejs.initializeWithEthers({
    ethersProvider: provider,
    ethersSigner: signer,
    generatePermit: true,
  });

  if ('error' in result && result.error) {
    throw new Error(result.error.message || 'Failed to initialize cofhejs');
  }

  // Get the generated permit
  const permitResult = cofhejs.getPermit();

  if ('error' in permitResult && permitResult.error) {
    throw new Error(permitResult.error.message || 'Failed to get permit');
  }

  const permit = 'data' in permitResult ? permitResult.data : permitResult;

  const session: FheSession = {
    permit,
    client: cofhejs,
    contractAddress,
    createdAt: Date.now(),
    expiresAt: Date.now() + FHE_SESSION_DURATION_MS,
  };

  currentSession = session;
  sessionExpiry = session.expiresAt;
  isInitialized = true;

  return session;
}

/**
 * Clear the current session
 */
export function clearSession(): void {
  currentSession = null;
  sessionExpiry = null;
  isInitialized = false;
}

/**
 * Encrypt a uint128 value
 */
export async function encryptUint128(value: bigint): Promise<Uint8Array> {
  if (!isSessionValid()) {
    throw new Error('No valid FHE session');
  }

  const cofhe = await getCofhe();
  if (!cofhe) throw new Error('cofhejs not available');

  const { cofhejs, Encryptable } = cofhe;

  const result = await cofhejs.encrypt([Encryptable.uint128(value)]);

  if ('error' in result && result.error) {
    throw new Error(result.error.message || 'Failed to encrypt uint128');
  }

  const encrypted = 'data' in result ? result.data : result;
  const ctHash = encrypted[0].ctHash;
  return bigintToBytes(ctHash);
}

/**
 * Encrypt a boolean value
 */
export async function encryptBool(value: boolean): Promise<Uint8Array> {
  if (!isSessionValid()) {
    throw new Error('No valid FHE session');
  }

  const cofhe = await getCofhe();
  if (!cofhe) throw new Error('cofhejs not available');

  const { cofhejs, Encryptable } = cofhe;

  const result = await cofhejs.encrypt([Encryptable.bool(value)]);

  if ('error' in result && result.error) {
    throw new Error(result.error.message || 'Failed to encrypt bool');
  }

  const encrypted = 'data' in result ? result.data : result;
  const ctHash = encrypted[0].ctHash;
  return bigintToBytes(ctHash);
}

/**
 * Unseal (decrypt) a ciphertext
 */
export async function unseal(ciphertext: string, maxRetries: number = 3): Promise<bigint> {
  if (!isSessionValid()) {
    throw new Error('No valid FHE session');
  }

  const cofhe = await getCofhe();
  if (!cofhe) throw new Error('cofhejs not available');

  const { cofhejs, FheTypes } = cofhe;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const ctHash = BigInt(ciphertext);
      const result = await cofhejs.unseal(ctHash, FheTypes.Uint128);

      if ('error' in result && result.error) {
        throw new Error(result.error.message || 'Failed to unseal');
      }

      const unsealed = 'data' in result ? result.data : result;
      return BigInt(unsealed.toString());
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
