'use client';

import { ReactNode, useState, useEffect } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { config } from '@/lib/wagmiConfig';
import { PoolProvider } from '@/components/providers/PoolProvider';

import '@rainbow-me/rainbowkit/styles.css';

// FHE is loaded on-demand when needed, not at startup

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60, // 1 minute
            gcTime: 1000 * 60 * 5, // 5 minutes
          },
        },
      })
  );

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: '#FF6A3D',
            accentColorForeground: '#F9F7F1',
            borderRadius: 'medium',
            fontStack: 'system',
          })}
        >
          <PoolProvider>{children}</PoolProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
