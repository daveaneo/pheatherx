# Frontend Implementation Plan - Critique & Suggestions

**Reviewing:** `FRONTEND_IMPLEMENTATION_PLAN.md` v1.0
**Date:** November 2024

---

## Executive Summary

The implementation plan provides a solid foundation with good phase organization and code examples. However, it has **significant gaps** in FHE integration details, state management architecture, and real-world contract interaction patterns. This critique identifies high-impact improvements that will prevent major refactoring later.

---

## 1. FHE Integration Is Oversimplified

### Current Issue

The plan's FHE implementation (`src/lib/fhe.ts`) is a placeholder mock that doesn't reflect how `cofhejs` actually works:

```typescript
// From plan - oversimplified mock
class MockFheClient {
  async encryptBool(value: boolean): Promise<EncryptedValue> {
    const data = new Uint8Array([value ? 1 : 0]);
    return { data, type: 'ebool' };
  }
}
```

### Real-World Complexity

Based on Fhenix documentation and how FHE works:

1. **Encryption requires a permit/session** - Users must sign a message to create an FHE session before encrypting
2. **Encrypted values are tied to specific contracts** - You can't just encrypt a value; it must be bound to a contract address
3. **`allow()` is a contract call, not a client method** - Granting access requires an on-chain transaction
4. **Decryption requires network consensus** - It's not just async; it requires threshold decryption from validators

### Recommendation

Add a dedicated Phase 1.5 for FHE infrastructure:

```typescript
// src/lib/fhe/client.ts
import { FhenixClient, EncryptedUint128, EncryptedBool, Permit } from 'cofhejs';

interface FheSession {
  permit: Permit;
  client: FhenixClient;
  expiresAt: number;
}

export class PheatherXFheClient {
  private session: FheSession | null = null;
  private provider: any;

  constructor(provider: any) {
    this.provider = provider;
  }

  /**
   * Initialize FHE session - requires user signature
   * Must be called before any encryption/decryption
   */
  async initSession(contractAddress: string): Promise<void> {
    const client = new FhenixClient({ provider: this.provider });

    // Generate permit - this prompts user to sign
    const permit = await client.generatePermit(contractAddress, this.provider);

    this.session = {
      permit,
      client,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    };
  }

  isSessionValid(): boolean {
    return this.session !== null && Date.now() < this.session.expiresAt;
  }

  async encrypt(value: bigint, contractAddress: string): Promise<EncryptedUint128> {
    if (!this.isSessionValid()) {
      throw new Error('FHE session not initialized. Call initSession() first.');
    }

    // Encryption is bound to specific contract
    return this.session!.client.encrypt_uint128(value, contractAddress);
  }

  async encryptBool(value: boolean, contractAddress: string): Promise<EncryptedBool> {
    if (!this.isSessionValid()) {
      throw new Error('FHE session not initialized');
    }
    return this.session!.client.encrypt_bool(value, contractAddress);
  }

  /**
   * Request decryption - this is async and may take 5-30 seconds
   * Returns a promise that resolves when threshold decryption completes
   */
  async unseal(ciphertext: string, contractAddress: string): Promise<bigint> {
    if (!this.isSessionValid()) {
      throw new Error('FHE session not initialized');
    }

    return this.session!.client.unseal(contractAddress, ciphertext, this.session!.permit);
  }
}
```

**New hook for session management:**

```typescript
// src/hooks/useFheSession.ts
export function useFheSession() {
  const { provider } = useProvider();
  const hookAddress = usePheatherXAddress();
  const [status, setStatus] = useState<'disconnected' | 'initializing' | 'ready' | 'error'>('disconnected');
  const [client, setClient] = useState<PheatherXFheClient | null>(null);

  const initialize = async () => {
    if (!provider || !hookAddress) return;

    setStatus('initializing');
    try {
      const fheClient = new PheatherXFheClient(provider);
      await fheClient.initSession(hookAddress);
      setClient(fheClient);
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      throw error;
    }
  };

  return { status, client, initialize, isReady: status === 'ready' };
}
```

**UI implications:**
- Add "Initialize Privacy Session" button/flow before first encrypted operation
- Show session status in header
- Auto-prompt session initialization on wallet connect
- Handle session expiry gracefully

---

