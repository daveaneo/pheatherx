# FheatherX Frontend Implementation Plan

**Version:** 1.0
**Based on:** web-app-specs-v2.md
**Created:** November 2024

---

## Executive Summary

This document outlines the implementation plan for the FheatherX frontend—a privacy-focused DeFi trading interface built on FHE (Fully Homomorphic Encryption). The plan is organized into phases with clear deliverables, dependencies, and technical requirements.

---

## Table of Contents

1. [Implementation Phases Overview](#1-implementation-phases-overview)
2. [Phase 0: Project Setup](#2-phase-0-project-setup)
3. [Phase 1: Core Infrastructure](#3-phase-1-core-infrastructure)
4. [Phase 2: Portfolio & Balances](#4-phase-2-portfolio--balances)
5. [Phase 3: Swap Interface](#5-phase-3-swap-interface)
6. [Phase 4: Limit Orders](#6-phase-4-limit-orders)
7. [Phase 5: Analytics Dashboard](#7-phase-5-analytics-dashboard)
8. [Phase 6: Polish & Placeholders](#8-phase-6-polish--placeholders)
9. [Phase 7: Testing & QA](#9-phase-7-testing--qa)
10. [Technical Dependencies](#10-technical-dependencies)
11. [Risk Mitigation](#11-risk-mitigation)

---

## 1. Implementation Phases Overview

```
Phase 0: Project Setup
    │
    ▼
Phase 1: Core Infrastructure
    │   ├── Design System & Components
    │   ├── Wallet Connection
    │   ├── Network Configuration
    │   └── Contract Integration Base
    │
    ▼
Phase 2: Portfolio & Balances
    │   ├── Deposit Flow
    │   ├── Withdraw Flow
    │   ├── Balance Display (Encrypted)
    │   └── Balance Reveal (FHE Decrypt)
    │
    ▼
Phase 3: Swap Interface
    │   ├── Token Selector
    │   ├── Amount Input
    │   ├── Swap Execution
    │   └── Transaction Status
    │
    ▼
Phase 4: Limit Orders
    │   ├── Order Form (4 types)
    │   ├── Active Orders Management
    │   ├── Order History
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
    │   ├── Auctions (Coming Soon)
    │   ├── Launchpad (Coming Soon)
    │   └── Final Polish
    │
    ▼
Phase 7: Testing & QA
```

---

## 2. Phase 0: Project Setup

**Goal:** Initialize the project with all necessary tooling and configuration.

### 2.1 Tasks

#### 2.1.1 Initialize Next.js Project
```bash
cd /home/david/PycharmProjects/fheatherx/frontend
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir
```

Configuration choices:
- TypeScript: Yes
- ESLint: Yes
- Tailwind CSS: Yes
- `src/` directory: Yes
- App Router: Yes
- Import alias: `@/*`

#### 2.1.2 Install Dependencies

**Core Dependencies:**
```bash
npm install wagmi viem @tanstack/react-query
npm install @rainbow-me/rainbowkit
npm install zustand
npm install framer-motion
npm install react-hook-form zod @hookform/resolvers
npm install lightweight-charts  # or recharts
npm install date-fns
npm install clsx tailwind-merge
```

**Development Dependencies:**
```bash
npm install -D @types/node
npm install -D prettier prettier-plugin-tailwindcss
npm install -D @testing-library/react @testing-library/jest-dom vitest
```

**FHE Dependencies (when available):**
```bash
npm install cofhejs  # Fhenix client library
```

#### 2.1.3 Project Structure Setup

Create directory structure:
```
frontend/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── providers.tsx
│   │   ├── swap/
│   │   │   └── page.tsx
│   │   ├── orders/
│   │   │   ├── page.tsx
│   │   │   ├── new/
│   │   │   │   └── page.tsx
│   │   │   ├── active/
│   │   │   │   └── page.tsx
│   │   │   └── history/
│   │   │       └── page.tsx
│   │   ├── portfolio/
│   │   │   └── page.tsx
│   │   ├── analytics/
│   │   │   └── page.tsx
│   │   ├── auctions/
│   │   │   └── page.tsx
│   │   └── launchpad/
│   │       └── page.tsx
│   ├── components/
│   │   ├── ui/
│   │   ├── layout/
│   │   ├── swap/
│   │   ├── orders/
│   │   ├── portfolio/
│   │   └── analytics/
│   ├── hooks/
│   ├── lib/
│   │   ├── contracts/
│   │   ├── utils/
│   │   └── constants/
│   ├── stores/
│   ├── styles/
│   └── types/
├── public/
│   ├── icons/
│   ├── images/
│   └── fonts/
├── .env.local
├── .env.example
├── tailwind.config.ts
├── next.config.js
└── package.json
```

#### 2.1.4 Environment Configuration

Create `.env.example`:
```env
# Network RPC URLs
NEXT_PUBLIC_LOCAL_RPC_URL=http://localhost:8545
NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
NEXT_PUBLIC_FHENIX_RPC_URL=https://testnet.fhenix.io

# Contract Addresses (per network)
NEXT_PUBLIC_FHEATHERX_ADDRESS_LOCAL=0x...
NEXT_PUBLIC_FHEATHERX_ADDRESS_BASE_SEPOLIA=0x...
NEXT_PUBLIC_FHEATHERX_ADDRESS_FHENIX=0x...

# Pool Manager Address
NEXT_PUBLIC_POOL_MANAGER_ADDRESS=0x...

# WalletConnect Project ID
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id
```

### 2.2 Deliverables

- [ ] Next.js project initialized with App Router
- [ ] All dependencies installed
- [ ] Directory structure created
- [ ] Environment variables configured
- [ ] Git repository initialized (if not already)
- [ ] README updated with setup instructions

---

## 3. Phase 1: Core Infrastructure

**Goal:** Build foundational components, wallet integration, and contract setup.

### 3.1 Design System Implementation

#### 3.1.1 Tailwind Configuration

**File:** `tailwind.config.ts`
```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Primary
        'phoenix-ember': '#FF6A3D',
        'feather-gold': '#F0C27B',
        'obsidian-black': '#0A0A0F',
        'ash-gray': '#1C1E26',
        // Secondary
        'iridescent-violet': '#6B5BFF',
        'deep-magenta': '#D6246E',
        'electric-teal': '#19C9A0',
        // Neutral
        'carbon-gray': '#2B2D36',
        'feather-white': '#F9F7F1',
      },
      backgroundImage: {
        'flame-gradient': 'linear-gradient(135deg, #FF6A3D 0%, #D6246E 50%, #6B5BFF 100%)',
        'feather-gradient': 'linear-gradient(90deg, #F0C27B 0%, #19C9A0 100%)',
        'obsidian-gradient': 'linear-gradient(180deg, #0A0A0F 0%, #1C1E26 100%)',
      },
      fontFamily: {
        heading: ['Inter Tight', 'sans-serif'],
        body: ['Satoshi', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
        display: ['Neue Machina', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '12px',
        lg: '16px',
        xl: '20px',
      },
      boxShadow: {
        'ember-glow': '0 0 20px rgba(255, 106, 61, 0.3)',
        'card': '0 4px 24px rgba(0, 0, 0, 0.2)',
      },
      animation: {
        'shimmer': 'shimmer 2s ease infinite',
        'pulse-ember': 'pulse-ember 1.5s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        'pulse-ember': {
          '0%, 100%': { boxShadow: '0 0 8px #FF6A3D' },
          '50%': { boxShadow: '0 0 20px #FF6A3D' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-3px)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
```

#### 3.1.2 Global Styles

**File:** `src/styles/globals.css`
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --phoenix-ember: #FF6A3D;
    --feather-gold: #F0C27B;
    --obsidian-black: #0A0A0F;
    --ash-gray: #1C1E26;
    --iridescent-violet: #6B5BFF;
    --deep-magenta: #D6246E;
    --electric-teal: #19C9A0;
    --carbon-gray: #2B2D36;
    --feather-white: #F9F7F1;
  }

  body {
    @apply bg-obsidian-black text-feather-white font-body antialiased;
  }

  h1, h2, h3, h4, h5, h6 {
    @apply font-heading;
  }
}

@layer components {
  .btn-primary {
    @apply bg-flame-gradient text-feather-white px-8 py-4 rounded-lg font-medium
           shadow-ember-glow hover:brightness-110 active:scale-[0.98]
           transition-all duration-200;
  }

  .btn-secondary {
    @apply bg-transparent border border-carbon-gray text-feather-white
           px-8 py-4 rounded-lg font-medium
           hover:border-phoenix-ember transition-colors duration-200;
  }

  .card {
    @apply bg-carbon-gray border border-carbon-gray/50 rounded-lg p-6
           shadow-card hover:shadow-ember-glow/10 transition-shadow duration-300;
  }

  .input-field {
    @apply bg-ash-gray border border-carbon-gray rounded-lg px-4 py-3
           text-feather-white placeholder:text-carbon-gray
           focus:border-phoenix-ember focus:ring-1 focus:ring-phoenix-ember/50
           outline-none transition-all duration-200;
  }

  .encrypted-value {
    @apply font-mono text-iridescent-violet;
  }
}

/* Custom scrollbar */
::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-track {
  @apply bg-obsidian-black;
}

::-webkit-scrollbar-thumb {
  @apply bg-carbon-gray rounded-full hover:bg-ash-gray;
}
```

#### 3.1.3 UI Components

Create base UI components:

**File:** `src/components/ui/Button.tsx`
```typescript
import { forwardRef, ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'bg-flame-gradient text-feather-white shadow-ember-glow hover:brightness-110 active:scale-[0.98]',
        secondary: 'bg-transparent border border-carbon-gray text-feather-white hover:border-phoenix-ember',
        danger: 'bg-deep-magenta text-feather-white hover:brightness-110',
        ghost: 'bg-transparent text-feather-white hover:bg-carbon-gray/50',
      },
      size: {
        sm: 'px-4 py-2 text-sm',
        md: 'px-6 py-3 text-base',
        lg: 'px-8 py-4 text-lg',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <span className="mr-2 animate-spin">⟳</span>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
```

**Additional UI components to implement:**
- [ ] `Card.tsx` - Container component
- [ ] `Input.tsx` - Form input with variants
- [ ] `Modal.tsx` - Dialog component with backdrop
- [ ] `Select.tsx` - Custom select/dropdown
- [ ] `Tabs.tsx` - Tab navigation
- [ ] `Badge.tsx` - Status badges
- [ ] `Skeleton.tsx` - Loading placeholders
- [ ] `Toast.tsx` - Notification toasts
- [ ] `Tooltip.tsx` - Information tooltips

### 3.2 Wallet Connection

#### 3.2.1 Chain Configuration

**File:** `src/lib/chains.ts`
```typescript
import { Chain } from 'wagmi/chains';

export const localAnvil: Chain = {
  id: 31337,
  name: 'Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_LOCAL_RPC_URL || 'http://localhost:8545'] },
  },
};

export const baseSepolia: Chain = {
  id: 84532,
  name: 'Base Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'] },
  },
  blockExplorers: {
    default: { name: 'BaseScan', url: 'https://sepolia.basescan.org' },
  },
  testnet: true,
};

export const fhenixTestnet: Chain = {
  id: 8008135, // Placeholder - update when known
  name: 'Fhenix Testnet',
  nativeCurrency: { name: 'Fhenix ETH', symbol: 'FHE', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_FHENIX_RPC_URL || 'https://testnet.fhenix.io'] },
  },
  testnet: true,
};

export const supportedChains = [localAnvil, baseSepolia, fhenixTestnet] as const;

// FHE support per network
export const fheSupport: Record<number, 'full' | 'mock'> = {
  31337: 'mock',
  84532: 'mock',
  8008135: 'full',
};

export function isFheSupported(chainId: number): boolean {
  return fheSupport[chainId] === 'full';
}
```

#### 3.2.2 Wagmi Configuration

**File:** `src/lib/wagmi.ts`
```typescript
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { supportedChains } from './chains';

export const wagmiConfig = getDefaultConfig({
  appName: 'FheatherX',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '',
  chains: supportedChains,
  ssr: true,
});
```

#### 3.2.3 Providers Setup

**File:** `src/app/providers.tsx`
```typescript
'use client';

import { ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { wagmiConfig } from '@/lib/wagmi';

import '@rainbow-me/rainbowkit/styles.css';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: '#FF6A3D',
            accentColorForeground: '#F9F7F1',
            borderRadius: 'medium',
            fontStack: 'system',
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
```

### 3.3 Contract Integration

#### 3.3.1 Contract ABIs

**File:** `src/lib/contracts/abi.ts`
```typescript
export const FHEATHERX_ABI = [
  // Deposit/Withdraw
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'isToken0', type: 'bool' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'isToken0', type: 'bool' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  // Orders
  {
    name: 'placeOrder',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'triggerTick', type: 'int24' },
      { name: 'direction', type: 'bytes' }, // ebool encoded
      { name: 'amount', type: 'bytes' },    // euint128 encoded
      { name: 'minOutput', type: 'bytes' }, // euint128 encoded
    ],
    outputs: [{ name: 'orderId', type: 'uint256' }],
  },
  {
    name: 'cancelOrder',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'orderId', type: 'uint256' }],
    outputs: [],
  },
  // View functions
  {
    name: 'getReserves',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'reserve0', type: 'uint256' },
      { name: 'reserve1', type: 'uint256' },
    ],
  },
  {
    name: 'getActiveOrders',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    name: 'getOrderCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'hasOrdersAtTick',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tick', type: 'int24' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getUserBalanceToken0',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bytes' }], // euint128
  },
  {
    name: 'getUserBalanceToken1',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bytes' }], // euint128
  },
  // Events
  {
    name: 'Deposit',
    type: 'event',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'isToken0', type: 'bool', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'Withdraw',
    type: 'event',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'isToken0', type: 'bool', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'OrderPlaced',
    type: 'event',
    inputs: [
      { name: 'orderId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'triggerTick', type: 'int24', indexed: false },
    ],
  },
  {
    name: 'OrderCancelled',
    type: 'event',
    inputs: [
      { name: 'orderId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
    ],
  },
  {
    name: 'OrderFilled',
    type: 'event',
    inputs: [
      { name: 'orderId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'executor', type: 'address', indexed: true },
    ],
  },
] as const;
```

#### 3.3.2 Contract Addresses

**File:** `src/lib/contracts/addresses.ts`
```typescript
export const FHEATHERX_ADDRESSES: Record<number, `0x${string}`> = {
  31337: process.env.NEXT_PUBLIC_FHEATHERX_ADDRESS_LOCAL as `0x${string}`,
  84532: process.env.NEXT_PUBLIC_FHEATHERX_ADDRESS_BASE_SEPOLIA as `0x${string}`,
  8008135: process.env.NEXT_PUBLIC_FHEATHERX_ADDRESS_FHENIX as `0x${string}`,
};

export const PROTOCOL_FEE = 0.001; // ETH
export const EXECUTOR_REWARD_BPS = 100; // 1%
```

#### 3.3.3 Contract Hooks

**File:** `src/hooks/useContract.ts`
```typescript
import { useAccount, useChainId, useReadContract, useWriteContract } from 'wagmi';
import { FHEATHERX_ABI } from '@/lib/contracts/abi';
import { FHEATHERX_ADDRESSES } from '@/lib/contracts/addresses';

export function useFheatherXAddress() {
  const chainId = useChainId();
  return FHEATHERX_ADDRESSES[chainId];
}

export function useReserves() {
  const address = useFheatherXAddress();

  return useReadContract({
    address,
    abi: FHEATHERX_ABI,
    functionName: 'getReserves',
  });
}

export function useActiveOrders() {
  const address = useFheatherXAddress();
  const { address: userAddress } = useAccount();

  return useReadContract({
    address,
    abi: FHEATHERX_ABI,
    functionName: 'getActiveOrders',
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!userAddress,
    },
  });
}

export function useOrderCount() {
  const address = useFheatherXAddress();
  const { address: userAddress } = useAccount();

  return useReadContract({
    address,
    abi: FHEATHERX_ABI,
    functionName: 'getOrderCount',
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!userAddress,
    },
  });
}

