# FheatherX Frontend Implementation Plan v3

**Version:** 3.0
**Based on:** v2 + v2 Audit Findings
**Created:** November 2024
**Status:** Ready for Implementation

---

## Changelog from v2

v3 incorporates all findings from the v2 audit:

| Addition | Section |
|----------|---------|
| Token approval flow (ERC20) | Phase 2, Appendix A |
| Native ETH handling | Phase 2, Appendix A |
| Gas estimation hook | Phase 1, Appendix A |
| Order status derivation | Phase 4, Appendix B |
| Network mismatch guard | Phase 1 |
| App loading states | Phase 1 |
| FHE retry logic | Appendix A |
| Block explorer links | Appendix A |
| Form validation schemas (Zod) | Appendix B |
| Constants file | Phase 0 |
| Environment validation | Phase 0 |
| cofhejs API abstraction note | Appendix A |

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

**Appendices:**
- [Appendix A: Hooks & Utilities](./FRONTEND_IMPL_v3_APPENDIX_A_HOOKS.md)
- [Appendix B: State & Validation](./FRONTEND_IMPL_v3_APPENDIX_B_STATE.md)
- [Appendix C: Components](./FRONTEND_IMPL_v3_APPENDIX_C_COMPONENTS.md)

---

## 1. Implementation Phases Overview

```
Phase 0: Project Setup
    │   ├── Next.js initialization
    │   ├── Dependencies
    │   ├── Constants file ← NEW
    │   └── Environment validation ← NEW
    │
    ▼
Phase 1: Core Infrastructure
    │   ├── Design System & UI Components
    │   ├── Wallet Connection (RainbowKit)
    │   ├── Network Configuration
    │   ├── Network Mismatch Guard ← NEW
    │   ├── App Loading States ← NEW
    │   ├── Gas Estimation Hook ← NEW
    │   └── Block Explorer Links ← NEW
    │
    ▼
Phase 1.5: FHE Infrastructure
    │   ├── FHE Client Wrapper (cofhejs)
    │   ├── Session/Permit Management
    │   ├── Encrypted Value Encoding
    │   ├── Decryption Flow with Progress
    │   ├── FHE Retry Logic ← NEW
    │   └── FHE State Store (Zustand)
    │
    ▼
Phase 2: Portfolio & Balances
    │   ├── Token Approval Flow ← NEW
    │   ├── Native ETH Handling ← NEW
    │   ├── Deposit Flow
    │   ├── Withdraw Flow
    │   ├── Balance Display (encrypted)
    │   └── Balance Reveal (FHE decrypt)
    │
    ▼
Phase 3: Swap Interface
    │   ├── Uniswap v4 Router Integration
    │   ├── hookData Encoding for Privacy
    │   ├── Transaction Simulation
    │   └── Swap Execution & Status
    │
    ▼
Phase 4: Limit Orders
    │   ├── Form Validation (Zod) ← NEW
    │   ├── Order Form (4 types)
    │   ├── FHE Encryption + allow()
    │   ├── Active Orders Management
    │   ├── Order Status Derivation ← NEW
    │   ├── Order History (Event Indexing)
    │   └── Cancel Flow
    │
    ▼
Phase 5: Analytics Dashboard
    │
    ▼
Phase 6: Polish & Placeholders
    │
    ▼
Phase 7: Testing & QA
```

---

## 2. Phase 0: Project Setup

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

