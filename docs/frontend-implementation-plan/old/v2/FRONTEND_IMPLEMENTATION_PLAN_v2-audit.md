# Frontend Implementation Plan v2 - Audit

**Reviewing:** `FRONTEND_IMPLEMENTATION_PLAN_v2.md` and Appendices A, B, C
**Date:** November 2024
**Purpose:** Final audit before implementation begins

---

## Executive Summary

The v2 implementation plan represents a significant improvement over v1, with proper FHE integration, state management, and router patterns. This audit identifies **remaining gaps and refinements** needed for production readiness. Overall, the plan is implementation-ready with the changes noted below.

**Audit Result:** ✅ Approved with minor refinements

---

## 1. Strengths of v2

### 1.1 FHE Integration (Appendix A)
- ✅ Proper session/permit flow documented
- ✅ Mock client for non-Fhenix networks
- ✅ Clear encryption/decryption patterns
- ✅ Security considerations addressed
- ✅ Session expiry handling

### 1.2 State Management (Appendix B)
- ✅ Clear separation of server state (TanStack Query) and client state (Zustand)
- ✅ Event-based invalidation pattern
- ✅ Optimistic updates for cancel order
- ✅ Proper persistence strategy (sessionStorage for sensitive data)
- ✅ Query key organization

### 1.3 Component Architecture (Appendix C)
- ✅ Comprehensive Tailwind configuration
- ✅ AdaptiveModal pattern for mobile/desktop
- ✅ Consistent component API design
- ✅ Accessibility considerations (focus-visible)

### 1.4 Router Integration
- ✅ Uniswap v4 router pattern documented
- ✅ Pool key construction
- ✅ hookData encoding for privacy

---

## 2. Gaps Identified

### 2.1 Missing: Token Approval Flow

**Issue:** The deposit flow shows `deposit(isToken0, amount)` but doesn't address ERC20 token approval.

**Current (incomplete):**
```typescript
const deposit = async (isToken0: boolean, amount: bigint) => {
  return writeContractAsync({
    address: hookAddress,
    abi: PHEATHERX_ABI,
    functionName: 'deposit',
    args: [isToken0, amount],
  });
};
```

**Required:** For ERC20 tokens (not native ETH), users must first approve the hook contract to spend their tokens.

**Recommendation:** Add to Phase 2:

```typescript
// src/hooks/useDeposit.ts

export function useDeposit() {
  const hookAddress = usePheatherXAddress();
  const { writeContractAsync } = useWriteContract();

  const checkAllowance = async (tokenAddress: `0x${string}`, amount: bigint) => {
    const allowance = await readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [address, hookAddress],
    });
    return allowance >= amount;
  };

  const approve = async (tokenAddress: `0x${string}`, amount: bigint) => {
    return writeContractAsync({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [hookAddress, amount],
    });
  };

  const deposit = async (isToken0: boolean, amount: bigint) => {
    const tokenAddress = isToken0 ? TOKEN0_ADDRESS : TOKEN1_ADDRESS;

    // Skip approval for native ETH
    if (tokenAddress !== NATIVE_ETH_ADDRESS) {
      const hasAllowance = await checkAllowance(tokenAddress, amount);
      if (!hasAllowance) {
        await approve(tokenAddress, amount);
      }
    }

    return writeContractAsync({
      address: hookAddress,
      abi: PHEATHERX_ABI,
      functionName: 'deposit',
      args: [isToken0, amount],
    });
  };

  return { deposit, approve, checkAllowance };
}
```

**UI Update:** DepositModal should show two-step flow:
1. "Step 1: Approve" (if needed)
2. "Step 2: Deposit"

---

### 2.2 Missing: Native ETH Handling

**Issue:** The plan doesn't distinguish between ERC20 tokens and native ETH for deposits/withdrawals.

**Consideration:** If token0 or token1 is native ETH (address 0x0 or WETH):
- Deposits may need `msg.value` instead of ERC20 transfer
- The contract may use WETH internally

