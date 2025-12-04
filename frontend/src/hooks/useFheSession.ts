'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { useEthersSigner } from './useEthersSigner';
import { useEthersProvider } from './useEthersProvider';
import { MockFheClient } from '@/lib/fhe/mockClient';
import * as fheSingleton from '@/lib/fhe/singleton';
import { useFheStore } from '@/stores/fheStore';
import { PHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { fheSupport } from '@/lib/chains';

export function useFheSession() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const provider = useEthersProvider();
  const signer = useEthersSigner();

  const [isInitializing, setIsInitializing] = useState(false);
  const [cofheLoadStatus, setCofheLoadStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>(
    fheSingleton.getLoadStatus()
  );

  // Track previous chainId to detect actual changes
  const prevChainIdRef = useRef<number | null>(null);

  const {
    sessionStatus,
    sessionError,
    sessionExpiresAt,
    autoInitRejected,
    initSource,
    setSessionStatus,
    setSessionExpiry,
    setAutoInitRejected,
    setInitSource,
    reset,
  } = useFheStore();

  const hookAddress = PHEATHERX_ADDRESSES[chainId];
  const networkFheSupport = fheSupport[chainId];
  const isMock = networkFheSupport !== 'full';

  // Check cofhe status once on mount
  useEffect(() => {
    setCofheLoadStatus(fheSingleton.getLoadStatus());

    // Check if we already have a valid session from the singleton
    if (fheSingleton.isSessionValid() && sessionStatus !== 'ready') {
      setSessionStatus('ready');
      setSessionExpiry(fheSingleton.getSessionExpiry()!);
    }
    // Only run on mount - don't subscribe to changes to avoid loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialize = useCallback(async () => {
    // Note: hookAddress can be zero address if contract not deployed yet
    // FHE session init doesn't require a deployed contract
    if (!provider || !isConnected) {
      setSessionStatus('disconnected');
      return;
    }

    // Use a placeholder address if no hook deployed yet
    const contractAddr = hookAddress && hookAddress !== '0x0000000000000000000000000000000000000000'
      ? hookAddress
      : '0x0000000000000000000000000000000000000001' as `0x${string}`;

    // Check if we already have a valid session (check singleton directly)
    if (fheSingleton.isSessionValid()) {
      if (sessionStatus !== 'ready') {
        setSessionStatus('ready');
        setSessionExpiry(fheSingleton.getSessionExpiry()!);
      }
      return;
    }

    // Prevent multiple concurrent initializations
    if (isInitializing) return;
    setIsInitializing(true);
    setInitSource('manual');
    setAutoInitRejected(false); // Clear rejection flag on manual attempt
    setSessionStatus('initializing');

    try {
      if (isMock) {
        // Use mock client for local/unsupported networks
        const client = new MockFheClient();
        const session = await client.initSession(contractAddr);
        setSessionStatus('ready');
        setSessionExpiry(session.expiresAt);
      } else {
        // Use real FHE via singleton
        if (!signer) throw new Error('Signer not available');

        // This will wait for cofhejs to load if still loading
        const session = await fheSingleton.initializeSession(provider, signer, contractAddr);
        setSessionStatus('ready');
        setSessionExpiry(session.expiresAt);
      }
    } catch (error) {
      console.error('FHE session init failed:', error);
      setSessionStatus('error', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsInitializing(false);
    }
  }, [provider, signer, hookAddress, isConnected, isMock, setSessionStatus, setSessionExpiry, setInitSource, setAutoInitRejected, isInitializing]);

  // Auto-check expiry
  useEffect(() => {
    if (!sessionExpiresAt) return;

    const checkExpiry = () => {
      if (Date.now() > sessionExpiresAt) {
        setSessionStatus('expired');
        fheSingleton.clearSession();
      }
    };

    checkExpiry();
    const interval = setInterval(checkExpiry, 60000);

    return () => clearInterval(interval);
  }, [sessionExpiresAt, setSessionStatus]);

  // Reset on wallet disconnect
  useEffect(() => {
    if (!isConnected) {
      reset();
      fheSingleton.clearSession();
    }
  }, [isConnected, reset]);

  // Reset on chain change (only when chainId actually changes)
  useEffect(() => {
    if (prevChainIdRef.current !== null && prevChainIdRef.current !== chainId) {
      reset();
      fheSingleton.clearSession();
    }
    prevChainIdRef.current = chainId;
  }, [chainId, reset]);

  return {
    status: sessionStatus,
    error: sessionError,
    expiresAt: sessionExpiresAt,
    isReady: sessionStatus === 'ready',
    isInitializing: sessionStatus === 'initializing',
    isMock,
    cofheLoadStatus,
    isCofheReady: cofheLoadStatus === 'loaded',
    // Auto-init tracking
    initSource,
    wasAutoInitRejected: autoInitRejected,
    // Actions
    initialize,
    encrypt: fheSingleton.isSessionValid() ? fheSingleton.encryptUint128 : undefined,
    encryptBool: fheSingleton.isSessionValid() ? fheSingleton.encryptBool : undefined,
    unseal: fheSingleton.isSessionValid() ? fheSingleton.unseal : undefined,
  };
}
