import type { FheSession } from '@/types/fhe';
import { FHE_SESSION_DURATION_MS } from '@/lib/constants';

/**
 * Mock FHE Client for local development and non-Fhenix networks
 * Simulates FHE operations without actual encryption
 */
export class MockFheClient {
  private session: FheSession | null = null;

  async initSession(contractAddress: `0x${string}`): Promise<FheSession> {
    // Simulate initialization delay
    await new Promise(resolve => setTimeout(resolve, 500));

    const session: FheSession = {
      permit: {
        signature: ('0x' + '00'.repeat(65)) as `0x${string}`,
        publicKey: ('0x' + '00'.repeat(32)) as `0x${string}`,
      },
      client: null as any,
      contractAddress,
      createdAt: Date.now(),
      expiresAt: Date.now() + FHE_SESSION_DURATION_MS,
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
    // Convert bigint to 16-byte array (128 bits)
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _maxRetries: number = 3
  ): Promise<bigint> {
    // Simulate decryption delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Return mock value based on ciphertext hash for consistency
    const hash = ciphertext.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return BigInt(Math.floor((hash % 10) + 1)) * BigInt(1e18);
  }

  clearSession(): void {
    this.session = null;
  }
}
