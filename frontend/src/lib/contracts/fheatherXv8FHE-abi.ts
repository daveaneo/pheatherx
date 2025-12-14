/**
 * FheatherXv8FHE ABI - Full Privacy FHE:FHE Pools
 *
 * Key v8FHE Features:
 * - FHE:FHE pools only (both tokens must be FHERC20)
 * - Momentum closure with binary search
 * - Virtual slicing for fair allocation
 * - Encrypted-only liquidity functions
 * - Binary search reserve sync
 */

// InEuint128 tuple type for encrypted uint128 values
export const IN_EUINT128_TUPLE = {
  type: "tuple",
  components: [
    { name: "ctHash", type: "uint256" },
    { name: "securityZone", type: "uint8" },
    { name: "utype", type: "uint8" },
    { name: "signature", type: "bytes" }
  ]
} as const;

// BucketSide enum
export const BucketSide = {
  BUY: 0,
  SELL: 1
} as const;

export type BucketSideType = typeof BucketSide[keyof typeof BucketSide];

// Re-export types from v6 for compatibility
export type { InEuint128, InEbool } from './fheatherXv6Abi';

export const FHEATHERX_V8_FHE_ABI = [
  // ============ Constructor ============
  {
    type: "constructor",
    inputs: [
      { name: "_poolManager", type: "address" },
      { name: "_owner", type: "address" },
      { name: "_swapFeeBps", type: "uint256" }
    ],
    stateMutability: "nonpayable"
  },

  // ============ Constants ============
  {
    type: "function",
    name: "PRECISION",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "TICK_SPACING",
    inputs: [],
    outputs: [{ name: "", type: "int24" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "MIN_TICK",
    inputs: [],
    outputs: [{ name: "", type: "int24" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "MAX_TICK",
    inputs: [],
    outputs: [{ name: "", type: "int24" }],
    stateMutability: "view"
  },

  // ============ State Variables ============
  {
    type: "function",
    name: "feeCollector",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "swapFeeBps",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "lastProcessedTick",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ name: "", type: "int24" }],
    stateMutability: "view"
  },

  // ============ Pool State ============
  {
    type: "function",
    name: "poolStates",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "initialized", type: "bool" },
      { name: "protocolFeeBps", type: "uint256" }
    ],
    stateMutability: "view"
  },

  // ============ Pool Reserves ============
  {
    type: "function",
    name: "poolReserves",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "encReserve0", type: "uint256" },  // euint128 handle
      { name: "encReserve1", type: "uint256" },  // euint128 handle
      { name: "encTotalLpSupply", type: "uint256" },  // euint128 handle
      { name: "reserve0", type: "uint256" },
      { name: "reserve1", type: "uint256" },
      { name: "reserveBlockNumber", type: "uint256" },
      { name: "nextRequestId", type: "uint256" },
      { name: "lastResolvedId", type: "uint256" }
    ],
    stateMutability: "view"
  },

  // ============ Buckets (Limit Orders) ============
  {
    type: "function",
    name: "buckets",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "tick", type: "int24" },
      { name: "side", type: "uint8" }
    ],
    outputs: [
      { name: "totalShares", type: "uint256" },  // euint128 handle
      { name: "liquidity", type: "uint256" },     // euint128 handle
      { name: "proceedsPerShare", type: "uint256" },  // euint128 handle
      { name: "filledPerShare", type: "uint256" },    // euint128 handle
      { name: "initialized", type: "bool" }
    ],
    stateMutability: "view"
  },

  // ============ User Positions ============
  {
    type: "function",
    name: "positions",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "user", type: "address" },
      { name: "tick", type: "int24" },
      { name: "side", type: "uint8" }
    ],
    outputs: [
      { name: "shares", type: "uint256" },  // euint128 handle
      { name: "proceedsPerShareSnapshot", type: "uint256" },  // euint128 handle
      { name: "filledPerShareSnapshot", type: "uint256" },    // euint128 handle
      { name: "realizedProceeds", type: "uint256" }           // euint128 handle
    ],
    stateMutability: "view"
  },

  // ============ LP Balances (Encrypted) ============
  {
    type: "function",
    name: "encLpBalances",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "user", type: "address" }
    ],
    outputs: [{ name: "", type: "uint256" }],  // euint128 handle
    stateMutability: "view"
  },

  // ============ Liquidity Functions (Encrypted Only) ============
  {
    type: "function",
    name: "addLiquidity",
    inputs: [
      { name: "poolId", type: "bytes32" },
      {
        name: "amount0",
        ...IN_EUINT128_TUPLE
      },
      {
        name: "amount1",
        ...IN_EUINT128_TUPLE
      }
    ],
    outputs: [{ name: "lpAmount", type: "uint256" }],  // euint128 handle
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "removeLiquidity",
    inputs: [
      { name: "poolId", type: "bytes32" },
      {
        name: "lpAmount",
        ...IN_EUINT128_TUPLE
      }
    ],
    outputs: [
      { name: "amount0", type: "uint256" },  // euint128 handle
      { name: "amount1", type: "uint256" }   // euint128 handle
    ],
    stateMutability: "nonpayable"
  },

  // ============ Limit Order Functions ============
  {
    type: "function",
    name: "deposit",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "tick", type: "int24" },
      { name: "side", type: "uint8" },
      {
        name: "encryptedAmount",
        ...IN_EUINT128_TUPLE
      },
      { name: "deadline", type: "uint256" },
      { name: "maxTickDrift", type: "int24" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "tick", type: "int24" },
      { name: "side", type: "uint8" },
      {
        name: "encryptedAmount",
        ...IN_EUINT128_TUPLE
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "claim",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "tick", type: "int24" },
      { name: "side", type: "uint8" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },

  // ============ View Functions ============
  {
    type: "function",
    name: "getReserves",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "reserve0", type: "uint256" },
      { name: "reserve1", type: "uint256" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "getCurrentTick",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ name: "", type: "int24" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "getQuote",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "zeroForOne", type: "bool" },
      { name: "amountIn", type: "uint256" }
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "view"
  },

  // ============ Reserve Sync ============
  {
    type: "function",
    name: "trySyncReserves",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "pendingDecrypts",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "requestId", type: "uint256" }
    ],
    outputs: [
      { name: "reserve0", type: "uint256" },  // euint128 handle
      { name: "reserve1", type: "uint256" },  // euint128 handle
      { name: "blockNumber", type: "uint256" }
    ],
    stateMutability: "view"
  },

  // ============ Admin Functions ============
  {
    type: "function",
    name: "pause",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "unpause",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "setFeeCollector",
    inputs: [{ name: "_feeCollector", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "setProtocolFee",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "_feeBps", type: "uint256" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },

  // ============ Events ============
  {
    type: "event",
    name: "PoolInitialized",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "token0", type: "address", indexed: false },
      { name: "token1", type: "address", indexed: false }
    ]
  },
  {
    type: "event",
    name: "SwapExecuted",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "zeroForOne", type: "bool", indexed: false }
    ]
  },
  {
    type: "event",
    name: "MomentumActivated",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "fromTick", type: "int24", indexed: false },
      { name: "toTick", type: "int24", indexed: false },
      { name: "bucketsActivated", type: "uint8", indexed: false }
    ]
  },
  {
    type: "event",
    name: "Deposit",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "tick", type: "int24", indexed: true },
      { name: "side", type: "uint8", indexed: false }
    ]
  },
  {
    type: "event",
    name: "Withdraw",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "tick", type: "int24", indexed: true },
      { name: "side", type: "uint8", indexed: false }
    ]
  },
  {
    type: "event",
    name: "Claim",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "tick", type: "int24", indexed: true },
      { name: "side", type: "uint8", indexed: false }
    ]
  },
  {
    type: "event",
    name: "LiquidityAdded",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true }
    ]
  },
  {
    type: "event",
    name: "LiquidityRemoved",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true }
    ]
  },
  {
    type: "event",
    name: "ReserveSyncRequested",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "requestId", type: "uint256", indexed: true },
      { name: "blockNumber", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "ReservesSynced",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "reserve0", type: "uint256", indexed: false },
      { name: "reserve1", type: "uint256", indexed: false },
      { name: "requestId", type: "uint256", indexed: true }
    ]
  },

  // ============ Errors ============
  {
    type: "error",
    name: "ZeroAmount",
    inputs: []
  },
  {
    type: "error",
    name: "PoolNotInitialized",
    inputs: []
  },
  {
    type: "error",
    name: "SlippageExceeded",
    inputs: []
  },
  {
    type: "error",
    name: "InsufficientLiquidity",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidTick",
    inputs: []
  },
  {
    type: "error",
    name: "DeadlineExpired",
    inputs: []
  },
  {
    type: "error",
    name: "PriceMoved",
    inputs: []
  },
  {
    type: "error",
    name: "FeeTooHigh",
    inputs: []
  },
  {
    type: "error",
    name: "NotFherc20Pair",
    inputs: []
  }
] as const;

// V8FHE defaults
export const V8_FHE_DEFAULTS = {
  DEADLINE_OFFSET: 3600,  // 1 hour
  MAX_TICK_DRIFT: 887272, // MAX_TICK - allows any price movement for limit orders
  TICK_SPACING: 60
} as const;
