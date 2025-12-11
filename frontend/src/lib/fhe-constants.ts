/**
 * FHE Type Constants
 * These values match @fhenixprotocol/cofhe-contracts/ICofhe.sol Utils library
 *
 * IMPORTANT: These must match the CoFHE contract constants exactly
 */

// FHE encrypted type identifiers (utype values)
export const FHE_TYPES = {
  EBOOL: 0,      // EBOOL_TFHE
  EUINT8: 2,     // EUINT8_TFHE
  EUINT16: 3,    // EUINT16_TFHE
  EUINT32: 4,    // EUINT32_TFHE
  EUINT64: 5,    // EUINT64_TFHE
  EUINT128: 6,   // EUINT128_TFHE - Note: NOT 7, that's EADDRESS!
  EADDRESS: 7,   // EADDRESS_TFHE
  EUINT256: 8,   // EUINT256_TFHE
} as const;

// Default security zone for FHE operations
export const DEFAULT_SECURITY_ZONE = 0;

// Type guard for utype
export type FHEType = typeof FHE_TYPES[keyof typeof FHE_TYPES];
