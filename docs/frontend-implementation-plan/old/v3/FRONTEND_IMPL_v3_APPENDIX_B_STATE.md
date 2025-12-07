# Appendix B: State & Validation

**Parent Document:** [FRONTEND_IMPLEMENTATION_PLAN_v3.md](./FRONTEND_IMPLEMENTATION_PLAN_v3.md)

---

## Overview

This appendix defines the state management architecture and validation schemas, including new additions from the v2 audit:

- **Zod Validation Schemas** (NEW)
- **Order Status Derivation** (NEW)
- **Trigger Price Validation** (NEW)
- Zustand stores for client state
- TanStack Query configuration for server state

---

## 1. State Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        State Layers                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────┐    ┌──────────────────────┐          │
│  │   Server State       │    │   Client State       │          │
│  │   (TanStack Query)   │    │   (Zustand)          │          │
│  ├──────────────────────┤    ├──────────────────────┤          │
│  │ • Contract reads     │    │ • FHE session        │          │
│  │ • Event logs         │    │ • Revealed balances  │          │
│  │ • User orders        │    │ • UI preferences     │          │
│  │ • Pool reserves      │    │ • Pending txs        │          │
│  │ • Token balances     │    │ • Form state         │          │
│  └──────────────────────┘    └──────────────────────┘          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Validation Schemas (NEW)

### 2.1 Order Form Schema

```typescript
// src/lib/validation/orderSchema.ts

import { z } from 'zod';

export const ORDER_TYPES = ['limit-buy', 'limit-sell', 'stop-loss', 'take-profit'] as const;
export type OrderType = typeof ORDER_TYPES[number];

/**
 * Base order form schema
 */
export const orderFormSchema = z.object({
  orderType: z.enum(ORDER_TYPES, {
    required_error: 'Select an order type',
  }),

  triggerPrice: z
    .string()
    .min(1, 'Enter trigger price')
    .refine(
      (v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0,
      'Price must be greater than 0'
    ),

  amount: z
    .string()
    .min(1, 'Enter amount')
    .refine(
      (v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0,
      'Amount must be greater than 0'
    ),

  slippage: z
    .number()
    .min(0.01, 'Min slippage is 0.01%')
    .max(50, 'Max slippage is 50%'),
});

export type OrderFormValues = z.infer<typeof orderFormSchema>;

/**
 * Validate trigger price against current price based on order type
 */
export function validateTriggerPrice(
  orderType: OrderType,
  triggerPrice: number,
  currentPrice: number
): { valid: boolean; error?: string } {
  if (triggerPrice <= 0) {
    return { valid: false, error: 'Trigger price must be greater than 0' };
  }

  switch (orderType) {
    case 'limit-buy':
      // Limit buy: triggers when price drops to or below trigger
      if (triggerPrice >= currentPrice) {
        return {
          valid: false,
          error: `Limit buy trigger (${triggerPrice}) must be below current price (${currentPrice})`,
        };
      }
      break;

    case 'limit-sell':
      // Limit sell: triggers when price rises to or above trigger
      if (triggerPrice <= currentPrice) {
        return {
          valid: false,
          error: `Limit sell trigger (${triggerPrice}) must be above current price (${currentPrice})`,
        };
      }
      break;

    case 'stop-loss':
      // Stop loss: triggers when price drops to or below trigger (sell to prevent further loss)
      if (triggerPrice >= currentPrice) {
        return {
          valid: false,
          error: `Stop-loss trigger (${triggerPrice}) must be below current price (${currentPrice})`,
        };
      }
      break;

    case 'take-profit':
      // Take profit: triggers when price rises to or above trigger (sell to lock in profit)
      if (triggerPrice <= currentPrice) {
        return {
          valid: false,
          error: `Take-profit trigger (${triggerPrice}) must be above current price (${currentPrice})`,
        };
      }
      break;
  }

  return { valid: true };
}

/**
 * Combined validation for the full form
 */
export function validateOrderForm(
  values: OrderFormValues,
  currentPrice: number
): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  // Parse schema first
  const result = orderFormSchema.safeParse(values);
  if (!result.success) {
    result.error.errors.forEach((err) => {
      const path = err.path.join('.');
      errors[path] = err.message;
    });
    return { valid: false, errors };
  }

  // Validate trigger price
  const triggerValidation = validateTriggerPrice(
    values.orderType,
    parseFloat(values.triggerPrice),
    currentPrice
  );

  if (!triggerValidation.valid) {
    errors.triggerPrice = triggerValidation.error!;
    return { valid: false, errors };
  }

  return { valid: true, errors: {} };
}
```