## 2. Contract Interaction Patterns Are Incomplete

### Current Issue

The plan shows basic `useReadContract`/`useWriteContract` patterns but misses critical details:

1. **No handling for encrypted function parameters** - The ABI shows `bytes` for encrypted values, but no encoding logic
2. **`placeOrder` requires encoding encrypted values** - You can't just pass TypeScript objects
3. **Event listening for order fills not implemented** - Critical for notifications
4. **No transaction simulation** - Users should see if a tx will fail before signing

### From Actual Contract

```solidity
function placeOrder(
    int24 triggerTick,
    ebool direction,      // Encrypted - needs special encoding
    euint128 amount,      // Encrypted - needs special encoding
    euint128 minOutput    // Encrypted - needs special encoding
) external payable returns (uint256 orderId);
```

### Recommendation

Add proper encrypted parameter handling:

```typescript
// src/lib/contracts/encoding.ts
import { encodeAbiParameters, parseAbiParameters } from 'viem';
import { EncryptedUint128, EncryptedBool } from 'cofhejs';

/**
 * Encode encrypted values for contract calls
 * cofhejs encrypted values contain both the ciphertext and proof
 */
export function encodeEncryptedBool(encrypted: EncryptedBool): `0x${string}` {
  // The exact encoding depends on Fhenix's format
  // This is the ciphertext + ZK proof bundled together
  return encrypted.data as `0x${string}`;
}

export function encodeEncryptedUint128(encrypted: EncryptedUint128): `0x${string}` {
  return encrypted.data as `0x${string}`;
}

// src/hooks/usePlaceOrder.ts
export function usePlaceOrder() {
  const hookAddress = usePheatherXAddress();
  const { writeContractAsync, isPending } = useWriteContract();
  const { client: fheClient, isReady: fheReady } = useFheSession();
  const publicClient = usePublicClient();

  const placeOrder = async (params: {
    triggerTick: number;
    direction: boolean;
    amount: bigint;
    minOutput: bigint;
  }) => {
    if (!fheClient || !fheReady) {
      throw new Error('FHE session not ready');
    }

    // 1. Encrypt all parameters
    const encDirection = await fheClient.encryptBool(params.direction, hookAddress);
    const encAmount = await fheClient.encrypt(params.amount, hookAddress);
    const encMinOutput = await fheClient.encrypt(params.minOutput, hookAddress);

    // 2. Encode for contract call
    const encodedDirection = encodeEncryptedBool(encDirection);
    const encodedAmount = encodeEncryptedUint128(encAmount);
    const encodedMinOutput = encodeEncryptedUint128(encMinOutput);

    // 3. Simulate transaction first
    try {
      await publicClient.simulateContract({
        address: hookAddress,
        abi: PHEATHERX_ABI,
        functionName: 'placeOrder',
        args: [params.triggerTick, encodedDirection, encodedAmount, encodedMinOutput],
        value: parseEther('0.001'),
      });
    } catch (error) {
      // Parse revert reason and show user-friendly error
      throw new OrderSimulationError(error);
    }

    // 4. Execute transaction
    const hash = await writeContractAsync({
      address: hookAddress,
      abi: PHEATHERX_ABI,
      functionName: 'placeOrder',
      args: [params.triggerTick, encodedDirection, encodedAmount, encodedMinOutput],
      value: parseEther('0.001'),
    });

    return hash;
  };

  return { placeOrder, isPending };
}
```

---

## 3. State Management Architecture Is Missing

### Current Issue

The plan mentions Zustand but provides no architecture for:
- Global FHE session state
- Cached decrypted balances
- Order data across pages
- Transaction queue management
- Optimistic updates

### Recommendation

Add dedicated state management section:

