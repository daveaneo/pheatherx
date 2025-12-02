export interface OrderPlacedEvent {
  orderId: bigint;
  owner: `0x${string}`;
  triggerTick: number;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  timestamp?: number;
}

export interface OrderFilledEvent {
  orderId: bigint;
  owner: `0x${string}`;
  executor: `0x${string}`;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  timestamp?: number;
}

export interface OrderCancelledEvent {
  orderId: bigint;
  owner: `0x${string}`;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  timestamp?: number;
}

export interface DepositEvent {
  user: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
}

export interface WithdrawEvent {
  user: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
}