### 2.2 Deposit Schema

```typescript
// src/lib/validation/depositSchema.ts

import { z } from 'zod';

export const depositFormSchema = z.object({
  amount: z
    .string()
    .min(1, 'Enter amount')
    .refine(
      (v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0,
      'Amount must be greater than 0'
    ),

  isToken0: z.boolean(),
});

export type DepositFormValues = z.infer<typeof depositFormSchema>;

/**
 * Validate deposit against wallet balance
 */
export function validateDeposit(
  amount: bigint,
  walletBalance: bigint
): { valid: boolean; error?: string } {
  if (amount <= 0n) {
    return { valid: false, error: 'Amount must be greater than 0' };
  }

  if (amount > walletBalance) {
    return { valid: false, error: 'Insufficient balance' };
  }

  return { valid: true };
}
```

### 2.3 Withdraw Schema

```typescript
// src/lib/validation/withdrawSchema.ts

import { z } from 'zod';

export const withdrawFormSchema = z.object({
  amount: z
    .string()
    .min(1, 'Enter amount')
    .refine(
      (v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0,
      'Amount must be greater than 0'
    ),

  isToken0: z.boolean(),
});

export type WithdrawFormValues = z.infer<typeof withdrawFormSchema>;

/**
 * Validate withdrawal against hook balance
 */
export function validateWithdraw(
  amount: bigint,
  hookBalance: bigint
): { valid: boolean; error?: string } {
  if (amount <= 0n) {
    return { valid: false, error: 'Amount must be greater than 0' };
  }

  if (amount > hookBalance) {
    return { valid: false, error: 'Insufficient balance in hook' };
  }

  return { valid: true };
}
```

### 2.4 Swap Schema

```typescript
// src/lib/validation/swapSchema.ts

import { z } from 'zod';

export const swapFormSchema = z.object({
  amountIn: z
    .string()
    .min(1, 'Enter amount')
    .refine(
      (v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0,
      'Amount must be greater than 0'
    ),

  zeroForOne: z.boolean(),

  slippage: z
    .number()
    .min(0.01, 'Min slippage is 0.01%')
    .max(50, 'Max slippage is 50%'),
});

export type SwapFormValues = z.infer<typeof swapFormSchema>;
```

---

## 3. Order Status Derivation (NEW)

### 3.1 Order Types and Status

```typescript
// src/lib/orders.ts

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
```

### 3.2 Event Types

```typescript
// src/types/events.ts

export interface OrderPlacedEvent {
  orderId: bigint;
  owner: `0x${string}`;
  triggerTick: number;
  isBuyOrder: boolean;
  isStopOrder: boolean;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  timestamp?: number;
}

export interface OrderFilledEvent {
  orderId: bigint;
  owner: `0x${string}`;
  amountIn: bigint;
  amountOut: bigint;
  executedTick: number;
  slippageFailed?: boolean; // If contract provides this
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
```

### 3.3 Status Derivation Logic

