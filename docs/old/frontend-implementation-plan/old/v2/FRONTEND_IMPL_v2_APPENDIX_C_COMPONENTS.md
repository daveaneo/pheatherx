# Appendix C: Component Specifications

**Parent Document:** [FRONTEND_IMPLEMENTATION_PLAN_v2.md](./FRONTEND_IMPLEMENTATION_PLAN_v2.md)

---

## Overview

This appendix provides complete component specifications including Tailwind configuration, base UI components, and feature-specific components.

---

## 1. Tailwind Configuration

```typescript
// tailwind.config.ts

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
        'flame-gradient':
          'linear-gradient(135deg, #FF6A3D 0%, #D6246E 50%, #6B5BFF 100%)',
        'feather-gradient':
          'linear-gradient(90deg, #F0C27B 0%, #19C9A0 100%)',
        'obsidian-gradient':
          'linear-gradient(180deg, #0A0A0F 0%, #1C1E26 100%)',
      },

      fontFamily: {
        heading: ['var(--font-inter-tight)', 'Inter Tight', 'sans-serif'],
        body: ['var(--font-satoshi)', 'Satoshi', 'sans-serif'],
        mono: ['var(--font-ibm-plex-mono)', 'IBM Plex Mono', 'monospace'],
        display: ['var(--font-neue-machina)', 'Neue Machina', 'sans-serif'],
      },

      fontSize: {
        'display-1': ['4rem', { lineHeight: '1.1', fontWeight: '700' }],
        'display-2': ['3rem', { lineHeight: '1.15', fontWeight: '700' }],
        'heading-1': ['2.5rem', { lineHeight: '1.2', fontWeight: '700' }],
        'heading-2': ['2rem', { lineHeight: '1.25', fontWeight: '600' }],
        'heading-3': ['1.5rem', { lineHeight: '1.3', fontWeight: '600' }],
        'heading-4': ['1.25rem', { lineHeight: '1.4', fontWeight: '500' }],
      },

      borderRadius: {
        DEFAULT: '12px',
        lg: '16px',
        xl: '20px',
        '2xl': '24px',
      },

      boxShadow: {
        'ember-glow': '0 0 20px rgba(255, 106, 61, 0.3)',
        'ember-glow-sm': '0 0 10px rgba(255, 106, 61, 0.2)',
        card: '0 4px 24px rgba(0, 0, 0, 0.2)',
        'card-hover': '0 8px 32px rgba(0, 0, 0, 0.3)',
      },

      animation: {
        shimmer: 'shimmer 2s ease infinite',
        'pulse-ember': 'pulse-ember 1.5s ease-in-out infinite',
        float: 'float 3s ease-in-out infinite',
        'fade-in': 'fadeIn 0.3s ease',
        'slide-up': 'slideUp 0.3s ease',
        'slide-down': 'slideDown 0.3s ease',
      },

      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        'pulse-ember': {
          '0%, 100%': { boxShadow: '0 0 8px rgba(255, 106, 61, 0.4)' },
          '50%': { boxShadow: '0 0 20px rgba(255, 106, 61, 0.6)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-3px)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: { transform: 'translateY(10px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          from: { transform: 'translateY(-10px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
      },

      transitionDuration: {
        DEFAULT: '200ms',
      },
    },
  },
  plugins: [],
};

export default config;
```

---

## 2. Global Styles

