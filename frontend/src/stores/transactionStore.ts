'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { TX_RETENTION_MS } from '@/lib/constants';

type TxStatus = 'pending' | 'confirmed' | 'failed';

interface TrackedTransaction {
  hash: `0x${string}`;
  type: 'deposit' | 'withdraw' | 'swap' | 'placeOrder' | 'cancelOrder' | 'approve' | 'faucet' | 'closePosition' | 'wrap' | 'unwrap' | 'addLiquidity' | 'removeLiquidity';
  status: TxStatus;
  description: string;
  createdAt: number;
  confirmedAt?: number;
  error?: string;
}

interface TransactionState {
  transactions: TrackedTransaction[];

  addTransaction: (tx: Omit<TrackedTransaction, 'status' | 'createdAt'>) => void;
  updateTransaction: (hash: `0x${string}`, updates: Partial<TrackedTransaction>) => void;
  clearOldTransactions: () => void;
  getRecentTransactions: (count?: number) => TrackedTransaction[];
  getPendingTransactions: () => TrackedTransaction[];
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

      getRecentTransactions: (count = 10) => {
        return get().transactions.slice(0, count);
      },

      getPendingTransactions: () => {
        return get().transactions.filter(tx => tx.status === 'pending');
      },
    })),
    {
      name: 'fheatherx-transactions',
    }
  )
);