```typescript
// src/lib/orders.ts (continued)

import type { OrderPlacedEvent, OrderFilledEvent, OrderCancelledEvent } from '@/types/events';

/**
 * Derive order status from events
 *
 * Priority:
 * 1. Check for cancellation (terminal)
 * 2. Check for fill (terminal, may include slippage failure)
 * 3. If only placed, still active
 */
export function deriveOrderStatus(
  orderId: bigint,
  placedEvents: OrderPlacedEvent[],
  filledEvents: OrderFilledEvent[],
  cancelledEvents: OrderCancelledEvent[]
): OrderStatus {
  // Check if this order was cancelled
  const cancelEvent = cancelledEvents.find(e => e.orderId === orderId);
  if (cancelEvent) {
    return 'cancelled';
  }

  // Check if this order was filled
  const fillEvent = filledEvents.find(e => e.orderId === orderId);
  if (fillEvent) {
    // Check for slippage failure if the contract emits this info
    if (fillEvent.slippageFailed) {
      return 'slippage_failed';
    }
    return 'filled';
  }

  // Check if order was placed
  const placedEvent = placedEvents.find(e => e.orderId === orderId);
  if (placedEvent) {
    return 'active';
  }

  // Order not found - should not happen in normal flow
  return 'active';
}

/**
 * Build complete order info from events
 */
export function buildOrderInfo(
  orderId: bigint,
  placedEvents: OrderPlacedEvent[],
  filledEvents: OrderFilledEvent[],
  cancelledEvents: OrderCancelledEvent[]
): OrderInfo | null {
  const placedEvent = placedEvents.find(e => e.orderId === orderId);
  if (!placedEvent) return null;

  const status = deriveOrderStatus(orderId, placedEvents, filledEvents, cancelledEvents);

  const fillEvent = filledEvents.find(e => e.orderId === orderId);
  const cancelEvent = cancelledEvents.find(e => e.orderId === orderId);

  return {
    orderId,
    owner: placedEvent.owner,
    triggerTick: placedEvent.triggerTick,
    isBuyOrder: placedEvent.isBuyOrder,
    isStopOrder: placedEvent.isStopOrder,
    status,
    createdAt: placedEvent.timestamp ?? Date.now(),
    filledAt: fillEvent?.timestamp,
    cancelledAt: cancelEvent?.timestamp,
    txHash: placedEvent.transactionHash,
  };
}

/**
 * Build all orders for a user from events
 */
export function buildUserOrders(
  userAddress: `0x${string}`,
  placedEvents: OrderPlacedEvent[],
  filledEvents: OrderFilledEvent[],
  cancelledEvents: OrderCancelledEvent[]
): OrderInfo[] {
  // Filter to user's placed events
  const userPlaced = placedEvents.filter(
    e => e.owner.toLowerCase() === userAddress.toLowerCase()
  );

  // Build order info for each
  const orders: OrderInfo[] = [];
  for (const placed of userPlaced) {
    const orderInfo = buildOrderInfo(
      placed.orderId,
      placedEvents,
      filledEvents,
      cancelledEvents
    );
    if (orderInfo) {
      orders.push(orderInfo);
    }
  }

  // Sort by creation time (newest first)
  return orders.sort((a, b) => b.createdAt - a.createdAt);
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
```

### 3.4 Order History Hook

```typescript
// src/hooks/useOrderHistory.ts

'use client';

import { useMemo } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { FHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { queryKeys } from '@/lib/queryKeys';
import {
  buildUserOrders,
  getActiveOrders,
  getHistoricalOrders,
  type OrderInfo,
} from '@/lib/orders';
import type {
  OrderPlacedEvent,
  OrderFilledEvent,
  OrderCancelledEvent,
} from '@/types/events';

interface UseOrderHistoryResult {
  orders: OrderInfo[];
  activeOrders: OrderInfo[];
  historicalOrders: OrderInfo[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useOrderHistory(): UseOrderHistoryResult {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const hookAddress = FHEATHERX_ADDRESSES[chainId];

  // Fetch all events
  const { data: events, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.userEvents(address!, hookAddress),
    queryFn: async () => {
      if (!publicClient || !address) return null;

      // Fetch events in parallel
      const [placedLogs, filledLogs, cancelledLogs] = await Promise.all([
        publicClient.getContractEvents({
          address: hookAddress,
          abi: FHEATHERX_ABI,
          eventName: 'OrderPlaced',
          args: { owner: address },
          fromBlock: 'earliest',
        }),
        publicClient.getContractEvents({
          address: hookAddress,
          abi: FHEATHERX_ABI,
          eventName: 'OrderFilled',
          args: { owner: address },
          fromBlock: 'earliest',
        }),
        publicClient.getContractEvents({
          address: hookAddress,
          abi: FHEATHERX_ABI,
          eventName: 'OrderCancelled',
          args: { owner: address },
          fromBlock: 'earliest',
        }),
      ]);

      // Parse events
      const placedEvents: OrderPlacedEvent[] = placedLogs.map(log => ({
        orderId: log.args.orderId!,
        owner: log.args.owner!,
        triggerTick: log.args.triggerTick!,
        isBuyOrder: log.args.isBuyOrder!,
        isStopOrder: log.args.isStopOrder!,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
      }));

      const filledEvents: OrderFilledEvent[] = filledLogs.map(log => ({
        orderId: log.args.orderId!,
        owner: log.args.owner!,
        amountIn: log.args.amountIn!,
        amountOut: log.args.amountOut!,
        executedTick: log.args.executedTick!,
        slippageFailed: log.args.slippageFailed,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
      }));

      const cancelledEvents: OrderCancelledEvent[] = cancelledLogs.map(log => ({
        orderId: log.args.orderId!,
        owner: log.args.owner!,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
      }));

      return { placedEvents, filledEvents, cancelledEvents };
    },
    enabled: !!address && !!hookAddress && !!publicClient,
    staleTime: 30_000,
  });

  // Derive orders from events
  const orders = useMemo(() => {
    if (!events || !address) return [];
    return buildUserOrders(
      address,
      events.placedEvents,
      events.filledEvents,
      events.cancelledEvents
    );
  }, [events, address]);

  const activeOrders = useMemo(() => getActiveOrders(orders), [orders]);
  const historicalOrders = useMemo(() => getHistoricalOrders(orders), [orders]);

  return {
    orders,
    activeOrders,
    historicalOrders,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}
```

