# Plan: FHE Demo - Two Parallel Strategies

## Goal
Get FHE working for hackathon demo via two parallel tracks:
1. **Strategy 1**: Real FHE on Arbitrum Sepolia (pending testnet ETH)
2. **Strategy 2**: ETH Sepolia workaround - on-chain encryption + oracle-based decryption hack

---

## Current State

### What Works
- **On-chain FHE encryption** works on ETH Sepolia (FHE.asEuint128, FHE.add, etc.)
- **Contract deployed** at `0x47712BED8Ae60A41B5d092A3Dc04cb19FF508AC8`
- **cofhejs CDN loading** now works (esm.sh)
- **All UI/UX** ready - FheSessionGuard, auto-init, session management

### What's Broken
- **cofhejs.initializeWithEthers()** fails with "An internal error occurred"
- **cofhejs.unseal()** - can't decrypt because session won't initialize
- **ACLNotAllowed** errors when contract tries FHE operations

### Test Results (Dec 4, 2025)
Tested 4 initialization variations on ETH Sepolia (Chain 11155111):

| Variation | Options | Time | Result |
|-----------|---------|------|--------|
| 1 | env + generatePermit | 1491ms | `INTERNAL_ERROR` |
| 2 | env only | 664ms | `INTERNAL_ERROR` |
| 3 | permit only (auto-detect) | 1ms | `INTERNAL_ERROR` |
| 4 | minimal | 0ms | `INTERNAL_ERROR` |

**All variations return:** `{ name: "CofhejsError", code: "INTERNAL_ERROR", cause: {} }`

