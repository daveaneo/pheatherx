export const PHEATHERX_ABI = [
  // Events
  {
    type: 'event',
    name: 'Deposit',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Withdraw',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'OrderPlaced',
    inputs: [
      { name: 'orderId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'triggerTick', type: 'int24', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'OrderCancelled',
    inputs: [
      { name: 'orderId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'OrderFilled',
    inputs: [
      { name: 'orderId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'executor', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'ReserveSyncRequested',
    inputs: [{ name: 'blockNumber', type: 'uint256', indexed: false }],
  },
  {
    type: 'event',
    name: 'ReservesSynced',
    inputs: [
      { name: 'reserve0', type: 'uint256', indexed: false },
      { name: 'reserve1', type: 'uint256', indexed: false },
    ],
  },

  // View functions
  {
    type: 'function',
    name: 'getReserves',
    inputs: [],
    outputs: [
      { name: 'reserve0', type: 'uint256' },
      { name: 'reserve1', type: 'uint256' },
    ],
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
    name: 'getUserBalanceToken0',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }], // Returns euint128 handle
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getUserBalanceToken1',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }], // Returns euint128 handle
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getActiveOrders',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getOrderCount',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'hasOrdersAtTick',
    inputs: [{ name: 'tick', type: 'int24' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
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
    name: 'orders',
    inputs: [{ name: 'orderId', type: 'uint256' }],
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'triggerTick', type: 'int24' },
      { name: 'direction', type: 'uint256' }, // ebool handle
      { name: 'amount', type: 'uint256' }, // euint128 handle
      { name: 'minOutput', type: 'uint256' }, // euint128 handle
      { name: 'active', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'PROTOCOL_FEE',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },

  // User functions
  {
    type: 'function',
    name: 'deposit',
    inputs: [
      { name: 'isToken0', type: 'bool' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable', // Payable to support native ETH deposits
  },
  {
    type: 'function',
    name: 'withdraw',
    inputs: [
      { name: 'isToken0', type: 'bool' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'placeOrder',
    inputs: [
      { name: 'triggerTick', type: 'int24' },
      { name: 'direction', type: 'bytes' }, // InEbool
      { name: 'amount', type: 'bytes' }, // InEuint128
      { name: 'minOutput', type: 'bytes' }, // InEuint128
    ],
    outputs: [{ name: 'orderId', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'cancelOrder',
    inputs: [{ name: 'orderId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'forceSyncReserves',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;