---

## 4. Zustand Stores

### 4.1 FHE Store

```typescript
// src/stores/fheStore.ts

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { BALANCE_CACHE_TTL_MS } from '@/lib/constants';

type SessionStatus = 'disconnected' | 'initializing' | 'ready' | 'expired' | 'error';

interface RevealedBalance {
  value: bigint;
  revealedAt: number;
}

interface FheState {
  // Session state
  sessionStatus: SessionStatus;
  sessionError: string | null;
  sessionExpiresAt: number | null;

  // Revealed balances cache (key -> value as string for serialization)
  revealedBalances: Record<string, { value: string; revealedAt: number }>;

  // Actions
  setSessionStatus: (status: SessionStatus, error?: string) => void;
  setSessionExpiry: (expiresAt: number) => void;
  cacheBalance: (key: string, value: bigint) => void;
  getCachedBalance: (key: string) => RevealedBalance | null;
  clearBalances: () => void;
  reset: () => void;
}

export const useFheStore = create<FheState>()(
  persist(
    immer((set, get) => ({
      sessionStatus: 'disconnected',
      sessionError: null,
      sessionExpiresAt: null,
      revealedBalances: {},

      setSessionStatus: (status, error) =>
        set(state => {
          state.sessionStatus = status;
          state.sessionError = error || null;
        }),

      setSessionExpiry: expiresAt =>
        set(state => {
          state.sessionExpiresAt = expiresAt;
        }),

      cacheBalance: (key, value) =>
        set(state => {
          state.revealedBalances[key] = {
            value: value.toString(),
            revealedAt: Date.now(),
          };
        }),

      getCachedBalance: key => {
        const cached = get().revealedBalances[key];
        if (!cached) return null;
        if (Date.now() - cached.revealedAt > BALANCE_CACHE_TTL_MS) return null;
        return {
          value: BigInt(cached.value),
          revealedAt: cached.revealedAt,
        };
      },

      clearBalances: () =>
        set(state => {
          state.revealedBalances = {};
        }),

      reset: () =>
        set(state => {
          state.sessionStatus = 'disconnected';
          state.sessionError = null;
          state.sessionExpiresAt = null;
          state.revealedBalances = {};
        }),
    })),
    {
      name: 'fheatherx-fhe',
      storage: createJSONStorage(() => sessionStorage), // Security: use sessionStorage
      partialize: state => ({
        // Only persist revealed balances, NOT session
        revealedBalances: state.revealedBalances,
      }),
    }
  )
);
```

### 4.2 Orders Store

