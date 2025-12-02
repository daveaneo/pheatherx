/**
 * Lazy loader for cofhejs FHE client
 *
 * This module provides a function to load the real FHE client at runtime,
 * avoiding build-time analysis of the heavy cofhejs package.
 */

import type { FheSession } from '@/types/fhe';
import { FHE_SESSION_DURATION_MS } from '@/lib/constants';

// Cache the loaded module
let cofheModule: typeof import('cofhejs/web') | null = null;
let isInitialized = false;

/**
 * Load the cofhejs module at runtime
 * Returns null if loading fails (e.g., in SSR or unsupported environment)
 */
async function loadCofhe(): Promise<typeof import('cofhejs/web') | null> {
  if (cofheModule) return cofheModule;

  // Only load in browser
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    // Use Function constructor to create a truly dynamic import
    // that bundlers cannot statically analyze
    const dynamicImport = new Function('specifier', 'return import(specifier)');
    cofheModule = await dynamicImport('cofhejs/web');
    return cofheModule;
  } catch (error) {
    console.error('Failed to load cofhejs:', error);
    return null;
  }
}

/**
 * Create a real FHE client using cofhejs
 * This function is called only when the user initiates FHE session
 */
export async function createRealFheClient(
  provider: any,
  signer: any
): Promise<RealFheClient | null> {
  const cofhe = await loadCofhe();
  if (!cofhe) {
    console.warn('cofhejs not available, falling back to mock');
    return null;
  }

  return new RealFheClient(provider, signer, cofhe);
}

/**
 * Real FHE Client that wraps cofhejs (new API)
 */
export class RealFheClient {
  private session: FheSession | null = null;
  private provider: any;
  private signer: any;
  private cofhe: typeof import('cofhejs/web');

  constructor(provider: any, signer: any, cofheModule: typeof import('cofhejs/web')) {
    this.provider = provider;
    this.signer = signer;
    this.cofhe = cofheModule;
  }

  async initSession(contractAddress: `0x${string}`): Promise<FheSession> {
    try {
      const { cofhejs } = this.cofhe;

      // Initialize cofhejs with ethers provider/signer
      // generatePermit: true will automatically create a self-permit
      const result = await cofhejs.initializeWithEthers({
        ethersProvider: this.provider,
        ethersSigner: this.signer,
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

      this.session = session;
      isInitialized = true;
      return session;
    } catch (error) {
      console.error('Failed to initialize FHE session:', error);
      throw new Error('Failed to initialize privacy session');
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

  async encryptUint128(value: bigint): Promise<Uint8Array> {
    if (!this.isSessionValid()) {
      throw new Error('No valid FHE session');
    }

    const { cofhejs, Encryptable } = this.cofhe;

    // Use the new encrypt API
    const result = await cofhejs.encrypt([Encryptable.uint128(value)]);

    if ('error' in result && result.error) {
      throw new Error(result.error.message || 'Failed to encrypt uint128');
    }

    const encrypted = 'data' in result ? result.data : result;
    // CoFheInItem has ctHash (bigint) and signature (string)
    // Convert ctHash to bytes for contract calls
    const ctHash = encrypted[0].ctHash;
    return this.bigintToBytes(ctHash);
  }

  async encryptBool(value: boolean): Promise<Uint8Array> {
    if (!this.isSessionValid()) {
      throw new Error('No valid FHE session');
    }

    const { cofhejs, Encryptable } = this.cofhe;

    const result = await cofhejs.encrypt([Encryptable.bool(value)]);

    if ('error' in result && result.error) {
      throw new Error(result.error.message || 'Failed to encrypt bool');
    }

    const encrypted = 'data' in result ? result.data : result;
    const ctHash = encrypted[0].ctHash;
    return this.bigintToBytes(ctHash);
  }

  // Helper to convert bigint to Uint8Array (32 bytes)
  private bigintToBytes(value: bigint): Uint8Array {
    const hex = value.toString(16).padStart(64, '0');
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  async unseal(ciphertext: string, maxRetries: number = 3): Promise<bigint> {
    if (!this.isSessionValid()) {
      throw new Error('No valid FHE session');
    }

    const { cofhejs, FheTypes } = this.cofhe;

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Parse ciphertext as bigint (hash)
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

  clearSession(): void {
    this.session = null;
    isInitialized = false;
  }
}