```typescript
// src/stores/fheStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface RevealedBalance {
  value: bigint;
  revealedAt: number;
  token: 'token0' | 'token1';
}

interface FheStore {
  // Session
  sessionStatus: 'disconnected' | 'initializing' | 'ready' | 'expired';
  sessionExpiresAt: number | null;

  // Revealed balances (cached for session)
  revealedBalances: Record<string, RevealedBalance>; // key: `${address}-${token}`

  // Actions
  setSessionStatus: (status: FheStore['sessionStatus']) => void;
  cacheRevealedBalance: (address: string, token: 'token0' | 'token1', value: bigint) => void;
  getRevealedBalance: (address: string, token: 'token0' | 'token1') => RevealedBalance | null;
  clearRevealedBalances: () => void;
}

export const useFheStore = create<FheStore>()(
  persist(
    (set, get) => ({
      sessionStatus: 'disconnected',
      sessionExpiresAt: null,
      revealedBalances: {},

      setSessionStatus: (status) => set({ sessionStatus: status }),

      cacheRevealedBalance: (address, token, value) => {
        const key = `${address}-${token}`;
        set((state) => ({
          revealedBalances: {
            ...state.revealedBalances,
            [key]: { value, revealedAt: Date.now(), token },
          },
        }));
      },

      getRevealedBalance: (address, token) => {
        const key = `${address}-${token}`;
        const cached = get().revealedBalances[key];
        // Expire after 5 minutes
        if (cached && Date.now() - cached.revealedAt < 5 * 60 * 1000) {
          return cached;
        }
        return null;
      },

      clearRevealedBalances: () => set({ revealedBalances: {} }),
    }),
    {
      name: 'pheatherx-fhe',
      partialize: (state) => ({
        // Only persist revealed balances, not session (security)
        revealedBalances: state.revealedBalances,
      }),
    }
  )
);

// src/stores/ordersStore.ts
interface OrdersStore {
  // Active orders cache
  activeOrders: Map<bigint, OrderData>;

  // Pending transactions (optimistic updates)
  pendingOrders: PendingOrder[];
  pendingCancellations: bigint[];

  // Actions
  addPendingOrder: (order: PendingOrder) => void;
  confirmOrder: (tempId: string, realId: bigint) => void;
  addPendingCancellation: (orderId: bigint) => void;
  confirmCancellation: (orderId: bigint) => void;
}
```

---

## 4. Swap Flow Doesn't Match Contract Architecture

### Current Issue

The plan's swap implementation assumes a simple swap function, but PheatherX uses Uniswap v4's router pattern:

```typescript
// From plan - incorrect assumption
const handleSwap = async () => {
  // This implies calling a "swap" function directly on the hook
  // But that's not how it works
};
```

### How Swaps Actually Work

1. User calls Uniswap v4 `PoolManager.swap()` via a router
2. The swap triggers PheatherX hook's `beforeSwap()`
3. Hook intercepts and executes privately using `BeforeSwapDelta`
4. User receives tokens

### Recommendation

Update swap integration to use Uniswap v4 router:

```typescript
// src/lib/contracts/router.ts
export const SWAP_ROUTER_ABI = [
  {
    name: 'swap',
    type: 'function',
    inputs: [
      { name: 'key', type: 'tuple', components: [
        { name: 'currency0', type: 'address' },
        { name: 'currency1', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' },
      ]},
      { name: 'params', type: 'tuple', components: [
        { name: 'zeroForOne', type: 'bool' },
        { name: 'amountSpecified', type: 'int256' },
        { name: 'sqrtPriceLimitX96', type: 'uint160' },
      ]},
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [{ name: 'delta', type: 'int256' }],
  },
] as const;

// src/hooks/useSwap.ts
export function useSwap() {
  const { writeContractAsync } = useWriteContract();
  const { client: fheClient } = useFheSession();
  const hookAddress = usePheatherXAddress();

  const swap = async (params: {
    zeroForOne: boolean;
    amountIn: bigint;
    minAmountOut: bigint;
  }) => {
    // Encode hookData with encrypted parameters for maximum privacy
    // This passes through to beforeSwap() where the hook uses it
    const hookData = await encodePrivateSwapData(fheClient, {
      direction: params.zeroForOne,
      minOutput: params.minAmountOut,
    });

    const poolKey = {
      currency0: TOKEN0_ADDRESS,
      currency1: TOKEN1_ADDRESS,
      fee: 3000, // 0.3%
      tickSpacing: 60,
      hooks: hookAddress,
    };

    const swapParams = {
      zeroForOne: params.zeroForOne,
      amountSpecified: params.zeroForOne ? -params.amountIn : params.amountIn,
      sqrtPriceLimitX96: params.zeroForOne ? MIN_SQRT_RATIO + 1n : MAX_SQRT_RATIO - 1n,
    };

    return writeContractAsync({
      address: SWAP_ROUTER_ADDRESS,
      abi: SWAP_ROUTER_ABI,
      functionName: 'swap',
      args: [poolKey, swapParams, hookData],
    });
  };

  return { swap };
}
```

