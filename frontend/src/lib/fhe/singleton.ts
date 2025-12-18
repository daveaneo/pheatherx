/**
 * Global FHE Client Singleton
 *
 * This module provides FHE functionality using cofhejs/web client-side.
 * The user's wallet signs the permit, which is required for unsealing.
 */

import type { FheSession } from '@/types/fhe';
import { FHE_SESSION_DURATION_MS } from '@/lib/constants';

/**
 * Encrypted input struct matching CoFHE's InEuint128/InEbool format
 */
export interface EncryptedInput {
  ctHash: bigint;
  securityZone: number;
  utype: number;
  signature: `0x${string}`;
}

// Cached cofhejs module
let cofheModule: typeof import('cofhejs/web') | null = null;

// Session state
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
 * Load cofhejs/web module dynamically
 */
async function loadCofhe(): Promise<typeof import('cofhejs/web')> {
  if (cofheModule) return cofheModule;

  // Only load in browser
  if (typeof window === 'undefined') {
    throw new Error('cofhejs/web can only be loaded in browser');
  }

  cofheModule = await import('cofhejs/web');
  return cofheModule;
}

/**
 * Get the current status
 */
export function getLoadStatus(): 'idle' | 'loading' | 'loaded' | 'error' {
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
 * Preload cofhejs module
 */
export async function preloadCofhe(): Promise<any> {
  try {
    await loadCofhe();
    return { ready: true };
  } catch (error) {
    console.warn('[FHE] Preload failed:', error);
    return { ready: false, error };
  }
}

/**
 * Get cofhe module
 */
export async function getCofhe(): Promise<typeof import('cofhejs/web')> {
  return loadCofhe();
}

/**
 * Initialize FHE session using cofhejs/web client-side
 * User's wallet signs the permit - required for unsealing
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
      // Load cofhejs/web
      const { cofhejs } = await loadCofhe();

      const userAddress = await signer.getAddress();
      console.log('[FHE] Initializing session with user wallet...', { userAddress });

      // Initialize with user's actual wallet - this signs the permit
      const result = await cofhejs.initializeWithEthers({
        ethersProvider: provider,
        ethersSigner: signer,
        environment: 'TESTNET',
        generatePermit: true,
      });

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to initialize cofhejs');
      }

      console.log('[FHE] Session initialized, permit issuer:', result.data?.issuer);

      // Store session
      const expiresAt = Date.now() + FHE_SESSION_DURATION_MS;
      sessionExpiry = expiresAt;

      const session: FheSession = {
        permit: result.data,
        client: cofhejs,
        contractAddress,
        createdAt: Date.now(),
        expiresAt,
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
  initializationInProgress = null;
  cofheModule = null; // Clear module to force re-initialization
  notifyListeners('idle');
}

/**
 * Encrypt a uint128 value using cofhejs/web
 * Returns the full encrypted struct including signature for CoFHE validation
 */
export async function encryptUint128(value: bigint): Promise<EncryptedInput> {
  if (!currentSession) {
    throw new Error('No valid FHE session');
  }

  const { cofhejs, Encryptable } = await loadCofhe();

  const result = await cofhejs.encrypt([Encryptable.uint128(value)]);

  if ('error' in result && result.error) {
    throw new Error(result.error.message || 'Failed to encrypt uint128');
  }

  const encrypted = 'data' in result ? result.data : result;
  const item = encrypted[0];

  return {
    ctHash: BigInt(item.ctHash),
    securityZone: item.securityZone,
    utype: item.utype,
    signature: (item.signature || '0x') as `0x${string}`,
  };
}

/**
 * Encrypt a boolean value using cofhejs/web
 * Returns the full encrypted struct including signature for CoFHE validation
 */
export async function encryptBool(value: boolean): Promise<EncryptedInput> {
  if (!currentSession) {
    throw new Error('No valid FHE session');
  }

  const { cofhejs, Encryptable } = await loadCofhe();

  const result = await cofhejs.encrypt([Encryptable.bool(value)]);

  if ('error' in result && result.error) {
    throw new Error(result.error.message || 'Failed to encrypt bool');
  }

  const encrypted = 'data' in result ? result.data : result;
  const item = encrypted[0];

  return {
    ctHash: BigInt(item.ctHash),
    securityZone: item.securityZone,
    utype: item.utype,
    signature: (item.signature || '0x') as `0x${string}`,
  };
}

/**
 * Unseal (decrypt) a ciphertext using cofhejs/web
 * Requires the permit to be signed by the user who has FHE.allow() permission
 */
export async function unseal(ciphertext: string, maxRetries: number = 3): Promise<bigint> {
  if (!currentSession) {
    throw new Error('No valid FHE session');
  }

  const { cofhejs, FheTypes } = await loadCofhe();

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const ctHash = BigInt(ciphertext);

      const result = await cofhejs.unseal(ctHash, FheTypes.Uint128);

      if ('error' in result && result.error) {
        throw new Error(result.error.message || JSON.stringify(result.error) || 'Failed to unseal');
      }

      const unsealed = 'data' in result ? result.data : result;
      return BigInt(unsealed.toString());
    } catch (error) {
      lastError = error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isSealedDataNotFound = errorMessage.includes('sealed data not found');

      console.warn(`FHE unseal attempt ${attempt}/${maxRetries} failed:`, error);

      if (attempt < maxRetries) {
        // Use longer delays for "sealed data not found" - CoFHE may still be processing
        const baseDelay = isSealedDataNotFound ? 2000 : 1000;
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(`[FHE] Retrying in ${delay}ms...${isSealedDataNotFound ? ' (waiting for CoFHE to process ciphertext)' : ''}`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  // Provide more helpful error message for common issues
  const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
  if (errorMessage.includes('sealed data not found')) {
    throw new Error('Ciphertext not yet available on CoFHE - try refreshing in a few seconds');
  }
  throw new Error(`Failed to decrypt after ${maxRetries} attempts`);
}
