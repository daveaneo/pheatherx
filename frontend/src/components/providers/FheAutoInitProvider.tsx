'use client';

import { ReactNode, useEffect, useRef } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { useEthersSigner } from '@/hooks/useEthersSigner';
import { useEthersProvider } from '@/hooks/useEthersProvider';
import * as fheSingleton from '@/lib/fhe/singleton';
import { useFheStore } from '@/stores/fheStore';
import { PHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { fheSupport } from '@/lib/chains';
import { MockFheClient } from '@/lib/fhe/mockClient';

interface FheAutoInitProviderProps {
  children: ReactNode;
  disabled?: boolean;
}

/**
 * Check if auto-init is globally disabled via environment or localStorage
 */
function isAutoInitDisabled(): boolean {
  if (process.env.NEXT_PUBLIC_FHE_AUTO_INIT === 'false') {
    return true;
  }
  if (typeof window !== 'undefined') {
    return localStorage.getItem('pheatherx:disableAutoInit') === 'true';
  }
  return false;
}

/**
 * Provider that automatically initializes FHE session after wallet connection.
 * Must be used inside WagmiProvider/QueryClientProvider.
 */
export function FheAutoInitProvider({ children, disabled = false }: FheAutoInitProviderProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const provider = useEthersProvider();
  const signer = useEthersSigner();

  const {
    sessionStatus,
    autoInitAttempted,
    autoInitRejected,
    setSessionStatus,
    setSessionExpiry,
    setAutoInitAttempted,
    setAutoInitRejected,
    setInitSource,
  } = useFheStore();

  const initInProgressRef = useRef(false);
  const lastChainIdRef = useRef<number | null>(null);
  const lastAddressRef = useRef<string | null>(null);

  const hookAddress = PHEATHERX_ADDRESSES[chainId];
  const networkFheSupport = fheSupport[chainId];
  const isMock = networkFheSupport !== 'full';
  const hasFheSupport = networkFheSupport === 'full' || networkFheSupport === 'mock';

  // Reset auto-init state on chain or address change
  useEffect(() => {
    if (chainId !== lastChainIdRef.current || address !== lastAddressRef.current) {
      setAutoInitAttempted(false);
      setAutoInitRejected(false);
      lastChainIdRef.current = chainId;
      lastAddressRef.current = address ?? null;
    }
  }, [chainId, address, setAutoInitAttempted, setAutoInitRejected]);

  // Preload cofhejs as soon as wallet connects to FHE-supported chain
  useEffect(() => {
    if (isConnected && hasFheSupport && !isMock) {
      fheSingleton.preloadCofhe();
    }
  }, [isConnected, hasFheSupport, isMock]);

  // Auto-initialize FHE session
  useEffect(() => {
    // Skip if disabled globally or via prop
    if (disabled || isAutoInitDisabled()) {
      return;
    }

    // Skip if not connected or missing requirements
    if (!isConnected || !provider || !hookAddress) {
      return;
    }

    // Skip if chain doesn't support FHE
    if (!hasFheSupport) {
      return;
    }

    // Skip if already ready or initializing
    if (sessionStatus === 'ready' || sessionStatus === 'initializing') {
      return;
    }

    // Skip if auto-init already attempted (prevents retry loops)
    if (autoInitAttempted) {
      return;
    }

    // Skip if user rejected the previous auto-init signature
    if (autoInitRejected) {
      return;
    }

    // Skip if singleton already has valid session
    if (fheSingleton.isSessionValid()) {
      setSessionStatus('ready');
      setSessionExpiry(fheSingleton.getSessionExpiry()!);
      return;
    }

    // Prevent concurrent init attempts
    if (initInProgressRef.current) {
      return;
    }

    // For real FHE, need signer
    if (!isMock && !signer) {
      return;
    }

    // Start auto-initialization
    initInProgressRef.current = true;
    setAutoInitAttempted(true);
    setInitSource('auto');
    setSessionStatus('initializing');

    const doInit = async () => {
      try {
        if (isMock) {
          const client = new MockFheClient();
          const session = await client.initSession(hookAddress);
          setSessionStatus('ready');
          setSessionExpiry(session.expiresAt);
        } else {
          const session = await fheSingleton.initializeSession(provider, signer!, hookAddress);
          setSessionStatus('ready');
          setSessionExpiry(session.expiresAt);
        }
      } catch (error) {
        console.error('[FHE Auto-Init] Failed:', error);

        // Check if user rejected the signature
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        const isRejection =
          message.includes('user rejected') ||
          message.includes('user denied') ||
          message.includes('rejected the request') ||
          message.includes('action_rejected');

        if (isRejection) {
          setAutoInitRejected(true);
          // Reset to disconnected so manual init button shows
          setSessionStatus('disconnected');
        } else {
          setSessionStatus('error', error instanceof Error ? error.message : 'Auto-init failed');
        }
      } finally {
        initInProgressRef.current = false;
      }
    };

    doInit();
  }, [
    disabled,
    isConnected,
    provider,
    signer,
    hookAddress,
    hasFheSupport,
    isMock,
    sessionStatus,
    autoInitAttempted,
    autoInitRejected,
    setSessionStatus,
    setSessionExpiry,
    setAutoInitAttempted,
    setAutoInitRejected,
    setInitSource,
  ]);

  return <>{children}</>;
}