```typescript
// src/stores/ordersStore.ts

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

interface PendingOrder {
  tempId: string;
  triggerTick: number;
  orderType: string;
  amount: string;
  createdAt: number;
  txHash?: `0x${string}`;
}

interface OrdersState {
  // Optimistic updates
  pendingOrders: PendingOrder[];
  pendingCancellations: bigint[];

  // Actions
  addPendingOrder: (order: Omit<PendingOrder, 'tempId' | 'createdAt'>) => string;
  updatePendingOrderHash: (tempId: string, txHash: `0x${string}`) => void;
  removePendingOrder: (tempId: string) => void;
  addPendingCancellation: (orderId: bigint) => void;
  removePendingCancellation: (orderId: bigint) => void;
  clearPending: () => void;
}

export const useOrdersStore = create<OrdersState>()(
  immer((set, get) => ({
    pendingOrders: [],
    pendingCancellations: [],

    addPendingOrder: order => {
      const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      set(state => {
        state.pendingOrders.push({
          ...order,
          tempId,
          createdAt: Date.now(),
        });
      });
      return tempId;
    },

    updatePendingOrderHash: (tempId, txHash) =>
      set(state => {
        const order = state.pendingOrders.find(o => o.tempId === tempId);
        if (order) {
          order.txHash = txHash;
        }
      }),

    removePendingOrder: tempId =>
      set(state => {
        state.pendingOrders = state.pendingOrders.filter(o => o.tempId !== tempId);
      }),

    addPendingCancellation: orderId =>
      set(state => {
        if (!state.pendingCancellations.includes(orderId)) {
          state.pendingCancellations.push(orderId);
        }
      }),

    removePendingCancellation: orderId =>
      set(state => {
        state.pendingCancellations = state.pendingCancellations.filter(
          id => id !== orderId
        );
      }),

    clearPending: () =>
      set(state => {
        state.pendingOrders = [];
        state.pendingCancellations = [];
      }),
  }))
);
```

### 4.3 UI Store

```typescript
// src/stores/uiStore.ts

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SLIPPAGE } from '@/lib/constants';

interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: 'default' | 'success' | 'error' | 'warning';
  duration?: number;
}

interface UiState {
  // Preferences
  slippageTolerance: number;
  expertMode: boolean;

  // Modal states
  activeModal: string | null;
  modalData: Record<string, unknown>;

  // Toast notifications
  toasts: Toast[];

  // Actions
  setSlippage: (slippage: number) => void;
  setExpertMode: (enabled: boolean) => void;
  openModal: (modalId: string, data?: Record<string, unknown>) => void;
  closeModal: () => void;
  addToast: (toast: Omit<Toast, 'id'>) => string;
  removeToast: (id: string) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      slippageTolerance: DEFAULT_SLIPPAGE,
      expertMode: false,
      activeModal: null,
      modalData: {},
      toasts: [],

      setSlippage: slippage => set({ slippageTolerance: slippage }),

      setExpertMode: enabled => set({ expertMode: enabled }),

      openModal: (modalId, data = {}) =>
        set({ activeModal: modalId, modalData: data }),

      closeModal: () => set({ activeModal: null, modalData: {} }),

      addToast: toast => {
        const id = `toast-${Date.now()}`;
        set(state => ({
          toasts: [...state.toasts, { ...toast, id }],
        }));

        const duration = toast.duration ?? 5000;
        if (duration > 0) {
          setTimeout(() => {
            get().removeToast(id);
          }, duration);
        }

        return id;
      },

      removeToast: id =>
        set(state => ({
          toasts: state.toasts.filter(t => t.id !== id),
        })),
    }),
    {
      name: 'fheatherx-ui',
      partialize: state => ({
        slippageTolerance: state.slippageTolerance,
        expertMode: state.expertMode,
      }),
    }
  )
);

// Convenience hook for toasts
export function useToast() {
  const addToast = useUiStore(state => state.addToast);
  const removeToast = useUiStore(state => state.removeToast);

  return {
    toast: addToast,
    dismiss: removeToast,
    success: (title: string, description?: string) =>
      addToast({ title, description, variant: 'success' }),
    error: (title: string, description?: string) =>
      addToast({ title, description, variant: 'error' }),
    warning: (title: string, description?: string) =>
      addToast({ title, description, variant: 'warning' }),
  };
}
```

### 4.4 Transaction Store

