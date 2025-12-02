'use client';

import { ReactNode } from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Modal } from './Modal';
import { BottomSheet } from './BottomSheet';

interface AdaptiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function AdaptiveModal(props: AdaptiveModalProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return <BottomSheet {...props} />;
  }

  return <Modal {...props} />;
}
