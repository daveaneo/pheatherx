'use client';

import { ReactNode, useState, useEffect } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { config } from '@/lib/wagmiConfig';
import { PoolProvider } from '@/components/providers/PoolProvider';
import { preloadCofhe } from '@/lib/fhe/singleton';

import '@rainbow-me/rainbowkit/styles.css';

// Start preloading cofhejs in the background
// This runs once when the module is first imported
if (typeof window !== 'undefined') {
  // Delay slightly to not block initial render
  setTimeout(() => {
    preloadCofhe().catch(() => {
      // Silently fail - will retry when user needs FHE
    });
  }, 1000);
}

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
