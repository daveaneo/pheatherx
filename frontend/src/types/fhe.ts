export interface FheSession {
  permit: any; // Permit from cofhejs (structure changed in new version)
  client: any; // cofhejs client instance
  contractAddress: `0x${string}`;
  createdAt: number;
  expiresAt: number;
}

// Legacy permit interface (kept for mock client compatibility)
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
