'use client';

import { ReactNode, useState, useEffect } from 'react';
import { WagmiProvider, useConnect } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { config, testConfig, isTestMode } from '@/lib/wagmiConfig';
import { PoolProvider } from '@/components/providers/PoolProvider';

import '@rainbow-me/rainbowkit/styles.css';

// FHE is loaded on-demand when needed, not at startup

interface ProvidersProps {
  children: ReactNode;
}

// Component that auto-connects the mock wallet in test mode
function TestWalletAutoConnect() {
  const { connect, connectors } = useConnect();
  const [hasConnected, setHasConnected] = useState(false);

  useEffect(() => {
    if (hasConnected) return;

    // Find the mock connector and auto-connect
    const mockConnector = connectors.find((c) => c.id === 'mock');
    if (mockConnector) {
      console.log('[Test Mode] Auto-connecting test wallet...');
      connect({ connector: mockConnector });
      setHasConnected(true);
    }
  }, [connect, connectors, hasConnected]);

  return null;
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

  // Use test config when TEST_MODE is enabled
  const activeConfig = isTestMode() ? testConfig : config;
  const testModeEnabled = isTestMode();

  // Log test mode status on mount
  useEffect(() => {
    if (testModeEnabled) {
      console.log('[Test Mode] Enabled - using mock wallet connector');
    }
  }, [testModeEnabled]);

  return (
    <WagmiProvider config={activeConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: '#FF6A3D',
            accentColorForeground: '#F9F7F1',
            borderRadius: 'medium',
            fontStack: 'system',
          })}
        >
          {/* Auto-connect test wallet in test mode */}
          {testModeEnabled && <TestWalletAutoConnect />}
          <PoolProvider>{children}</PoolProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