**Recommendation:** Add utility:

```typescript
// src/lib/tokens.ts

export const NATIVE_ETH_ADDRESS = '0x0000000000000000000000000000000000000000';

export function isNativeEth(address: string): boolean {
  return address.toLowerCase() === NATIVE_ETH_ADDRESS.toLowerCase();
}

// In deposit hook
if (isNativeEth(tokenAddress)) {
  // Send with value
  return writeContractAsync({
    address: hookAddress,
    abi: PHEATHERX_ABI,
    functionName: 'deposit',
    args: [isToken0, amount],
    value: amount, // Native ETH
  });
}
```

**Note:** Verify with contract implementation whether it uses native ETH or WETH.

---

### 2.3 Missing: Gas Estimation

**Issue:** No gas estimation before transactions. Users should see estimated gas costs.

**Recommendation:** Add to transaction flows:

```typescript
// src/hooks/useGasEstimate.ts

export function useGasEstimate() {
  const publicClient = usePublicClient();

  const estimate = async (request: {
    address: `0x${string}`;
    abi: any;
    functionName: string;
    args: any[];
    value?: bigint;
  }) => {
    try {
      const gas = await publicClient.estimateContractGas(request);
      const gasPrice = await publicClient.getGasPrice();
      const estimatedCost = gas * gasPrice;

      return {
        gas,
        gasPrice,
        estimatedCost,
        estimatedCostEth: formatEther(estimatedCost),
      };
    } catch (error) {
      return null; // Estimation failed, likely tx will fail
    }
  };

  return { estimate };
}
```

**UI:** Show "Estimated gas: ~0.002 ETH" before confirm button.

---

### 2.4 Incomplete: Order Status Determination

**Issue:** The plan shows how to fetch events but doesn't explain how to determine an order's current status (active, filled, cancelled, slippage failed).

**Current gap in `useOrderHistory`:** Events are fetched but not correlated to determine final status.

**Recommendation:** Add status derivation logic:

```typescript
// src/lib/orders.ts

export type OrderStatus = 'active' | 'filled' | 'cancelled' | 'slippage_failed';

export function deriveOrderStatus(
  orderId: bigint,
  events: OrderEvent[]
): OrderStatus {
  const orderEvents = events.filter(e => e.orderId === orderId);

  // Check for terminal events (most recent wins)
  const sorted = orderEvents.sort((a, b) => Number(b.blockNumber - a.blockNumber));

  for (const event of sorted) {
    if (event.type === 'filled') return 'filled';
    if (event.type === 'cancelled') return 'cancelled';
    // Note: slippage_failed may need a separate event or flag in OrderFilled
  }

  // If only placed event exists, it's active
  return 'active';
}
```

**Contract Note:** Check if the contract emits a distinct event for slippage failures or if it's encoded in OrderFilled event args.

---

### 2.5 Missing: Retry Logic for FHE Operations

**Issue:** FHE decryption can fail due to network issues. No retry mechanism documented.

**Recommendation:** Add to `useBalanceReveal`:

```typescript
const reveal = async (retries = 3) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // ... existing reveal logic
      return decrypted;
    } catch (error) {
      if (attempt === retries) throw error;

      // Exponential backoff
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
};
```

---

### 2.6 Missing: Block Explorer Links

**Issue:** Transaction hashes are tracked but no utility to generate block explorer URLs.

**Recommendation:**

```typescript
// src/lib/chains.ts

export function getExplorerUrl(chainId: number, hash: `0x${string}`): string | null {
  const explorers: Record<number, string> = {
    84532: 'https://sepolia.basescan.org/tx/',
    8008135: 'https://explorer.fhenix.io/tx/', // Verify URL
  };

  const base = explorers[chainId];
  return base ? `${base}${hash}` : null;
}

// Usage
<a href={getExplorerUrl(chainId, txHash)} target="_blank">View on Explorer</a>
```

---

### 2.7 Incomplete: Form Validation

**Issue:** Order form validation logic is mentioned but not fully specified.

