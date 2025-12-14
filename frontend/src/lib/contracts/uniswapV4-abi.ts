/**
 * Uniswap v4 ABI - Native ERC:ERC Pools
 *
 * For ERC20:ERC20 pools, we use standard Uniswap v4 without FHE hooks.
 * This provides cheaper, faster swaps for non-private token pairs.
 *
 * Key contracts:
 * - PoolManager: Singleton managing all pool state
 * - UniversalRouter: Entry point for swaps
 * - PositionManager: LP position management (ERC-721)
 */

// PoolKey struct - identifies a Uniswap v4 pool
export interface PoolKey {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

// SwapParams for direct PoolManager interaction
export interface SwapParams {
  zeroForOne: boolean;
  amountSpecified: bigint; // Negative for exact input, positive for exact output
  sqrtPriceLimitX96: bigint;
}

// Uniswap v4 PoolManager ABI (subset for reads)
export const UNISWAP_V4_POOL_MANAGER_ABI = [
  // Get pool state
  {
    type: "function",
    name: "getSlot0",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" }
    ],
    stateMutability: "view"
  },
  // Get pool liquidity
  {
    type: "function",
    name: "getLiquidity",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [{ name: "", type: "uint128" }],
    stateMutability: "view"
  },
  // Get reserves (via extsload)
  {
    type: "function",
    name: "extsload",
    inputs: [{ name: "slot", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view"
  },
  // Events
  {
    type: "event",
    name: "Swap",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "amount0", type: "int128", indexed: false },
      { name: "amount1", type: "int128", indexed: false },
      { name: "sqrtPriceX96", type: "uint160", indexed: false },
      { name: "liquidity", type: "uint128", indexed: false },
      { name: "tick", type: "int24", indexed: false },
      { name: "fee", type: "uint24", indexed: false }
    ]
  },
  {
    type: "event",
    name: "ModifyLiquidity",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "tickLower", type: "int24", indexed: false },
      { name: "tickUpper", type: "int24", indexed: false },
      { name: "liquidityDelta", type: "int256", indexed: false },
      { name: "salt", type: "bytes32", indexed: false }
    ]
  }
] as const;

// Universal Router ABI (for executing swaps)
export const UNISWAP_V4_UNIVERSAL_ROUTER_ABI = [
  // Execute commands (main entry point)
  {
    type: "function",
    name: "execute",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  // Execute with callback
  {
    type: "function",
    name: "execute",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" }
    ],
    outputs: [],
    stateMutability: "payable"
  }
] as const;

// Position Manager ABI (for LP operations)
export const UNISWAP_V4_POSITION_MANAGER_ABI = [
  // Mint new position
  {
    type: "function",
    name: "mint",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "poolKey", type: "tuple", components: [
            { name: "currency0", type: "address" },
            { name: "currency1", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "tickSpacing", type: "int24" },
            { name: "hooks", type: "address" }
          ]},
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "liquidity", type: "uint256" },
          { name: "amount0Max", type: "uint256" },
          { name: "amount1Max", type: "uint256" },
          { name: "owner", type: "address" },
          { name: "hookData", type: "bytes" }
        ]
      }
    ],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "liquidity", type: "uint128" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" }
    ],
    stateMutability: "payable"
  },
  // Increase liquidity
  {
    type: "function",
    name: "increaseLiquidity",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "liquidity", type: "uint256" },
      { name: "amount0Max", type: "uint256" },
      { name: "amount1Max", type: "uint256" },
      { name: "hookData", type: "bytes" }
    ],
    outputs: [
      { name: "liquidity", type: "uint128" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" }
    ],
    stateMutability: "payable"
  },
  // Decrease liquidity
  {
    type: "function",
    name: "decreaseLiquidity",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "liquidity", type: "uint256" },
      { name: "amount0Min", type: "uint256" },
      { name: "amount1Min", type: "uint256" },
      { name: "hookData", type: "bytes" }
    ],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" }
    ],
    stateMutability: "nonpayable"
  },
  // Burn position (remove all liquidity)
  {
    type: "function",
    name: "burn",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "amount0Min", type: "uint256" },
      { name: "amount1Min", type: "uint256" },
      { name: "hookData", type: "bytes" }
    ],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" }
    ],
    stateMutability: "nonpayable"
  },
  // Get position info
  {
    type: "function",
    name: "getPositionInfo",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "poolKey", type: "tuple", components: [
        { name: "currency0", type: "address" },
        { name: "currency1", type: "address" },
        { name: "fee", type: "uint24" },
        { name: "tickSpacing", type: "int24" },
        { name: "hooks", type: "address" }
      ]},
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "liquidity", type: "uint128" }
    ],
    stateMutability: "view"
  },
  // ERC-721 functions
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "ownerOf",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "tokenOfOwnerByIndex",
    inputs: [
      { name: "owner", type: "address" },
      { name: "index", type: "uint256" }
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view"
  }
] as const;

// Command bytes for Universal Router
export const UNIVERSAL_ROUTER_COMMANDS = {
  // V4 specific commands
  V4_SWAP: 0x10,
  V4_POSITION_MANAGER_CALL: 0x11,
  // Settlement commands
  SETTLE: 0x0c,
  SETTLE_ALL: 0x0d,
  TAKE: 0x0e,
  TAKE_ALL: 0x0f,
  // Permit2 commands
  PERMIT2_PERMIT: 0x0a,
  PERMIT2_TRANSFER_FROM: 0x0b,
} as const;

// V4Router action types (used within V4_SWAP command)
export const V4_ROUTER_ACTIONS = {
  SWAP_EXACT_IN_SINGLE: 0x00,
  SWAP_EXACT_IN: 0x01,
  SWAP_EXACT_OUT_SINGLE: 0x02,
  SWAP_EXACT_OUT: 0x03,
} as const;

// Default pool parameters for native ERC:ERC pools
export const NATIVE_POOL_DEFAULTS = {
  FEE: 3000, // 0.3%
  TICK_SPACING: 60,
  HOOKS: '0x0000000000000000000000000000000000000000' as `0x${string}`, // No hooks
} as const;

/**
 * Compute Uniswap v4 pool ID from PoolKey
 * poolId = keccak256(abi.encode(poolKey))
 */
export function computePoolId(poolKey: PoolKey): `0x${string}` {
  // Note: This is a simplified version. In production, use viem's encodeAbiParameters
  // The actual computation needs proper ABI encoding of the PoolKey struct
  const { keccak256, encodeAbiParameters } = require('viem');

  const encoded = encodeAbiParameters(
    [
      { type: 'address', name: 'currency0' },
      { type: 'address', name: 'currency1' },
      { type: 'uint24', name: 'fee' },
      { type: 'int24', name: 'tickSpacing' },
      { type: 'address', name: 'hooks' },
    ],
    [
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.tickSpacing,
      poolKey.hooks,
    ]
  );

  return keccak256(encoded);
}
