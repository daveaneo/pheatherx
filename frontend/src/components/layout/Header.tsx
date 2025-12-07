'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useChainId } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  testnetOnly?: boolean;
  comingSoon?: boolean;
}

const navItems: NavItem[] = [
  { href: '/swap', label: 'Swap' },
  { href: '/liquidity', label: 'Liquidity' },
  { href: '/orders/new', label: 'Orders' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/auctions', label: 'Auctions', comingSoon: true },
  { href: '/launchpad', label: 'Launchpad', comingSoon: true },
  { href: '/faucet', label: 'Faucet', testnetOnly: true },
];

// Testnets and local development chains
// Testnets: Local, Ethereum Sepolia, Arbitrum Sepolia, Fhenix
const TESTNET_CHAIN_IDS = [31337, 11155111, 421614, 8008135];

export function Header() {
  const pathname = usePathname();
  const chainId = useChainId();

  const isTestnet = TESTNET_CHAIN_IDS.includes(chainId);

  // Filter nav items based on network
  const visibleNavItems = navItems.filter(item => !item.testnetOnly || isTestnet);

  return (
    <header className="sticky top-0 z-40 bg-obsidian-black/80 backdrop-blur-lg border-b border-carbon-gray/50">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <svg
              className="w-6 h-6 text-phoenix-ember group-hover:brightness-110 transition-all"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
              <line x1="16" y1="8" x2="2" y2="22" />
              <line x1="17.5" y1="15" x2="9" y2="15" />
            </svg>
            <span className="font-display text-xl font-bold text-feather-white group-hover:text-phoenix-ember transition-all">
              FheatherX
            </span>
          </Link>

          {/* Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {visibleNavItems.map(item => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5',
                    isActive
                      ? 'bg-carbon-gray text-phoenix-ember'
                      : 'text-feather-white/70 hover:text-feather-white hover:bg-carbon-gray/50'
                  )}
                >
                  {item.label}
                  {item.comingSoon && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-feather-gold/20 text-feather-gold font-medium">
                      Soon
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Connect Button */}
          <div className="flex items-center gap-4" data-testid="wallet-connection">
            <ConnectButton
              chainStatus="icon"
              accountStatus={{
                smallScreen: 'avatar',
                largeScreen: 'full',
              }}
              showBalance={false}
            />
          </div>
        </div>
      </div>
    </header>
  );
}
