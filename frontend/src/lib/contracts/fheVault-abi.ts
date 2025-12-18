/**
 * FheVault ABI - ERC-6909 vault for wrapping ERC20 tokens to encrypted balances
 *
 * Key Features:
 * - wrap: Convert ERC20 to encrypted balance in vault
 * - unwrap: Request async decrypt to get ERC20 back (creates claim)
 * - fulfillClaim: Complete the claim after decrypt is ready
 * - transferEncrypted: Move encrypted balances between users
 *
 * The vault tracks claims using ERC-6909 claim tokens.
 */

export const FHE_VAULT_ABI = [
  // ============ Constructor ============
  {
    type: 'constructor',
    inputs: [],
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
    name: 'setTokenSupport',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'supported', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'addSupportedTokens',
    inputs: [{ name: 'tokens', type: 'address[]' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'pause',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unpause',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // ============ Wrap Functions ============
  {
    type: 'function',
    name: 'wrap',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'wrapEncrypted',
    inputs: [
      { name: 'token', type: 'address' },
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
      { name: 'maxPlaintext', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // ============ Unwrap Functions ============
  {
    type: 'function',
    name: 'unwrap',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'encAmount', type: 'uint256' }, // euint128 handle
    ],
    outputs: [{ name: 'claimId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unwrapEncrypted',
    inputs: [
      { name: 'token', type: 'address' },
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

  // ============ Encrypted Balance Functions ============
  {
    type: 'function',
    name: 'transferEncrypted',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }, // euint128 handle
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getEncryptedBalance',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'user', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }], // euint128 handle
    stateMutability: 'view',
  },

  // ============ ERC-6909 Functions ============
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'receiver', type: 'address' },
      { name: 'id', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'transferFrom',
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'receiver', type: 'address' },
      { name: 'id', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'id', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setOperator',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },

  // ============ View Functions ============
  {
    type: 'function',
    name: 'supportedTokens',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isTokenSupported',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTokenId',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'pure',
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
    name: 'supportsInterface',
    inputs: [{ name: 'interfaceId', type: 'bytes4' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'pure',
  },

  // ============ Events ============
  {
    type: 'event',
    name: 'Wrapped',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'UnwrapRequested',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'claimId', type: 'uint256', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'ClaimFulfilled',
    inputs: [
      { name: 'claimId', type: 'uint256', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TokenSupportUpdated',
    inputs: [
      { name: 'token', type: 'address', indexed: true },
      { name: 'supported', type: 'bool', indexed: false },
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
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'caller', type: 'address', indexed: false },
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Approval',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'spender', type: 'address', indexed: true },
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'OperatorSet',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'operator', type: 'address', indexed: true },
      { name: 'approved', type: 'bool', indexed: false },
    ],
  },

  // ============ Errors ============
  { type: 'error', name: 'Unauthorized', inputs: [] },
  { type: 'error', name: 'TokenNotSupported', inputs: [] },
  { type: 'error', name: 'ZeroAmount', inputs: [] },
  { type: 'error', name: 'ClaimNotFound', inputs: [] },
  { type: 'error', name: 'ClaimAlreadyFulfilled', inputs: [] },
  { type: 'error', name: 'DecryptNotReady', inputs: [] },
  { type: 'error', name: 'InsufficientBalance', inputs: [] },
  { type: 'error', name: 'InvalidClaimId', inputs: [] },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
  { type: 'error', name: 'AmountTooLarge', inputs: [] },
] as const;