```typescript
// src/stores/transactionStore.ts

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { TX_RETENTION_MS } from '@/lib/constants';

type TxStatus = 'pending' | 'confirmed' | 'failed';

interface TrackedTransaction {
  hash: `0x${string}`;
  type: 'deposit' | 'withdraw' | 'swap' | 'placeOrder' | 'cancelOrder';
  status: TxStatus;
  description: string;
  createdAt: number;
  confirmedAt?: number;
  error?: string;
}

interface TransactionState {
  transactions: TrackedTransaction[];

  // Actions
  addTransaction: (tx: Omit<TrackedTransaction, 'status' | 'createdAt'>) => void;
  updateTransaction: (hash: `0x${string}`, updates: Partial<TrackedTransaction>) => void;
  clearOldTransactions: () => void;
}

export const useTransactionStore = create<TransactionState>()(
  persist(
    immer((set, get) => ({
      transactions: [],

      addTransaction: tx =>
        set(state => {
          state.transactions.unshift({
            ...tx,
            status: 'pending',
            createdAt: Date.now(),
          });
          // Keep only last 50 transactions
          if (state.transactions.length > 50) {
            state.transactions = state.transactions.slice(0, 50);
          }
        }),

      updateTransaction: (hash, updates) =>
        set(state => {
          const tx = state.transactions.find(t => t.hash === hash);
          if (tx) {
            Object.assign(tx, updates);
          }
        }),

      clearOldTransactions: () =>
        set(state => {
          const cutoff = Date.now() - TX_RETENTION_MS;
          state.transactions = state.transactions.filter(
            tx => tx.createdAt > cutoff || tx.status === 'pending'
          );
        }),
    })),
    {
      name: 'fheatherx-transactions',
    }
  )
);
```

---

## 5. TanStack Query Configuration

### 5.1 Query Client Setup

```typescript
// src/lib/queryClient.ts

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30 seconds
      gcTime: 5 * 60 * 1000, // 5 minutes
      retry: 2,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
```

### 5.2 Query Keys

```typescript
// src/lib/queryKeys.ts

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
```

### 5.3 Event Invalidation Hook

```typescript
// src/hooks/useEventInvalidation.ts

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount, useWatchContractEvent } from 'wagmi';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { FHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { useChainId } from 'wagmi';
import { queryKeys } from '@/lib/queryKeys';
import { useFheStore } from '@/stores/fheStore';

export function useEventInvalidation() {
  const { address } = useAccount();
  const chainId = useChainId();
  const hookAddress = FHEATHERX_ADDRESSES[chainId];
  const queryClient = useQueryClient();
  const clearBalances = useFheStore(state => state.clearBalances);

  // Invalidate on Deposit
  useWatchContractEvent({
    address: hookAddress,
    abi: FHEATHERX_ABI,
    eventName: 'Deposit',
    onLogs: logs => {
      logs.forEach(log => {
        if (log.args.user?.toLowerCase() === address?.toLowerCase()) {
          clearBalances();
          queryClient.invalidateQueries({
            queryKey: queryKeys.reserves(hookAddress),
          });
        }
      });
    },
    enabled: !!address && !!hookAddress,
  });

  // Invalidate on Withdraw
  useWatchContractEvent({
    address: hookAddress,
    abi: FHEATHERX_ABI,
    eventName: 'Withdraw',
    onLogs: logs => {
      logs.forEach(log => {
        if (log.args.user?.toLowerCase() === address?.toLowerCase()) {
          clearBalances();
          queryClient.invalidateQueries({
            queryKey: queryKeys.reserves(hookAddress),
          });
        }
      });
    },
    enabled: !!address && !!hookAddress,
  });

  // Invalidate on OrderPlaced
  useWatchContractEvent({
    address: hookAddress,
    abi: FHEATHERX_ABI,
    eventName: 'OrderPlaced',
    onLogs: logs => {
      logs.forEach(log => {
        if (log.args.owner?.toLowerCase() === address?.toLowerCase()) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.activeOrders(address!, hookAddress),
          });
          queryClient.invalidateQueries({
            queryKey: queryKeys.userEvents(address!, hookAddress),
          });
          clearBalances();
        }
      });
    },
    enabled: !!address && !!hookAddress,
  });

  // Invalidate on OrderFilled
  useWatchContractEvent({
    address: hookAddress,
    abi: FHEATHERX_ABI,
    eventName: 'OrderFilled',
    onLogs: logs => {
      logs.forEach(log => {
        if (log.args.owner?.toLowerCase() === address?.toLowerCase()) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.activeOrders(address!, hookAddress),
          });
          queryClient.invalidateQueries({
            queryKey: queryKeys.userEvents(address!, hookAddress),
          });
          clearBalances();
        }
      });
    },
    enabled: !!address && !!hookAddress,
  });

  // Invalidate on OrderCancelled
  useWatchContractEvent({
    address: hookAddress,
    abi: FHEATHERX_ABI,
    eventName: 'OrderCancelled',
    onLogs: logs => {
      logs.forEach(log => {
        if (log.args.owner?.toLowerCase() === address?.toLowerCase()) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.activeOrders(address!, hookAddress),
          });
          queryClient.invalidateQueries({
            queryKey: queryKeys.userEvents(address!, hookAddress),
          });
          clearBalances();
        }
      });
    },
    enabled: !!address && !!hookAddress,
  });
}
```

