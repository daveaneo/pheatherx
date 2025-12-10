'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const orderTabs = [
  { href: '/orders/new', label: 'New Order' },
  { href: '/orders/active', label: 'Active' },
  { href: '/orders/claims', label: 'Claims' },
  { href: '/orders/history', label: 'History' },
];

export default function OrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div>
      {/* Orders Tab Navigation */}
      <div className="border-b border-carbon-gray/50 mb-6">
        <div className="max-w-2xl mx-auto px-4">
          <nav className="flex gap-1 -mb-px">
            {orderTabs.map(tab => {
              const isActive = pathname === tab.href;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    'px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                    isActive
                      ? 'border-phoenix-ember text-phoenix-ember'
                      : 'border-transparent text-feather-white/60 hover:text-feather-white hover:border-carbon-gray'
                  )}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      <div className="px-4">
        {children}
      </div>
    </div>
  );
}
