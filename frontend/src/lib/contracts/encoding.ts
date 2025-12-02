import { encodeAbiParameters, parseAbiParameters } from 'viem';

/**
 * Encode hook data for PheatherX swap
 * The hook expects the caller address to verify the sender
 */
export function encodeSwapHookData(caller: `0x${string}`): `0x${string}` {
  return encodeAbiParameters(
    parseAbiParameters('address'),
    [caller]
  );
}

/**
 * Encode order parameters for FHE
 */
export function encodeOrderParams(
  triggerTick: number,
  isBuy: boolean,
  isLimit: boolean,
  encryptedAmount: Uint8Array
): `0x${string}` {
  // Pack the encrypted amount and flags
  const flags = (isBuy ? 1 : 0) | (isLimit ? 2 : 0);

  // Convert Uint8Array to hex string
  const encryptedHex: `0x${string}` = `0x${Array.from(encryptedAmount)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')}`;

  return encodeAbiParameters(
    parseAbiParameters('int24, uint8, bytes'),
    [triggerTick, flags, encryptedHex]
  );
}
