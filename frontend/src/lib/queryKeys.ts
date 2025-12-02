export const queryKeys = {
  // Pool data
  reserves: (hookAddress: string) => ['reserves', hookAddress] as const,
  poolMetrics: (hookAddress: string) => ['poolMetrics', hookAddress] as const,
  currentTick: (hookAddress: string) => ['currentTick', hookAddress] as const,

  // User data
  activeOrders: (address: string, hookAddress: string) =>
    ['activeOrders', address, hookAddress] as const,
  orderHistory: (address: string, hookAddress: string) =>
    ['orderHistory', address, hookAddress] as const,
  orderCount: (address: string, hookAddress: string) =>
    ['orderCount', address, hookAddress] as const,

  // Balances
  walletBalance: (address: string, tokenAddress: string) =>
    ['walletBalance', address, tokenAddress] as const,
  hookBalance: (address: string, hookAddress: string, isToken0: boolean) =>
    ['hookBalance', address, hookAddress, isToken0] as const,

  // Events
  userEvents: (address: string, hookAddress: string) =>
    ['userEvents', address, hookAddress] as const,
};

// Standalone exports for hooks that import individual keys
export const orderHistoryKey = (chainId: number, address?: `0x${string}`) =>
  ['orderHistory', chainId, address] as const;