**Recommendation:** Add Zod schemas:

```typescript
// src/lib/validation/orderSchema.ts

import { z } from 'zod';

export const orderFormSchema = z.object({
  orderType: z.enum(['limit-buy', 'limit-sell', 'stop-loss', 'take-profit']),
  tokenIn: z.string().min(1, 'Select input token'),
  tokenOut: z.string().min(1, 'Select output token'),
  triggerPrice: z
    .string()
    .min(1, 'Enter trigger price')
    .refine(v => !isNaN(parseFloat(v)) && parseFloat(v) > 0, 'Invalid price'),
  amount: z
    .string()
    .min(1, 'Enter amount')
    .refine(v => !isNaN(parseFloat(v)) && parseFloat(v) > 0, 'Invalid amount'),
  slippage: z
    .number()
    .min(0.01, 'Min slippage 0.01%')
    .max(50, 'Max slippage 50%'),
});

// Custom validation for trigger price vs current price
export function validateTriggerPrice(
  schema: z.infer<typeof orderFormSchema>,
  currentPrice: number
): string | null {
  const triggerPrice = parseFloat(schema.triggerPrice);
  const { orderType } = schema;

  if (orderType === 'limit-buy' && triggerPrice >= currentPrice) {
    return 'Limit buy trigger must be below current price';
  }
  if (orderType === 'limit-sell' && triggerPrice <= currentPrice) {
    return 'Limit sell trigger must be above current price';
  }
  if (orderType === 'stop-loss' && triggerPrice >= currentPrice) {
    return 'Stop-loss trigger must be below current price';
  }
  if (orderType === 'take-profit' && triggerPrice <= currentPrice) {
    return 'Take-profit trigger must be above current price';
  }

  return null;
}
```

---

### 2.8 Missing: Loading States for Initial Data

**Issue:** When the app first loads, there's no handling for the period when wallet is connecting and data is being fetched.

**Recommendation:** Add app-level loading state:

```typescript
// src/components/common/AppLoader.tsx

export function AppLoader({ children }: { children: ReactNode }) {
  const { isConnecting, isReconnecting } = useAccount();
  const { status: fheStatus } = useFheSession();

  if (isConnecting || isReconnecting) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-phoenix-ember/20 animate-pulse-ember" />
          <p className="text-feather-white/60">Connecting wallet...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
```

---

### 2.9 Missing: Network Mismatch Handling

**Issue:** What happens when user is on wrong network?

**Recommendation:**

```typescript
// src/components/common/NetworkGuard.tsx

export function NetworkGuard({ children }: { children: ReactNode }) {
  const { chain } = useAccount();
  const { chains, switchChain } = useSwitchChain();

  const isSupported = chains.some(c => c.id === chain?.id);

  if (chain && !isSupported) {
    return (
      <Card className="text-center max-w-md mx-auto mt-20">
        <h2 className="text-xl font-bold mb-4">Unsupported Network</h2>
        <p className="text-feather-white/60 mb-6">
          Please switch to a supported network.
        </p>
        <div className="space-y-2">
          {chains.map(c => (
            <Button
              key={c.id}
              variant="secondary"
              onClick={() => switchChain({ chainId: c.id })}
              className="w-full"
            >
              Switch to {c.name}
            </Button>
          ))}
        </div>
      </Card>
    );
  }

  return <>{children}</>;
}
```

---

### 2.10 Clarification: cofhejs API

**Issue:** The FHE client wrapper assumes certain cofhejs API methods that should be verified.

**Methods assumed:**
- `new FhenixClient({ provider })`
- `client.generatePermit(contractAddress, provider, signer)`
- `client.encrypt_uint128(value, contractAddress)`
- `client.encrypt_bool(value, contractAddress)`
- `client.unseal(contractAddress, ciphertext, permit)`

**Recommendation:** Before implementation, verify these methods against actual cofhejs documentation. The API may differ. Consider:
- Creating an abstraction layer that can adapt to API changes
- Adding comprehensive error handling for API mismatches

