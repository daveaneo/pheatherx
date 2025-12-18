'use client';

import { useEffect, useRef } from 'react';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { supportedChains } from '@/lib/chains';

const CHAIN_STORAGE_KEY = 'fheatherx-preferred-chain';

/**
 * Component that persists and restores the user's chain selection.
 *
 * Problem: When navigating between tabs/pages, the app may default to
 * the first chain in supportedChains (Ethereum Sepolia) instead of
 * the user's last selected chain.
 *
 * Solution: This component:
 * 1. Saves the current chainId to localStorage whenever it changes
 * 2. On reconnection, switches to the persisted chain if different
 */
export function ChainPersistence() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const hasRestoredRef = useRef(false);
  const previousChainIdRef = useRef<number | null>(null);

  // Save chain selection to localStorage when it changes
  useEffect(() => {
    if (!isConnected || !chainId) return;

    // Only save if it's a supported chain
    const isSupported = supportedChains.some(c => c.id === chainId);
    if (isSupported && chainId !== previousChainIdRef.current) {
      localStorage.setItem(CHAIN_STORAGE_KEY, chainId.toString());
      previousChainIdRef.current = chainId;
    }
  }, [isConnected, chainId]);

  // Restore chain selection on reconnect
  useEffect(() => {
    if (!isConnected || hasRestoredRef.current) return;

    // Only attempt restoration once per session
    hasRestoredRef.current = true;

    const savedChainId = localStorage.getItem(CHAIN_STORAGE_KEY);
    if (!savedChainId) return;

    const targetChainId = parseInt(savedChainId, 10);

    // If we're already on the target chain, no action needed
    if (chainId === targetChainId) return;

    // Verify target is a supported chain
    const isSupported = supportedChains.some(c => c.id === targetChainId);
    if (!isSupported) return;

    // Switch to the persisted chain
    // Small delay to allow wallet to fully reconnect
    const timer = setTimeout(() => {
      switchChain?.({ chainId: targetChainId });
    }, 500);

    return () => clearTimeout(timer);
  }, [isConnected, chainId, switchChain]);

  return null;
}
