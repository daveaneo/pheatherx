/**
 * FheatherXv5 ABI - Hybrid AMM + Limit Orders Uniswap v4 Hook
 *
 * This is the v5 contract ABI that uses bucket-based positions indexed by (poolId, tick, side).
 * The PoolId is a bytes32 computed from hashing the PoolKey.
 */

export const FHEATHERX_V5_ABI = [
  // ═══════════════════════════════════════════════════════════════════════
  //                               EVENTS
  // ═══════════════════════════════════════════════════════════════════════
  {
    type: 'event',
    name: 'PoolInitialized',
    inputs: [
      { name: 'poolId', type: 'bytes32', indexed: true },
      { name: 'token0', type: 'address', indexed: false },
      { name: 'token1', type: 'address', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Swap',
    inputs: [
      { name: 'poolId', type: 'bytes32', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'zeroForOne', type: 'bool', indexed: true },
      { name: 'amountIn', type: 'uint256', indexed: false },
      { name: 'amountOut', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'SwapEncrypted',
    inputs: [
      { name: 'poolId', type: 'bytes32', indexed: true },
      { name: 'user', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'Deposit',
    inputs: [
      { name: 'poolId', type: 'bytes32', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'tick', type: 'int24', indexed: true },
      { name: 'side', type: 'uint8', indexed: false }, // BucketSide enum
      { name: 'amountHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Withdraw',
    inputs: [
      { name: 'poolId', type: 'bytes32', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'tick', type: 'int24', indexed: true },
      { name: 'side', type: 'uint8', indexed: false },
      { name: 'amountHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Claim',
    inputs: [
      { name: 'poolId', type: 'bytes32', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'tick', type: 'int24', indexed: true },
      { name: 'side', type: 'uint8', indexed: false },
      { name: 'amountHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'BucketFilled',
    inputs: [
      { name: 'poolId', type: 'bytes32', indexed: true },
      { name: 'tick', type: 'int24', indexed: true },
      { name: 'side', type: 'uint8', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'LiquidityAdded',
    inputs: [
      { name: 'poolId', type: 'bytes32', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
      { name: 'lpAmount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'LiquidityRemoved',
    inputs: [
      { name: 'poolId', type: 'bytes32', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
      { name: 'lpAmount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'LiquidityAddedEncrypted',
    inputs: [
      { name: 'poolId', type: 'bytes32', indexed: true },
      { name: 'user', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'LiquidityRemovedEncrypted',
    inputs: [
      { name: 'poolId', type: 'bytes32', indexed: true },
      { name: 'user', type: 'address', indexed: true },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  //                           VIEW FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════
  {
    type: 'function',
    name: 'getPoolState',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [
      { name: 'token0', type: 'address' },
      { name: 'token1', type: 'address' },
      { name: 'initialized', type: 'bool' },
      { name: 'maxBucketsPerSwap', type: 'uint256' },
      { name: 'protocolFeeBps', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPoolReserves',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [
      { name: 'reserve0', type: 'uint256' },
      { name: 'reserve1', type: 'uint256' },
      { name: 'lpSupply', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTickPrice',
    inputs: [{ name: 'tick', type: 'int24' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'hasActiveOrders',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'tick', type: 'int24' },
      { name: 'side', type: 'uint8' }, // BucketSide enum: 0=BUY, 1=SELL
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'lpBalances',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'user', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalLpSupply',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'encLpBalances',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'user', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }], // euint128 handle
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'buckets',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'tick', type: 'int24' },
      { name: 'side', type: 'uint8' },
    ],
    outputs: [
      { name: 'totalShares', type: 'uint256' }, // euint128 handle
      { name: 'liquidity', type: 'uint256' }, // euint128 handle
      { name: 'proceedsPerShare', type: 'uint256' }, // euint128 handle
      { name: 'filledPerShare', type: 'uint256' }, // euint128 handle
      { name: 'initialized', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'positions',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'user', type: 'address' },
      { name: 'tick', type: 'int24' },
      { name: 'side', type: 'uint8' },
    ],
    outputs: [
      { name: 'shares', type: 'uint256' }, // euint128 handle
      { name: 'proceedsPerShareSnapshot', type: 'uint256' }, // euint128 handle
      { name: 'filledPerShareSnapshot', type: 'uint256' }, // euint128 handle
      { name: 'realizedProceeds', type: 'uint256' }, // euint128 handle
    ],
    stateMutability: 'view',
  },

  // ═══════════════════════════════════════════════════════════════════════
  //                        LIMIT ORDER FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════
  {
    type: 'function',
    name: 'depositToTick',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'tick', type: 'int24' },
      { name: 'side', type: 'uint8' }, // BucketSide: 0=BUY, 1=SELL
      { name: 'encryptedAmount', type: 'bytes' }, // InEuint128
      { name: 'deadline', type: 'uint256' },
      { name: 'maxTickDrift', type: 'int24' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdrawFromTick',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'tick', type: 'int24' },
      { name: 'side', type: 'uint8' },
      { name: 'encryptedAmount', type: 'bytes' }, // InEuint128
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claimProceeds',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'tick', type: 'int24' },
      { name: 'side', type: 'uint8' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'exit',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'tick', type: 'int24' },
      { name: 'side', type: 'uint8' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // ═══════════════════════════════════════════════════════════════════════
  //                         AMM SWAP FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════
  {
    type: 'function',
    name: 'swapExactInput',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'swapEncrypted',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'direction', type: 'bytes' }, // InEbool
      { name: 'encryptedAmountIn', type: 'bytes' }, // InEuint128
      { name: 'encryptedAmountOutMin', type: 'bytes' }, // InEuint128
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // ═══════════════════════════════════════════════════════════════════════
  //                        LIQUIDITY FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════
  {
    type: 'function',
    name: 'addLiquidity',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
    outputs: [{ name: 'lpAmount', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'removeLiquidity',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'lpAmount', type: 'uint256' },
    ],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'addLiquidityEncrypted',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'amount0', type: 'bytes' }, // InEuint128
      { name: 'amount1', type: 'bytes' }, // InEuint128
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'removeLiquidityEncrypted',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'lpAmount', type: 'bytes' }, // InEuint128
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // ═══════════════════════════════════════════════════════════════════════
  //                           CONSTANTS
  // ═══════════════════════════════════════════════════════════════════════
  {
    type: 'function',
    name: 'TICK_SPACING',
    inputs: [],
    outputs: [{ name: '', type: 'int24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'MAX_PROTOCOL_FEE_BPS',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

// BucketSide enum values
export const BucketSide = {
  BUY: 0,
  SELL: 1,
} as const;

export type BucketSideType = (typeof BucketSide)[keyof typeof BucketSide];
