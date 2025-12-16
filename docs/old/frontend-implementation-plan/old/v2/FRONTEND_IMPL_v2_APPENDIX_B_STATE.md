# Appendix B: State Management Architecture

**Parent Document:** [FRONTEND_IMPLEMENTATION_PLAN_v2.md](./FRONTEND_IMPLEMENTATION_PLAN_v2.md)

---

## Overview

This appendix defines the state management architecture using Zustand for client state and TanStack Query for server state.

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

## 2. Zustand Stores

### 2.1 FHE Store

```typescript
// src/stores/fheStore.ts

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

type SessionStatus = 'disconnected' | 'initializing' | 'ready' | 'expired' | 'error';

interface RevealedBalance {
  value: bigint;
  revealedAt: number;
}

// Custom serializer for bigint
const bigintSerializer = {
  serialize: (value: bigint) => value.toString(),
  deserialize: (value: string) => BigInt(value),
};

interface FheState {
  // Session state
  sessionStatus: SessionStatus;
  sessionError: string | null;
  sessionExpiresAt: number | null;

  // Revealed balances cache (address-chain-token -> value)
  revealedBalances: Record<string, { value: string; revealedAt: number }>;

  // Actions
  setSessionStatus: (status: SessionStatus, error?: string) => void;
  setSessionExpiry: (expiresAt: number) => void;
  cacheBalance: (key: string, value: bigint) => void;
  getCachedBalance: (key: string) => RevealedBalance | null;
  clearBalances: () => void;
  reset: () => void;
}

const BALANCE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const useFheStore = create<FheState>()(
  persist(
    immer((set, get) => ({
      sessionStatus: 'disconnected',
      sessionError: null,
      sessionExpiresAt: null,
      revealedBalances: {},

      setSessionStatus: (status, error) =>
        set((state) => {
          state.sessionStatus = status;
          state.sessionError = error || null;
        }),

      setSessionExpiry: (expiresAt) =>
        set((state) => {
          state.sessionExpiresAt = expiresAt;
        }),

      cacheBalance: (key, value) =>
        set((state) => {
          state.revealedBalances[key] = {
            value: value.toString(),
            revealedAt: Date.now(),
          };
        }),

      getCachedBalance: (key) => {
        const cached = get().revealedBalances[key];
        if (!cached) return null;
        if (Date.now() - cached.revealedAt > BALANCE_CACHE_TTL) return null;
        return {
          value: BigInt(cached.value),
          revealedAt: cached.revealedAt,
        };
      },

      clearBalances: () =>
        set((state) => {
          state.revealedBalances = {};
        }),

      reset: () =>
        set((state) => {
          state.sessionStatus = 'disconnected';
          state.sessionError = null;
          state.sessionExpiresAt = null;
          state.revealedBalances = {};
        }),
    })),
    {
      name: 'fheatherx-fhe',
      storage: createJSONStorage(() => sessionStorage), // Use sessionStorage, not localStorage
      partialize: (state) => ({
        // Only persist revealed balances, NOT session (security)
        revealedBalances: state.revealedBalances,
      }),
    }
  )
);
```

### 2.2 Orders Store

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

    addPendingOrder: (order) => {
      const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      set((state) => {
        state.pendingOrders.push({
          ...order,
          tempId,
          createdAt: Date.now(),
        });
      });
      return tempId;
    },

    updatePendingOrderHash: (tempId, txHash) =>
      set((state) => {
        const order = state.pendingOrders.find((o) => o.tempId === tempId);
        if (order) {
          order.txHash = txHash;
        }
      }),

    removePendingOrder: (tempId) =>
      set((state) => {
        state.pendingOrders = state.pendingOrders.filter((o) => o.tempId !== tempId);
      }),

    addPendingCancellation: (orderId) =>
      set((state) => {
        if (!state.pendingCancellations.includes(orderId)) {
          state.pendingCancellations.push(orderId);
        }
      }),

    removePendingCancellation: (orderId) =>
      set((state) => {
        state.pendingCancellations = state.pendingCancellations.filter(
          (id) => id !== orderId
        );
      }),

    clearPending: () =>
      set((state) => {
        state.pendingOrders = [];
        state.pendingCancellations = [];
      }),
  }))
);
```

### 2.3 UI Store

```typescript
// src/stores/uiStore.ts

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: 'default' | 'success' | 'error' | 'warning';
  duration?: number;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      slippageTolerance: 0.5,
      expertMode: false,
      activeModal: null,
      modalData: {},
      toasts: [],

      setSlippage: (slippage) => set({ slippageTolerance: slippage }),

      setExpertMode: (enabled) => set({ expertMode: enabled }),

      openModal: (modalId, data = {}) =>
        set({ activeModal: modalId, modalData: data }),

      closeModal: () => set({ activeModal: null, modalData: {} }),

      addToast: (toast) => {
        const id = `toast-${Date.now()}`;
        set((state) => ({
          toasts: [...state.toasts, { ...toast, id }],
        }));

        // Auto-remove after duration
        const duration = toast.duration ?? 5000;
        if (duration > 0) {
          setTimeout(() => {
            get().removeToast(id);
          }, duration);
        }

        return id;
      },

      removeToast: (id) =>
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        })),
    }),
    {
      name: 'fheatherx-ui',
      partialize: (state) => ({
        slippageTolerance: state.slippageTolerance,
        expertMode: state.expertMode,
      }),
    }
  )
);