```css
/* src/styles/globals.css */

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --phoenix-ember: #ff6a3d;
    --feather-gold: #f0c27b;
    --obsidian-black: #0a0a0f;
    --ash-gray: #1c1e26;
    --iridescent-violet: #6b5bff;
    --deep-magenta: #d6246e;
    --electric-teal: #19c9a0;
    --carbon-gray: #2b2d36;
    --feather-white: #f9f7f1;
  }

  * {
    @apply border-carbon-gray;
  }

  body {
    @apply bg-obsidian-black text-feather-white font-body antialiased;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    @apply font-heading;
  }

  /* Custom selection color */
  ::selection {
    @apply bg-phoenix-ember/30 text-feather-white;
  }
}

@layer components {
  /* Card styles */
  .card {
    @apply bg-carbon-gray border border-carbon-gray/50 rounded-lg p-6
           shadow-card transition-shadow duration-200
           hover:shadow-card-hover;
  }

  .card-interactive {
    @apply card cursor-pointer
           hover:border-phoenix-ember/30 hover:shadow-ember-glow-sm;
  }

  /* Input styles */
  .input-field {
    @apply bg-ash-gray border border-carbon-gray rounded-lg px-4 py-3
           text-feather-white placeholder:text-feather-white/40
           focus:border-phoenix-ember focus:ring-1 focus:ring-phoenix-ember/30
           outline-none transition-all duration-200 w-full;
  }

  .input-field-error {
    @apply input-field border-deep-magenta focus:border-deep-magenta
           focus:ring-deep-magenta/30;
  }

  /* Encrypted value display */
  .encrypted-value {
    @apply font-mono text-iridescent-violet;
  }

  /* Status badges */
  .badge {
    @apply inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium;
  }

  .badge-success {
    @apply badge bg-electric-teal/20 text-electric-teal;
  }

  .badge-error {
    @apply badge bg-deep-magenta/20 text-deep-magenta;
  }

  .badge-warning {
    @apply badge bg-feather-gold/20 text-feather-gold;
  }

  .badge-info {
    @apply badge bg-iridescent-violet/20 text-iridescent-violet;
  }
}

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  @apply bg-obsidian-black;
}

::-webkit-scrollbar-thumb {
  @apply bg-carbon-gray rounded-full;
}

::-webkit-scrollbar-thumb:hover {
  @apply bg-ash-gray;
}

/* Focus visible for accessibility */
.focus-visible:focus-visible {
  @apply outline-none ring-2 ring-phoenix-ember ring-offset-2 ring-offset-obsidian-black;
}
```

---

## 3. Utility Functions

```typescript
// src/lib/utils.ts

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatUSD(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function formatTokenAmount(
  value: bigint,
  decimals: number,
  displayDecimals = 4
): string {
  const divisor = BigInt(10 ** decimals);
  const integerPart = value / divisor;
  const fractionalPart = value % divisor;

  const fractionalStr = fractionalPart
    .toString()
    .padStart(decimals, '0')
    .slice(0, displayDecimals);

  return `${integerPart}.${fractionalStr}`;
}
```

---

## 4. Base UI Components

### 4.1 Button

```typescript
// src/components/ui/Button.tsx

import { forwardRef, ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phoenix-ember focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian-black',
  {
    variants: {
      variant: {
        primary:
          'bg-flame-gradient text-feather-white shadow-ember-glow hover:brightness-110 active:scale-[0.98]',
        secondary:
          'bg-transparent border border-carbon-gray text-feather-white hover:border-phoenix-ember hover:text-phoenix-ember',
        danger:
          'bg-deep-magenta text-feather-white hover:brightness-110 active:scale-[0.98]',
        ghost:
          'bg-transparent text-feather-white hover:bg-carbon-gray/50',
        link: 'bg-transparent text-phoenix-ember hover:underline p-0',
      },
      size: {
        sm: 'h-9 px-4 text-sm',
        md: 'h-11 px-6 text-base',
        lg: 'h-14 px-8 text-lg',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

export interface ButtonProps
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
          <svg
            className="mr-2 h-4 w-4 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
```

### 4.2 Input

```typescript
// src/components/ui/Input.tsx

import { forwardRef, InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  icon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, icon, type, ...props }, ref) => {
    return (
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-feather-white/40">
            {icon}
          </div>
        )}
        <input
          type={type}
          className={cn(
            'input-field',
            icon && 'pl-10',
            error && 'input-field-error',
            className
          )}
          ref={ref}
          {...props}
        />
      </div>
    );
  }
);

Input.displayName = 'Input';
```