// Write hooks
export function useDeposit() {
  const address = useFheatherXAddress();
  const { writeContractAsync } = useWriteContract();

  return async (isToken0: boolean, amount: bigint) => {
    return writeContractAsync({
      address,
      abi: FHEATHERX_ABI,
      functionName: 'deposit',
      args: [isToken0, amount],
    });
  };
}

export function useWithdraw() {
  const address = useFheatherXAddress();
  const { writeContractAsync } = useWriteContract();

  return async (isToken0: boolean, amount: bigint) => {
    return writeContractAsync({
      address,
      abi: FHEATHERX_ABI,
      functionName: 'withdraw',
      args: [isToken0, amount],
    });
  };
}

export function useCancelOrder() {
  const address = useFheatherXAddress();
  const { writeContractAsync } = useWriteContract();

  return async (orderId: bigint) => {
    return writeContractAsync({
      address,
      abi: FHEATHERX_ABI,
      functionName: 'cancelOrder',
      args: [orderId],
    });
  };
}
```

### 3.4 Layout Components

#### 3.4.1 Header Component

**File:** `src/components/layout/Header.tsx`
```typescript
'use client';

import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/swap', label: 'Swap' },
  { href: '/orders', label: 'Orders', dropdown: [
    { href: '/orders/new', label: 'New Order' },
    { href: '/orders/active', label: 'Active' },
    { href: '/orders/history', label: 'History' },
  ]},
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
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <span className="text-2xl font-display font-bold bg-flame-gradient bg-clip-text text-transparent">
            FheatherX
          </span>
        </Link>

        {/* Navigation */}
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                pathname.startsWith(item.href)
                  ? 'text-phoenix-ember bg-phoenix-ember/10'
                  : 'text-feather-white/70 hover:text-feather-white hover:bg-carbon-gray/50'
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

        {/* Connect Wallet */}
        <ConnectButton />
      </div>
    </header>
  );
}
```

### 3.5 Deliverables

- [ ] Tailwind configuration with custom theme
- [ ] Global styles with FheatherX design tokens
- [ ] Base UI components (Button, Card, Input, Modal, etc.)
- [ ] RainbowKit + wagmi integration
- [ ] Network switcher working for all supported chains
- [ ] Contract hooks for read operations
- [ ] Header with navigation
- [ ] Mobile-responsive bottom navigation
- [ ] Root layout with providers

---

## 4. Phase 2: Portfolio & Balances

**Goal:** Implement deposit, withdraw, and encrypted balance management.

### 4.1 FHE Integration

#### 4.1.1 FHE Client Setup

**File:** `src/lib/fhe.ts`
```typescript
import { useMemo } from 'react';
// import { FhenixClient } from 'cofhejs'; // Uncomment when available

