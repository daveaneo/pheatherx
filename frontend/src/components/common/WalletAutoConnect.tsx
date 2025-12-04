'use client';

import { useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { usePathname } from 'next/navigation';
import { isDAppRoute } from '@/lib/routes';

/**
 * Component that automatically opens the wallet connect modal
 * when user navigates to a dApp page without being connected.
 *
 * This creates a seamless onboarding flow:
 * 1. User clicks "Launch dApp" on homepage
 * 2. User is taken to /portfolio
 * 3. Wallet connect modal auto-opens
 * 4. User connects wallet
 * 5. FHE auto-init triggers (via FheAutoInitProvider)
 * 6. User is ready to trade
 */
export function WalletAutoConnect() {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const pathname = usePathname();
  const hasAttemptedRef = useRef(false);
  const lastPathnameRef = useRef<string | null>(null);

  useEffect(() => {
    // Reset attempt flag when pathname changes to a new dApp route
    // This allows the modal to open again if user navigates to different dApp pages
    if (pathname !== lastPathnameRef.current) {
      if (isDAppRoute(pathname) && !isDAppRoute(lastPathnameRef.current || '')) {
        // User just entered dApp from non-dApp route, reset the flag
        hasAttemptedRef.current = false;
      }
      lastPathnameRef.current = pathname;
    }

    // Only auto-open on dApp pages, when not connected, and only once per entry
    const shouldOpenModal =
      isDAppRoute(pathname) &&
      !isConnected &&
      openConnectModal &&
      !hasAttemptedRef.current;

    if (shouldOpenModal) {
      hasAttemptedRef.current = true;
      // Small delay to allow page to render first
      const timer = setTimeout(() => {
        openConnectModal();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [pathname, isConnected, openConnectModal]);

  return null;
}
