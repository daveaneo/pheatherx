'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { BALANCE_CACHE_TTL_MS } from '@/lib/constants';

type SessionStatus = 'disconnected' | 'initializing' | 'ready' | 'expired' | 'error';
type InitSource = 'auto' | 'manual' | null;

interface RevealedBalance {
  value: bigint;
  revealedAt: number;
}

interface FheState {
  sessionStatus: SessionStatus;
  sessionError: string | null;
  sessionExpiresAt: number | null;
  revealedBalances: Record<string, { value: string; revealedAt: number }>;

  // Auto-init tracking
  autoInitAttempted: boolean;
  autoInitRejected: boolean;
  initSource: InitSource;

  setSessionStatus: (status: SessionStatus, error?: string) => void;
  setSessionExpiry: (expiresAt: number) => void;
  setAutoInitAttempted: (attempted: boolean) => void;
  setAutoInitRejected: (rejected: boolean) => void;
  setInitSource: (source: InitSource) => void;
  cacheBalance: (key: string, value: bigint) => void;
  getCachedBalance: (key: string) => RevealedBalance | null;
  clearBalance: (key: string) => void;
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
      autoInitAttempted: false,
      autoInitRejected: false,
      initSource: null,

      setSessionStatus: (status, error) =>
        set(state => {
          state.sessionStatus = status;
          state.sessionError = error || null;
        }),

      setSessionExpiry: expiresAt =>
        set(state => {
          state.sessionExpiresAt = expiresAt;
        }),

      setAutoInitAttempted: attempted =>
        set(state => {
          state.autoInitAttempted = attempted;
        }),

      setAutoInitRejected: rejected =>
        set(state => {
          state.autoInitRejected = rejected;
        }),

      setInitSource: source =>
        set(state => {
          state.initSource = source;
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

      clearBalance: key =>
        set(state => {
          delete state.revealedBalances[key];
        }),

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
          state.autoInitAttempted = false;
          state.autoInitRejected = false;
          state.initSource = null;
        }),
    })),
    {
      name: 'fheatherx-fhe',
      storage: createJSONStorage(() => sessionStorage),
      partialize: state => ({
        revealedBalances: state.revealedBalances,
      }),
    }
  )
);