### 4.3 Card

```typescript
// src/components/ui/Card.tsx

import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(interactive ? 'card-interactive' : 'card', className)}
        {...props}
      />
    );
  }
);

Card.displayName = 'Card';

export const CardHeader = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col space-y-1.5 pb-4', className)}
    {...props}
  />
));

CardHeader.displayName = 'CardHeader';

export const CardTitle = forwardRef<
  HTMLHeadingElement,
  HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn('text-xl font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));

CardTitle.displayName = 'CardTitle';

export const CardContent = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('', className)} {...props} />
));

CardContent.displayName = 'CardContent';
```

### 4.4 Modal

```typescript
// src/components/ui/Modal.tsx

'use client';

import { Fragment, ReactNode } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { cn } from '@/lib/utils';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Modal({ isOpen, onClose, title, children, className }: ModalProps) {
  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-obsidian-black/80 backdrop-blur-sm" />
        </Transition.Child>

        {/* Modal */}
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel
                className={cn(
                  'w-full max-w-md transform overflow-hidden rounded-xl bg-carbon-gray p-6 shadow-xl transition-all',
                  className
                )}
              >
                {title && (
                  <Dialog.Title className="text-lg font-semibold mb-4">
                    {title}
                  </Dialog.Title>
                )}
                {children}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
```

### 4.5 BottomSheet (Mobile)

```typescript
// src/components/ui/BottomSheet.tsx

'use client';

import { Fragment, ReactNode } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { cn } from '@/lib/utils';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function BottomSheet({
  isOpen,
  onClose,
  title,
  children,
  className,
}: BottomSheetProps) {
  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-obsidian-black/80" />
        </Transition.Child>

        {/* Sheet */}
        <div className="fixed inset-0 overflow-hidden">
          <div className="flex min-h-full items-end justify-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="translate-y-full"
              enterTo="translate-y-0"
              leave="ease-in duration-200"
              leaveFrom="translate-y-0"
              leaveTo="translate-y-full"
            >
              <Dialog.Panel
                className={cn(
                  'w-full max-h-[85vh] transform overflow-hidden rounded-t-2xl bg-carbon-gray shadow-xl transition-all',
                  className
                )}
              >
                {/* Handle */}
                <div className="sticky top-0 bg-carbon-gray pt-4 pb-2 px-6">
                  <div className="w-12 h-1 bg-ash-gray rounded-full mx-auto mb-4" />
                  {title && (
                    <Dialog.Title className="text-lg font-semibold text-center">
                      {title}
                    </Dialog.Title>
                  )}
                </div>

                {/* Content */}
                <div className="px-6 pb-8 overflow-y-auto">{children}</div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
```

### 4.6 Adaptive Modal

```typescript
// src/components/ui/AdaptiveModal.tsx

'use client';

import { ReactNode } from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Modal } from './Modal';
import { BottomSheet } from './BottomSheet';

interface AdaptiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function AdaptiveModal(props: AdaptiveModalProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return <BottomSheet {...props} />;
  }

  return <Modal {...props} />;
}
```

### 4.7 Progress

```typescript
// src/components/ui/Progress.tsx

import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  value: number;
  max?: number;
}

export const Progress = forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, max = 100, ...props }, ref) => {
    const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

    return (
      <div
        ref={ref}
        className={cn(
          'relative h-2 w-full overflow-hidden rounded-full bg-ash-gray',
          className
        )}
        {...props}
      >
        <div
          className="h-full bg-flame-gradient transition-all duration-300 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
    );
  }
);

Progress.displayName = 'Progress';
```

### 4.8 Skeleton

```typescript
// src/components/ui/Skeleton.tsx

import { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn('animate-pulse rounded-lg bg-carbon-gray', className)}
      {...props}
    />
  );
}
```

### 4.9 Tooltip