# FHE
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
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── providers.tsx
│   │   ├── swap/page.tsx
│   │   ├── orders/
│   │   │   ├── new/page.tsx
│   │   │   ├── active/page.tsx
│   │   │   └── history/page.tsx
│   │   ├── portfolio/page.tsx
│   │   ├── analytics/page.tsx
│   │   ├── auctions/page.tsx
│   │   └── launchpad/page.tsx
│   ├── components/
│   │   ├── ui/
│   │   ├── layout/
│   │   ├── common/
│   │   │   ├── ErrorBoundary.tsx
│   │   │   ├── ConnectPrompt.tsx
│   │   │   ├── FheSessionGuard.tsx
│   │   │   ├── NetworkGuard.tsx      ← NEW
│   │   │   └── AppLoader.tsx         ← NEW
│   │   ├── swap/
│   │   ├── orders/
│   │   ├── portfolio/
│   │   └── analytics/
│   ├── hooks/
│   │   ├── useContract.ts
│   │   ├── useFheSession.ts
│   │   ├── useBalanceReveal.ts
│   │   ├── useSwap.ts
│   │   ├── usePlaceOrder.ts
│   │   ├── useOrderHistory.ts
│   │   ├── useGasEstimate.ts         ← NEW
│   │   ├── useDeposit.ts             ← Updated with approval
│   │   └── useIsMobile.ts
│   ├── lib/
│   │   ├── contracts/
│   │   │   ├── abi.ts
│   │   │   ├── erc20Abi.ts           ← NEW
│   │   │   ├── addresses.ts
│   │   │   ├── router.ts
│   │   │   └── encoding.ts
│   │   ├── fhe/
│   │   │   ├── client.ts
│   │   │   ├── session.ts
│   │   │   └── encoding.ts
│   │   ├── validation/               ← NEW
│   │   │   ├── orderSchema.ts
│   │   │   └── depositSchema.ts
│   │   ├── chains.ts
│   │   ├── tokens.ts
│   │   ├── orders.ts
│   │   ├── constants.ts              ← NEW
│   │   ├── env.ts                    ← NEW
│   │   └── utils.ts
│   ├── stores/
│   │   ├── fheStore.ts
│   │   ├── ordersStore.ts
│   │   └── uiStore.ts
│   ├── styles/globals.css
│   └── types/
├── public/
├── .env.example
├── tailwind.config.ts
└── package.json
```

### 2.4 Constants File (NEW)

```typescript
// src/lib/constants.ts

// Protocol
export const PROTOCOL_FEE = 0.001; // ETH
export const PROTOCOL_FEE_WEI = BigInt(1e15); // 0.001 ETH in wei
export const EXECUTOR_REWARD_BPS = 100; // 1%

// FHE
export const FHE_SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
export const FHE_RETRY_ATTEMPTS = 3;
export const FHE_RETRY_BASE_DELAY_MS = 1000;

// Caching
export const BALANCE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const TX_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

// Uniswap
export const MIN_SQRT_RATIO = BigInt('4295128739');
export const MAX_SQRT_RATIO = BigInt('1461446703485210103287273052203988822378723970342');
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

// Addresses
export const NATIVE_ETH_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

// UI
export const DEFAULT_SLIPPAGE = 0.5; // 0.5%
export const MAX_SLIPPAGE = 50; // 50%
```

### 2.5 Environment Validation (NEW)

```typescript
// src/lib/env.ts

const requiredEnvVars = [
  'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID',
] as const;

const networkEnvVars = [
  'NEXT_PUBLIC_FHEATHERX_ADDRESS_LOCAL',
  'NEXT_PUBLIC_FHEATHERX_ADDRESS_BASE_SEPOLIA',
  'NEXT_PUBLIC_SWAP_ROUTER_ADDRESS_LOCAL',
  'NEXT_PUBLIC_SWAP_ROUTER_ADDRESS_BASE_SEPOLIA',
] as const;

export function validateEnv(): void {
  const missing: string[] = [];

  for (const key of requiredEnvVars) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }

  // Warn about missing network vars in development
  if (process.env.NODE_ENV === 'development') {
    for (const key of networkEnvVars) {
      if (!process.env[key]) {
        console.warn(`Warning: ${key} not set. Some features may not work.`);
      }
    }
  }
}

// Call in layout.tsx
```

### 2.6 Environment File

```env
# .env.example

# Required
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id

# Network: Local
NEXT_PUBLIC_LOCAL_RPC_URL=http://localhost:8545
NEXT_PUBLIC_FHEATHERX_ADDRESS_LOCAL=0x...
NEXT_PUBLIC_SWAP_ROUTER_ADDRESS_LOCAL=0x...
NEXT_PUBLIC_TOKEN0_ADDRESS_LOCAL=0x...
NEXT_PUBLIC_TOKEN1_ADDRESS_LOCAL=0x...

# Network: Base Sepolia
NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
NEXT_PUBLIC_FHEATHERX_ADDRESS_BASE_SEPOLIA=0x...
NEXT_PUBLIC_SWAP_ROUTER_ADDRESS_BASE_SEPOLIA=0x...
NEXT_PUBLIC_TOKEN0_ADDRESS_BASE_SEPOLIA=0x...
NEXT_PUBLIC_TOKEN1_ADDRESS_BASE_SEPOLIA=0x...

# Network: Fhenix (when ready)
NEXT_PUBLIC_FHENIX_RPC_URL=https://testnet.fhenix.io
NEXT_PUBLIC_FHEATHERX_ADDRESS_FHENIX=0x...
NEXT_PUBLIC_SWAP_ROUTER_ADDRESS_FHENIX=0x...

