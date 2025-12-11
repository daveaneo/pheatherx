/**
 * FheatherXv6 ABI - Multi-pool FHE-enabled DEX Hook
 *
 * Key v6 Features:
 * - Multi-pool support (ERC:ERC, FHE:FHE, ERC:FHE, FHE:ERC)
 * - Plaintext and encrypted function variants
 * - Limit orders with bucket-based fills
 * - Proper V4 settlement via take()/settle()
 */

export const FHEATHERX_V6_ABI = [
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
    name: "FEE_CHANGE_DELAY",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "MAX_TICK",
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

  // ============ Swap Functions ============
  // swapForPool() - Plaintext swap for specific pool
  {
    type: "function",
    name: "swapForPool",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "zeroForOne", type: "bool" },
      { name: "amountIn", type: "uint256" },
      { name: "minAmountOut", type: "uint256" }
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "nonpayable"
  },
  // swapEncrypted() - Encrypted swap (hides direction, amount, and minOutput)
  {
    type: "function",
    name: "swapEncrypted",
    inputs: [
      { name: "poolId", type: "bytes32" },
      {
        name: "direction",
        type: "tuple",
        components: [
          { name: "ctHash", type: "uint256" },
          { name: "securityZone", type: "uint8" },
          { name: "utype", type: "uint8" },
          { name: "signature", type: "bytes" }
        ]
      },
      {
        name: "amountIn",
        type: "tuple",
        components: [
          { name: "ctHash", type: "uint256" },
          { name: "securityZone", type: "uint8" },
          { name: "utype", type: "uint8" },
          { name: "signature", type: "bytes" }
        ]
      },
      {
        name: "minOutput",
        type: "tuple",
        components: [
          { name: "ctHash", type: "uint256" },
          { name: "securityZone", type: "uint8" },
          { name: "utype", type: "uint8" },
          { name: "signature", type: "bytes" }
        ]
      }
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "nonpayable"
  },

  // ============ Liquidity Functions ============
  // addLiquidity() - Plaintext liquidity addition
  {
    type: "function",
    name: "addLiquidity",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" }
    ],
    outputs: [{ name: "lpAmount", type: "uint256" }],
    stateMutability: "nonpayable"
  },
  // addLiquidityEncrypted() - Encrypted liquidity (requires FHE:FHE pool)
  {
    type: "function",
    name: "addLiquidityEncrypted",
    inputs: [
      { name: "poolId", type: "bytes32" },
      {
        name: "amount0",
        type: "tuple",
        components: [
          { name: "ctHash", type: "uint256" },
          { name: "securityZone", type: "uint8" },
          { name: "utype", type: "uint8" },
          { name: "signature", type: "bytes" }
        ]
      },
      {
        name: "amount1",
        type: "tuple",
        components: [
          { name: "ctHash", type: "uint256" },
          { name: "securityZone", type: "uint8" },
          { name: "utype", type: "uint8" },
          { name: "signature", type: "bytes" }
        ]
      }
    ],
    outputs: [{ name: "lpAmount", type: "uint256" }],
    stateMutability: "nonpayable"
  },
  // removeLiquidity() - Plaintext liquidity removal
  {
    type: "function",
    name: "removeLiquidity",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "lpAmount", type: "uint256" }
    ],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" }
    ],
    stateMutability: "nonpayable"
  },
  // removeLiquidityEncrypted() - Encrypted liquidity removal (requires FHE:FHE pool)
  {
    type: "function",
    name: "removeLiquidityEncrypted",
    inputs: [
      { name: "poolId", type: "bytes32" },
      {
        name: "lpAmount",
        type: "tuple",
        components: [
          { name: "ctHash", type: "uint256" },
          { name: "securityZone", type: "uint8" },
          { name: "utype", type: "uint8" },
          { name: "signature", type: "bytes" }
        ]
      }
    ],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" }
    ],
    stateMutability: "nonpayable"
  },

  // ============ Limit Order Functions ============
  // deposit() - Place limit order (input token must be FHERC20)
  {
    type: "function",
    name: "deposit",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "tick", type: "int24" },
      { name: "side", type: "uint8" },  // BucketSide: 0=BUY, 1=SELL
      {
        name: "encryptedAmount",
        type: "tuple",
        components: [
          { name: "ctHash", type: "uint256" },
          { name: "securityZone", type: "uint8" },
          { name: "utype", type: "uint8" },
          { name: "signature", type: "bytes" }
        ]
      },
      { name: "deadline", type: "uint256" },
      { name: "maxTickDrift", type: "int24" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  // withdraw() - Withdraw unfilled order amount
  {
    type: "function",
    name: "withdraw",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "tick", type: "int24" },
      { name: "side", type: "uint8" },
      {
        name: "encryptedAmount",
        type: "tuple",
        components: [
          { name: "ctHash", type: "uint256" },
          { name: "securityZone", type: "uint8" },
          { name: "utype", type: "uint8" },
          { name: "signature", type: "bytes" }
        ]
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  // claim() - Claim filled order proceeds
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

  // ============ View Functions - Pool State ============
  {
    type: "function",
    name: "getPoolState",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "token0IsFherc20", type: "bool" },
      { name: "token1IsFherc20", type: "bool" },
      { name: "initialized", type: "bool" },
      { name: "maxBucketsPerSwap", type: "uint256" },
      { name: "protocolFeeBps", type: "uint256" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "getPoolReserves",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "_reserve0", type: "uint256" },
      { name: "_reserve1", type: "uint256" },
      { name: "lpSupply", type: "uint256" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "getReserves",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "r0", type: "uint256" },
      { name: "r1", type: "uint256" }
    ],
    stateMutability: "view"
  },

  // ============ View Functions - Tick/Price ============
  {
    type: "function",
    name: "getCurrentTickForPool",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ name: "", type: "int24" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "getTickPrice",
    inputs: [{ name: "tick", type: "int24" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "tickPrices",
    inputs: [{ name: "", type: "int24" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view"
  },

  // ============ View Functions - Quote ============
  {
    type: "function",
    name: "getQuoteForPool",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "zeroForOne", type: "bool" },
      { name: "amountIn", type: "uint256" }
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view"
  },

  // ============ View Functions - Orders ============
  {
    type: "function",
    name: "hasOrdersAtTick",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "tick", type: "int24" },
      { name: "side", type: "uint8" }
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "hasActiveOrders",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "tick", type: "int24" },
      { name: "side", type: "uint8" }
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "lastProcessedTick",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "int24" }],
    stateMutability: "view"
  },

  // ============ View Functions - Positions ============
  {
    type: "function",
    name: "lpBalances",
    inputs: [
      { name: "", type: "bytes32" },
      { name: "", type: "address" }
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "encLpBalances",
    inputs: [
      { name: "", type: "bytes32" },
      { name: "", type: "address" }
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "totalLpSupply",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "positions",
    inputs: [
      { name: "", type: "bytes32" },
      { name: "", type: "address" },
      { name: "", type: "int24" },
      { name: "", type: "uint8" }
    ],
    outputs: [
      { name: "shares", type: "uint256" },
      { name: "proceedsPerShareSnapshot", type: "uint256" },
      { name: "filledPerShareSnapshot", type: "uint256" },
      { name: "realizedProceeds", type: "uint256" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "buckets",
    inputs: [
      { name: "", type: "bytes32" },
      { name: "", type: "int24" },
      { name: "", type: "uint8" }
    ],
    outputs: [
      { name: "totalShares", type: "uint256" },
      { name: "liquidity", type: "uint256" },
      { name: "proceedsPerShare", type: "uint256" },
      { name: "filledPerShare", type: "uint256" },
      { name: "initialized", type: "bool" }
    ],
    stateMutability: "view"
  },

  // ============ Admin Functions ============
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "paused",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
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
    name: "feeCollector",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "poolManager",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view"
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
    name: "setMaxBucketsPerSwap",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "_maxBuckets", type: "uint256" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "queueProtocolFee",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "_feeBps", type: "uint256" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "applyProtocolFee",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable"
  },
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
    name: "transferOwnership",
    inputs: [{ name: "newOwner", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "renounceOwnership",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "trySyncReserves",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable"
  },

  // ============ Events ============
  {
    type: "event",
    name: "Swap",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "zeroForOne", type: "bool", indexed: true },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "SwapEncrypted",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true }
    ]
  },
  {
    type: "event",
    name: "LiquidityAdded",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "amount0", type: "uint256", indexed: false },
      { name: "amount1", type: "uint256", indexed: false },
      { name: "lpAmount", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "LiquidityAddedEncrypted",
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
      { name: "user", type: "address", indexed: true },
      { name: "amount0", type: "uint256", indexed: false },
      { name: "amount1", type: "uint256", indexed: false },
      { name: "lpAmount", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "LiquidityRemovedEncrypted",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true }
    ]
  },
  {
    type: "event",
    name: "Deposit",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "tick", type: "int24", indexed: true },
      { name: "side", type: "uint8", indexed: false },
      { name: "amountHash", type: "bytes32", indexed: false }
    ]
  },
  {
    type: "event",
    name: "Withdraw",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "tick", type: "int24", indexed: true },
      { name: "side", type: "uint8", indexed: false },
      { name: "amountHash", type: "bytes32", indexed: false }
    ]
  },
  {
    type: "event",
    name: "Claim",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "tick", type: "int24", indexed: true },
      { name: "side", type: "uint8", indexed: false },
      { name: "amountHash", type: "bytes32", indexed: false }
    ]
  },
  {
    type: "event",
    name: "BucketFilled",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "tick", type: "int24", indexed: true },
      { name: "side", type: "uint8", indexed: false }
    ]
  },
  {
    type: "event",
    name: "PoolInitialized",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "token0", type: "address", indexed: false },
      { name: "token1", type: "address", indexed: false },
      { name: "token0IsFherc20", type: "bool", indexed: false },
      { name: "token1IsFherc20", type: "bool", indexed: false }
    ]
  },
  {
    type: "event",
    name: "ReservesSynced",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "reserve0", type: "uint256", indexed: false },
      { name: "reserve1", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "ReserveSyncRequested",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "blockNumber", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "ProtocolFeeQueued",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "newFeeBps", type: "uint256", indexed: false },
      { name: "effectiveTimestamp", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "ProtocolFeeApplied",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "newFeeBps", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "FeeCollectorUpdated",
    inputs: [{ name: "newCollector", type: "address", indexed: false }]
  },
  {
    type: "event",
    name: "Paused",
    inputs: [{ name: "account", type: "address", indexed: false }]
  },
  {
    type: "event",
    name: "Unpaused",
    inputs: [{ name: "account", type: "address", indexed: false }]
  },
  {
    type: "event",
    name: "OwnershipTransferred",
    inputs: [
      { name: "previousOwner", type: "address", indexed: true },
      { name: "newOwner", type: "address", indexed: true }
    ]
  },

  // ============ Errors ============
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "PoolNotInitialized", inputs: [] },
  { type: "error", name: "SlippageExceeded", inputs: [] },
  { type: "error", name: "InsufficientLiquidity", inputs: [] },
  { type: "error", name: "InvalidTick", inputs: [] },
  { type: "error", name: "InputTokenMustBeFherc20", inputs: [] },
  { type: "error", name: "BothTokensMustBeFherc20", inputs: [] },
  { type: "error", name: "DeadlineExpired", inputs: [] },
  { type: "error", name: "PriceMoved", inputs: [] },
  { type: "error", name: "FeeTooHigh", inputs: [] },
  { type: "error", name: "FeeChangeNotReady", inputs: [] },
  { type: "error", name: "NotPoolManager", inputs: [] },
  { type: "error", name: "EnforcedPause", inputs: [] },
  { type: "error", name: "ExpectedPause", inputs: [] },
  { type: "error", name: "HookNotImplemented", inputs: [] },
  { type: "error", name: "ReentrancyGuardReentrantCall", inputs: [] },
  {
    type: "error",
    name: "OwnableInvalidOwner",
    inputs: [{ name: "owner", type: "address" }]
  },
  {
    type: "error",
    name: "OwnableUnauthorizedAccount",
    inputs: [{ name: "account", type: "address" }]
  },
  {
    type: "error",
    name: "SafeERC20FailedOperation",
    inputs: [{ name: "token", type: "address" }]
  },
  {
    type: "error",
    name: "InvalidEncryptedInput",
    inputs: [
      { name: "got", type: "uint8" },
      { name: "expected", type: "uint8" }
    ]
  },
  {
    type: "error",
    name: "SecurityZoneOutOfBounds",
    inputs: [{ name: "value", type: "int32" }]
  }
] as const;

// Type exports for TypeScript support
export type InEuint128 = {
  ctHash: bigint;
  securityZone: number;
  utype: number;
  signature: `0x${string}`;
};

export type InEbool = {
  ctHash: bigint;
  securityZone: number;
  utype: number;
  signature: `0x${string}`;
};

// BucketSide enum
export const BucketSide = {
  BUY: 0,
  SELL: 1
} as const;

export type BucketSideType = typeof BucketSide[keyof typeof BucketSide];

// Default values for v6 parameters
export const V6_DEFAULTS = {
  DEADLINE_OFFSET: 3600, // 1 hour from now
  MAX_TICK_DRIFT: 10,    // Allow 10 tick drift
  MIN_TICK: -6000,
  MAX_TICK: 6000,
  TICK_SPACING: 60
} as const;