**Note:** This requires understanding the exact router contract being used. May need to deploy a custom router that handles the PheatherX hook properly.

---

## 5. Balance Reveal UX Needs Work

### Current Issue

The plan shows balance reveal as a simple async operation:

```typescript
const handleReveal = async () => {
  const mockEncrypted = { data: new Uint8Array(16), type: 'euint128' as const };
  await reveal(mockEncrypted);
};
```

### Real-World Complexity

1. **Need to fetch encrypted balance from contract first** - `getUserBalanceToken0()` returns encrypted bytes
2. **Decryption requires the FHE session permit** - Can't decrypt without prior session
3. **Decryption can take 5-30 seconds** - Need proper progress indication
4. **Decryption can fail** - Network issues, session expiry, etc.

### Recommendation

```typescript
// src/hooks/useBalanceReveal.ts
export function useBalanceReveal(isToken0: boolean) {
  const { address } = useAccount();
  const hookAddress = usePheatherXAddress();
  const { client: fheClient, isReady: fheReady } = useFheSession();
  const { cacheRevealedBalance, getRevealedBalance } = useFheStore();

  const [state, setState] = useState<{
    status: 'idle' | 'fetching' | 'decrypting' | 'revealed' | 'error';
    value?: bigint;
    error?: string;
    progress?: number; // 0-100 for decryption progress
  }>({ status: 'idle' });

  // Check cache first
  useEffect(() => {
    if (address) {
      const cached = getRevealedBalance(address, isToken0 ? 'token0' : 'token1');
      if (cached) {
        setState({ status: 'revealed', value: cached.value });
      }
    }
  }, [address, isToken0]);

  const reveal = async () => {
    if (!address || !fheClient || !fheReady) {
      setState({ status: 'error', error: 'FHE session not ready' });
      return;
    }

    try {
      // Step 1: Fetch encrypted balance from contract
      setState({ status: 'fetching' });
      const encryptedBalance = await readContract({
        address: hookAddress,
        abi: PHEATHERX_ABI,
        functionName: isToken0 ? 'getUserBalanceToken0' : 'getUserBalanceToken1',
        args: [address],
      });

      // Step 2: Request decryption (this is the slow part)
      setState({ status: 'decrypting', progress: 0 });

      // Set up progress simulation (actual progress not available from FHE)
      const progressInterval = setInterval(() => {
        setState((prev) => ({
          ...prev,
          progress: Math.min((prev.progress || 0) + 10, 90),
        }));
      }, 1000);

      const decrypted = await fheClient.unseal(
        encryptedBalance as string,
        hookAddress
      );

      clearInterval(progressInterval);

      // Step 3: Cache and return
      cacheRevealedBalance(address, isToken0 ? 'token0' : 'token1', decrypted);
      setState({ status: 'revealed', value: decrypted, progress: 100 });

      return decrypted;
    } catch (error) {
      setState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Decryption failed',
      });
      throw error;
    }
  };

  const hide = () => {
    setState({ status: 'idle' });
  };

  return { ...state, reveal, hide };
}
```

---

## 6. Missing: Event Indexing Strategy

### Current Issue

The plan mentions "event indexing" but provides no implementation:

```typescript
// From plan - just a comment
// Options for indexing:
// 1. The Graph subgraph (recommended for production)
// 2. Direct RPC event fetching (simpler, works for testnet)
```

### Why This Matters

- Order history requires `OrderPlaced`, `OrderFilled`, `OrderCancelled` events
- Analytics requires `Deposit`, `Withdraw`, swap events
- User notifications require real-time event listening
- Without indexing, you can't show historical data

### Recommendation

Add concrete indexing implementation for testnet:

