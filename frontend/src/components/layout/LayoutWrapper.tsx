'use client';

import { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { HomepageHeader } from './HomepageHeader';
import { DAppHeader } from './DAppHeader';
import { MobileNav } from './MobileNav';
import { isDAppRoute } from '@/lib/routes';

interface LayoutWrapperProps {
  children: ReactNode;
}

/**
 * Wrapper component that conditionally renders different layouts
 * based on whether the current page is part of the dApp or homepage
 *
 * - Homepage: Minimal header (logo + launch button), no mobile nav
 * - dApp pages: Full header with nav + wallet, mobile bottom nav
 */
export function LayoutWrapper({ children }: LayoutWrapperProps) {
  const pathname = usePathname();
  const isDApp = isDAppRoute(pathname);

  return (
    <>
      {isDApp ? <DAppHeader /> : <HomepageHeader />}
      {children}
      {isDApp && <MobileNav />}
    </>
  );
}
