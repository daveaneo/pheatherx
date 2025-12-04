'use client';

import Link from 'next/link';

/**
 * Minimal header for the homepage/marketing pages
 * Only shows logo and "Launch dApp" button - no wallet connect or navigation
 */
export function HomepageHeader() {
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
              PheatherX
            </span>
          </Link>

          {/* Launch dApp Button */}
          <Link
            href="/portfolio"
            className="px-5 py-2 rounded-lg font-medium text-sm bg-gradient-to-r from-phoenix-ember to-deep-magenta text-feather-white hover:brightness-110 transition-all"
          >
            Launch dApp
          </Link>
        </div>
      </div>
    </header>
  );
}