```typescript
// src/hooks/useOrderEvents.ts
import { useEffect } from 'react';
import { usePublicClient, useWatchContractEvent } from 'wagmi';

export function useOrderFillNotifications() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Watch for order fills in real-time
  useWatchContractEvent({
    address: PHEATHERX_ADDRESS,
    abi: PHEATHERX_ABI,
    eventName: 'OrderFilled',
    onLogs: (logs) => {
      logs.forEach((log) => {
        if (log.args.owner?.toLowerCase() === address?.toLowerCase()) {
          toast({
            title: 'Order Filled!',
            description: `Order #${log.args.orderId} was executed`,
            variant: 'success',
          });
          // Invalidate queries to refresh data
          queryClient.invalidateQueries({ queryKey: ['activeOrders'] });
          queryClient.invalidateQueries({ queryKey: ['balances'] });
        }
      });
    },
  });
}

// src/hooks/useOrderHistory.ts
export function useOrderHistory() {
  const { address } = useAccount();
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ['orderHistory', address],
    queryFn: async () => {
      if (!address) return [];

      // Fetch all order events for user
      const [placedLogs, filledLogs, cancelledLogs] = await Promise.all([
        publicClient.getLogs({
          address: PHEATHERX_ADDRESS,
          event: parseAbiItem('event OrderPlaced(uint256 indexed orderId, address indexed owner, int24 triggerTick)'),
          args: { owner: address },
          fromBlock: 'earliest',
        }),
        publicClient.getLogs({
          address: PHEATHERX_ADDRESS,
          event: parseAbiItem('event OrderFilled(uint256 indexed orderId, address indexed owner, address indexed executor)'),
          args: { owner: address },
          fromBlock: 'earliest',
        }),
        publicClient.getLogs({
          address: PHEATHERX_ADDRESS,
          event: parseAbiItem('event OrderCancelled(uint256 indexed orderId, address indexed owner)'),
          args: { owner: address },
          fromBlock: 'earliest',
        }),
      ]);

      // Merge and sort by block number
      return mergeOrderEvents(placedLogs, filledLogs, cancelledLogs);
    },
    enabled: !!address,
    staleTime: 30_000, // 30 seconds
  });
}
```

**For production:** Plan for a subgraph or custom indexer. RPC event fetching won't scale.

---

## 7. Missing: Error Boundary & Recovery

### Current Issue

No error handling architecture. If FHE fails mid-operation, users are stuck.

### Recommendation

Add global error boundaries and recovery flows:

```typescript
// src/components/ErrorBoundary.tsx
'use client';

import { Component, ReactNode } from 'react';
import { Button } from './ui/Button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
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
    // Clear any corrupted state
    useFheStore.getState().clearRevealedBalances();
  };

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="card text-center py-12">
            <h2 className="text-xl font-bold mb-4">Something went wrong</h2>
            <p className="text-feather-white/60 mb-6">
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

// src/hooks/useTransactionRecovery.ts
export function useTransactionRecovery() {
  const [pendingTxs, setPendingTxs] = useState<PendingTransaction[]>([]);

  // On mount, check localStorage for pending transactions
  useEffect(() => {
    const saved = localStorage.getItem('pendingTransactions');
    if (saved) {
      const txs = JSON.parse(saved);
      // Check status of each pending tx
      txs.forEach(async (tx: PendingTransaction) => {
        const receipt = await publicClient.getTransactionReceipt({ hash: tx.hash });
        if (receipt) {
          // Transaction completed while user was away
          handleCompletedTransaction(tx, receipt);
        } else {
          // Still pending - show in UI
          setPendingTxs((prev) => [...prev, tx]);
        }
      });
    }
  }, []);

  return { pendingTxs };
}
```

---

## 8. Phase Dependencies Are Incorrect

### Current Issue

The plan shows Phase 3 (Swap) before Phase 4 (Orders), but both depend on the same FHE infrastructure that's not properly established.

### Recommendation

Restructure phases:

```
Phase 0: Project Setup (unchanged)

Phase 1: Core Infrastructure (unchanged)

Phase 1.5: FHE Infrastructure (NEW)
├── FHE client wrapper for cofhejs
├── Session management (init, expiry, refresh)
├── Encrypted value encoding utilities
├── Balance reveal with proper flow
├── FHE state store (Zustand)
└── Session status UI in header

Phase 2: Portfolio & Balances
├── Now uses real FHE infrastructure
├── Deposit/Withdraw (plaintext - simpler)
└── Balance reveal with full flow

Phase 3: Swap Interface
├── Router integration (not direct hook call)
├── hookData encoding for privacy
└── Simulation before execution

