'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useChainId } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { cn } from '@/lib/utils';
import { FheSessionIndicator } from '@/components/common/FheSessionIndicator';
import { useSelectedPool } from '@/stores/poolStore';
import { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  testnetOnly?: boolean;
  comingSoon?: boolean;
}

const navItems: NavItem[] = [
  { href: '/trade', label: 'Trade' },
  { href: '/liquidity', label: 'Liquidity' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/auctions', label: 'Auctions', comingSoon: true },
  { href: '/launchpad', label: 'Launchpad', comingSoon: true },
];

// Testnets and local development chains
const TESTNET_CHAIN_IDS = [31337, 11155111, 421614, 8008135];

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function HookAddressBadge() {
  const { hookAddress, contractType, isLoading, pool } = useSelectedPool();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const addr = hookAddress || pool?.hook;
    if (!addr) return;
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [hookAddress, pool?.hook]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-carbon-gray/50 border border-carbon-gray text-xs">
        <span className="text-steel-gray animate-pulse">Loading...</span>
      </div>
    );
  }

  // Show "No pool" if no pool selected
  if (!pool) {
    return (
      <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-carbon-gray/50 border border-carbon-gray text-xs">
        <span className="text-steel-gray">No pool</span>
      </div>
    );
  }

  // Use pool.hook directly as fallback
  const displayAddress = hookAddress || pool.hook;

  if (!displayAddress || displayAddress === '0x0000000000000000000000000000000000000000') {
    return (
      <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-carbon-gray/50 border border-carbon-gray text-xs">
        <span className="text-steel-gray">Native</span>
      </div>
    );
  }

  const typeLabel = contractType === 'v8fhe' ? 'FHE' : contractType === 'v8mixed' ? 'Mixed' : 'Hook';
  const typeColor = contractType === 'v8fhe'
    ? 'text-phoenix-ember'
    : contractType === 'v8mixed'
      ? 'text-feather-gold'
      : 'text-steel-gray';

  return (
    <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-carbon-gray/50 border border-carbon-gray text-xs">
      <span className={cn('font-medium', typeColor)}>{typeLabel}</span>
      <span className="text-steel-gray">|</span>
      <span className="font-mono text-feather-white/70">{truncateAddress(displayAddress)}</span>
      <button
        onClick={handleCopy}
        className="p-0.5 rounded hover:bg-carbon-gray transition-colors"
        title={copied ? 'Copied!' : 'Copy hook address'}
      >
        {copied ? (
          <Check className="w-3 h-3 text-green-400" />
        ) : (
          <Copy className="w-3 h-3 text-steel-gray hover:text-feather-white" />
        )}
      </button>
    </div>
  );
}

/**
 * Full header for dApp pages
 * Includes logo, navigation, wallet connect, and network selector
 */
export function DAppHeader() {
  const pathname = usePathname();
  const chainId = useChainId();

  const isTestnet = TESTNET_CHAIN_IDS.includes(chainId);

  // Filter nav items based on network
  const visibleNavItems = navItems.filter(item => !item.testnetOnly || isTestnet);

  return (
    <header className="sticky top-0 z-40 bg-obsidian-black/80 backdrop-blur-lg border-b border-carbon-gray/50">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo + Hook Address */}
          <div className="flex items-center gap-3">
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
            <HookAddressBadge />
          </div>

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

          {/* FHE Session + Connect Button */}
          <div className="flex items-center gap-3" data-testid="wallet-connection">
            <FheSessionIndicator />
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