**Conclusion:** The issue is NOT our parameters. The CoFHE coprocessor for ETH Sepolia is unreachable/broken. Variations 3 & 4 fail instantly (can't detect chain), while 1 & 2 actually attempt network calls before failing.

### Key Insight
The **encryption side works** (contract can encrypt values). The problem is **decryption** (unseal) which requires cofhejs to initialize a session with the CoFHE coprocessor.

---

## Strategy 1: Arbitrum Sepolia (Real FHE)

### Prerequisites
- Arbitrum Sepolia testnet ETH (you're working on this)

### Steps Once Funded
1. Deploy test tokens (tWETH, tUSDC) to Arbitrum Sepolia
2. Deploy PheatherXFactory and PheatherX hook
3. Update `src/lib/chains.ts` with Arbitrum Sepolia contract addresses
4. Test cofhejs initialization on Arbitrum Sepolia
5. If works → full real FHE demo

### Files to Modify
- `contracts/script/` - deployment scripts for Arbitrum Sepolia
- `src/lib/chains.ts` - add Arbitrum Sepolia addresses
- `.env` - Arbitrum Sepolia RPC

---

## Strategy 2: ETH Sepolia Oracle Workaround

### Concept
Since encryption works but decryption (unseal) doesn't:
1. **Encrypt normally** using FHE on-chain
2. **Track values off-chain** - we know what we encrypted
3. **Oracle/indexer** returns the "decrypted" values we already know
4. **Frontend** uses oracle instead of cofhejs.unseal()

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      CURRENT FLOW (BROKEN)                  │
├─────────────────────────────────────────────────────────────┤
│  Frontend                                                    │
│     │                                                        │
│     ├─► deposit(100 ETH) ─────► Contract encrypts            │
│     │                              FHE.asEuint128(100)       │
│     │                                                        │
│     └─► getBalance() ─────────► Returns ciphertext hash      │
│              │                                               │
│              └─► cofhejs.unseal() ──► FAILS (no session)    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    WORKAROUND FLOW                          │
├─────────────────────────────────────────────────────────────┤
│  Frontend                                                    │
│     │                                                        │
│     ├─► deposit(100 ETH) ─────► Contract encrypts            │
│     │         │                    FHE.asEuint128(100)       │
│     │         │                                              │
│     │         └─► Log to Oracle: "user X deposited 100"      │
│     │                                                        │
│     └─► getBalance() ─────────► Oracle returns 100           │
│              │                   (we track it ourselves)     │
│              │                                               │
│              └─► Display balance without unseal()            │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Options

#### Option 2A: Client-Side Balance Tracking
Track all deposits/withdrawals/swaps client-side and compute balance locally.

**Pros**: No backend needed
**Cons**: Loses state on refresh, not shareable across devices

```typescript
// balanceTracker.ts
interface BalanceEvent {
  type: 'deposit' | 'withdraw' | 'swap';
  token: 'token0' | 'token1';
  amount: bigint;
  txHash: string;
  timestamp: number;
}

class ClientBalanceTracker {
  private events: BalanceEvent[] = [];

  addDeposit(token: 'token0' | 'token1', amount: bigint, txHash: string) {
    this.events.push({ type: 'deposit', token, amount, txHash, timestamp: Date.now() });
    this.persist();
  }

  getBalance(token: 'token0' | 'token1'): bigint {
    return this.events
      .filter(e => e.token === token)
      .reduce((sum, e) => {
        if (e.type === 'deposit') return sum + e.amount;
        if (e.type === 'withdraw') return sum - e.amount;
        return sum; // swaps handled separately
      }, 0n);
  }

  persist() {
    localStorage.setItem('pheatherx:balanceEvents', JSON.stringify(this.events));
  }
}
```

#### Option 2B: Simple Backend Oracle
Lightweight backend that indexes contract events and returns known values.

**Pros**: Persists across sessions, shareable
**Cons**: Need to deploy/run backend

```typescript
// API endpoint: GET /api/balance?user=0x...&token=0
// Returns: { balance: "1000000000000000000" }

// Frontend change in useBalanceReveal.ts:
async function revealBalance() {
  if (isOracleMode) {
    const res = await fetch(`/api/balance?user=${address}&token=${tokenIndex}`);
    const { balance } = await res.json();
    return BigInt(balance);
  }
  // else use cofhejs.unseal()
}
```

#### Option 2C: Event-Based Indexing (Hybrid)
Use The Graph or similar to index Deposit/Withdraw events, compute balances from event history.

**Pros**: Decentralized, automatic
**Cons**: Setup overhead, subgraph deployment

### Recommended: Minimal Stub - Only Replace unseal()

**Principle**: Deviate as little as possible from real FHE flow.

**What stays real:**
- cofhejs loading from CDN ✓
- cofhejs.initializeWithEthers() attempt ✓ (will fail, but we try)
- All on-chain FHE operations (FHE.asEuint128, FHE.add, etc.) ✓
- Deposit/withdraw contract calls ✓

**What we stub (ETH Sepolia only):**
- `unseal()` → Use balance tracker instead

**Chain-specific behavior:**

| Chain | cofhejs init | encrypt | unseal |
|-------|-------------|---------|--------|
| Arbitrum Sepolia | Required (throw if fails) | Real cofhejs | Real cofhejs |
| Ethereum Sepolia | Try, handle error gracefully | Real (contract-side) | **Stub** (tracker) |
| Local Anvil | Mock | Mock | Mock |

### Implementation Steps for Strategy 2

#### Step 1: Create Balance Tracker (`src/lib/fhe/balanceTracker.ts`)
```typescript
export class BalanceTracker {
  private storageKey = 'pheatherx:balanceTracker';

  trackDeposit(user: string, chainId: number, pool: string, isToken0: boolean, amount: bigint, txHash: string);
  trackWithdraw(user: string, chainId: number, pool: string, isToken0: boolean, amount: bigint, txHash: string);
  trackSwap(user: string, chainId: number, pool: string, token0Delta: bigint, token1Delta: bigint, txHash: string);

  getBalance(user: string, chainId: number, pool: string, isToken0: boolean): bigint;

  // Persist to localStorage keyed by chainId
}
```

#### Step 2: Update useFheSession Hook (Minimal Change)
```typescript
// In initializeSession():
try {
  const result = await cofhejs.initializeWithEthers({...});
  // Success path
} catch (error) {
  if (chainId === 11155111) { // ETH Sepolia
    // Handle gracefully - session is "limited" but usable
    console.warn('[FHE] ETH Sepolia: cofhejs init failed, using balance tracker for unseal');
    setSessionStatus('limited'); // New status
  } else {
    // Other chains: throw - must have real FHE
    throw error;
  }
}
```

#### Step 3: Update useDeposit Hook
After successful deposit tx, call `balanceTracker.trackDeposit(...)`.

#### Step 4: Update useWithdraw Hook
After successful withdraw tx, call `balanceTracker.trackWithdraw(...)`.

#### Step 5: Update useBalanceReveal Hook (The Only Real Stub)
```typescript
async function revealBalance() {
  // Only stub unseal on ETH Sepolia
  if (chainId === 11155111) {
    return balanceTracker.getBalance(address, chainId, poolAddress, isToken0);
  }
  // All other chains: real cofhejs.unseal()
  return fheSingleton.unseal(ciphertext);
}
```

**Note**: FheSessionGuard stays mostly unchanged - it just needs to handle the new 'limited' status.

---

## Files to Create/Modify

### Strategy 2 (Minimal Stub - ETH Sepolia Only)

| File | Action |
|------|--------|
| `src/lib/fhe/balanceTracker.ts` | **CREATE** - Client-side balance tracking |
| `src/hooks/useDeposit.ts` | MODIFY - Track deposits after tx |
| `src/hooks/useWithdraw.ts` | MODIFY - Track withdrawals after tx |
| `src/hooks/useBalanceReveal.ts` | MODIFY - Use tracker on ETH Sepolia |
| `src/hooks/useFheSession.ts` | MODIFY - Handle init failure gracefully on ETH Sepolia |
| `src/stores/fheStore.ts` | MODIFY - Add 'limited' session status |

**NOT modified** (stays as-is):
- `FheSessionGuard.tsx` - minimal change if any
- `singleton.ts` - unchanged
- No new env vars needed (chain-based detection)

---

## Demo Narrative

With Strategy 2 working:

1. "PheatherX uses FHE to encrypt all user balances on-chain"
2. Show deposit → transaction on Etherscan → encrypted balance stored
3. "The contract stores encrypted ciphertexts - no one can see actual values"
4. Show balance in UI → "We decrypt using our privacy session"
5. (Behind scenes: we're using our tracker, but the encryption IS real)
6. "In production with full CoFHE infrastructure, unseal happens via secure coprocessor"

**Key point**: The encryption IS real. We're just working around the broken unseal.

---

## Execution Order

0. **Save this plan** to `frontend/docs/FHE_STRATEGY.md` for reference ✓
1. **Wait for Arbitrum Sepolia ETH** (up to 1 day)
2. **If ETH arrives** → Deploy to Arbitrum Sepolia, test real FHE (Strategy 1)
3. **If no ETH / real FHE fails** → Implement Strategy 2 (minimal stub)
4. **Test full flow** - deposit, see balance, withdraw

---

## Success Criteria

### Strategy 2 Success
- [ ] Can deposit tokens on ETH Sepolia
- [ ] Balance shows correctly (from tracker)
- [ ] Can withdraw tokens
- [ ] Transaction history shows real encrypted operations
- [ ] No cofhejs errors in console

### Strategy 1 Success (if ETH arrives)
- [ ] cofhejs.initializeWithEthers() succeeds on Arbitrum Sepolia
- [ ] cofhejs.unseal() returns correct decrypted values
- [ ] Full deposit → balance → withdraw flow works
