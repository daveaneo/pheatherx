'use client';

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
  slippageTolerance: number;
  expertMode: boolean;
  activeModal: string | null;
  modalData: Record<string, unknown>;
  toasts: Toast[];

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
