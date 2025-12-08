/**
 * ABI for FheatherXFactory contract
 * Verified from FheatherXFactory.sol
 */
export const FHEATHERX_FACTORY_ABI = [
  // Events
  {
    type: 'event',
    name: 'PoolCreated',
    inputs: [
      { name: 'token0', type: 'address', indexed: true },
      { name: 'token1', type: 'address', indexed: true },
      { name: 'hook', type: 'address', indexed: true },
      { name: 'poolIndex', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PoolDeactivated',
    inputs: [
      { name: 'hook', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'PoolReactivated',
    inputs: [
      { name: 'hook', type: 'address', indexed: true },
    ],
  },

  // Read functions
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPool',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
    ],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPoolInfo',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'token0', type: 'address' },
          { name: 'token1', type: 'address' },
          { name: 'hook', type: 'address' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPoolByHook',
    inputs: [{ name: 'hook', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'token0', type: 'address' },
          { name: 'token1', type: 'address' },
          { name: 'hook', type: 'address' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAllPools',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'token0', type: 'address' },
          { name: 'token1', type: 'address' },
          { name: 'hook', type: 'address' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getActivePools',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'token0', type: 'address' },
          { name: 'token1', type: 'address' },
          { name: 'hook', type: 'address' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'poolCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },

  // Write functions
  {
    type: 'function',
    name: 'createPool',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
    ],
    outputs: [{ name: 'hook', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'deactivatePool',
    inputs: [{ name: 'hook', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'reactivatePool',
    inputs: [{ name: 'hook', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;
