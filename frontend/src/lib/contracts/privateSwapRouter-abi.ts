/**
 * PrivateSwapRouter ABI - Encrypted Swap Router for FHE Pools
 *
 * Key Features:
 * - swapEncrypted: Full privacy swap for v8FHE pools (encrypted direction + amounts)
 * - swapMixed: Partial privacy swap for v8Mixed pools (plaintext direction, encrypted amounts)
 *
 * The router converts InEuint128/InEbool inputs to euint128/ebool handles,
 * validates FHE signatures, and passes handles to the hook via hookData.
 */

// Re-export types for convenience
export type { InEuint128, InEbool } from './fheatherXv6Abi';

export const PRIVATE_SWAP_ROUTER_ABI = [
  // ============ Constructor ============
  {
    type: 'constructor',
    inputs: [{ name: '_poolManager', type: 'address' }],
    stateMutability: 'nonpayable',
  },

  // ============ State Variables ============
  {
    type: 'function',
    name: 'poolManager',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },

  // ============ Encrypted Swap (v8FHE - Full Privacy) ============
  {
    type: 'function',
    name: 'swapEncrypted',
    inputs: [
      {
        name: 'key',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      {
        name: 'encDirection',
        type: 'tuple',
        components: [
          { name: 'ctHash', type: 'uint256' },
          { name: 'securityZone', type: 'uint8' },
          { name: 'utype', type: 'uint8' },
          { name: 'signature', type: 'bytes' },
        ],
      },
      {
        name: 'encAmountIn',
        type: 'tuple',
        components: [
          { name: 'ctHash', type: 'uint256' },
          { name: 'securityZone', type: 'uint8' },
          { name: 'utype', type: 'uint8' },
          { name: 'signature', type: 'bytes' },
        ],
      },
      {
        name: 'encMinOutput',
        type: 'tuple',
        components: [
          { name: 'ctHash', type: 'uint256' },
          { name: 'securityZone', type: 'uint8' },
          { name: 'utype', type: 'uint8' },
          { name: 'signature', type: 'bytes' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // ============ Mixed Swap (v8Mixed - Partial Privacy) ============
  {
    type: 'function',
    name: 'swapMixed',
    inputs: [
      {
        name: 'key',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      { name: 'zeroForOne', type: 'bool' },
      {
        name: 'encAmountIn',
        type: 'tuple',
        components: [
          { name: 'ctHash', type: 'uint256' },
          { name: 'securityZone', type: 'uint8' },
          { name: 'utype', type: 'uint8' },
          { name: 'signature', type: 'bytes' },
        ],
      },
      {
        name: 'encMinOutput',
        type: 'tuple',
        components: [
          { name: 'ctHash', type: 'uint256' },
          { name: 'securityZone', type: 'uint8' },
          { name: 'utype', type: 'uint8' },
          { name: 'signature', type: 'bytes' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // ============ Events ============
  {
    type: 'event',
    name: 'EncryptedSwapInitiated',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'hook', type: 'address', indexed: false },
    ],
  },

  // ============ Errors ============
  {
    type: 'error',
    name: 'UnauthorizedCallback',
    inputs: [],
  },
] as const;
