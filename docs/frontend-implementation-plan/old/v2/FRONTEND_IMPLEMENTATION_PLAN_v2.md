# FheatherX Frontend Implementation Plan v2

**Version:** 2.0
**Based on:** web-app-specs-v2.md + Implementation Plan v1 Critique
**Created:** November 2024

---

## Executive Summary

This document outlines the implementation plan for the FheatherX frontend. Version 2 incorporates critical feedback regarding FHE integration complexity, Uniswap v4 router patterns, state management, and event indexing.

**Key Changes from v1:**
- New Phase 1.5 for FHE Infrastructure
- Proper FHE session/permit flow
- Uniswap v4 router integration for swaps
- Zustand state management architecture
- Event indexing for order history
- Error boundaries and recovery flows
- Mobile-first component patterns

---

## Table of Contents

1. [Implementation Phases Overview](#1-implementation-phases-overview)
2. [Phase 0: Project Setup](#2-phase-0-project-setup)
3. [Phase 1: Core Infrastructure](#3-phase-1-core-infrastructure)
4. [Phase 1.5: FHE Infrastructure](#4-phase-15-fhe-infrastructure)
5. [Phase 2: Portfolio & Balances](#5-phase-2-portfolio--balances)
6. [Phase 3: Swap Interface](#6-phase-3-swap-interface)
7. [Phase 4: Limit Orders](#7-phase-4-limit-orders)
8. [Phase 5: Analytics Dashboard](#8-phase-5-analytics-dashboard)
9. [Phase 6: Polish & Placeholders](#9-phase-6-polish--placeholders)
10. [Phase 7: Testing & QA](#10-phase-7-testing--qa)
11. [Technical Dependencies](#11-technical-dependencies)
12. [Risk Mitigation](#12-risk-mitigation)

**Appendices (separate files):**
- [Appendix A: FHE Integration Details](./FRONTEND_IMPL_v2_APPENDIX_A_FHE.md)
- [Appendix B: State Management Architecture](./FRONTEND_IMPL_v2_APPENDIX_B_STATE.md)
- [Appendix C: Component Specifications](./FRONTEND_IMPL_v2_APPENDIX_C_COMPONENTS.md)

---

## 1. Implementation Phases Overview

```
Phase 0: Project Setup
    │
    ▼
Phase 1: Core Infrastructure
    │   ├── Design System & UI Components
    │   ├── Wallet Connection (RainbowKit)
    │   ├── Network Configuration
    │   └── Contract ABIs & Base Hooks
    │
    ▼
Phase 1.5: FHE Infrastructure  ← NEW
    │   ├── FHE Client Wrapper (cofhejs)
    │   ├── Session/Permit Management
    │   ├── Encrypted Value Encoding
    │   ├── Decryption Flow with Progress
    │   └── FHE State Store (Zustand)
    │
    ▼
Phase 2: Portfolio & Balances
    │   ├── Deposit Flow (plaintext)
    │   ├── Withdraw Flow (plaintext)
    │   ├── Balance Display (encrypted)
    │   └── Balance Reveal (FHE decrypt)
    │
    ▼
Phase 3: Swap Interface
    │   ├── Uniswap v4 Router Integration  ← CHANGED
    │   ├── hookData Encoding for Privacy
    │   ├── Transaction Simulation
    │   └── Swap Execution & Status
    │
    ▼
Phase 4: Limit Orders
    │   ├── Order Form (4 types)
    │   ├── FHE Encryption + allow()
    │   ├── Active Orders Management
    │   ├── Order History (Event Indexing)  ← CHANGED
    │   └── Cancel Flow
    │
    ▼
Phase 5: Analytics Dashboard
    │   ├── Pool Metrics
    │   ├── Price Charts
    │   └── User Statistics
    │
    ▼
Phase 6: Polish & Placeholders
    │   ├── Landing Page
    │   ├── Auctions/Launchpad (Coming Soon)
    │   └── Mobile Optimizations  ← NEW
    │
    ▼
Phase 7: Testing & QA
    │   ├── Unit Tests
    │   ├── Integration Tests
    │   └── E2E Tests
```

---

## 2. Phase 0: Project Setup

**Goal:** Initialize the project with all necessary tooling.

### 2.1 Initialize Next.js Project

```bash
cd /home/david/PycharmProjects/fheatherx/frontend
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir
```

### 2.2 Install Dependencies

```bash
# Core
npm install wagmi viem @tanstack/react-query
npm install @rainbow-me/rainbowkit
npm install zustand immer
npm install framer-motion
npm install react-hook-form zod @hookform/resolvers
npm install lightweight-charts
npm install date-fns
npm install clsx tailwind-merge class-variance-authority

# FHE (when available)
npm install cofhejs

# Uniswap utilities
npm install @uniswap/sdk-core @uniswap/v3-sdk

# Dev
npm install -D @types/node prettier prettier-plugin-tailwindcss
npm install -D vitest @testing-library/react @testing-library/jest-dom
npm install -D playwright
```

### 2.3 Project Structure

```
frontend/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── providers.tsx
│   │   ├── swap/
│   │   ├── orders/
│   │   │   ├── new/
│   │   │   ├── active/
│   │   │   └── history/
│   │   ├── portfolio/
│   │   ├── analytics/
│   │   ├── auctions/
│   │   └── launchpad/
│   ├── components/
│   │   ├── ui/                   # Base UI components
│   │   ├── layout/               # Header, Footer, Nav
│   │   ├── swap/
│   │   ├── orders/
│   │   ├── portfolio/
│   │   ├── analytics/
│   │   └── common/               # Shared components
│   │       ├── ErrorBoundary.tsx
│   │       ├── ConnectPrompt.tsx
│   │       └── FheSessionGuard.tsx
│   ├── hooks/
│   │   ├── useContract.ts
│   │   ├── useFheSession.ts
│   │   ├── useBalanceReveal.ts
│   │   ├── useSwap.ts
│   │   ├── usePlaceOrder.ts
│   │   ├── useOrderHistory.ts
│   │   └── useIsMobile.ts
│   ├── lib/
│   │   ├── contracts/
│   │   │   ├── abi.ts
│   │   │   ├── addresses.ts
│   │   │   ├── router.ts
│   │   │   └── encoding.ts
│   │   ├── fhe/
│   │   │   ├── client.ts
│   │   │   ├── session.ts
│   │   │   └── encoding.ts
│   │   ├── uniswap/
│   │   │   ├── ticks.ts
│   │   │   ├── prices.ts
│   │   │   └── poolKey.ts
│   │   ├── chains.ts
│   │   ├── tokens.ts
│   │   ├── orders.ts
│   │   └── utils.ts
│   ├── stores/
│   │   ├── fheStore.ts
│   │   ├── ordersStore.ts
│   │   └── uiStore.ts
│   ├── styles/
│   │   └── globals.css
│   └── types/
│       ├── fhe.ts
│       ├── orders.ts
│       └── tokens.ts
├── public/
├── .env.example
├── tailwind.config.ts
└── package.json
```

### 2.4 Environment Configuration

```env
# .env.example

# RPC URLs
NEXT_PUBLIC_LOCAL_RPC_URL=http://localhost:8545
NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
NEXT_PUBLIC_FHENIX_RPC_URL=https://testnet.fhenix.io

# Contract Addresses - FheatherX Hook
NEXT_PUBLIC_FHEATHERX_ADDRESS_LOCAL=0x...
NEXT_PUBLIC_FHEATHERX_ADDRESS_BASE_SEPOLIA=0x...
NEXT_PUBLIC_FHEATHERX_ADDRESS_FHENIX=0x...

# Contract Addresses - Uniswap v4 Router
NEXT_PUBLIC_SWAP_ROUTER_ADDRESS_LOCAL=0x...
NEXT_PUBLIC_SWAP_ROUTER_ADDRESS_BASE_SEPOLIA=0x...
NEXT_PUBLIC_SWAP_ROUTER_ADDRESS_FHENIX=0x...

# Contract Addresses - Pool Manager
NEXT_PUBLIC_POOL_MANAGER_ADDRESS_LOCAL=0x...
NEXT_PUBLIC_POOL_MANAGER_ADDRESS_BASE_SEPOLIA=0x...
NEXT_PUBLIC_POOL_MANAGER_ADDRESS_FHENIX=0x...

# Token Addresses
NEXT_PUBLIC_TOKEN0_ADDRESS=0x...
NEXT_PUBLIC_TOKEN1_ADDRESS=0x...

# Pool Configuration
NEXT_PUBLIC_POOL_FEE=3000
NEXT_PUBLIC_TICK_SPACING=60

# WalletConnect
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id
```

### 2.5 Deliverables

- [ ] Next.js project initialized
- [ ] All dependencies installed
- [ ] Directory structure created
- [ ] Environment variables configured
- [ ] TypeScript strict mode enabled
- [ ] ESLint + Prettier configured

---

## 3. Phase 1: Core Infrastructure

**Goal:** Design system, wallet connection, network config, contract basics.

### 3.1 Tailwind Configuration

See [Appendix C: Component Specifications](./FRONTEND_IMPL_v2_APPENDIX_C_COMPONENTS.md) for full Tailwind config with FheatherX theme tokens.

Key colors:
- `phoenix-ember`: #FF6A3D
- `feather-gold`: #F0C27B
- `obsidian-black`: #0A0A0F
- `ash-gray`: #1C1E26
- `iridescent-violet`: #6B5BFF
- `electric-teal`: #19C9A0
- `deep-magenta`: #D6246E

### 3.2 Chain Configuration

```typescript
// src/lib/chains.ts
import { Chain } from 'wagmi/chains';

export const localAnvil: Chain = {
  id: 31337,
  name: 'Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_LOCAL_RPC_URL!] },
  },
};

export const baseSepolia: Chain = {
  id: 84532,
  name: 'Base Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL!] },
  },
  blockExplorers: {
    default: { name: 'BaseScan', url: 'https://sepolia.basescan.org' },
  },
  testnet: true,
};

export const fhenixTestnet: Chain = {
  id: 8008135,
  name: 'Fhenix Testnet',
  nativeCurrency: { name: 'FHE', symbol: 'FHE', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_FHENIX_RPC_URL!] },
  },
  testnet: true,
};

export const supportedChains = [localAnvil, baseSepolia, fhenixTestnet] as const;

// FHE support level per network
export type FheSupport = 'full' | 'mock' | 'none';
export const fheSupport: Record<number, FheSupport> = {
  31337: 'mock',
  84532: 'mock',
  8008135: 'full',
};
```

### 3.3 Wallet Configuration

```typescript
// src/lib/wagmi.ts
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { supportedChains } from './chains';

export const wagmiConfig = getDefaultConfig({
  appName: 'FheatherX',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
  chains: supportedChains,
  ssr: true,
});
```

### 3.4 Base UI Components

Build these primitive components (details in Appendix C):

- [ ] `Button` - Primary, secondary, danger, ghost variants
- [ ] `Card` - Container with glow effects
- [ ] `Input` - Form input with validation states
- [ ] `Modal` - Centered modal (desktop) / BottomSheet (mobile)
- [ ] `BottomSheet` - Mobile-optimized modal
- [ ] `Select` - Custom dropdown
- [ ] `Tabs` - Tab navigation
- [ ] `Badge` - Status indicators
- [ ] `Skeleton` - Loading placeholders
- [ ] `Toast` - Notifications
- [ ] `Tooltip` - Information tooltips
- [ ] `Progress` - Progress bar for FHE operations

### 3.5 Layout Components

```typescript
// src/components/layout/Header.tsx
'use client';

import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { usePathname } from 'next/navigation';
import { FheSessionIndicator } from './FheSessionIndicator';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/swap', label: 'Swap' },
  { href: '/orders', label: 'Orders' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/auctions', label: 'Auctions', badge: 'Soon' },
  { href: '/launchpad', label: 'Launchpad', badge: 'Soon' },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-obsidian-black/80 backdrop-blur-lg border-b border-carbon-gray">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="font-display font-bold text-2xl bg-flame-gradient bg-clip-text text-transparent">
          FheatherX
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                pathname.startsWith(item.href)
                  ? 'text-phoenix-ember bg-phoenix-ember/10'
                  : 'text-feather-white/70 hover:text-feather-white'
              )}
            >
              {item.label}
              {item.badge && (
                <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-iridescent-violet/20 text-iridescent-violet">
                  {item.badge}
                </span>
              )}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <FheSessionIndicator />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
```

### 3.6 Error Boundary

```typescript
// src/components/common/ErrorBoundary.tsx
'use client';

import { Component, ReactNode } from 'react';
import { Button } from '@/components/ui/Button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="card text-center py-12 max-w-md mx-auto">
            <div className="text-4xl mb-4">⚠️</div>
            <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
            <p className="text-feather-white/60 mb-6 text-sm">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <Button onClick={this.handleReset}>Try Again</Button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
```

### 3.7 Deliverables

- [ ] Tailwind config with FheatherX theme
- [ ] Global styles with design tokens
- [ ] All base UI components
- [ ] Header with navigation
- [ ] Mobile bottom navigation
- [ ] Error boundary component
- [ ] Providers setup (wagmi, RainbowKit, QueryClient)
- [ ] Root layout

---

## 4. Phase 1.5: FHE Infrastructure

**Goal:** Proper FHE client wrapper with session management, encryption, and decryption flows.

> **Critical:** This phase is essential before any encrypted operations. See [Appendix A: FHE Integration Details](./FRONTEND_IMPL_v2_APPENDIX_A_FHE.md) for complete implementation.

### 4.1 FHE Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        User Wallet                          │
└─────────────────────────┬───────────────────────────────────┘
                          │ Signs permit message
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    FHE Session Manager                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Permit Store │  │ FhenixClient │  │ Session Timer│      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │ Encrypt  │    │ Decrypt  │    │  allow() │
    │  Values  │    │ Balances │    │ On-chain │
    └──────────┘    └──────────┘    └──────────┘
```

### 4.2 FHE Client Wrapper

```typescript
// src/lib/fhe/client.ts
import { FhenixClient, Permit } from 'cofhejs';

export interface FheSession {
  permit: Permit;
  client: FhenixClient;
  contractAddress: string;
  createdAt: number;
  expiresAt: number;
}

export class FheatherXFheClient {
  private session: FheSession | null = null;
  private provider: any;

  constructor(provider: any) {
    this.provider = provider;
  }

  async initSession(contractAddress: string): Promise<FheSession> {
    const client = new FhenixClient({ provider: this.provider });

    // This prompts user to sign a message
    const permit = await client.generatePermit(contractAddress, this.provider);

    const session: FheSession = {
      permit,
      client,
      contractAddress,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    };

    this.session = session;
    return session;
  }

  isSessionValid(): boolean {
    return this.session !== null && Date.now() < this.session.expiresAt;
  }

  getSession(): FheSession | null {
    if (!this.isSessionValid()) return null;
    return this.session;
  }

  async encryptUint128(value: bigint): Promise<Uint8Array> {
    if (!this.session) throw new Error('No FHE session');
    return this.session.client.encrypt_uint128(value, this.session.contractAddress);
  }

  async encryptBool(value: boolean): Promise<Uint8Array> {
    if (!this.session) throw new Error('No FHE session');
    return this.session.client.encrypt_bool(value, this.session.contractAddress);
  }

  async unseal(ciphertext: string): Promise<bigint> {
    if (!this.session) throw new Error('No FHE session');
    return this.session.client.unseal(
      this.session.contractAddress,
      ciphertext,
      this.session.permit
    );
  }

  clearSession(): void {
    this.session = null;
  }
}
```

### 4.3 FHE State Store

```typescript
// src/stores/fheStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type SessionStatus = 'disconnected' | 'initializing' | 'ready' | 'expired' | 'error';

interface RevealedBalance {
  value: bigint;
  revealedAt: number;
}

interface FheState {
  // Session
  sessionStatus: SessionStatus;
  sessionError: string | null;
  sessionExpiresAt: number | null;

  // Cached revealed balances
  revealedBalances: Record<string, RevealedBalance>;

  // Actions
  setSessionStatus: (status: SessionStatus, error?: string) => void;
  setSessionExpiry: (expiresAt: number) => void;
  cacheBalance: (key: string, value: bigint) => void;
  getCachedBalance: (key: string) => RevealedBalance | null;
  clearBalances: () => void;
  reset: () => void;
}

export const useFheStore = create<FheState>()(
  persist(
    (set, get) => ({
      sessionStatus: 'disconnected',
      sessionError: null,
      sessionExpiresAt: null,
      revealedBalances: {},

      setSessionStatus: (status, error) =>
        set({ sessionStatus: status, sessionError: error || null }),

      setSessionExpiry: (expiresAt) =>
        set({ sessionExpiresAt: expiresAt }),

      cacheBalance: (key, value) =>
        set((state) => ({
          revealedBalances: {
            ...state.revealedBalances,
            [key]: { value, revealedAt: Date.now() },
          },
        })),

      getCachedBalance: (key) => {
        const cached = get().revealedBalances[key];
        if (!cached) return null;
        // Expire after 5 minutes
        if (Date.now() - cached.revealedAt > 5 * 60 * 1000) return null;
        return cached;
      },

      clearBalances: () => set({ revealedBalances: {} }),

      reset: () =>
        set({
          sessionStatus: 'disconnected',
          sessionError: null,
          sessionExpiresAt: null,
          revealedBalances: {},
        }),
    }),
    {
      name: 'fheatherx-fhe',
      partialize: (state) => ({
        revealedBalances: state.revealedBalances,
      }),
    }
  )
);
```

### 4.4 FHE Session Hook

```typescript
// src/hooks/useFheSession.ts
'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { useEthersProvider } from '@/hooks/useEthersProvider';
import { FheatherXFheClient } from '@/lib/fhe/client';
import { useFheStore } from '@/stores/fheStore';
import { FHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';
import { fheSupport } from '@/lib/chains';

export function useFheSession() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const provider = useEthersProvider();
  const clientRef = useRef<FheatherXFheClient | null>(null);

  const {
    sessionStatus,
    sessionError,
    sessionExpiresAt,
    setSessionStatus,
    setSessionExpiry,
    reset,
  } = useFheStore();

  const hookAddress = FHEATHERX_ADDRESSES[chainId];
  const networkFheSupport = fheSupport[chainId];

  // Initialize session
  const initialize = useCallback(async () => {
    if (!provider || !hookAddress || !isConnected) {
      setSessionStatus('disconnected');
      return;
    }

    // Mock mode - no real FHE needed
    if (networkFheSupport === 'mock') {
      setSessionStatus('ready');
      setSessionExpiry(Date.now() + 24 * 60 * 60 * 1000);
      return;
    }

    setSessionStatus('initializing');

    try {
      const client = new FheatherXFheClient(provider);
      const session = await client.initSession(hookAddress);

      clientRef.current = client;
      setSessionStatus('ready');
      setSessionExpiry(session.expiresAt);
    } catch (error) {
      setSessionStatus('error', error instanceof Error ? error.message : 'Failed to initialize');
    }
  }, [provider, hookAddress, isConnected, networkFheSupport, setSessionStatus, setSessionExpiry]);

  // Check expiry
  useEffect(() => {
    if (sessionExpiresAt && Date.now() > sessionExpiresAt) {
      setSessionStatus('expired');
    }
  }, [sessionExpiresAt, setSessionStatus]);

  // Reset on disconnect
  useEffect(() => {
    if (!isConnected) {
      reset();
      clientRef.current = null;
    }
  }, [isConnected, reset]);

  return {
    status: sessionStatus,
    error: sessionError,
    expiresAt: sessionExpiresAt,
    client: clientRef.current,
    isReady: sessionStatus === 'ready',
    isMock: networkFheSupport === 'mock',
    initialize,
  };
}
```

### 4.5 FHE Session Indicator

```typescript
// src/components/layout/FheSessionIndicator.tsx
'use client';

import { useFheSession } from '@/hooks/useFheSession';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';

export function FheSessionIndicator() {
  const { status, isReady, isMock, initialize, expiresAt } = useFheSession();

  if (status === 'disconnected') return null;

  const getStatusColor = () => {
    switch (status) {
      case 'ready': return 'bg-electric-teal';
      case 'initializing': return 'bg-feather-gold animate-pulse';
      case 'expired': return 'bg-deep-magenta';
      case 'error': return 'bg-deep-magenta';
      default: return 'bg-carbon-gray';
    }
  };

  const getStatusText = () => {
    if (isMock) return 'Mock FHE';
    switch (status) {
      case 'ready': return 'Privacy Ready';
      case 'initializing': return 'Initializing...';
      case 'expired': return 'Session Expired';
      case 'error': return 'Session Error';
      default: return 'Not Ready';
    }
  };

  return (
    <Tooltip content={isMock ? 'Using mock FHE on this network' : `Session ${status}`}>
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
        <span className="text-xs text-feather-white/60 hidden sm:block">
          {getStatusText()}
        </span>
        {(status === 'expired' || status === 'error') && (
          <Button size="sm" variant="ghost" onClick={initialize}>
            Retry
          </Button>
        )}
      </div>
    </Tooltip>
  );
}
```

### 4.6 FHE Session Guard

```typescript
// src/components/common/FheSessionGuard.tsx
'use client';

import { ReactNode } from 'react';
import { useFheSession } from '@/hooks/useFheSession';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

interface Props {
  children: ReactNode;
  requireSession?: boolean;
}

export function FheSessionGuard({ children, requireSession = true }: Props) {
  const { status, error, initialize, isMock } = useFheSession();

  // Mock mode - always allow
  if (isMock) return <>{children}</>;

  // Not required - always allow
  if (!requireSession) return <>{children}</>;

  // Ready - allow
  if (status === 'ready') return <>{children}</>;

  // Initializing - show loading
  if (status === 'initializing') {
    return (
      <Card className="text-center py-12 max-w-md mx-auto">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-phoenix-ember/20 flex items-center justify-center animate-pulse-ember">
          <span className="text-xl">🔐</span>
        </div>
        <h3 className="font-semibold mb-2">Initializing Privacy Session</h3>
        <p className="text-sm text-feather-white/60">
          Please sign the message in your wallet to enable encrypted operations.
        </p>
      </Card>
    );
  }

  // Need to initialize
  return (
    <Card className="text-center py-12 max-w-md mx-auto">
      <div className="text-4xl mb-4">🔐</div>
      <h3 className="font-semibold mb-2">Privacy Session Required</h3>
      <p className="text-sm text-feather-white/60 mb-6">
        To use encrypted features, you need to initialize a privacy session.
        This requires signing a message with your wallet.
      </p>
      {error && (
        <p className="text-sm text-deep-magenta mb-4">{error}</p>
      )}
      <Button onClick={initialize}>
        Initialize Privacy Session
      </Button>
    </Card>
  );
}
```

### 4.7 Deliverables

- [ ] FHE client wrapper class
- [ ] FHE session state store (Zustand)
- [ ] `useFheSession` hook
- [ ] FHE session indicator in header
- [ ] FHE session guard component
- [ ] Mock FHE client for non-Fhenix networks
- [ ] Balance caching with expiry
- [ ] Session expiry handling

---

## 5. Phase 2: Portfolio & Balances

**Goal:** Deposit, withdraw, and encrypted balance management.

### 5.1 Balance Reveal Hook

```typescript
// src/hooks/useBalanceReveal.ts
'use client';

import { useState, useCallback } from 'react';
import { useAccount, useChainId, useReadContract } from 'wagmi';
import { useFheSession } from './useFheSession';
import { useFheStore } from '@/stores/fheStore';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { FHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';

type RevealStatus = 'idle' | 'fetching' | 'decrypting' | 'revealed' | 'error';

export function useBalanceReveal(isToken0: boolean) {
  const { address } = useAccount();
  const chainId = useChainId();
  const hookAddress = FHEATHERX_ADDRESSES[chainId];
  const { client, isReady, isMock } = useFheSession();
  const { cacheBalance, getCachedBalance } = useFheStore();

  const [status, setStatus] = useState<RevealStatus>('idle');
  const [value, setValue] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const cacheKey = `${address}-${chainId}-${isToken0 ? 'token0' : 'token1'}`;

  // Check cache on mount
  const cached = getCachedBalance(cacheKey);
  if (cached && status === 'idle') {
    setValue(cached.value);
    setStatus('revealed');
  }

  const reveal = useCallback(async () => {
    if (!address || !hookAddress) {
      setError('Wallet not connected');
      setStatus('error');
      return;
    }

    // Check cache first
    const cached = getCachedBalance(cacheKey);
    if (cached) {
      setValue(cached.value);
      setStatus('revealed');
      return cached.value;
    }

    try {
      setStatus('fetching');
      setProgress(10);

      // Mock mode - return fake balance
      if (isMock) {
        await new Promise((r) => setTimeout(r, 500));
        const mockValue = BigInt(Math.floor(Math.random() * 10) * 1e18);
        setValue(mockValue);
        cacheBalance(cacheKey, mockValue);
        setStatus('revealed');
        setProgress(100);
        return mockValue;
      }

      // Real FHE mode
      if (!client || !isReady) {
        throw new Error('FHE session not ready');
      }

      // Fetch encrypted balance from contract
      // (This would use useReadContract, simplified here)
      setProgress(30);

      // Decrypt
      setStatus('decrypting');
      const progressInterval = setInterval(() => {
        setProgress((p) => Math.min(p + 10, 90));
      }, 1000);

      // const decrypted = await client.unseal(encryptedBalance);
      const decrypted = BigInt(0); // Placeholder

      clearInterval(progressInterval);
      setProgress(100);

      setValue(decrypted);
      cacheBalance(cacheKey, decrypted);
      setStatus('revealed');

      return decrypted;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reveal');
      setStatus('error');
    }
  }, [address, hookAddress, client, isReady, isMock, cacheKey, cacheBalance, getCachedBalance]);

  const hide = useCallback(() => {
    setValue(null);
    setStatus('idle');
    setProgress(0);
  }, []);

  return {
    status,
    value,
    error,
    progress,
    reveal,
    hide,
    isRevealing: status === 'fetching' || status === 'decrypting',
    isRevealed: status === 'revealed',
  };
}
```

### 5.2 Deposit/Withdraw Hooks

```typescript
// src/hooks/useDeposit.ts
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { useFheatherXAddress } from './useContract';

export function useDeposit() {
  const hookAddress = useFheatherXAddress();
  const { writeContractAsync, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const deposit = async (isToken0: boolean, amount: bigint) => {
    return writeContractAsync({
      address: hookAddress,
      abi: FHEATHERX_ABI,
      functionName: 'deposit',
      args: [isToken0, amount],
    });
  };

  return {
    deposit,
    hash,
    isPending,
    isConfirming,
    isSuccess,
  };
}
```

### 5.3 Portfolio Page

```typescript
// src/app/portfolio/page.tsx
'use client';

import { useAccount } from 'wagmi';
import { ConnectPrompt } from '@/components/common/ConnectPrompt';
import { FheSessionGuard } from '@/components/common/FheSessionGuard';
import { BalanceCard } from '@/components/portfolio/BalanceCard';
import { ActivityList } from '@/components/portfolio/ActivityList';

export default function PortfolioPage() {
  const { isConnected } = useAccount();

  if (!isConnected) {
    return <ConnectPrompt message="Connect your wallet to view your portfolio" />;
  }

  return (
    <FheSessionGuard>
      <div className="max-w-4xl mx-auto py-8 px-4">
        <h1 className="text-3xl font-heading font-bold mb-8">Portfolio</h1>

        <div className="space-y-4 mb-8">
          <BalanceCard
            token={{ symbol: 'ETH', name: 'Ethereum', decimals: 18 }}
            isToken0={true}
          />
          <BalanceCard
            token={{ symbol: 'USDC', name: 'USD Coin', decimals: 6 }}
            isToken0={false}
          />
        </div>

        <h2 className="text-xl font-heading font-semibold mb-4">Recent Activity</h2>
        <ActivityList />
      </div>
    </FheSessionGuard>
  );
}
```

### 5.4 Deliverables

- [ ] `useBalanceReveal` hook with progress
- [ ] `useDeposit` hook
- [ ] `useWithdraw` hook
- [ ] Portfolio page layout
- [ ] BalanceCard component with reveal flow
- [ ] DepositModal with approve + deposit
- [ ] WithdrawModal
- [ ] ActivityList with event fetching
- [ ] "In Orders" balance calculation

---

## 6. Phase 3: Swap Interface

**Goal:** Swap via Uniswap v4 router with proper hookData encoding.

### 6.1 Router Integration

```typescript
// src/lib/contracts/router.ts
export const SWAP_ROUTER_ABI = [
  {
    name: 'swap',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'key',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'zeroForOne', type: 'bool' },
          { name: 'amountSpecified', type: 'int256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [{ name: 'delta', type: 'int256' }],
  },
] as const;

// Pool key construction
export function getPoolKey(hookAddress: `0x${string}`) {
  return {
    currency0: process.env.NEXT_PUBLIC_TOKEN0_ADDRESS as `0x${string}`,
    currency1: process.env.NEXT_PUBLIC_TOKEN1_ADDRESS as `0x${string}`,
    fee: Number(process.env.NEXT_PUBLIC_POOL_FEE),
    tickSpacing: Number(process.env.NEXT_PUBLIC_TICK_SPACING),
    hooks: hookAddress,
  };
}
```

### 6.2 Swap Hook

```typescript
// src/hooks/useSwap.ts
import { useWriteContract, usePublicClient } from 'wagmi';
import { parseEther } from 'viem';
import { SWAP_ROUTER_ABI, getPoolKey } from '@/lib/contracts/router';
import { useFheatherXAddress, useRouterAddress } from './useContract';
import { useFheSession } from './useFheSession';
import { encodeSwapHookData } from '@/lib/fhe/encoding';
import { MIN_SQRT_RATIO, MAX_SQRT_RATIO } from '@/lib/uniswap/constants';

interface SwapParams {
  zeroForOne: boolean;
  amountIn: bigint;
  minAmountOut: bigint;
}

export function useSwap() {
  const hookAddress = useFheatherXAddress();
  const routerAddress = useRouterAddress();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();
  const { client: fheClient, isMock } = useFheSession();

  const swap = async (params: SwapParams) => {
    const poolKey = getPoolKey(hookAddress);

    // Encode hookData for privacy (optional extra privacy layer)
    let hookData = '0x' as `0x${string}`;
    if (!isMock && fheClient) {
      hookData = await encodeSwapHookData(fheClient, {
        minOutput: params.minAmountOut,
      });
    }

    const swapParams = {
      zeroForOne: params.zeroForOne,
      amountSpecified: params.zeroForOne
        ? -BigInt(params.amountIn) // Exact input for zeroForOne
        : BigInt(params.amountIn),
      sqrtPriceLimitX96: params.zeroForOne
        ? MIN_SQRT_RATIO + 1n
        : MAX_SQRT_RATIO - 1n,
    };

    // Simulate first
    await publicClient.simulateContract({
      address: routerAddress,
      abi: SWAP_ROUTER_ABI,
      functionName: 'swap',
      args: [poolKey, swapParams, hookData],
    });

    // Execute
    return writeContractAsync({
      address: routerAddress,
      abi: SWAP_ROUTER_ABI,
      functionName: 'swap',
      args: [poolKey, swapParams, hookData],
    });
  };

  return { swap, isPending };
}
```

### 6.3 Tick/Price Utilities

```typescript
// src/lib/uniswap/ticks.ts
import { TickMath } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';

export const MIN_SQRT_RATIO = BigInt(TickMath.MIN_SQRT_RATIO.toString());
export const MAX_SQRT_RATIO = BigInt(TickMath.MAX_SQRT_RATIO.toString());
export const MIN_TICK = TickMath.MIN_TICK;
export const MAX_TICK = TickMath.MAX_TICK;

/**
 * Convert price to tick using proper Uniswap math
 */
export function priceToTick(
  price: number,
  token0Decimals: number,
  token1Decimals: number,
  tickSpacing: number
): number {
  // Adjust for decimals
  const adjustedPrice = price * Math.pow(10, token0Decimals - token1Decimals);

  // price = 1.0001^tick, so tick = log(price) / log(1.0001)
  const tick = Math.floor(Math.log(adjustedPrice) / Math.log(1.0001));

  // Round to nearest valid tick
  return nearestUsableTick(tick, tickSpacing);
}

/**
 * Convert tick to price
 */
export function tickToPrice(
  tick: number,
  token0Decimals: number,
  token1Decimals: number
): number {
  const rawPrice = Math.pow(1.0001, tick);
  return rawPrice * Math.pow(10, token1Decimals - token0Decimals);
}

/**
 * Round tick to nearest valid tick for pool
 */
export function nearestUsableTick(tick: number, tickSpacing: number): number {
  const rounded = Math.round(tick / tickSpacing) * tickSpacing;
  return Math.max(MIN_TICK, Math.min(MAX_TICK, rounded));
}

/**
 * Calculate price from reserves
 */
export function priceFromReserves(
  reserve0: bigint,
  reserve1: bigint,
  token0Decimals: number,
  token1Decimals: number
): number {
  if (reserve0 === 0n) return 0;
  const r0 = Number(reserve0) / Math.pow(10, token0Decimals);
  const r1 = Number(reserve1) / Math.pow(10, token1Decimals);
  return r1 / r0;
}
```

### 6.4 Deliverables

- [ ] Router ABI and pool key construction
- [ ] `useSwap` hook with simulation
- [ ] Tick/price utilities with proper math
- [ ] Swap page with deposit check
- [ ] SwapCard component
- [ ] TokenSelector modal
- [ ] SlippageSettings modal
- [ ] Transaction status tracking
- [ ] Error handling for failed swaps

---

## 7. Phase 4: Limit Orders

**Goal:** Full order management with FHE encryption.

### 7.1 Order Placement Hook

```typescript
// src/hooks/usePlaceOrder.ts
import { useWriteContract, usePublicClient } from 'wagmi';
import { parseEther } from 'viem';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { PROTOCOL_FEE } from '@/lib/contracts/addresses';
import { useFheatherXAddress } from './useContract';
import { useFheSession } from './useFheSession';
import { encodeEncryptedBool, encodeEncryptedUint128 } from '@/lib/fhe/encoding';

interface PlaceOrderParams {
  triggerTick: number;
  direction: boolean;
  amount: bigint;
  minOutput: bigint;
}

export function usePlaceOrder() {
  const hookAddress = useFheatherXAddress();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();
  const { client: fheClient, isMock } = useFheSession();

  const placeOrder = async (params: PlaceOrderParams) => {
    let encDirection: `0x${string}`;
    let encAmount: `0x${string}`;
    let encMinOutput: `0x${string}`;

    if (isMock) {
      // Mock encoding for non-FHE networks
      encDirection = `0x${params.direction ? '01' : '00'}`;
      encAmount = `0x${params.amount.toString(16).padStart(32, '0')}`;
      encMinOutput = `0x${params.minOutput.toString(16).padStart(32, '0')}`;
    } else {
      if (!fheClient) throw new Error('FHE session not ready');

      // Encrypt parameters
      const rawDirection = await fheClient.encryptBool(params.direction);
      const rawAmount = await fheClient.encryptUint128(params.amount);
      const rawMinOutput = await fheClient.encryptUint128(params.minOutput);

      encDirection = encodeEncryptedBool(rawDirection);
      encAmount = encodeEncryptedUint128(rawAmount);
      encMinOutput = encodeEncryptedUint128(rawMinOutput);
    }

    // Simulate
    await publicClient.simulateContract({
      address: hookAddress,
      abi: FHEATHERX_ABI,
      functionName: 'placeOrder',
      args: [params.triggerTick, encDirection, encAmount, encMinOutput],
      value: parseEther(PROTOCOL_FEE.toString()),
    });

    // Execute
    return writeContractAsync({
      address: hookAddress,
      abi: FHEATHERX_ABI,
      functionName: 'placeOrder',
      args: [params.triggerTick, encDirection, encAmount, encMinOutput],
      value: parseEther(PROTOCOL_FEE.toString()),
    });
  };

  return { placeOrder, isPending };
}
```

### 7.2 Order History (Event Indexing)

```typescript
// src/hooks/useOrderHistory.ts
import { useQuery } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';
import { parseAbiItem } from 'viem';
import { useFheatherXAddress } from './useContract';

interface OrderEvent {
  orderId: bigint;
  type: 'placed' | 'filled' | 'cancelled';
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  triggerTick?: number;
  executor?: `0x${string}`;
}

export function useOrderHistory() {
  const { address } = useAccount();
  const hookAddress = useFheatherXAddress();
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ['orderHistory', address, hookAddress],
    queryFn: async (): Promise<OrderEvent[]> => {
      if (!address || !hookAddress) return [];

      const [placedLogs, filledLogs, cancelledLogs] = await Promise.all([
        publicClient.getLogs({
          address: hookAddress,
          event: parseAbiItem(
            'event OrderPlaced(uint256 indexed orderId, address indexed owner, int24 triggerTick)'
          ),
          args: { owner: address },
          fromBlock: 'earliest',
        }),
        publicClient.getLogs({
          address: hookAddress,
          event: parseAbiItem(
            'event OrderFilled(uint256 indexed orderId, address indexed owner, address indexed executor)'
          ),
          args: { owner: address },
          fromBlock: 'earliest',
        }),
        publicClient.getLogs({
          address: hookAddress,
          event: parseAbiItem(
            'event OrderCancelled(uint256 indexed orderId, address indexed owner)'
          ),
          args: { owner: address },
          fromBlock: 'earliest',
        }),
      ]);

      const events: OrderEvent[] = [
        ...placedLogs.map((log) => ({
          orderId: log.args.orderId!,
          type: 'placed' as const,
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          triggerTick: log.args.triggerTick,
        })),
        ...filledLogs.map((log) => ({
          orderId: log.args.orderId!,
          type: 'filled' as const,
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          executor: log.args.executor,
        })),
        ...cancelledLogs.map((log) => ({
          orderId: log.args.orderId!,
          type: 'cancelled' as const,
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
        })),
      ];

      // Sort by block number descending
      return events.sort((a, b) => Number(b.blockNumber - a.blockNumber));
    },
    enabled: !!address && !!hookAddress,
    staleTime: 30_000,
  });
}
```

### 7.3 Order Fill Notifications

```typescript
// src/hooks/useOrderFillNotifications.ts
import { useEffect } from 'react';
import { useAccount, useWatchContractEvent } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { useFheatherXAddress } from './useContract';
import { useToast } from './useToast';

export function useOrderFillNotifications() {
  const { address } = useAccount();
  const hookAddress = useFheatherXAddress();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useWatchContractEvent({
    address: hookAddress,
    abi: FHEATHERX_ABI,
    eventName: 'OrderFilled',
    onLogs: (logs) => {
      logs.forEach((log) => {
        if (log.args.owner?.toLowerCase() === address?.toLowerCase()) {
          toast({
            title: 'Order Filled!',
            description: `Order #${log.args.orderId} was executed`,
            variant: 'success',
          });

          // Invalidate queries
          queryClient.invalidateQueries({ queryKey: ['activeOrders'] });
          queryClient.invalidateQueries({ queryKey: ['orderHistory'] });
          queryClient.invalidateQueries({ queryKey: ['balances'] });
        }
      });
    },
    enabled: !!address && !!hookAddress,
  });
}
```

### 7.4 Deliverables

- [ ] `usePlaceOrder` hook with FHE encryption
- [ ] `useCancelOrder` hook
- [ ] `useOrderHistory` hook with event indexing
- [ ] `useOrderFillNotifications` hook
- [ ] Order type configuration and validation
- [ ] New order page with type tabs
- [ ] OrderForm component
- [ ] Active orders page
- [ ] OrderCard component
- [ ] Order history page
- [ ] CancelModal with confirmation
- [ ] Price visualization (trigger vs current)

---

## 8. Phase 5: Analytics Dashboard

**Goal:** Pool metrics, charts, and user statistics.

### 8.1 Metrics Hooks

```typescript
// src/hooks/usePoolMetrics.ts
import { useReadContract } from 'wagmi';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { useFheatherXAddress } from './useContract';
import { priceFromReserves } from '@/lib/uniswap/ticks';

export function usePoolMetrics() {
  const hookAddress = useFheatherXAddress();

  const { data: reserves } = useReadContract({
    address: hookAddress,
    abi: FHEATHERX_ABI,
    functionName: 'getReserves',
  });

  const reserve0 = reserves?.[0] ?? 0n;
  const reserve1 = reserves?.[1] ?? 0n;

  // Calculate TVL (simplified - assumes token1 is USD stablecoin)
  const tvl = Number(reserve0) / 1e18 * 2500 + Number(reserve1) / 1e6;

  // Calculate price
  const price = priceFromReserves(reserve0, reserve1, 18, 6);

  return {
    reserve0,
    reserve1,
    tvl,
    price,
  };
}
```

### 8.2 Deliverables

- [ ] `usePoolMetrics` hook
- [ ] `useVolumeData` hook (event aggregation)
- [ ] `useUserStats` hook
- [ ] Analytics page layout
- [ ] MetricCard component
- [ ] PriceChart component (Lightweight Charts)
- [ ] VolumeChart component
- [ ] UserStats component
- [ ] Time range selector

---

## 9. Phase 6: Polish & Placeholders

**Goal:** Landing page, placeholders, and mobile optimization.

### 9.1 Mobile Components

```typescript
// src/components/ui/BottomSheet.tsx
'use client';

import { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function BottomSheet({ isOpen, onClose, title, children }: BottomSheetProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 bg-obsidian-black/80 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed bottom-0 left-0 right-0 bg-carbon-gray rounded-t-2xl z-50 max-h-[85vh] overflow-auto"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            <div className="sticky top-0 bg-carbon-gray p-4 border-b border-ash-gray">
              <div className="w-12 h-1 bg-ash-gray rounded-full mx-auto mb-4" />
              {title && <h3 className="font-semibold text-center">{title}</h3>}
            </div>
            <div className="p-4">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// src/hooks/useIsMobile.ts
import { useState, useEffect } from 'react';

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return isMobile;
}

// Adaptive Modal that uses BottomSheet on mobile
export function AdaptiveModal({ children, ...props }) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return <BottomSheet {...props}>{children}</BottomSheet>;
  }

  return <Modal {...props}>{children}</Modal>;
}
```

### 9.2 Deliverables

- [ ] Landing page (hero, features, how it works, stats)
- [ ] Auctions placeholder page
- [ ] Launchpad placeholder page
- [ ] BottomSheet component
- [ ] AdaptiveModal component
- [ ] `useIsMobile` hook
- [ ] Mobile bottom navigation
- [ ] Touch-optimized buttons (48px min)
- [ ] Footer component

---

## 10. Phase 7: Testing & QA

### 10.1 Unit Tests

```typescript
// src/lib/uniswap/__tests__/ticks.test.ts
import { describe, it, expect } from 'vitest';
import { priceToTick, tickToPrice, nearestUsableTick } from '../ticks';

describe('tick utilities', () => {
  it('converts price to tick correctly', () => {
    const tick = priceToTick(2500, 18, 6, 60);
    expect(tick).toBeCloseTo(201180, -1); // Approximate
  });

  it('rounds to nearest usable tick', () => {
    expect(nearestUsableTick(100, 60)).toBe(120);
    expect(nearestUsableTick(130, 60)).toBe(120);
    expect(nearestUsableTick(150, 60)).toBe(180);
  });

  it('price to tick and back is consistent', () => {
    const originalPrice = 2500;
    const tick = priceToTick(originalPrice, 18, 6, 1);
    const recoveredPrice = tickToPrice(tick, 18, 6);
    expect(recoveredPrice).toBeCloseTo(originalPrice, 0);
  });
});
```

### 10.2 Test Coverage

- [ ] Tick/price conversion utilities
- [ ] Order validation logic
- [ ] FHE encoding/decoding (mock)
- [ ] Form validation
- [ ] Component rendering
- [ ] Hook behavior

### 10.3 E2E Tests

```typescript
// e2e/swap.spec.ts
import { test, expect } from '@playwright/test';

test('can complete a swap', async ({ page }) => {
  await page.goto('/swap');

  // Connect wallet (mock)
  await page.click('[data-testid="connect-wallet"]');

  // Select tokens
  await page.click('[data-testid="token-in-selector"]');
  await page.click('[data-testid="token-ETH"]');

  // Enter amount
  await page.fill('[data-testid="amount-input"]', '1.0');

  // Execute swap
  await page.click('[data-testid="swap-button"]');

  // Verify success
  await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
});
```

### 10.4 Deliverables

- [ ] Unit tests for utilities (>80% coverage)
- [ ] Component tests
- [ ] Integration tests for critical flows
- [ ] E2E tests for main user journeys
- [ ] QA checklist completed
- [ ] Performance audit
- [ ] Accessibility audit

---

## 11. Technical Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| next | 14.x | React framework |
| react | 18.x | UI library |
| typescript | 5.x | Type safety |
| tailwindcss | 3.x | Styling |
| wagmi | 2.x | Wallet integration |
| viem | 2.x | Contract interaction |
| @rainbow-me/rainbowkit | 2.x | Wallet UI |
| @tanstack/react-query | 5.x | Data fetching |
| zustand | 4.x | State management |
| immer | 10.x | Immutable updates |
| framer-motion | 11.x | Animations |
| react-hook-form | 7.x | Forms |
| zod | 3.x | Validation |
| lightweight-charts | 4.x | Price charts |
| @uniswap/v3-sdk | 3.x | Tick math |
| cofhejs | TBD | FHE client |
| date-fns | 3.x | Date formatting |
| class-variance-authority | 0.7.x | Component variants |

---

## 12. Risk Mitigation

### 12.1 Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| cofhejs API changes | High | Abstract behind client wrapper |
| FHE decryption slow | High | Progress UI, caching, session persistence |
| Contract ABI changes | Medium | Version ABIs, TypeScript types |
| Router not available | High | Deploy custom router or use test doubles |

### 12.2 UX Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| FHE session confusing | High | Clear onboarding, status indicator |
| Deposit-first not understood | High | Prominent messaging, guided flow |
| Order mechanics complex | Medium | In-context explanations, visual aids |

### 12.3 Security Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Session permit leaked | High | Don't persist permits, clear on disconnect |
| XSS attacks | High | Sanitize inputs, CSP headers |
| Transaction simulation bypass | Medium | Always simulate before execute |

---

## Appendices

The following appendices provide detailed implementation specifications:

- **[Appendix A: FHE Integration Details](./FRONTEND_IMPL_v2_APPENDIX_A_FHE.md)** - Complete FHE client, encoding, and session management
- **[Appendix B: State Management Architecture](./FRONTEND_IMPL_v2_APPENDIX_B_STATE.md)** - Zustand stores, caching strategies
- **[Appendix C: Component Specifications](./FRONTEND_IMPL_v2_APPENDIX_C_COMPONENTS.md)** - UI component code, Tailwind config

---

## Changelog from v1

### Added
- Phase 1.5: FHE Infrastructure
- FHE client wrapper with proper session/permit flow
- FHE state store (Zustand)
- FheSessionGuard component
- FheSessionIndicator component
- Uniswap v4 router integration for swaps
- Event indexing for order history
- Order fill notifications
- Error boundary component
- Transaction simulation before execution
- BottomSheet for mobile modals
- `useIsMobile` hook
- Proper tick math using @uniswap/v3-sdk

### Changed
- Swap now goes through router, not direct hook call
- Balance reveal includes proper fetch → decrypt flow
- Order placement includes FHE encoding
- All modals use AdaptiveModal (BottomSheet on mobile)

### Fixed
- FHE integration now reflects actual cofhejs patterns
- Tick/price math uses proper Uniswap calculations
- State management architecture defined

---

*End of Implementation Plan v2*