---

## 3. Minor Improvements

### 3.1 Add README to Implementation Plan Folder

```markdown
# Frontend Implementation Plan

This folder contains the complete frontend implementation plan for PheatherX.

## Documents

| File | Description |
|------|-------------|
| `FRONTEND_IMPLEMENTATION_PLAN.md` | Original v1 plan |
| `FRONTEND_IMPLEMENTATION_PLAN-critique.md` | Critique of v1 |
| `FRONTEND_IMPLEMENTATION_PLAN_v2.md` | **Current plan (v2)** |
| `FRONTEND_IMPL_v2_APPENDIX_A_FHE.md` | FHE integration details |
| `FRONTEND_IMPL_v2_APPENDIX_B_STATE.md` | State management |
| `FRONTEND_IMPL_v2_APPENDIX_C_COMPONENTS.md` | UI components |
| `FRONTEND_IMPLEMENTATION_PLAN_v2-audit.md` | Audit of v2 |

## Getting Started

Start with `FRONTEND_IMPLEMENTATION_PLAN_v2.md` and follow the phases sequentially.
```

### 3.2 Add Constants File Reference

The plan references constants but doesn't show a consolidated constants file:

```typescript
// src/lib/constants.ts

export const PROTOCOL_FEE = 0.001; // ETH
export const EXECUTOR_REWARD_BPS = 100; // 1%
export const FHE_SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
export const BALANCE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const TX_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

// Uniswap
export const MIN_SQRT_RATIO = BigInt('4295128739');
export const MAX_SQRT_RATIO = BigInt('1461446703485210103287273052203988822378723970342');
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
```

### 3.3 Environment Variable Validation

Add startup validation:

```typescript
// src/lib/env.ts

const requiredEnvVars = [
  'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID',
  'NEXT_PUBLIC_PHEATHERX_ADDRESS_LOCAL',
] as const;

export function validateEnv() {
  const missing = requiredEnvVars.filter(
    key => !process.env[key]
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }
}

// Call in app/layout.tsx or middleware
```

---

## 4. Testing Considerations

### 4.1 Add Mock Data for Development

```typescript
// src/lib/mocks/orders.ts

export const mockOrders = [
  {
    orderId: 1n,
    type: 'limit-buy',
    triggerTick: -200000,
    status: 'active',
    createdAt: Date.now() - 3600000,
  },
  // ... more mock orders
];

// Use in development
if (process.env.NODE_ENV === 'development') {
  // Return mock data instead of RPC calls
}
```

### 4.2 Storybook Consideration

For component development, consider adding Storybook:

```bash
npx storybook@latest init
```

This helps develop UI components in isolation before integration.

---

## 5. Summary of Required Changes

### Must Have (Before Implementation)

| Item | Priority | Effort |
|------|----------|--------|
| Token approval flow | High | Medium |
| Native ETH handling | High | Low |
| Order status derivation | High | Low |
| Network mismatch guard | High | Low |
| Verify cofhejs API | High | Low |

### Should Have (During Implementation)

| Item | Priority | Effort |
|------|----------|--------|
| Gas estimation | Medium | Medium |
| Block explorer links | Medium | Low |
| Form validation schemas | Medium | Medium |
| FHE retry logic | Medium | Low |
| App loading states | Medium | Low |

### Nice to Have (Post-MVP)

| Item | Priority | Effort |
|------|----------|--------|
| Storybook setup | Low | Medium |
| Mock data system | Low | Medium |
| README for docs folder | Low | Low |

---

## 6. Audit Conclusion

**Status:** ✅ **Approved for Implementation**

The v2 implementation plan is comprehensive and addresses the critical issues from v1. The gaps identified are refinements rather than fundamental issues.

**Recommended Next Steps:**

1. Verify cofhejs API against documentation
2. Add token approval flow to Phase 2
3. Add native ETH handling check
4. Begin implementation following phase order
5. Create PR checklist based on phase deliverables

---

*End of Audit Document*