# Pool Configuration
NEXT_PUBLIC_POOL_FEE=3000
NEXT_PUBLIC_TICK_SPACING=60
```

### 2.7 Deliverables

- [ ] Next.js project initialized
- [ ] All dependencies installed
- [ ] Directory structure created
- [ ] Constants file created
- [ ] Environment validation added
- [ ] `.env.example` documented
- [ ] TypeScript strict mode enabled

---

## 3. Phase 1: Core Infrastructure

### 3.1 Chain Configuration with Explorer Links (UPDATED)

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
  blockExplorers: {
    default: { name: 'Fhenix Explorer', url: 'https://explorer.testnet.fhenix.zone' },
  },
  testnet: true,
};

export const supportedChains = [localAnvil, baseSepolia, fhenixTestnet] as const;

// FHE support per network
export type FheSupport = 'full' | 'mock';
export const fheSupport: Record<number, FheSupport> = {
  31337: 'mock',
  84532: 'mock',
  8008135: 'full',
};

// Block explorer URL helper (NEW)
export function getExplorerTxUrl(chainId: number, txHash: `0x${string}`): string | null {
  const chain = supportedChains.find(c => c.id === chainId);
  const explorer = chain?.blockExplorers?.default;
  if (!explorer) return null;
  return `${explorer.url}/tx/${txHash}`;
}

export function getExplorerAddressUrl(chainId: number, address: `0x${string}`): string | null {
  const chain = supportedChains.find(c => c.id === chainId);
  const explorer = chain?.blockExplorers?.default;
  if (!explorer) return null;
  return `${explorer.url}/address/${address}`;
}
```

### 3.2 Network Guard (NEW)

```typescript
// src/components/common/NetworkGuard.tsx

'use client';

import { ReactNode } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { supportedChains } from '@/lib/chains';

interface NetworkGuardProps {
  children: ReactNode;
}

export function NetworkGuard({ children }: NetworkGuardProps) {
  const { chain, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  // Not connected - no guard needed
  if (!isConnected) {
    return <>{children}</>;
  }

  // Check if current chain is supported
  const isSupported = supportedChains.some(c => c.id === chain?.id);

  if (!isSupported) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Card className="text-center max-w-md">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold mb-2">Unsupported Network</h2>
          <p className="text-feather-white/60 mb-6">
            You're connected to {chain?.name || 'an unknown network'}.
            Please switch to a supported network.
          </p>
          <div className="space-y-2">
            {supportedChains.map(c => (
              <Button
                key={c.id}
                variant="secondary"
                onClick={() => switchChain({ chainId: c.id })}
                loading={isPending}
                className="w-full"
              >
                Switch to {c.name}
              </Button>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
```

### 3.3 App Loader (NEW)

```typescript
// src/components/common/AppLoader.tsx

'use client';

import { ReactNode } from 'react';
import { useAccount } from 'wagmi';

interface AppLoaderProps {
  children: ReactNode;
}

export function AppLoader({ children }: AppLoaderProps) {
  const { isConnecting, isReconnecting } = useAccount();

  if (isConnecting || isReconnecting) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-obsidian-black">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-phoenix-ember/20 flex items-center justify-center animate-pulse-ember">
            <span className="text-2xl">🔗</span>
          </div>
          <p className="text-feather-white/60">Connecting wallet...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
```

### 3.4 Gas Estimation Hook (NEW)

```typescript
// src/hooks/useGasEstimate.ts

import { usePublicClient } from 'wagmi';
import { formatEther, type Abi } from 'viem';

interface GasEstimateRequest {
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  account?: `0x${string}`;
}

interface GasEstimate {
  gas: bigint;
  gasPrice: bigint;
  estimatedCost: bigint;
  estimatedCostEth: string;
  estimatedCostUsd?: number;
}

export function useGasEstimate() {
  const publicClient = usePublicClient();

  const estimate = async (
    request: GasEstimateRequest,
    ethPriceUsd?: number
  ): Promise<GasEstimate | null> => {
    if (!publicClient) return null;

    try {
      const [gas, gasPrice] = await Promise.all([
        publicClient.estimateContractGas({
          address: request.address,
          abi: request.abi,
          functionName: request.functionName,
          args: request.args,
          value: request.value,
          account: request.account,
        }),
        publicClient.getGasPrice(),
      ]);

      const estimatedCost = gas * gasPrice;
      const estimatedCostEth = formatEther(estimatedCost);

      return {
        gas,
        gasPrice,
        estimatedCost,
        estimatedCostEth,
        estimatedCostUsd: ethPriceUsd
          ? parseFloat(estimatedCostEth) * ethPriceUsd
          : undefined,
      };
    } catch (error) {
      console.warn('Gas estimation failed:', error);
      return null; // Estimation failed - tx likely to fail
    }
  };

  return { estimate };
}
```

