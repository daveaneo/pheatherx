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
 */
export function orderTypeToFlags(orderType: OrderType): { isBuyOrder: boolean; isStopOrder: boolean } {
  switch (orderType) {
    case 'limit-buy':
      return { isBuyOrder: true, isStopOrder: false };
    case 'limit-sell':
      return { isBuyOrder: false, isStopOrder: false };
    case 'stop-loss':
      return { isBuyOrder: true, isStopOrder: true };
    case 'take-profit':
      return { isBuyOrder: false, isStopOrder: true };
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
