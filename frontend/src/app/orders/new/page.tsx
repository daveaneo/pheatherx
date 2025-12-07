'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Redirect /orders/new to /trade
 * The /trade page is the primary order creation interface
 */
export default function NewOrderRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/trade');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <p className="text-feather-white/60">Redirecting to Trade...</p>
    </div>
  );
}