export interface EncryptedValue {
  data: Uint8Array;
  type: 'ebool' | 'euint128';
}

// Mock implementation for development
class MockFheClient {
  async encryptBool(value: boolean): Promise<EncryptedValue> {
    // In mock mode, just encode the value
    const data = new Uint8Array([value ? 1 : 0]);
    return { data, type: 'ebool' };
  }

  async encryptUint128(value: bigint): Promise<EncryptedValue> {
    // In mock mode, encode as bytes
    const data = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      data[15 - i] = Number((value >> BigInt(i * 8)) & BigInt(0xff));
    }
    return { data, type: 'euint128' };
  }

  async decrypt(encrypted: EncryptedValue): Promise<bigint> {
    // In mock mode, decode the value
    if (encrypted.type === 'ebool') {
      return BigInt(encrypted.data[0]);
    }
    let value = BigInt(0);
    for (let i = 0; i < encrypted.data.length; i++) {
      value = (value << BigInt(8)) | BigInt(encrypted.data[i]);
    }
    return value;
  }

  async allow(encrypted: EncryptedValue, contractAddress: string): Promise<void> {
    // No-op in mock mode
    console.log('Mock FHE: allowing', contractAddress, 'to access encrypted value');
  }
}

export function useFheClient() {
  return useMemo(() => new MockFheClient(), []);
}

export function useEncrypt() {
  const client = useFheClient();

  return {
    encryptBool: client.encryptBool.bind(client),
    encryptUint128: client.encryptUint128.bind(client),
    decrypt: client.decrypt.bind(client),
    allow: client.allow.bind(client),
  };
}
```

#### 4.1.2 Balance Reveal Hook

**File:** `src/hooks/useBalanceReveal.ts`
```typescript
import { useState, useCallback } from 'react';
import { useEncrypt, EncryptedValue } from '@/lib/fhe';

type RevealStatus = 'hidden' | 'revealing' | 'revealed' | 'error';

interface BalanceRevealState {
  status: RevealStatus;
  value?: bigint;
  error?: string;
  revealedAt?: number;
}

export function useBalanceReveal() {
  const [state, setState] = useState<BalanceRevealState>({
    status: 'hidden',
  });
  const { decrypt } = useEncrypt();

  const reveal = useCallback(async (encryptedBalance: EncryptedValue) => {
    setState({ status: 'revealing' });

    try {
      // Simulate async decryption delay
      await new Promise(resolve => setTimeout(resolve, 2000));

      const value = await decrypt(encryptedBalance);
      setState({
        status: 'revealed',
        value,
        revealedAt: Date.now(),
      });
      return value;
    } catch (error) {
      setState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Decryption failed',
      });
      throw error;
    }
  }, [decrypt]);

  const hide = useCallback(() => {
    setState({ status: 'hidden' });
  }, []);

  return {
    ...state,
    reveal,
    hide,
    isRevealing: state.status === 'revealing',
    isRevealed: state.status === 'revealed',
  };
}
```

### 4.2 Portfolio Components

#### 4.2.1 Portfolio Page

**File:** `src/app/portfolio/page.tsx`
```typescript
'use client';

import { useAccount } from 'wagmi';
import { BalanceCard } from '@/components/portfolio/BalanceCard';
import { ActivityList } from '@/components/portfolio/ActivityList';
import { DepositModal } from '@/components/portfolio/DepositModal';
import { WithdrawModal } from '@/components/portfolio/WithdrawModal';
import { ConnectPrompt } from '@/components/ConnectPrompt';

export default function PortfolioPage() {
  const { isConnected } = useAccount();

  if (!isConnected) {
    return <ConnectPrompt message="Connect your wallet to view your portfolio" />;
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <h1 className="text-3xl font-heading font-bold mb-8">Portfolio</h1>

      {/* Total Value */}
      <div className="card mb-8 text-center">
        <p className="text-feather-white/60 mb-2">Total Value (Estimated)</p>
        <p className="text-4xl font-mono font-bold">$••••••</p>
        <button className="mt-4 btn-secondary text-sm">
          Reveal All Balances
        </button>
      </div>

      {/* Token Balances */}
      <div className="space-y-4 mb-8">
        <h2 className="text-xl font-heading font-semibold">Your Balances</h2>
        <BalanceCard
          token={{ symbol: 'ETH', name: 'Ethereum', decimals: 18 }}
          isToken0={true}
        />
        <BalanceCard
          token={{ symbol: 'USDC', name: 'USD Coin', decimals: 6 }}
          isToken0={false}
        />
      </div>

      {/* Recent Activity */}
      <div>
        <h2 className="text-xl font-heading font-semibold mb-4">Recent Activity</h2>
        <ActivityList />
      </div>

      {/* Modals */}
      <DepositModal />
      <WithdrawModal />
    </div>
  );
}
```

#### 4.2.2 Balance Card Component

**File:** `src/components/portfolio/BalanceCard.tsx`
```typescript
'use client';

import { useState } from 'react';
import { formatUnits } from 'viem';
import { useBalanceReveal } from '@/hooks/useBalanceReveal';
import { Button } from '@/components/ui/Button';

interface Token {
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
}

interface BalanceCardProps {
  token: Token;
  isToken0: boolean;
}

