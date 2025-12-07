/**
 * FheatherX v3 Contract ABI
 *
 * This ABI matches the IFheatherXv3.sol interface exactly.
 * Generated from contract interface - do not modify manually.
 */

export const FHEATHERX_V3_ABI = [
  // ============================================================================
  // Events
  // ============================================================================
  {
    type: 'event',
    name: 'Deposit',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'tick', type: 'int24', indexed: true },
      { name: 'side', type: 'uint8', indexed: true },
      { name: 'amountHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Withdraw',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'tick', type: 'int24', indexed: true },
      { name: 'side', type: 'uint8', indexed: true },
      { name: 'amountHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Claim',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'tick', type: 'int24', indexed: true },
      { name: 'side', type: 'uint8', indexed: true },
      { name: 'amountHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Swap',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'zeroForOne', type: 'bool', indexed: true },
      { name: 'amountIn', type: 'uint256', indexed: false },
      { name: 'amountOut', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'BucketFilled',
    inputs: [
      { name: 'tick', type: 'int24', indexed: true },
      { name: 'side', type: 'uint8', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'BucketSeeded',
    inputs: [
      { name: 'tick', type: 'int24', indexed: true },
      { name: 'side', type: 'uint8', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'MaxBucketsPerSwapUpdated',
    inputs: [{ name: 'newMax', type: 'uint256', indexed: false }],
  },
  {
    type: 'event',
    name: 'ProtocolFeeQueued',
    inputs: [
      { name: 'newFeeBps', type: 'uint256', indexed: false },
      { name: 'effectiveTimestamp', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ProtocolFeeApplied',
    inputs: [{ name: 'newFeeBps', type: 'uint256', indexed: false }],
  },
  {
    type: 'event',
    name: 'FeeCollectorUpdated',
    inputs: [{ name: 'newCollector', type: 'address', indexed: false }],
  },

  // ============================================================================
  // Core Functions
  // ============================================================================
  {
    type: 'function',
    name: 'deposit',
    inputs: [
      { name: 'tick', type: 'int24' },
      {
        name: 'amount',
        type: 'tuple',
        components: [
          { name: 'data', type: 'bytes' },
        ],
      },
      { name: 'side', type: 'uint8' },
      { name: 'deadline', type: 'uint256' },
      { name: 'maxTickDrift', type: 'int24' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'swap',
    inputs: [
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'minAmountOut', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claim',
    inputs: [
      { name: 'tick', type: 'int24' },
      { name: 'side', type: 'uint8' },
    ],
    outputs: [{ name: 'proceeds', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdraw',
    inputs: [
      { name: 'tick', type: 'int24' },
      { name: 'side', type: 'uint8' },
      {
        name: 'amount',
        type: 'tuple',
        components: [
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: 'withdrawn', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'exit',
    inputs: [
      { name: 'tick', type: 'int24' },
      { name: 'side', type: 'uint8' },
    ],
    outputs: [
      { name: 'unfilled', type: 'uint256' },
      { name: 'proceeds', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },

  // ============================================================================
  // Admin Functions
  // ============================================================================
  {
    type: 'function',
    name: 'setMaxBucketsPerSwap',
    inputs: [{ name: '_max', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'queueProtocolFee',
    inputs: [{ name: '_feeBps', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'applyProtocolFee',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setFeeCollector',
    inputs: [{ name: '_collector', type: 'address' }],
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
  {
    type: 'function',
    name: 'seedBuckets',
    inputs: [{ name: 'ticks', type: 'int24[]' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'initializeReserves',
    inputs: [
      { name: '_reserve0', type: 'uint256' },
      { name: '_reserve1', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // ============================================================================
  // View Functions
  // ============================================================================
  {
    type: 'function',
    name: 'getClaimable',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'tick', type: 'int24' },
      { name: 'side', type: 'uint8' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable', // Note: returns euint128, requires FHE ops
  },
  {
    type: 'function',
    name: 'getWithdrawable',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'tick', type: 'int24' },
      { name: 'side', type: 'uint8' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable', // Note: returns euint128, requires FHE ops
  },
  {
    type: 'function',
    name: 'getPosition',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'tick', type: 'int24' },
      { name: 'side', type: 'uint8' },
    ],
    outputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'proceedsSnapshot', type: 'uint256' },
      { name: 'filledSnapshot', type: 'uint256' },
      { name: 'realized', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getBucket',
    inputs: [
      { name: 'tick', type: 'int24' },
      { name: 'side', type: 'uint8' },
    ],
    outputs: [
      { name: 'totalShares', type: 'uint256' },
      { name: 'liquidity', type: 'uint256' },
      { name: 'proceedsPerShare', type: 'uint256' },
      { name: 'filledPerShare', type: 'uint256' },
      { name: 'initialized', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTickPrices',
    inputs: [{ name: 'ticks', type: 'int24[]' }],
    outputs: [{ name: 'prices', type: 'uint256[]' }],
    stateMutability: 'view',
  },

  // ============================================================================
  // State Getters
  // ============================================================================
  {
    type: 'function',
    name: 'token0',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'token1',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'maxBucketsPerSwap',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'protocolFeeBps',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'feeCollector',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'pendingFeeBps',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'feeChangeTimestamp',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'reserve0',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'reserve1',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'tickPrices',
    inputs: [{ name: 'tick', type: 'int24' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },

  // ============================================================================
  // Constants
  // ============================================================================
  {
    type: 'function',
    name: 'PRECISION',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'TICK_SPACING',
    inputs: [],
    outputs: [{ name: '', type: 'int24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'MIN_TICK',
    inputs: [],
    outputs: [{ name: '', type: 'int24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'MAX_TICK',
    inputs: [],
    outputs: [{ name: '', type: 'int24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'FEE_CHANGE_DELAY',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

// Export type for use with viem
export type FheatherXV3Abi = typeof FHEATHERX_V3_ABI;