// Convenience hook for toasts
export function useToast() {
  const addToast = useUiStore((state) => state.addToast);
  const removeToast = useUiStore((state) => state.removeToast);

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

### 2.4 Transaction Store

```typescript
// src/stores/transactionStore.ts

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

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

const TX_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

export const useTransactionStore = create<TransactionState>()(
  persist(
    immer((set, get) => ({
      transactions: [],

      addTransaction: (tx) =>
        set((state) => {
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
        set((state) => {
          const tx = state.transactions.find((t) => t.hash === hash);
          if (tx) {
            Object.assign(tx, updates);
          }
        }),

      clearOldTransactions: () =>
        set((state) => {
          const cutoff = Date.now() - TX_RETENTION_MS;
          state.transactions = state.transactions.filter(
            (tx) => tx.createdAt > cutoff || tx.status === 'pending'
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

## 3. TanStack Query Configuration

### 3.1 Query Client Setup

```typescript
// src/lib/queryClient.ts

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30 seconds
      gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
      retry: 2,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
```

### 3.2 Query Keys

```typescript
// src/lib/queryKeys.ts

export const queryKeys = {
  // Pool data
  reserves: (hookAddress: string) => ['reserves', hookAddress] as const,
  poolMetrics: (hookAddress: string) => ['poolMetrics', hookAddress] as const,

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

### 3.3 Query Hooks

```typescript
// src/hooks/queries/useReserves.ts

import { useQuery } from '@tanstack/react-query';
import { useReadContract } from 'wagmi';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { useFheatherXAddress } from '@/hooks/useContract';
import { queryKeys } from '@/lib/queryKeys';

export function useReserves() {
  const hookAddress = useFheatherXAddress();

  return useReadContract({
    address: hookAddress,
    abi: FHEATHERX_ABI,
    functionName: 'getReserves',
    query: {
      queryKey: queryKeys.reserves(hookAddress),
      staleTime: 10_000, // Reserves update frequently
    },
  });
}
```

```typescript
// src/hooks/queries/useActiveOrders.ts

import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { useReadContract } from 'wagmi';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { useFheatherXAddress } from '@/hooks/useContract';
import { queryKeys } from '@/lib/queryKeys';

export function useActiveOrders() {
  const { address } = useAccount();
  const hookAddress = useFheatherXAddress();

  return useReadContract({
    address: hookAddress,
    abi: FHEATHERX_ABI,
    functionName: 'getActiveOrders',
    args: address ? [address] : undefined,
    query: {
      queryKey: queryKeys.activeOrders(address!, hookAddress),
      enabled: !!address,
      staleTime: 30_000,
    },
  });
}
```

---

## 4. State Synchronization

### 4.1 Invalidation on Events

```typescript
// src/hooks/useEventInvalidation.ts

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount, useWatchContractEvent } from 'wagmi';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { useFheatherXAddress } from '@/hooks/useContract';
import { queryKeys } from '@/lib/queryKeys';
import { useFheStore } from '@/stores/fheStore';

export function useEventInvalidation() {
  const { address } = useAccount();
  const hookAddress = useFheatherXAddress();
  const queryClient = useQueryClient();
  const clearBalances = useFheStore((state) => state.clearBalances);

  // Invalidate on Deposit
  useWatchContractEvent({
    address: hookAddress,
    abi: FHEATHERX_ABI,
    eventName: 'Deposit',
    onLogs: (logs) => {
      logs.forEach((log) => {
        if (log.args.user?.toLowerCase() === address?.toLowerCase()) {
          // Clear cached balance since it changed
          clearBalances();
          // Invalidate queries
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
    onLogs: (logs) => {
      logs.forEach((log) => {
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
    onLogs: (logs) => {
      logs.forEach((log) => {
        if (log.args.owner?.toLowerCase() === address?.toLowerCase()) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.activeOrders(address!, hookAddress),
          });
          queryClient.invalidateQueries({
            queryKey: queryKeys.orderHistory(address!, hookAddress),
          });
          clearBalances(); // Balance decreased
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
    onLogs: (logs) => {
      logs.forEach((log) => {
        if (log.args.owner?.toLowerCase() === address?.toLowerCase()) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.activeOrders(address!, hookAddress),
          });
          queryClient.invalidateQueries({
            queryKey: queryKeys.orderHistory(address!, hookAddress),
          });
          clearBalances(); // Balance changed
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
    onLogs: (logs) => {
      logs.forEach((log) => {
        if (log.args.owner?.toLowerCase() === address?.toLowerCase()) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.activeOrders(address!, hookAddress),
          });
          queryClient.invalidateQueries({
            queryKey: queryKeys.orderHistory(address!, hookAddress),
          });
          clearBalances(); // Balance restored
        }
      });
    },
    enabled: !!address && !!hookAddress,
  });
}
```

### 4.2 Optimistic Updates

```typescript
// src/hooks/mutations/useCancelOrder.ts

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAccount, useWriteContract } from 'wagmi';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { useFheatherXAddress } from '@/hooks/useContract';
import { queryKeys } from '@/lib/queryKeys';
import { useOrdersStore } from '@/stores/ordersStore';
import { useToast } from '@/stores/uiStore';

export function useCancelOrder() {
  const { address } = useAccount();
  const hookAddress = useFheatherXAddress();
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const { addPendingCancellation, removePendingCancellation } = useOrdersStore();
  const { toast, error: errorToast } = useToast();

  return useMutation({
    mutationFn: async (orderId: bigint) => {
      return writeContractAsync({
        address: hookAddress,
        abi: FHEATHERX_ABI,
        functionName: 'cancelOrder',
        args: [orderId],
      });
    },

    onMutate: async (orderId) => {
      // Optimistic update: mark as pending cancellation
      addPendingCancellation(orderId);

      // Cancel outgoing queries
      await queryClient.cancelQueries({
        queryKey: queryKeys.activeOrders(address!, hookAddress),
      });

      // Snapshot previous value
      const previousOrders = queryClient.getQueryData(
        queryKeys.activeOrders(address!, hookAddress)
      );

      // Optimistically remove from active orders
      queryClient.setQueryData(
        queryKeys.activeOrders(address!, hookAddress),
        (old: bigint[] | undefined) => old?.filter((id) => id !== orderId)
      );

      return { previousOrders };
    },

    onSuccess: (_, orderId) => {
      removePendingCancellation(orderId);
      toast({ title: 'Order Cancelled', variant: 'success' });
    },

    onError: (error, orderId, context) => {
      // Revert optimistic update
      removePendingCancellation(orderId);
      if (context?.previousOrders) {
        queryClient.setQueryData(
          queryKeys.activeOrders(address!, hookAddress),
          context.previousOrders
        );
      }
      errorToast('Failed to cancel order', error.message);
    },

    onSettled: () => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({
        queryKey: queryKeys.activeOrders(address!, hookAddress),
      });
    },
  });
}
```

---

## 5. Persistence Strategy

### 5.1 What to Persist

| Store | Persist? | Storage | Reason |
|-------|----------|---------|--------|
| FHE Session Status | No | - | Security: session is in-memory only |
| Revealed Balances | Yes | sessionStorage | UX: avoid re-revealing in same session |
| UI Preferences | Yes | localStorage | UX: remember slippage, expert mode |
| Pending Transactions | Yes | localStorage | Recovery: track txs across page reloads |
| Active Modal | No | - | UI: modals should close on refresh |

### 5.2 Storage Cleanup

```typescript
// src/hooks/useStorageCleanup.ts

import { useEffect } from 'react';
import { useTransactionStore } from '@/stores/transactionStore';

export function useStorageCleanup() {
  const clearOldTransactions = useTransactionStore(
    (state) => state.clearOldTransactions
  );

  useEffect(() => {
    // Clean up on mount
    clearOldTransactions();

    // Clean up periodically
    const interval = setInterval(clearOldTransactions, 60 * 60 * 1000); // Every hour

    return () => clearInterval(interval);
  }, [clearOldTransactions]);
}
```

---

## 6. DevTools Integration

```typescript
// src/app/providers.tsx

'use client';

import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    // ... other providers
    <>
      {children}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </>
  );
}
```

For Zustand, use the browser extension or:

```typescript
// Enable devtools in development
import { devtools } from 'zustand/middleware';

export const useFheStore = create<FheState>()(
  devtools(
    persist(
      immer((set, get) => ({
        // ... store implementation
      })),
      { name: 'fheatherx-fhe' }
    ),
    { name: 'FheStore' }
  )
);
```

---

*End of Appendix B*