```typescript
// src/components/ui/Tooltip.tsx

'use client';

import { ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}

export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div
          className={cn(
            'absolute z-50 px-3 py-2 text-sm bg-ash-gray rounded-lg shadow-lg whitespace-nowrap animate-fade-in',
            positionClasses[side]
          )}
        >
          {content}
        </div>
      )}
    </div>
  );
}
```

### 4.10 Tabs

```typescript
// src/components/ui/Tabs.tsx

'use client';

import { createContext, useContext, useState, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface TabsContextValue {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

interface TabsProps {
  defaultValue: string;
  children: ReactNode;
  className?: string;
}

export function Tabs({ defaultValue, children, className }: TabsProps) {
  const [activeTab, setActiveTab] = useState(defaultValue);

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

interface TabsListProps {
  children: ReactNode;
  className?: string;
}

export function TabsList({ children, className }: TabsListProps) {
  return (
    <div
      className={cn(
        'flex gap-1 p-1 bg-ash-gray rounded-lg',
        className
      )}
    >
      {children}
    </div>
  );
}

interface TabsTriggerProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabsTrigger({ value, children, className }: TabsTriggerProps) {
  const context = useContext(TabsContext);
  if (!context) throw new Error('TabsTrigger must be used within Tabs');

  const isActive = context.activeTab === value;

  return (
    <button
      onClick={() => context.setActiveTab(value)}
      className={cn(
        'px-4 py-2 rounded-md text-sm font-medium transition-all',
        isActive
          ? 'bg-carbon-gray text-feather-white shadow-sm'
          : 'text-feather-white/60 hover:text-feather-white',
        className
      )}
    >
      {children}
    </button>
  );
}

interface TabsContentProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabsContent({ value, children, className }: TabsContentProps) {
  const context = useContext(TabsContext);
  if (!context) throw new Error('TabsContent must be used within Tabs');

  if (context.activeTab !== value) return null;

  return (
    <div className={cn('animate-fade-in', className)}>
      {children}
    </div>
  );
}
```

---

## 5. Feature Components

### 5.1 ConnectPrompt

```typescript
// src/components/common/ConnectPrompt.tsx

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Card } from '@/components/ui/Card';

interface ConnectPromptProps {
  message?: string;
}

export function ConnectPrompt({
  message = 'Connect your wallet to continue',
}: ConnectPromptProps) {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Card className="text-center max-w-md">
        <div className="text-4xl mb-4">🔗</div>
        <h2 className="text-xl font-semibold mb-2">Wallet Required</h2>
        <p className="text-feather-white/60 mb-6">{message}</p>
        <ConnectButton />
      </Card>
    </div>
  );
}
```

### 5.2 TokenSelector

```typescript
// src/components/swap/TokenSelector.tsx

'use client';

import { useState } from 'react';
import { useChainId } from 'wagmi';
import { AdaptiveModal } from '@/components/ui/AdaptiveModal';
import { Input } from '@/components/ui/Input';
import { TOKEN_LIST, Token } from '@/lib/tokens';
import { cn } from '@/lib/utils';

interface TokenSelectorProps {
  selected?: Token;
  onSelect: (token: Token) => void;
  excludeToken?: Token;
  className?: string;
}

export function TokenSelector({
  selected,
  onSelect,
  excludeToken,
  className,
}: TokenSelectorProps) {
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

  const handleSelect = (token: Token) => {
    onSelect(token);
    setIsOpen(false);
    setSearch('');
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          'flex items-center gap-2 bg-ash-gray hover:bg-carbon-gray rounded-lg px-3 py-2 transition-colors',
          className
        )}
      >
        {selected ? (
          <>
            <div className="w-6 h-6 rounded-full bg-carbon-gray flex items-center justify-center text-xs font-bold">
              {selected.symbol[0]}
            </div>
            <span className="font-medium">{selected.symbol}</span>
          </>
        ) : (
          <span className="text-feather-white/60">Select</span>
        )}
        <span className="text-feather-white/40">▼</span>
      </button>

      <AdaptiveModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Select Token"
      >
        <Input
          placeholder="Search by name or symbol..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-4"
        />

        <div className="space-y-1 max-h-64 overflow-y-auto">
          {filteredTokens.length === 0 ? (
            <p className="text-center text-feather-white/60 py-8">
              No tokens found
            </p>
          ) : (
            filteredTokens.map((token) => (
              <button
                key={token.address}
                onClick={() => handleSelect(token)}
                className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-ash-gray transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-carbon-gray flex items-center justify-center font-bold">
                  {token.symbol[0]}
                </div>
                <div className="text-left">
                  <p className="font-medium">{token.symbol}</p>
                  <p className="text-sm text-feather-white/60">{token.name}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </AdaptiveModal>
    </>
  );
}
```