export function BalanceCard({ token, isToken0 }: BalanceCardProps) {
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const { status, value, reveal, hide, isRevealing } = useBalanceReveal();

  const handleReveal = async () => {
    // TODO: Get actual encrypted balance from contract
    const mockEncrypted = { data: new Uint8Array(16), type: 'euint128' as const };
    await reveal(mockEncrypted);
  };

  const formatBalance = (val: bigint) => {
    return formatUnits(val, token.decimals);
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-carbon-gray flex items-center justify-center">
            {token.symbol[0]}
          </div>
          <div>
            <p className="font-semibold">{token.name}</p>
            <p className="text-sm text-feather-white/60">{token.symbol}</p>
          </div>
        </div>
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex justify-between">
          <span className="text-feather-white/60">Available:</span>
          <div className="flex items-center gap-2">
            {status === 'revealed' && value !== undefined ? (
              <>
                <span className="font-mono">{formatBalance(value)}</span>
                <button onClick={hide} className="text-xs text-iridescent-violet hover:underline">
                  Hide
                </button>
              </>
            ) : (
              <>
                <span className="encrypted-value">••••••</span>
                <button
                  onClick={handleReveal}
                  disabled={isRevealing}
                  className="text-xs text-phoenix-ember hover:underline disabled:opacity-50"
                >
                  {isRevealing ? 'Revealing...' : 'Reveal'}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="flex justify-between">
          <span className="text-feather-white/60">In Orders:</span>
          <span className="encrypted-value">••••••</span>
        </div>
        <div className="flex justify-between border-t border-carbon-gray pt-2">
          <span className="text-feather-white/60">Total:</span>
          <span className="encrypted-value">••••••</span>
        </div>
      </div>

      <div className="flex gap-3">
        <Button
          variant="primary"
          size="sm"
          className="flex-1"
          onClick={() => setShowDeposit(true)}
        >
          Deposit
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="flex-1"
          onClick={() => setShowWithdraw(true)}
        >
          Withdraw
        </Button>
      </div>
    </div>
  );
}
```

### 4.3 Deposit Flow

#### 4.3.1 Deposit Modal

**File:** `src/components/portfolio/DepositModal.tsx`
```typescript
'use client';

import { useState } from 'react';
import { parseUnits } from 'viem';
import { useAccount, useBalance } from 'wagmi';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useDeposit } from '@/hooks/useContract';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: {
    symbol: string;
    decimals: number;
    address?: `0x${string}`;
  };
  isToken0: boolean;
}

