export type OrderType = 'limit-buy' | 'limit-sell' | 'stop-loss' | 'take-profit';
export type OrderStatus = 'active' | 'filled' | 'cancelled' | 'slippage_failed';

export interface OrderInfo {
  orderId: bigint;
  owner: `0x${string}`;
  triggerTick: number;
  isBuyOrder: boolean;
  isStopOrder: boolean;
  status: OrderStatus;
  createdAt: number;
  filledAt?: number;
  cancelledAt?: number;
  txHash?: `0x${string}`;
}

/**
 * Derive human-readable order type from contract flags
 */
export function deriveOrderType(isBuyOrder: boolean, isStopOrder: boolean): OrderType {
  if (isBuyOrder && !isStopOrder) return 'limit-buy';
  if (!isBuyOrder && !isStopOrder) return 'limit-sell';
  if (isBuyOrder && isStopOrder) return 'stop-loss';
  return 'take-profit';
}

/**
 * Convert order type to contract flags
 *
 * In v6:
 * - BUY orders (side=0): User deposits token1 to buy token0 when price drops
 * - SELL orders (side=1): User deposits token0 to sell for token1 when price rises
 */
export function orderTypeToFlags(orderType: OrderType): {
  isBuyOrder: boolean;
  isStopOrder: boolean;
  depositToken: 'token0' | 'token1';
} {
  switch (orderType) {
    case 'limit-buy':
      // Buy token0 when price drops → deposit token1
      return { isBuyOrder: true, isStopOrder: false, depositToken: 'token1' };
    case 'limit-sell':
      // Sell token0 when price rises → deposit token0
      return { isBuyOrder: false, isStopOrder: false, depositToken: 'token0' };
    case 'stop-loss':
      // Stop-loss: Sell token0 if price drops → deposit token0
      return { isBuyOrder: false, isStopOrder: true, depositToken: 'token0' };
    case 'take-profit':
      // Take-profit: Sell token0 when price rises → deposit token0
      return { isBuyOrder: false, isStopOrder: true, depositToken: 'token0' };
  }
}

/**
 * Order type metadata for UI
 */
export const ORDER_TYPE_INFO: Record<OrderType, {
  label: string;
  icon: string;
  description: string;
  triggerDirection: 'below' | 'above';
}> = {
  'limit-buy': {
    label: 'Limit Buy',
    icon: '📈',
    description: 'Buy when price drops to target',
    triggerDirection: 'below',
  },
  'limit-sell': {
    label: 'Limit Sell',
    icon: '📉',
    description: 'Sell when price rises to target',
    triggerDirection: 'above',
  },
  'stop-loss': {
    label: 'Stop Loss',
    icon: '🛡️',
    description: 'Sell if price drops to limit loss',
    triggerDirection: 'below',
  },
  'take-profit': {
    label: 'Take Profit',
    icon: '💰',
    description: 'Sell when price rises to lock profit',
    triggerDirection: 'above',
  },
};

export const ORDER_TYPES: OrderType[] = ['limit-buy', 'limit-sell', 'stop-loss', 'take-profit'];

/**
 * Derive order status from events
 */
export function deriveOrderStatus(
  orderId: bigint,
  placedEvents: { orderId: bigint }[],
  filledEvents: { orderId: bigint }[],
  cancelledEvents: { orderId: bigint }[]
): OrderStatus {
  const cancelEvent = cancelledEvents.find(e => e.orderId === orderId);
  if (cancelEvent) {
    return 'cancelled';
  }

  const fillEvent = filledEvents.find(e => e.orderId === orderId);
  if (fillEvent) {
    return 'filled';
  }

  const placedEvent = placedEvents.find(e => e.orderId === orderId);
  if (placedEvent) {
    return 'active';
  }

  return 'active';
}

/**
 * Filter orders by status
 */
export function filterOrdersByStatus(
  orders: OrderInfo[],
  statuses: OrderStatus[]
): OrderInfo[] {
  return orders.filter(o => statuses.includes(o.status));
}

/**
 * Get active orders only
 */
export function getActiveOrders(orders: OrderInfo[]): OrderInfo[] {
  return filterOrdersByStatus(orders, ['active']);
}

/**
 * Get historical orders (non-active)
 */
export function getHistoricalOrders(orders: OrderInfo[]): OrderInfo[] {
  return filterOrdersByStatus(orders, ['filled', 'cancelled', 'slippage_failed']);
}
