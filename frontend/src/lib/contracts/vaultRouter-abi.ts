/**
 * VaultRouter ABI - Router for coordinating swaps between ERC20 and FHERC20 tokens
 *
 * Key Features:
 * - swapErc20ToFherc20: Swap ERC20 input for FHERC20 output (automatic wrapping)
 * - swapFherc20ToErc20: Swap FHERC20 input for ERC20 output (via async claim)
 * - swapErc20ToErc20: Full journey ERC20 → swap → ERC20 (async claim)
 * - Token pair registry: Maps ERC20 ↔ FHERC20 tokens
 *
 * Uses FheVault's async claim system for ERC20 outputs.
 */

// Re-export types for convenience
export type { InEuint128, InEbool } from './fheatherXv6Abi';

export const VAULT_ROUTER_ABI = [
  // ============ Constructor ============
  {
    type: 'constructor',
    inputs: [{ name: '_poolManager', type: 'address' }],
    stateMutability: 'nonpayable',
  },

  // ============ Admin Functions ============
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'transferOwnership',
    inputs: [{ name: 'newOwner', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'registerTokenPair',
    inputs: [
      { name: 'erc20', type: 'address' },
      { name: 'fherc20', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'registerTokenPairs',
    inputs: [
      { name: 'erc20s', type: 'address[]' },
      { name: 'fherc20s', type: 'address[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // ============ Swap Functions ============
  {
    type: 'function',
    name: 'swapErc20ToFherc20',
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
      { name: 'erc20In', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
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
  {
    type: 'function',
    name: 'swapFherc20ToErc20',
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
    outputs: [{ name: 'claimId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'swapErc20ToErc20',
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
      { name: 'erc20In', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
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
    outputs: [{ name: 'claimId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },

  // ============ Claim Functions ============
  {
    type: 'function',
    name: 'fulfillClaim',
    inputs: [{ name: 'claimId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'isClaimReady',
    inputs: [{ name: 'claimId', type: 'uint256' }],
    outputs: [
      { name: 'ready', type: 'bool' },
      { name: 'amount', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getClaim',
    inputs: [{ name: 'claimId', type: 'uint256' }],
    outputs: [
      { name: 'recipient', type: 'address' },
      { name: 'erc20Token', type: 'address' },
      { name: 'requestedAt', type: 'uint256' },
      { name: 'fulfilled', type: 'bool' },
    ],
    stateMutability: 'view',
  },

  // ============ View Functions ============
  {
    type: 'function',
    name: 'poolManager',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'nextClaimId',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'erc20ToFherc20',
    inputs: [{ name: 'erc20', type: 'address' }],
    outputs: [{ name: 'fherc20', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'fherc20ToErc20',
    inputs: [{ name: 'fherc20', type: 'address' }],
    outputs: [{ name: 'erc20', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getFherc20',
    inputs: [{ name: 'erc20', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getErc20',
    inputs: [{ name: 'fherc20', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isTokenPairRegistered',
    inputs: [
      { name: 'erc20', type: 'address' },
      { name: 'fherc20', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },

  // ============ Events ============
  {
    type: 'event',
    name: 'SwapInitiated',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'tokenIn', type: 'address', indexed: true },
      { name: 'tokenOut', type: 'address', indexed: true },
      { name: 'isErc20In', type: 'bool', indexed: false },
      { name: 'isErc20Out', type: 'bool', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'UnwrapClaimCreated',
    inputs: [
      { name: 'claimId', type: 'uint256', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'erc20Token', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'ClaimFulfilled',
    inputs: [
      { name: 'claimId', type: 'uint256', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'erc20Token', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TokenPairRegistered',
    inputs: [
      { name: 'erc20', type: 'address', indexed: true },
      { name: 'fherc20', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'OwnershipTransferred',
    inputs: [
      { name: 'previousOwner', type: 'address', indexed: true },
      { name: 'newOwner', type: 'address', indexed: true },
    ],
  },

  // ============ Errors ============
  { type: 'error', name: 'Unauthorized', inputs: [] },
  { type: 'error', name: 'TokenPairNotRegistered', inputs: [] },
  { type: 'error', name: 'ZeroAmount', inputs: [] },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
  { type: 'error', name: 'ClaimNotFound', inputs: [] },
  { type: 'error', name: 'ClaimAlreadyFulfilled', inputs: [] },
  { type: 'error', name: 'DecryptNotReady', inputs: [] },
  { type: 'error', name: 'InvalidClaimId', inputs: [] },
  { type: 'error', name: 'UnauthorizedCallback', inputs: [] },
  { type: 'error', name: 'InvalidTokenPair', inputs: [] },
] as const;
