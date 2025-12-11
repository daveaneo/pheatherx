/**
 * FHERC20 Token ABI
 *
 * These tokens extend ERC20 with FHE (Fully Homomorphic Encryption) capabilities.
 * They support both plaintext (ERC20 compatible) and encrypted operations.
 */

export const FHERC20_ABI = [
  // Standard ERC20 functions
  {
    type: 'function',
    name: 'name',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'symbol',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalSupply',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'transferFrom',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },

  // ═══════════════════════════════════════════════════════════════════════
  //                      WRAP/UNWRAP FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Wrap ERC20 balance to encrypted FHERC20 balance
   * Burns the plaintext ERC20 balance and adds to encrypted balance
   */
  {
    type: 'function',
    name: 'wrap',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  /**
   * Unwrap encrypted FHERC20 balance back to ERC20
   * Subtracts from encrypted balance and mints plaintext tokens
   */
  {
    type: 'function',
    name: 'unwrap',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // ═══════════════════════════════════════════════════════════════════════
  //                      FAUCET FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Mint tokens from faucet (testnet only)
   */
  {
    type: 'function',
    name: 'faucet',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // ═══════════════════════════════════════════════════════════════════════
  //                      ENCRYPTED APPROVAL FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Approve spender to spend encrypted tokens
   * Uses encrypted allowance (required for transferFromEncryptedDirect)
   */
  {
    type: 'function',
    name: 'approveEncrypted',
    inputs: [
      { name: 'spender', type: 'address' },
      {
        name: 'encryptedAmount',
        type: 'tuple',
        components: [
          { name: 'ctHash', type: 'uint256' },
          { name: 'securityZone', type: 'uint8' },
          { name: 'utype', type: 'uint8' },
          { name: 'signature', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },

  // ═══════════════════════════════════════════════════════════════════════
  //                      ENCRYPTED BALANCE FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get encrypted balance handle (Fhenix standard name)
   */
  {
    type: 'function',
    name: 'balanceOfEncrypted',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }], // Returns euint128 handle
    stateMutability: 'view',
  },

  /**
   * Check if account has an initialized encrypted balance
   */
  {
    type: 'function',
    name: 'hasEncryptedBalance',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },

  /**
   * Get encrypted allowance handle
   */
  {
    type: 'function',
    name: 'allowanceEncrypted',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }], // Returns euint128 handle
    stateMutability: 'view',
  },

  /**
   * Transfer encrypted tokens (EOA/frontend input)
   */
  {
    type: 'function',
    name: 'transferEncrypted',
    inputs: [
      { name: 'to', type: 'address' },
      {
        name: 'encryptedAmount',
        type: 'tuple',
        components: [
          { name: 'ctHash', type: 'uint256' },
          { name: 'securityZone', type: 'uint8' },
          { name: 'utype', type: 'uint8' },
          { name: 'signature', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'uint256' }], // Returns euint128 handle
    stateMutability: 'nonpayable',
  },

  /**
   * Transfer encrypted tokens from another address (EOA/frontend input)
   */
  {
    type: 'function',
    name: 'transferFromEncrypted',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      {
        name: 'encryptedAmount',
        type: 'tuple',
        components: [
          { name: 'ctHash', type: 'uint256' },
          { name: 'securityZone', type: 'uint8' },
          { name: 'utype', type: 'uint8' },
          { name: 'signature', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'uint256' }], // Returns euint128 handle
    stateMutability: 'nonpayable',
  },

  /**
   * Transfer encrypted tokens (contract-to-contract, euint128 handle)
   * Fhenix standard name with underscore prefix
   */
  {
    type: 'function',
    name: '_transferEncrypted',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }, // euint128 handle
    ],
    outputs: [{ name: '', type: 'uint256' }], // Returns euint128 handle
    stateMutability: 'nonpayable',
  },

  /**
   * Transfer encrypted tokens from another address (contract-to-contract, euint128 handle)
   * Fhenix standard name with underscore prefix
   */
  {
    type: 'function',
    name: '_transferFromEncrypted',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }, // euint128 handle
    ],
    outputs: [{ name: '', type: 'uint256' }], // Returns euint128 handle
    stateMutability: 'nonpayable',
  },

  // ═══════════════════════════════════════════════════════════════════════
  //                              EVENTS
  // ═══════════════════════════════════════════════════════════════════════
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Approval',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'spender', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Wrapped',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Unwrapped',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const;