### 3.5 Root Layout Integration

```typescript
// src/app/layout.tsx

import { validateEnv } from '@/lib/env';
import { Providers } from './providers';
import { Header } from '@/components/layout/Header';
import { AppLoader } from '@/components/common/AppLoader';
import { NetworkGuard } from '@/components/common/NetworkGuard';
import '@/styles/globals.css';

// Validate environment on startup
validateEnv();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <AppLoader>
            <Header />
            <main className="pt-16 min-h-screen">
              <NetworkGuard>
                {children}
              </NetworkGuard>
            </main>
          </AppLoader>
        </Providers>
      </body>
    </html>
  );
}
```

### 3.6 Deliverables

- [ ] Tailwind config with theme
- [ ] Global styles
- [ ] Base UI components
- [ ] Header with navigation
- [ ] NetworkGuard component
- [ ] AppLoader component
- [ ] Gas estimation hook
- [ ] Block explorer URL helpers
- [ ] Error boundary
- [ ] Mobile navigation

---

## 4. Phase 1.5: FHE Infrastructure

See [Appendix A: Hooks & Utilities](./FRONTEND_IMPL_v3_APPENDIX_A_HOOKS.md) for complete FHE implementation including:

- FHE client wrapper with **retry logic** (NEW)
- Session/permit management
- Mock client for non-Fhenix networks
- Encrypted value encoding
- Balance reveal with progress
- **cofhejs API abstraction layer** (NEW)

### 4.1 Key Addition: FHE Retry Logic

```typescript
// In useBalanceReveal - retry with exponential backoff
const reveal = async (maxRetries = FHE_RETRY_ATTEMPTS) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // ... decryption logic
      return decrypted;
    } catch (error) {
      if (attempt === maxRetries) throw error;

      // Exponential backoff: 1s, 2s, 4s
      const delay = FHE_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, delay));
    }
  }
};
```

### 4.2 Deliverables

- [ ] FHE client wrapper with retry logic
- [ ] FHE session state store
- [ ] `useFheSession` hook
- [ ] FHE session indicator
- [ ] FHE session guard
- [ ] Mock client for dev
- [ ] Balance caching

---

## 5. Phase 2: Portfolio & Balances

### 5.1 Token Approval & Native ETH Handling (NEW)

See [Appendix A](./FRONTEND_IMPL_v3_APPENDIX_A_HOOKS.md) for complete `useDeposit` implementation with:

- ERC20 allowance checking
- Approval transaction
- Native ETH detection
- Two-step deposit flow

### 5.2 Updated Deposit Hook Summary

```typescript
// src/hooks/useDeposit.ts - Key changes

export function useDeposit() {
  // ...

  return {
    // Check if approval needed
    checkNeedsApproval: async (isToken0: boolean, amount: bigint) => {...},

    // Approve ERC20 spending
    approve: async (isToken0: boolean, amount: bigint) => {...},

    // Deposit (handles both ERC20 and native ETH)
    deposit: async (isToken0: boolean, amount: bigint) => {...},

    // Combined flow
    approveAndDeposit: async (isToken0: boolean, amount: bigint) => {...},

    // State
    isApproving,
    isDepositing,
    approvalHash,
    depositHash,
  };
}
```

### 5.3 Deposit Modal Updates

The DepositModal must now show a two-step flow:

```
┌─────────────────────────────────────┐
│  DEPOSIT USDC                       │
├─────────────────────────────────────┤
│                                     │
│  Amount: [____1000____] USDC        │
│                                     │
│  ┌─────────────────────────────────┐│
│  │ Step 1: Approve   [✓ Complete] ││
│  │ Step 2: Deposit   [In Progress]││
│  └─────────────────────────────────┘│
│                                     │
│  [        Processing...         ]   │
│                                     │
└─────────────────────────────────────┘
```

### 5.4 Deliverables

- [ ] Token approval flow
- [ ] Native ETH detection
- [ ] Updated `useDeposit` hook
- [ ] Updated `useWithdraw` hook
- [ ] DepositModal with two-step UI
- [ ] WithdrawModal
- [ ] BalanceCard with reveal
- [ ] Portfolio page

---

## 6. Phase 3: Swap Interface

No major changes from v2. See v2 documentation for:

- Router integration
- Pool key construction
- hookData encoding
- Swap execution

### 6.1 Deliverables

- [ ] Router ABI and pool key
- [ ] `useSwap` hook with simulation
- [ ] Tick/price utilities
- [ ] Swap page
- [ ] SwapCard component
- [ ] TokenSelector
- [ ] SlippageSettings

