'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/trade', label: 'Trade', icon: '&#x21C4;' },
  { href: '/liquidity', label: 'Liquidity', icon: '&#x1F4CA;' },
  { href: '/portfolio', label: 'Portfolio', icon: '&#x1F4BC;' },
];

const moreItems = [
  { href: '/auctions', label: 'Auctions', icon: '&#x1F528;', comingSoon: true },
  { href: '/launchpad', label: 'Launchpad', icon: '&#x1F680;', comingSoon: true },
];

export function MobileNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const isMoreActive = moreItems.some(item => pathname.startsWith(item.href));

  return (
    <>
      {/* More menu overlay */}
      {moreOpen && (
        <div
          className="md:hidden fixed inset-0 bg-obsidian-black/80 z-30"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {/* More menu popup */}
      {moreOpen && (
        <div className="md:hidden fixed bottom-20 right-4 bg-carbon-gray border border-carbon-gray/50 rounded-xl p-2 z-50 min-w-[160px]">
          {moreItems.map(item => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-lg transition-all',
                  isActive
                    ? 'text-phoenix-ember bg-ash-gray'
                    : 'text-feather-white/70 hover:bg-ash-gray'
                )}
              >
                <span
                  className="text-lg"
                  dangerouslySetInnerHTML={{ __html: item.icon }}
                />
                <span className="text-sm font-medium">{item.label}</span>
                {item.comingSoon && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-feather-gold/20 text-feather-gold font-medium ml-auto">
                    Soon
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {/* Bottom navigation bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-carbon-gray border-t border-carbon-gray/50 z-40">
        <div className="flex items-center justify-around h-16">
          {navItems.map(item => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-all',
                  isActive
                    ? 'text-phoenix-ember'
                    : 'text-feather-white/60'
                )}
              >
                <span
                  className="text-xl"
                  dangerouslySetInnerHTML={{ __html: item.icon }}
                />
                <span className="text-xs font-medium">{item.label}</span>
              </Link>
            );
          })}

          {/* More button */}
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className={cn(
              'flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-all',
              isMoreActive || moreOpen
                ? 'text-phoenix-ember'
                : 'text-feather-white/60'
            )}
          >
            <span className="text-xl">&#x22EF;</span>
            <span className="text-xs font-medium">More</span>
          </button>
        </div>
      </nav>
    </>
  );
}