export function DepositModal({ isOpen, onClose, token, isToken0 }: DepositModalProps) {
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<'input' | 'approve' | 'deposit' | 'success'>('input');
  const { address } = useAccount();
  const deposit = useDeposit();

  const { data: balance } = useBalance({
    address,
    token: token.address, // undefined for native ETH
  });

  const handleDeposit = async () => {
    try {
      setStep('deposit');
      const amountWei = parseUnits(amount, token.decimals);
      await deposit(isToken0, amountWei);
      setStep('success');
    } catch (error) {
      console.error('Deposit failed:', error);
      setStep('input');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Deposit ${token.symbol}`}>
      <div className="space-y-6">
        {step === 'input' && (
          <>
            <div>
              <label className="block text-sm text-feather-white/60 mb-2">Amount</label>
              <div className="relative">
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.0"
                  className="pr-20"
                />
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-phoenix-ember"
                  onClick={() => balance && setAmount(balance.formatted)}
                >
                  MAX
                </button>
              </div>
              <p className="mt-2 text-sm text-feather-white/60">
                Wallet Balance: {balance?.formatted || '0'} {token.symbol}
              </p>
            </div>

            <div className="bg-ash-gray rounded-lg p-4">
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <span className="text-iridescent-violet">ℹ</span> About Deposits
              </h4>
              <p className="text-sm text-feather-white/70">
                Deposited funds are held in the FheatherX hook contract.
                You can withdraw anytime. This enables encrypted balance
                accounting for private trading.
              </p>
            </div>

            <Button onClick={handleDeposit} className="w-full" disabled={!amount || parseFloat(amount) <= 0}>
              Deposit {token.symbol}
            </Button>
          </>
        )}

        {step === 'deposit' && (
          <div className="text-center py-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-phoenix-ember/20 flex items-center justify-center animate-pulse-ember">
              <span className="text-2xl">⟳</span>
            </div>
            <p className="font-medium">Depositing {amount} {token.symbol}</p>
            <p className="text-sm text-feather-white/60 mt-2">Confirm in your wallet...</p>
          </div>
        )}

        {step === 'success' && (
          <div className="text-center py-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-electric-teal/20 flex items-center justify-center">
              <span className="text-2xl text-electric-teal">✓</span>
            </div>
            <p className="font-medium">Deposit Successful!</p>
            <p className="text-sm text-feather-white/60 mt-2">
              {amount} {token.symbol} added to your FheatherX balance
            </p>
            <Button onClick={onClose} variant="secondary" className="mt-6">
              Close
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
```

### 4.4 Deliverables

- [ ] FHE client integration (mock + real)
- [ ] Balance reveal hook with async decryption
- [ ] Portfolio page layout
- [ ] Balance card with encrypted display
- [ ] Reveal balance flow with loading state
- [ ] Deposit modal with approve + deposit steps
- [ ] Withdraw modal
- [ ] Activity list component
- [ ] Transaction status indicators

---

## 5. Phase 3: Swap Interface

**Goal:** Implement instant encrypted swap functionality.

### 5.1 Token Selection

#### 5.1.1 Token List

**File:** `src/lib/tokens.ts`
```typescript
export interface Token {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
}

// Default token list per network
export const TOKEN_LIST: Record<number, Token[]> = {
  31337: [
    { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', name: 'Ethereum', decimals: 18 },
    { address: '0x...', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  ],
  84532: [
    { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', name: 'Ethereum', decimals: 18 },
    { address: '0x...', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  ],
  // Add Fhenix tokens
};
```

#### 5.1.2 Token Selector Component

**File:** `src/components/swap/TokenSelector.tsx`
```typescript
'use client';

import { useState } from 'react';
import { useChainId } from 'wagmi';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { TOKEN_LIST, Token } from '@/lib/tokens';

interface TokenSelectorProps {
  selected?: Token;
  onSelect: (token: Token) => void;
  excludeToken?: Token;
}

export function TokenSelector({ selected, onSelect, excludeToken }: TokenSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const chainId = useChainId();

  const tokens = TOKEN_LIST[chainId] || [];
  const filteredTokens = tokens.filter(
    (token) =>
      token.address !== excludeToken?.address &&
      (token.symbol.toLowerCase().includes(search.toLowerCase()) ||
        token.name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 bg-ash-gray rounded-lg px-3 py-2 hover:bg-carbon-gray transition-colors"
      >
        {selected ? (
          <>
            <span className="font-medium">{selected.symbol}</span>
            <span className="text-feather-white/60">▼</span>
          </>
        ) : (
          <span className="text-feather-white/60">Select token</span>
        )}
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Select Token">
        <Input
          placeholder="Search by name or address..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-4"
        />
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {filteredTokens.map((token) => (
            <button
              key={token.address}
              onClick={() => {
                onSelect(token);
                setIsOpen(false);
              }}
              className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-carbon-gray transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-carbon-gray flex items-center justify-center">
                {token.symbol[0]}
              </div>
              <div className="text-left">
                <p className="font-medium">{token.symbol}</p>
                <p className="text-sm text-feather-white/60">{token.name}</p>
              </div>
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}
```

### 5.2 Swap Form

#### 5.2.1 Swap Page

**File:** `src/app/swap/page.tsx`
```typescript
'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { SwapCard } from '@/components/swap/SwapCard';
import { NoDepositPrompt } from '@/components/swap/NoDepositPrompt';
import { ConnectPrompt } from '@/components/ConnectPrompt';
import { useUserHasDeposit } from '@/hooks/useUserHasDeposit';

export default function SwapPage() {
  const { isConnected } = useAccount();
  const { hasDeposit, isLoading } = useUserHasDeposit();

  if (!isConnected) {
    return <ConnectPrompt message="Connect your wallet to swap" />;
  }

  if (isLoading) {
    return <div className="flex justify-center py-20">Loading...</div>;
  }

  if (!hasDeposit) {
    return <NoDepositPrompt />;
  }

  return (
    <div className="max-w-lg mx-auto py-8 px-4">
      <SwapCard />
    </div>
  );
}
```

#### 5.2.2 Swap Card Component

**File:** `src/components/swap/SwapCard.tsx`
```typescript
'use client';

import { useState, useMemo } from 'react';
import { parseUnits, formatUnits } from 'viem';
import { useAccount } from 'wagmi';
import { TokenSelector } from './TokenSelector';
import { SlippageSettings } from './SlippageSettings';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useReserves } from '@/hooks/useContract';
import { useEncrypt } from '@/lib/fhe';
import { Token } from '@/lib/tokens';
import { priceFromReserves } from '@/lib/ticks';

export function SwapCard() {
  const [tokenIn, setTokenIn] = useState<Token | undefined>();
  const [tokenOut, setTokenOut] = useState<Token | undefined>();
  const [amountIn, setAmountIn] = useState('');
  const [slippage, setSlippage] = useState(0.5);
  const [showSettings, setShowSettings] = useState(false);
  const [swapState, setSwapState] = useState<'idle' | 'confirming' | 'pending' | 'success' | 'error'>('idle');

  const { address } = useAccount();
  const { data: reserves } = useReserves();
  const { encryptBool, encryptUint128, allow } = useEncrypt();

  // Calculate price and output
  const { price, amountOut, priceImpact } = useMemo(() => {
    if (!reserves || !tokenIn || !tokenOut || !amountIn) {
      return { price: 0, amountOut: '0', priceImpact: 0 };
    }

    const [reserve0, reserve1] = reserves;
    const price = priceFromReserves(reserve0, reserve1, tokenIn.decimals, tokenOut.decimals);

    // Simple constant product estimation
    const inputAmount = parseFloat(amountIn);
    const estimatedOutput = inputAmount * price;

    // Calculate price impact (simplified)
    const priceImpact = (inputAmount / Number(formatUnits(reserve0, tokenIn.decimals))) * 100;

    return {
      price,
      amountOut: estimatedOutput.toFixed(6),
      priceImpact: Math.min(priceImpact, 100),
    };
  }, [reserves, tokenIn, tokenOut, amountIn]);

  const minOutput = useMemo(() => {
    const output = parseFloat(amountOut);
    return (output * (1 - slippage / 100)).toFixed(6);
  }, [amountOut, slippage]);

  const handleSwap = async () => {
    if (!tokenIn || !tokenOut || !amountIn) return;

    try {
      setSwapState('confirming');

      // TODO: Encrypt swap parameters and execute
      // const encDirection = await encryptBool(true); // zeroForOne
      // const encAmount = await encryptUint128(parseUnits(amountIn, tokenIn.decimals));
      // const encMinOutput = await encryptUint128(parseUnits(minOutput, tokenOut.decimals));

      setSwapState('pending');
      // Execute swap...

      setSwapState('success');
    } catch (error) {
      console.error('Swap failed:', error);
      setSwapState('error');
    }
  };

  const switchTokens = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountIn('');
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-heading font-semibold">Swap</h2>
        <button
          onClick={() => setShowSettings(true)}
          className="text-feather-white/60 hover:text-feather-white"
        >
          ⚙️
        </button>
      </div>

      {/* From Token */}
      <div className="bg-ash-gray rounded-lg p-4 mb-2">
        <div className="flex justify-between mb-2">
          <span className="text-sm text-feather-white/60">From</span>
          <span className="text-sm text-feather-white/60">
            Balance: <span className="encrypted-value">••••••</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <TokenSelector
            selected={tokenIn}
            onSelect={setTokenIn}
            excludeToken={tokenOut}
          />
          <Input
            type="number"
            value={amountIn}
            onChange={(e) => setAmountIn(e.target.value)}
            placeholder="0.0"
            className="flex-1 text-right text-2xl bg-transparent border-none"
          />
        </div>
      </div>

      {/* Switch Button */}
      <div className="flex justify-center -my-2 relative z-10">
        <button
          onClick={switchTokens}
          className="w-10 h-10 rounded-full bg-carbon-gray border-4 border-obsidian-black flex items-center justify-center hover:bg-ash-gray transition-colors"
        >
          ↓
        </button>
      </div>

      {/* To Token */}
      <div className="bg-ash-gray rounded-lg p-4 mt-2 mb-4">
        <div className="flex justify-between mb-2">
          <span className="text-sm text-feather-white/60">To</span>
          <span className="text-sm text-feather-white/60">
            Balance: <span className="encrypted-value">••••••</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <TokenSelector
            selected={tokenOut}
            onSelect={setTokenOut}
            excludeToken={tokenIn}
          />
          <div className="flex-1 text-right text-2xl font-mono text-feather-white/60">
            {amountOut || '0.0'}
          </div>
        </div>
      </div>

      {/* Swap Details */}
      {tokenIn && tokenOut && amountIn && (
        <div className="border-t border-carbon-gray pt-4 mb-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-feather-white/60">Rate</span>
            <span>1 {tokenIn.symbol} = {price.toFixed(4)} {tokenOut.symbol}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-feather-white/60">Price Impact</span>
            <span className={priceImpact > 5 ? 'text-deep-magenta' : ''}>
              {priceImpact.toFixed(2)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-feather-white/60">Min. Received</span>
            <span>{minOutput} {tokenOut.symbol}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-feather-white/60">Slippage</span>
            <span>{slippage}%</span>
          </div>
          <p className="text-xs text-feather-white/40 mt-2">
            ⓘ Rate may be slightly delayed. Your trade uses real-time encrypted reserves.
          </p>
        </div>
      )}

      {/* Swap Button */}
      <Button
        onClick={handleSwap}
        disabled={!tokenIn || !tokenOut || !amountIn || swapState !== 'idle'}
        loading={swapState === 'confirming' || swapState === 'pending'}
        className="w-full"
      >
        {swapState === 'idle' && 'Swap Privately'}
        {swapState === 'confirming' && 'Confirm in Wallet...'}
        {swapState === 'pending' && 'Swapping...'}
        {swapState === 'success' && 'Swap Complete!'}
        {swapState === 'error' && 'Try Again'}
      </Button>

      {/* Slippage Settings Modal */}
      <SlippageSettings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        slippage={slippage}
        onSlippageChange={setSlippage}
      />
    </div>
  );
}
```

### 5.3 Deliverables

- [ ] Token list configuration
- [ ] Token selector modal with search
- [ ] Swap page with deposit check
- [ ] No-deposit prompt component
- [ ] Swap card with token inputs
- [ ] Price calculation from reserves
- [ ] Slippage settings modal
- [ ] Swap execution with FHE encryption
- [ ] Transaction status feedback
- [ ] Error handling

---

## 6. Phase 4: Limit Orders

**Goal:** Implement all 4 order types with management UI.

### 6.1 Order Type Logic

#### 6.1.1 Order Utilities

**File:** `src/lib/orders.ts`
```typescript
export type OrderType = 'limit-buy' | 'limit-sell' | 'stop-loss' | 'take-profit';

export interface OrderTypeConfig {
  type: OrderType;
  label: string;
  description: string;
  direction: boolean; // true = zeroForOne, false = oneForZero
  triggerSide: 'above' | 'below'; // Where trigger should be vs current price
  icon: string;
}

export const ORDER_TYPES: OrderTypeConfig[] = [
  {
    type: 'limit-buy',
    label: 'Limit Buy',
    description: 'Buy tokens when the price drops to your target.',
    direction: false, // oneForZero
    triggerSide: 'below',
    icon: '📈',
  },
  {
    type: 'limit-sell',
    label: 'Limit Sell',
    description: 'Sell tokens when the price rises to your target.',
    direction: true, // zeroForOne
    triggerSide: 'above',
    icon: '📉',
  },
  {
    type: 'stop-loss',
    label: 'Stop-Loss',
    description: 'Automatically sell if the price drops to protect from losses.',
    direction: true, // zeroForOne
    triggerSide: 'below',
    icon: '🛡️',
  },
  {
    type: 'take-profit',
    label: 'Take-Profit',
    description: 'Automatically sell when the price reaches your profit target.',
    direction: true, // zeroForOne
    triggerSide: 'above',
    icon: '🎯',
  },
];

export function getOrderDirection(orderType: OrderType): boolean {
  const config = ORDER_TYPES.find((o) => o.type === orderType);
  return config?.direction ?? true;
}

export function validateTriggerPrice(
  orderType: OrderType,
  triggerPrice: number,
  currentPrice: number
): { valid: boolean; error?: string } {
  const config = ORDER_TYPES.find((o) => o.type === orderType);
  if (!config) return { valid: false, error: 'Unknown order type' };

  if (config.triggerSide === 'above' && triggerPrice <= currentPrice) {
    return { valid: false, error: `Trigger price must be above current price (${currentPrice})` };
  }
  if (config.triggerSide === 'below' && triggerPrice >= currentPrice) {
    return { valid: false, error: `Trigger price must be below current price (${currentPrice})` };
  }

  return { valid: true };
}
```

### 6.2 Order Form

#### 6.2.1 New Order Page

**File:** `src/app/orders/new/page.tsx`
```typescript
'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { OrderTypeSelector } from '@/components/orders/OrderTypeSelector';
import { OrderForm } from '@/components/orders/OrderForm';
import { ConnectPrompt } from '@/components/ConnectPrompt';
import { OrderType } from '@/lib/orders';

export default function NewOrderPage() {
  const { isConnected } = useAccount();
  const [orderType, setOrderType] = useState<OrderType>('limit-buy');

  if (!isConnected) {
    return <ConnectPrompt message="Connect your wallet to place orders" />;
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <h1 className="text-3xl font-heading font-bold mb-8">Place Order</h1>

      <OrderTypeSelector selected={orderType} onSelect={setOrderType} />
      <OrderForm orderType={orderType} />
    </div>
  );
}
```

#### 6.2.2 Order Form Component

**File:** `src/components/orders/OrderForm.tsx`
```typescript
'use client';

import { useState, useMemo } from 'react';
import { parseUnits, parseEther } from 'viem';
import { useAccount } from 'wagmi';
import { TokenSelector } from '@/components/swap/TokenSelector';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useReserves, useFheatherXAddress } from '@/hooks/useContract';
import { useEncrypt } from '@/lib/fhe';
import { OrderType, ORDER_TYPES, getOrderDirection, validateTriggerPrice } from '@/lib/orders';
import { priceToTick, priceFromReserves } from '@/lib/ticks';
import { PROTOCOL_FEE } from '@/lib/contracts/addresses';
import { Token } from '@/lib/tokens';

interface OrderFormProps {
  orderType: OrderType;
}

export function OrderForm({ orderType }: OrderFormProps) {
  const [tokenIn, setTokenIn] = useState<Token | undefined>();
  const [tokenOut, setTokenOut] = useState<Token | undefined>();
  const [triggerPrice, setTriggerPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(1);
  const [formState, setFormState] = useState<'idle' | 'confirming' | 'pending' | 'success' | 'error'>('idle');

  const { address } = useAccount();
  const hookAddress = useFheatherXAddress();
  const { data: reserves } = useReserves();
  const { encryptBool, encryptUint128, allow } = useEncrypt();

  const orderConfig = ORDER_TYPES.find((o) => o.type === orderType)!;

  const currentPrice = useMemo(() => {
    if (!reserves || !tokenIn || !tokenOut) return 0;
    const [reserve0, reserve1] = reserves;
    return priceFromReserves(reserve0, reserve1, tokenIn.decimals, tokenOut.decimals);
  }, [reserves, tokenIn, tokenOut]);

  const priceDeviation = useMemo(() => {
    if (!currentPrice || !triggerPrice) return 0;
    return ((parseFloat(triggerPrice) - currentPrice) / currentPrice) * 100;
  }, [currentPrice, triggerPrice]);

  const validation = useMemo(() => {
    if (!triggerPrice || !currentPrice) return { valid: true };
    return validateTriggerPrice(orderType, parseFloat(triggerPrice), currentPrice);
  }, [orderType, triggerPrice, currentPrice]);

  const minOutput = useMemo(() => {
    const inputAmount = parseFloat(amount) || 0;
    const price = parseFloat(triggerPrice) || 0;
    const expectedOutput = inputAmount * price;
    return (expectedOutput * (1 - slippage / 100)).toFixed(6);
  }, [amount, triggerPrice, slippage]);

  const handlePlaceOrder = async () => {
    if (!tokenIn || !tokenOut || !triggerPrice || !amount || !validation.valid) return;

    try {
      setFormState('confirming');

      // Encrypt order parameters
      const direction = getOrderDirection(orderType);
      const encDirection = await encryptBool(direction);
      const encAmount = await encryptUint128(parseUnits(amount, tokenIn.decimals));
      const encMinOutput = await encryptUint128(parseUnits(minOutput, tokenOut.decimals));

      // Grant hook access to encrypted values
      await allow(encDirection, hookAddress);
      await allow(encAmount, hookAddress);
      await allow(encMinOutput, hookAddress);

      // Calculate trigger tick
      const triggerTick = priceToTick(parseFloat(triggerPrice), tokenIn.decimals, tokenOut.decimals);

      // TODO: Call placeOrder with protocol fee
      setFormState('pending');
      // await placeOrder(triggerTick, encDirection, encAmount, encMinOutput, { value: parseEther(PROTOCOL_FEE.toString()) });

      setFormState('success');
    } catch (error) {
      console.error('Order placement failed:', error);
      setFormState('error');
    }
  };

  return (
    <div className="card mt-6">
      {/* Order Type Info */}
      <div className="bg-iridescent-violet/10 border border-iridescent-violet/30 rounded-lg p-4 mb-6">
        <h3 className="font-medium flex items-center gap-2 mb-2">
          <span>{orderConfig.icon}</span>
          {orderConfig.label}
        </h3>
        <p className="text-sm text-feather-white/70">{orderConfig.description}</p>
      </div>

      {/* Token Pair */}
      <div className="mb-6">
        <label className="block text-sm text-feather-white/60 mb-2">Token Pair</label>
        <div className="flex items-center gap-2">
          <TokenSelector selected={tokenIn} onSelect={setTokenIn} excludeToken={tokenOut} />
          <span className="text-feather-white/60">→</span>
          <TokenSelector selected={tokenOut} onSelect={setTokenOut} excludeToken={tokenIn} />
        </div>
      </div>

      {/* Current Price */}
      {currentPrice > 0 && (
        <div className="mb-4 text-sm">
          <span className="text-feather-white/60">Current Price: </span>
          <span className="font-mono">{currentPrice.toFixed(4)} {tokenOut?.symbol}/{tokenIn?.symbol}</span>
        </div>
      )}

      {/* Trigger Price */}
      <div className="mb-6">
        <label className="block text-sm text-feather-white/60 mb-2">Target Price</label>
        <div className="relative">
          <Input
            type="number"
            value={triggerPrice}
            onChange={(e) => setTriggerPrice(e.target.value)}
            placeholder="0.0"
            className={!validation.valid ? 'border-deep-magenta' : ''}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-feather-white/60">
            {tokenOut?.symbol}
          </span>
        </div>
        {triggerPrice && (
          <p className={`mt-1 text-sm ${priceDeviation > 0 ? 'text-electric-teal' : 'text-deep-magenta'}`}>
            {priceDeviation > 0 ? '+' : ''}{priceDeviation.toFixed(1)}% from current
          </p>
        )}
        {!validation.valid && (
          <p className="mt-1 text-sm text-deep-magenta">{validation.error}</p>
        )}
      </div>

      {/* Amount */}
      <div className="mb-6">
        <label className="block text-sm text-feather-white/60 mb-2">Amount</label>
        <div className="relative">
          <Input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-feather-white/60">
            {tokenIn?.symbol}
          </span>
        </div>
        <p className="mt-1 text-sm text-feather-white/60">
          Available: <span className="encrypted-value">••••••</span> {tokenIn?.symbol}
        </p>
      </div>

      {/* Slippage */}
      <div className="mb-6">
        <label className="block text-sm text-feather-white/60 mb-2">Slippage Tolerance</label>
        <div className="flex gap-2">
          {[0.5, 1.0, 2.0].map((val) => (
            <button
              key={val}
              onClick={() => setSlippage(val)}
              className={`px-4 py-2 rounded-lg text-sm ${
                slippage === val
                  ? 'bg-phoenix-ember text-feather-white'
                  : 'bg-ash-gray text-feather-white/60 hover:bg-carbon-gray'
              }`}
            >
              {val}%
            </button>
          ))}
        </div>
      </div>

      {/* Order Summary */}
      <div className="border-t border-carbon-gray pt-4 mb-6 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-feather-white/60">Protocol Fee</span>
          <span>{PROTOCOL_FEE} ETH (~$2.45)</span>
        </div>
        <p className="text-xs text-feather-white/40">ⓘ Paid in ETH. Non-refundable.</p>
        <div className="flex justify-between">
          <span className="text-feather-white/60">Min. Output</span>
          <span>{minOutput} {tokenOut?.symbol}</span>
        </div>
      </div>

      {/* Trigger Explanation */}
      {tokenIn && tokenOut && triggerPrice && validation.valid && (
        <div className="bg-ash-gray rounded-lg p-3 mb-6 text-sm">
          <span className="text-electric-teal">✓</span> Your order will execute when price{' '}
          {orderConfig.triggerSide === 'below' ? 'FALLS' : 'RISES'} to {triggerPrice} {tokenOut.symbol}
        </div>
      )}

      {/* Submit Button */}
      <Button
        onClick={handlePlaceOrder}
        disabled={!tokenIn || !tokenOut || !triggerPrice || !amount || !validation.valid || formState !== 'idle'}
        loading={formState === 'confirming' || formState === 'pending'}
        className="w-full"
      >
        {formState === 'idle' && `Place ${orderConfig.label} Order`}
        {formState === 'confirming' && 'Confirm in Wallet...'}
        {formState === 'pending' && 'Placing Order...'}
        {formState === 'success' && 'Order Placed!'}
        {formState === 'error' && 'Try Again'}
      </Button>
    </div>
  );
}
```

### 6.3 Order Management

#### 6.3.1 Active Orders Page

**File:** `src/app/orders/active/page.tsx`
```typescript
'use client';

import { useAccount } from 'wagmi';
import Link from 'next/link';
import { OrderCard } from '@/components/orders/OrderCard';
import { Button } from '@/components/ui/Button';
import { ConnectPrompt } from '@/components/ConnectPrompt';
import { useActiveOrders } from '@/hooks/useContract';

export default function ActiveOrdersPage() {
  const { isConnected } = useAccount();
  const { data: orderIds, isLoading } = useActiveOrders();

  if (!isConnected) {
    return <ConnectPrompt message="Connect your wallet to view orders" />;
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-heading font-bold">Active Orders</h1>
        <Link href="/orders/new">
          <Button>+ New Order</Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <select className="input-field">
          <option>All Types</option>
          <option>Limit Buy</option>
          <option>Limit Sell</option>
          <option>Stop-Loss</option>
          <option>Take-Profit</option>
        </select>
        <select className="input-field">
          <option>All Pairs</option>
          <option>ETH/USDC</option>
        </select>
      </div>

      {/* Orders List */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card animate-pulse h-40" />
          ))}
        </div>
      ) : orderIds && orderIds.length > 0 ? (
        <div className="space-y-4">
          {orderIds.map((orderId) => (
            <OrderCard key={orderId.toString()} orderId={orderId} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <p className="text-feather-white/60 mb-4">No active orders</p>
          <Link href="/orders/new">
            <Button>Place Your First Order</Button>
          </Link>
        </div>
      )}

      {/* Info Note */}
      <p className="mt-8 text-sm text-feather-white/40 text-center">
        ⓘ Multiple orders can exist at the same trigger price. All orders at a triggered price execute together.
      </p>
    </div>
  );
}
```

### 6.4 Deliverables

- [ ] Order type configuration and utilities
- [ ] Order type selector tabs
- [ ] New order form with validation
- [ ] Trigger price validation per order type
- [ ] Price deviation display
- [ ] FHE encryption for order parameters
- [ ] FHE.allow() integration
- [ ] Active orders page with filtering
- [ ] Order card component
- [ ] Cancel order flow with confirmation modal
- [ ] Order history page
- [ ] Status badges (Filled, Cancelled, Slippage Failed)
- [ ] Transaction links to explorer

---

## 7. Phase 5: Analytics Dashboard

**Goal:** Display pool metrics, charts, and user statistics.

### 7.1 Analytics Page

**File:** `src/app/analytics/page.tsx`
```typescript
'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { MetricCard } from '@/components/analytics/MetricCard';
import { PriceChart } from '@/components/analytics/PriceChart';
import { VolumeChart } from '@/components/analytics/VolumeChart';
import { UserStats } from '@/components/analytics/UserStats';
import { useReserves } from '@/hooks/useContract';
import { formatUSD } from '@/lib/utils';

type TimeRange = '24h' | '7d' | '30d';

export default function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const { isConnected } = useAccount();
  const { data: reserves } = useReserves();

  // Calculate TVL from reserves
  const tvl = reserves
    ? Number(reserves[0]) / 1e18 * 2450 + Number(reserves[1]) / 1e6
    : 0;

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-heading font-bold">Analytics</h1>
        <div className="flex gap-2">
          {(['24h', '7d', '30d'] as TimeRange[]).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-4 py-2 rounded-lg text-sm ${
                timeRange === range
                  ? 'bg-phoenix-ember text-feather-white'
                  : 'bg-ash-gray text-feather-white/60 hover:bg-carbon-gray'
              }`}
            >
              {range.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <MetricCard
          label="Total Value Locked"
          value={formatUSD(tvl)}
          change={12.3}
        />
        <MetricCard
          label={`${timeRange.toUpperCase()} Volume`}
          value={formatUSD(542000)}
          change={8.7}
        />
        <MetricCard
          label="Total Orders"
          value="1,234"
          subtext="+23 today"
        />
      </div>

      {/* Price Chart */}
      <div className="card mb-8">
        <h2 className="text-xl font-heading font-semibold mb-4">Price Chart</h2>
        <PriceChart timeRange={timeRange} />
        <p className="mt-4 text-xs text-feather-white/40">
          ⓘ Price derived from public reserve cache. May be slightly delayed.
        </p>
      </div>

      {/* User Stats (if connected) */}
      {isConnected && (
        <div className="card mb-8">
          <h2 className="text-xl font-heading font-semibold mb-4">Your Stats</h2>
          <UserStats />
        </div>
      )}

      {/* Volume Chart */}
      <div className="card">
        <h2 className="text-xl font-heading font-semibold mb-4">Volume Breakdown</h2>
        <VolumeChart timeRange={timeRange} />
      </div>
    </div>
  );
}
```

### 7.2 Deliverables

- [ ] Analytics page layout
- [ ] Metric cards with change indicators
- [ ] Price chart component (Lightweight Charts)
- [ ] Volume bar chart
- [ ] User statistics section
- [ ] Time range selector
- [ ] Reserve/price staleness notes
- [ ] Responsive chart sizing

---

## 8. Phase 6: Polish & Placeholders

**Goal:** Complete landing page and placeholder sections.

### 8.1 Landing Page

**File:** `src/app/page.tsx`
```typescript
import Link from 'next/link';
import { Button } from '@/components/ui/Button';

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative py-32 px-4 text-center">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-5xl md:text-7xl font-display font-bold mb-6">
            Trade in <span className="bg-flame-gradient bg-clip-text text-transparent">Silence</span>
          </h1>
          <p className="text-xl text-feather-white/70 mb-8 max-w-2xl mx-auto">
            Private execution powered by FHE. Your trades, your secret.
            No front-running. No MEV extraction. Complete privacy.
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/swap">
              <Button size="lg">Launch App</Button>
            </Link>
            <Button variant="secondary" size="lg">
              Learn More ↓
            </Button>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 px-4 bg-ash-gray/50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-heading font-bold text-center mb-12">
            Why FheatherX?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <FeatureCard
              icon="🔐"
              title="Encrypted Swaps"
              description="Trade direction and amounts hidden from everyone"
            />
            <FeatureCard
              icon="📋"
              title="Private Limit Orders"
              description="Set triggers without revealing your strategy"
            />
            <FeatureCard
              icon="🛡️"
              title="MEV Protection"
              description="No front-running, sandwiching, or extraction"
            />
            <FeatureCard
              icon="🏛️"
              title="Institutional Grade"
              description="Professional-level privacy for serious traders"
            />
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-heading font-bold text-center mb-12">
            How It Works
          </h2>
          <div className="space-y-8">
            <Step
              number={1}
              title="Deposit tokens into your FheatherX balance"
              description="Unlike traditional DEXs, you deposit first to enable encrypted accounting. Your funds remain under your control."
            />
            <Step
              number={2}
              title="Execute encrypted trades"
              description="Swap instantly or place limit orders. All parameters are encrypted—no one sees your moves."
            />
            <Step
              number={3}
              title="Manage orders & withdraw"
              description="Cancel pending orders anytime. Withdraw to your wallet whenever you want."
            />
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="py-12 px-4 bg-flame-gradient">
        <div className="max-w-4xl mx-auto grid grid-cols-3 gap-8 text-center">
          <div>
            <p className="text-3xl font-bold">$2.4M</p>
            <p className="text-sm opacity-80">Total Volume</p>
          </div>
          <div>
            <p className="text-3xl font-bold">1,234</p>
            <p className="text-sm opacity-80">Active Orders</p>
          </div>
          <div>
            <p className="text-3xl font-bold">567</p>
            <p className="text-sm opacity-80">Unique Users</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="card text-center">
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="font-heading font-semibold mb-2">{title}</h3>
      <p className="text-sm text-feather-white/60">{description}</p>
    </div>
  );
}

