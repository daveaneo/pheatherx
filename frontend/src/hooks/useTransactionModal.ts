'use client';

import { useState, useCallback } from 'react';
import type { TransactionModalData, TransactionModalState } from '@/components/ui/TransactionModal';

interface UseTransactionModalReturn {
  isOpen: boolean;
  modalData: TransactionModalData;
  openModal: () => void;
  closeModal: () => void;
  setPending: (txType?: string, description?: string) => void;
  setSuccess: (hash: `0x${string}`, details?: { label: string; value: string }[]) => void;
  setError: (error: string) => void;
  reset: () => void;
}

const initialData: TransactionModalData = {
  state: 'idle',
};

/**
 * Hook for managing transaction modal state
 *
 * Usage:
 * ```tsx
 * const txModal = useTransactionModal();
 *
 * // In your transaction handler:
 * txModal.setPending('Swap', 'Swapping tokens...');
 * txModal.openModal();
 *
 * try {
 *   const hash = await sendTransaction(...);
 *   txModal.setSuccess(hash, [
 *     { label: 'Amount', value: '100 USDC' },
 *   ]);
 * } catch (err) {
 *   txModal.setError(err.message);
 * }
 * ```
 */
export function useTransactionModal(): UseTransactionModalReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [modalData, setModalData] = useState<TransactionModalData>(initialData);

  const openModal = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsOpen(false);
    // Reset to idle after close animation
    setTimeout(() => {
      setModalData(initialData);
    }, 200);
  }, []);

  const setPending = useCallback((txType?: string, description?: string) => {
    setModalData({
      state: 'pending',
      txType,
      description,
    });
  }, []);

  const setSuccess = useCallback((hash: `0x${string}`, details?: { label: string; value: string }[]) => {
    setModalData(prev => ({
      ...prev,
      state: 'success',
      hash,
      details,
    }));
  }, []);

  const setError = useCallback((error: string) => {
    // Parse common error messages for better UX
    let cleanError = error;

    // Handle user rejection
    if (error.includes('User rejected') || error.includes('user rejected')) {
      cleanError = 'Transaction was cancelled by user.';
    }
    // Handle insufficient funds
    else if (error.includes('insufficient funds')) {
      cleanError = 'Insufficient funds for gas. Please add more ETH to your wallet.';
    }
    // Handle execution reverted
    else if (error.includes('execution reverted')) {
      const revertMatch = error.match(/execution reverted: (.+?)(?:\"|$)/);
      if (revertMatch) {
        cleanError = `Transaction reverted: ${revertMatch[1]}`;
      } else {
        cleanError = 'Transaction reverted. Please check your inputs and try again.';
      }
    }
    // Truncate very long errors
    else if (cleanError.length > 200) {
      cleanError = cleanError.slice(0, 200) + '...';
    }

    setModalData(prev => ({
      ...prev,
      state: 'error',
      error: cleanError,
    }));
  }, []);

  const reset = useCallback(() => {
    setModalData(initialData);
    setIsOpen(false);
  }, []);

  return {
    isOpen,
    modalData,
    openModal,
    closeModal,
    setPending,
    setSuccess,
    setError,
    reset,
  };
}