---

## 7. Phase 4: Limit Orders

### 7.1 Form Validation with Zod (NEW)

See [Appendix B: State & Validation](./FRONTEND_IMPL_v3_APPENDIX_B_STATE.md) for complete validation schemas.

```typescript
// Key validation: trigger price vs current price
export function validateTriggerPrice(
  orderType: OrderType,
  triggerPrice: number,
  currentPrice: number
): { valid: boolean; error?: string } {
  switch (orderType) {
    case 'limit-buy':
      if (triggerPrice >= currentPrice) {
        return { valid: false, error: 'Trigger must be below current price' };
      }
      break;
    case 'limit-sell':
    case 'take-profit':
      if (triggerPrice <= currentPrice) {
        return { valid: false, error: 'Trigger must be above current price' };
      }
      break;
    case 'stop-loss':
      if (triggerPrice >= currentPrice) {
        return { valid: false, error: 'Trigger must be below current price' };
      }
      break;
  }
  return { valid: true };
}
```

### 7.2 Order Status Derivation (NEW)

```typescript
// src/lib/orders.ts

export type OrderStatus = 'active' | 'filled' | 'cancelled' | 'slippage_failed';

export function deriveOrderStatus(
  orderId: bigint,
  placedEvents: OrderPlacedEvent[],
  filledEvents: OrderFilledEvent[],
  cancelledEvents: OrderCancelledEvent[]
): OrderStatus {
  // Check if cancelled
  const wasCancelled = cancelledEvents.some(e => e.orderId === orderId);
  if (wasCancelled) return 'cancelled';

  // Check if filled
  const fillEvent = filledEvents.find(e => e.orderId === orderId);
  if (fillEvent) {
    // Check if slippage failed (if contract provides this info)
    // This depends on contract implementation
    return 'filled';
  }

  // Still active
  return 'active';
}
```

### 7.3 Deliverables

- [ ] Zod validation schemas
- [ ] Trigger price validation
- [ ] Order status derivation
- [ ] `usePlaceOrder` hook
- [ ] `useCancelOrder` hook
- [ ] `useOrderHistory` hook
- [ ] Order fill notifications
- [ ] Order pages (new, active, history)
- [ ] OrderForm component
- [ ] OrderCard component

---

## 8. Phase 5: Analytics Dashboard

No changes from v2.

### 8.1 Deliverables

- [ ] `usePoolMetrics` hook
- [ ] Analytics page
- [ ] MetricCard component
- [ ] PriceChart component
- [ ] VolumeChart component

---

## 9. Phase 6: Polish & Placeholders

No changes from v2.

### 9.1 Deliverables

- [ ] Landing page
- [ ] Auctions placeholder
- [ ] Launchpad placeholder
- [ ] Footer
- [ ] Mobile optimizations

---

## 10. Phase 7: Testing & QA

### 10.1 Unit Tests

Priority test areas:

```typescript
// Validation
- orderSchema validation
- trigger price validation
- order status derivation

// Utilities
- tick/price conversion
- gas estimation
- block explorer URLs

// FHE
- mock client encryption/decryption
- retry logic
- session expiry
```

### 10.2 Integration Tests

```typescript
// Critical flows
- Wallet connect → disconnect
- Deposit with approval → deposit
- Swap simulation → execution
- Order place → cancel
- Balance reveal with retry
```

### 10.3 Deliverables

- [ ] Unit tests (>80% utility coverage)
- [ ] Integration tests for critical flows
- [ ] E2E tests for main journeys
- [ ] Accessibility audit
- [ ] Performance audit

---

## Technical Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| next | 14.x | Framework |
| react | 18.x | UI |
| typescript | 5.x | Types |
| wagmi | 2.x | Wallet |
| viem | 2.x | Contracts |
| @rainbow-me/rainbowkit | 2.x | Wallet UI |
| @tanstack/react-query | 5.x | Data fetching |
| zustand | 4.x | State |
| zod | 3.x | Validation |
| cofhejs | TBD | FHE |

---

## Appendices

- **[Appendix A: Hooks & Utilities](./FRONTEND_IMPL_v3_APPENDIX_A_HOOKS.md)** - All hooks including deposit with approval, gas estimation, FHE with retry
- **[Appendix B: State & Validation](./FRONTEND_IMPL_v3_APPENDIX_B_STATE.md)** - Zustand stores, Zod schemas, order status
- **[Appendix C: Components](./FRONTEND_IMPL_v3_APPENDIX_C_COMPONENTS.md)** - UI components (same as v2)

---

*End of Implementation Plan v3*