function Step({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div className="flex gap-6">
      <div className="w-12 h-12 rounded-full bg-flame-gradient flex items-center justify-center font-bold text-xl shrink-0">
        {number}
      </div>
      <div>
        <h3 className="font-heading font-semibold text-xl mb-2">{title}</h3>
        <p className="text-feather-white/60">{description}</p>
      </div>
    </div>
  );
}
```

### 8.2 Placeholder Pages

**File:** `src/app/auctions/page.tsx`
```typescript
import { ComingSoonPage } from '@/components/ComingSoonPage';

export default function AuctionsPage() {
  return (
    <ComingSoonPage
      icon="🪶"
      title="Private Auctions"
      description="Auction assets with complete bid privacy. No one sees your bid until the auction closes."
      features={[
        'Sealed-bid auctions powered by FHE',
        'Fair price discovery without front-running',
        'Support for NFTs, tokens, and more',
      ]}
      ctaText="Get Notified"
    />
  );
}
```

### 8.3 Deliverables

- [ ] Landing page hero section
- [ ] Features grid
- [ ] How it works section
- [ ] Live stats bar
- [ ] Auctions placeholder page
- [ ] Launchpad placeholder page
- [ ] Email signup integration (optional)
- [ ] Footer component
- [ ] Social links
- [ ] Documentation links

---

## 9. Phase 7: Testing & QA

**Goal:** Comprehensive testing and quality assurance.

### 9.1 Testing Strategy

#### 9.1.1 Unit Tests

```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