Phase 4: Limit Orders
├── Full FHE encryption flow
├── FHE.allow() integration
└── Order management

Phase 5-7: (unchanged)
```

---

## 9. Tick/Price Utilities Need Validation

### Current Issue

The tick math utilities are simplified and may not match Uniswap v4's exact implementation:

```typescript
// From plan
export function priceToTick(price: number, ...): number {
  const adjustedPrice = price * Math.pow(10, token0Decimals - token1Decimals);
  return Math.floor(Math.log(adjustedPrice) / LOG_BASE);
}
```

### Concerns

1. **Floating point precision** - JavaScript's `Math.log` may not match Solidity's fixed-point math
2. **Tick spacing not enforced** - Pool may require ticks at specific intervals
3. **sqrtPriceX96 conversion missing** - Uniswap v4 uses sqrtPriceX96, not raw price

### Recommendation

Use a battle-tested library or port exact Solidity logic:

```typescript
// src/lib/ticks.ts
import { TickMath } from '@uniswap/v3-sdk'; // Or implement from scratch

// Use bigint math to avoid floating point issues
export function priceToTick(
  price: bigint, // price as fixed-point with 18 decimals
  token0Decimals: number,
  token1Decimals: number,
  tickSpacing: number
): number {
  // Convert to sqrtPriceX96 first
  const sqrtPriceX96 = priceToSqrtPriceX96(price, token0Decimals, token1Decimals);

  // Get tick from sqrtPrice
  const tick = TickMath.getTickAtSqrtRatio(sqrtPriceX96);

  // Round to nearest valid tick
  return nearestUsableTick(tick, tickSpacing);
}

export function tickToPrice(
  tick: number,
  token0Decimals: number,
  token1Decimals: number
): bigint {
  const sqrtPriceX96 = TickMath.getSqrtRatioAtTick(tick);
  return sqrtPriceX96ToPrice(sqrtPriceX96, token0Decimals, token1Decimals);
}

// Helper: Ensure tick is valid for pool's tick spacing
export function nearestUsableTick(tick: number, tickSpacing: number): number {
  const rounded = Math.round(tick / tickSpacing) * tickSpacing;
  // Clamp to valid range
  return Math.max(TickMath.MIN_TICK, Math.min(TickMath.MAX_TICK, rounded));
}
```

---

## 10. No Mobile-First Consideration

### Current Issue

The plan mentions "desktop-first" and responsive breakpoints but doesn't address:
- Touch targets for mobile
- Bottom sheet modals instead of centered modals on mobile
- Swipe gestures for navigation
- Mobile wallet deep linking (WalletConnect)

### Recommendation

Add mobile-specific components:

```typescript
// src/components/ui/BottomSheet.tsx
// Use for modals on mobile instead of centered modal

// src/hooks/useIsMobile.ts
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

// Usage in Modal
export function Modal({ children, ...props }) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return <BottomSheet {...props}>{children}</BottomSheet>;
  }

  return <CenteredModal {...props}>{children}</CenteredModal>;
}
```

---

## Summary of Recommendations

### Critical (Must Address)

1. **Rewrite FHE integration** - Add proper session management, permit flow, and encoding
2. **Fix swap flow** - Use Uniswap v4 router, not direct hook calls
3. **Add state management architecture** - FHE session state, balance caching, order state
4. **Implement event indexing** - Required for order history and notifications

### High Priority

5. **Restructure phases** - Add FHE infrastructure as Phase 1.5
6. **Add error boundaries** - Handle FHE failures gracefully
7. **Validate tick math** - Use bigint math, match Uniswap v4 exactly

### Medium Priority

8. **Add mobile-first components** - Bottom sheets, touch targets
9. **Transaction simulation** - Prevent failed txs before signing
10. **Transaction recovery** - Handle interrupted flows

---

## Conclusion

The implementation plan provides good structure but underestimates FHE complexity. The main gaps are:

1. FHE is not just "encrypt and send" - it requires sessions, permits, and careful state management
2. Swaps go through Uniswap v4 router, not direct hook calls
3. Event indexing is required for core features, not optional
4. Tick math needs precision to avoid order placement bugs

Addressing these issues before implementation will prevent significant refactoring later.

---

*End of Critique Document*