### 5.3 OrderTypeSelector

```typescript
// src/components/orders/OrderTypeSelector.tsx

import { ORDER_TYPES, OrderType } from '@/lib/orders';
import { cn } from '@/lib/utils';

interface OrderTypeSelectorProps {
  selected: OrderType;
  onSelect: (type: OrderType) => void;
}

export function OrderTypeSelector({ selected, onSelect }: OrderTypeSelectorProps) {
  return (
    <div className="flex gap-2 p-1 bg-ash-gray rounded-lg overflow-x-auto">
      {ORDER_TYPES.map((orderType) => (
        <button
          key={orderType.type}
          onClick={() => onSelect(orderType.type)}
          className={cn(
            'flex-1 min-w-[100px] px-4 py-3 rounded-md text-sm font-medium transition-all whitespace-nowrap',
            selected === orderType.type
              ? 'bg-carbon-gray text-feather-white shadow-sm'
              : 'text-feather-white/60 hover:text-feather-white'
          )}
        >
          <span className="mr-2">{orderType.icon}</span>
          {orderType.label}
        </button>
      ))}
    </div>
  );
}
```

---

## 6. Mobile Hook

```typescript
// src/hooks/useIsMobile.ts

import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 768;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };

    // Check on mount
    checkMobile();

    // Listen for resize
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return isMobile;
}
```

---

## 7. File Checklist

### UI Components
- [ ] `src/components/ui/Button.tsx`
- [ ] `src/components/ui/Input.tsx`
- [ ] `src/components/ui/Card.tsx`
- [ ] `src/components/ui/Modal.tsx`
- [ ] `src/components/ui/BottomSheet.tsx`
- [ ] `src/components/ui/AdaptiveModal.tsx`
- [ ] `src/components/ui/Progress.tsx`
- [ ] `src/components/ui/Skeleton.tsx`
- [ ] `src/components/ui/Tooltip.tsx`
- [ ] `src/components/ui/Tabs.tsx`
- [ ] `src/components/ui/Badge.tsx`
- [ ] `src/components/ui/Select.tsx`

### Layout Components
- [ ] `src/components/layout/Header.tsx`
- [ ] `src/components/layout/Footer.tsx`
- [ ] `src/components/layout/MobileNav.tsx`
- [ ] `src/components/layout/FheSessionIndicator.tsx`

### Common Components
- [ ] `src/components/common/ConnectPrompt.tsx`
- [ ] `src/components/common/ErrorBoundary.tsx`
- [ ] `src/components/common/FheSessionGuard.tsx`
- [ ] `src/components/common/EncryptedBalance.tsx`

### Feature Components
- [ ] `src/components/swap/TokenSelector.tsx`
- [ ] `src/components/swap/SwapCard.tsx`
- [ ] `src/components/swap/SlippageSettings.tsx`
- [ ] `src/components/orders/OrderTypeSelector.tsx`
- [ ] `src/components/orders/OrderForm.tsx`
- [ ] `src/components/orders/OrderCard.tsx`
- [ ] `src/components/portfolio/BalanceCard.tsx`
- [ ] `src/components/portfolio/DepositModal.tsx`
- [ ] `src/components/portfolio/WithdrawModal.tsx`

---

*End of Appendix C*