**Test areas:**
- [ ] Utility functions (tick/price conversion, order validation)
- [ ] FHE encryption/decryption (mock)
- [ ] Form validation logic
- [ ] Price calculations

#### 9.1.2 Component Tests

- [ ] Button variants and states
- [ ] Modal open/close behavior
- [ ] Form inputs and validation
- [ ] Token selector search
- [ ] Balance reveal flow

#### 9.1.3 Integration Tests

- [ ] Wallet connection flow
- [ ] Deposit/withdraw flow
- [ ] Swap execution
- [ ] Order placement
- [ ] Order cancellation

#### 9.1.4 E2E Tests (Optional)

```bash
npm install -D playwright
```

- [ ] Full user journey: connect → deposit → swap → withdraw
- [ ] Order lifecycle: place → monitor → cancel
- [ ] Network switching

### 9.2 QA Checklist

#### Visual QA
- [ ] All pages render correctly
- [ ] Responsive design works on mobile/tablet/desktop
- [ ] Animations are smooth
- [ ] Colors match design system
- [ ] Typography is consistent

#### Functional QA
- [ ] Wallet connects and disconnects properly
- [ ] Network switching works
- [ ] All forms validate correctly
- [ ] Error states display properly
- [ ] Loading states appear during async operations
- [ ] Success/failure feedback is clear

