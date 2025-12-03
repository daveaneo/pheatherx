'use client';

import { useCallback, useEffect, useState } from 'react';
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

  // Subscribe to cofhe load status changes
  useEffect(() => {
    setCofheLoadStatus(fheSingleton.getLoadStatus());

    const unsubscribe = fheSingleton.onLoadStatusChange((status) => {
      setCofheLoadStatus(status === 'loading' ? 'loading' : status === 'loaded' ? 'loaded' : 'error');
    });

    return unsubscribe;
  }, []);

  // Check if we already have a valid session from the singleton
  useEffect(() => {
    if (fheSingleton.isSessionValid() && sessionStatus !== 'ready') {
      setSessionStatus('ready');
      setSessionExpiry(fheSingleton.getSessionExpiry()!);
    }
  }, [sessionStatus, setSessionStatus, setSessionExpiry]);

  const initialize = useCallback(async () => {
    if (!provider || !hookAddress || !isConnected) {
      setSessionStatus('disconnected');
      return;
    }

    // Check if we already have a valid session
    if (fheSingleton.isSessionValid()) {
      setSessionStatus('ready');
      setSessionExpiry(fheSingleton.getSessionExpiry()!);
      return;
    }

    if (isInitializing) return;
    setIsInitializing(true);
    setInitSource('manual');
    setAutoInitRejected(false); // Clear rejection flag on manual attempt
    setSessionStatus('initializing');

    try {
      if (isMock) {
        // Use mock client for local/unsupported networks
        const client = new MockFheClient();
        const session = await client.initSession(hookAddress);
        setSessionStatus('ready');
        setSessionExpiry(session.expiresAt);
      } else {
        // Use real FHE via singleton
        if (!signer) throw new Error('Signer not available');

        // This will wait for cofhejs to load if still loading
        const session = await fheSingleton.initializeSession(provider, signer, hookAddress);
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

  // Reset on chain change
  useEffect(() => {
    reset();
    fheSingleton.clearSession();
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