---

## 6. Persistence Strategy

| Store | Persist? | Storage | Reason |
|-------|----------|---------|--------|
| FHE Session Status | No | - | Security: session is in-memory only |
| Revealed Balances | Yes | sessionStorage | UX: avoid re-revealing in same session |
| UI Preferences | Yes | localStorage | UX: remember slippage, expert mode |
| Pending Transactions | Yes | localStorage | Recovery: track txs across page reloads |
| Active Modal | No | - | UI: modals should close on refresh |
| Pending Orders | No | - | Transient: cleared after confirmation |

---

## 7. Testing

```typescript
// src/lib/validation/__tests__/orderSchema.test.ts

import { describe, it, expect } from 'vitest';
import {
  orderFormSchema,
  validateTriggerPrice,
  validateOrderForm,
} from '../orderSchema';

describe('orderFormSchema', () => {
  it('validates valid order form', () => {
    const result = orderFormSchema.safeParse({
      orderType: 'limit-buy',
      triggerPrice: '100.50',
      amount: '1.5',
      slippage: 0.5,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid order type', () => {
    const result = orderFormSchema.safeParse({
      orderType: 'invalid',
      triggerPrice: '100',
      amount: '1',
      slippage: 0.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero amount', () => {
    const result = orderFormSchema.safeParse({
      orderType: 'limit-buy',
      triggerPrice: '100',
      amount: '0',
      slippage: 0.5,
    });
    expect(result.success).toBe(false);
  });
});

describe('validateTriggerPrice', () => {
  const currentPrice = 100;

  it('validates limit-buy below current price', () => {
    expect(validateTriggerPrice('limit-buy', 95, currentPrice).valid).toBe(true);
    expect(validateTriggerPrice('limit-buy', 105, currentPrice).valid).toBe(false);
  });

  it('validates limit-sell above current price', () => {
    expect(validateTriggerPrice('limit-sell', 105, currentPrice).valid).toBe(true);
    expect(validateTriggerPrice('limit-sell', 95, currentPrice).valid).toBe(false);
  });

  it('validates stop-loss below current price', () => {
    expect(validateTriggerPrice('stop-loss', 90, currentPrice).valid).toBe(true);
    expect(validateTriggerPrice('stop-loss', 110, currentPrice).valid).toBe(false);
  });

  it('validates take-profit above current price', () => {
    expect(validateTriggerPrice('take-profit', 110, currentPrice).valid).toBe(true);
    expect(validateTriggerPrice('take-profit', 90, currentPrice).valid).toBe(false);
  });
});

// src/lib/orders/__tests__/status.test.ts

import { describe, it, expect } from 'vitest';
import { deriveOrderStatus, buildOrderInfo } from '../orders';

describe('deriveOrderStatus', () => {
  const mockPlaced = [
    { orderId: 1n, owner: '0x123', triggerTick: 100, isBuyOrder: true, isStopOrder: false },
  ];

  it('returns active for placed-only order', () => {
    const status = deriveOrderStatus(1n, mockPlaced as any, [], []);
    expect(status).toBe('active');
  });

  it('returns filled when fill event exists', () => {
    const fills = [{ orderId: 1n, owner: '0x123' }];
    const status = deriveOrderStatus(1n, mockPlaced as any, fills as any, []);
    expect(status).toBe('filled');
  });

  it('returns cancelled when cancel event exists', () => {
    const cancels = [{ orderId: 1n, owner: '0x123' }];
    const status = deriveOrderStatus(1n, mockPlaced as any, [], cancels as any);
    expect(status).toBe('cancelled');
  });

  it('prioritizes cancelled over filled', () => {
    const fills = [{ orderId: 1n }];
    const cancels = [{ orderId: 1n }];
    const status = deriveOrderStatus(1n, mockPlaced as any, fills as any, cancels as any);
    expect(status).toBe('cancelled');
  });
});
```

---

*End of Appendix B*