#### Accessibility QA
- [ ] Keyboard navigation works
- [ ] Screen reader announces content properly
- [ ] Focus indicators are visible
- [ ] Color contrast meets WCAG AA

#### Performance QA
- [ ] Initial page load < 3s
- [ ] Route transitions < 500ms
- [ ] No layout shifts
- [ ] Images optimized

### 9.3 Deliverables

- [ ] Unit test suite with >80% coverage on utilities
- [ ] Component test suite
- [ ] Integration tests for critical flows
- [ ] QA checklist completed
- [ ] Bug fixes from QA
- [ ] Performance optimizations

---

## 10. Technical Dependencies

### 10.1 External Dependencies

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
| framer-motion | 11.x | Animations |
| react-hook-form | 7.x | Forms |
| zod | 3.x | Validation |
| lightweight-charts | 4.x | Price charts |
| cofhejs | TBD | FHE client |

### 10.2 Contract Dependencies

- FheatherX hook contract deployed on target networks
- Pool Manager contract address
- Token contract addresses (token0, token1)

### 10.3 Infrastructure

- Vercel or similar for deployment
- Environment variables management
- RPC endpoints for each network
- WalletConnect project ID

---

## 11. Risk Mitigation

### 11.1 Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| FHE library not ready | High | Build with mock FHE, swap when ready |
| Contract ABI changes | Medium | Version ABIs, use TypeScript for type safety |
| Network instability | Medium | Implement retry logic, show clear errors |
| Slow FHE operations | Medium | Show progress indicators, explain delays |

### 11.2 UX Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Users don't understand deposit-first | High | Prominent onboarding, clear messaging |
| Order mechanics confusing | High | In-context explanations, tooltips |
| Balance reveal delay frustrating | Medium | Progress bar, session persistence option |

### 11.3 Security Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Private key exposure | Critical | Use RainbowKit, never handle keys |
| Contract interaction bugs | High | Thorough testing, transaction simulation |
| XSS attacks | High | Sanitize inputs, CSP headers |

---

## Appendix A: File Checklist

### Phase 0
- [ ] `frontend/package.json`
- [ ] `frontend/tsconfig.json`
- [ ] `frontend/tailwind.config.ts`
- [ ] `frontend/next.config.js`
- [ ] `frontend/.env.example`

### Phase 1
- [ ] `src/styles/globals.css`
- [ ] `src/lib/chains.ts`
- [ ] `src/lib/wagmi.ts`
- [ ] `src/lib/utils.ts`
- [ ] `src/lib/contracts/abi.ts`
- [ ] `src/lib/contracts/addresses.ts`
- [ ] `src/app/providers.tsx`
- [ ] `src/app/layout.tsx`
- [ ] `src/components/ui/Button.tsx`
- [ ] `src/components/ui/Card.tsx`
- [ ] `src/components/ui/Input.tsx`
- [ ] `src/components/ui/Modal.tsx`
- [ ] `src/components/layout/Header.tsx`

### Phase 2
- [ ] `src/lib/fhe.ts`
- [ ] `src/hooks/useContract.ts`
- [ ] `src/hooks/useBalanceReveal.ts`
- [ ] `src/app/portfolio/page.tsx`
- [ ] `src/components/portfolio/BalanceCard.tsx`
- [ ] `src/components/portfolio/DepositModal.tsx`
- [ ] `src/components/portfolio/WithdrawModal.tsx`
- [ ] `src/components/portfolio/ActivityList.tsx`

### Phase 3
- [ ] `src/lib/tokens.ts`
- [ ] `src/lib/ticks.ts`
- [ ] `src/app/swap/page.tsx`
- [ ] `src/components/swap/SwapCard.tsx`
- [ ] `src/components/swap/TokenSelector.tsx`
- [ ] `src/components/swap/SlippageSettings.tsx`
- [ ] `src/components/swap/NoDepositPrompt.tsx`

### Phase 4
- [ ] `src/lib/orders.ts`
- [ ] `src/app/orders/page.tsx`
- [ ] `src/app/orders/new/page.tsx`
- [ ] `src/app/orders/active/page.tsx`
- [ ] `src/app/orders/history/page.tsx`
- [ ] `src/components/orders/OrderTypeSelector.tsx`
- [ ] `src/components/orders/OrderForm.tsx`
- [ ] `src/components/orders/OrderCard.tsx`
- [ ] `src/components/orders/CancelModal.tsx`

### Phase 5
- [ ] `src/app/analytics/page.tsx`
- [ ] `src/components/analytics/MetricCard.tsx`
- [ ] `src/components/analytics/PriceChart.tsx`
- [ ] `src/components/analytics/VolumeChart.tsx`
- [ ] `src/components/analytics/UserStats.tsx`

### Phase 6
- [ ] `src/app/page.tsx`
- [ ] `src/app/auctions/page.tsx`
- [ ] `src/app/launchpad/page.tsx`
- [ ] `src/components/ComingSoonPage.tsx`
- [ ] `src/components/layout/Footer.tsx`

---

*End of Implementation Plan*
