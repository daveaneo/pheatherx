'use client';

import { ReactNode } from 'react';
import { usePoolDiscovery } from '@/hooks/usePoolDiscovery';

interface PoolProviderProps {
  children: ReactNode;
}

/**
 * Provider component that initializes pool discovery.
 * Must be used inside WagmiProvider/QueryClientProvider.
 */
export function PoolProvider({ children }: PoolProviderProps) {
  // Initialize pool discovery - fetches pools from factory on mount
  usePoolDiscovery();

  return <>{children}</>;
}
