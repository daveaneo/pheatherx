# Token Pair Support Matrix

This document defines how FheatherX handles different token type combinations across all operations.

---

## Token Types

| Type | Example | Balance Visibility | Description |
|------|---------|-------------------|-------------|
| **ERC20** | WETH, USDC | Public (plaintext) | Standard tokens, balances visible on-chain |
| **FHERC20** | fheWETH, fheUSDC | Private (encrypted) | FHE-enabled tokens, balances encrypted via Fhenix CoFHE |

FHERC20 tokens have two balance types:
- **Plaintext balance**: Standard ERC20 `balanceOf()` - visible, used by Uniswap routers
- **Encrypted balance**: `_encBalances[]` - private, used by FheatherX limit orders

Users convert between these via `wrap()` (plaintext → encrypted) and `unwrap()` (encrypted → plaintext).

---

## Pool Types

| Pool Pair | Hook | Managed By |
|-----------|------|------------|
| ERC20 : ERC20 | None (standard) | Uniswap v4 |
| FHERC20 : FHERC20 | FheatherXv4 | FheatherX |
| ERC20 : FHERC20 | FheatherXv4 | FheatherX |

---

## Operations by Pool Type

### 1. Swap

A swap exchanges one token for another at the current market price.

| Pool Pair | Swap Supported | Hook Used | Notes |
|-----------|----------------|-----------|-------|
| ERC20 : ERC20 | Yes | None | Standard Uniswap v4 AMM |
| FHERC20 : FHERC20 | Yes | FheatherXv4 | Swap uses plaintext balances; hook observes for limit order matching |
| ERC20 : FHERC20 | Yes | FheatherXv4 | Mixed swap; hook observes for limit order matching |

**Swap privacy**: Swaps use plaintext amounts (standard Uniswap behavior). Privacy is not the goal for swaps - they help with price discovery and trigger limit order fills.

---

### 2. Add Liquidity

Adding liquidity provides tokens to a pool in exchange for LP position.

| Pool Pair | Add Liquidity | Hook Used | Notes |
|-----------|---------------|-----------|-------|
| ERC20 : ERC20 | Yes | None | Standard Uniswap v4 LP |
| FHERC20 : FHERC20 | Yes | FheatherXv4 | LP with FHE-enabled tokens |
| ERC20 : FHERC20 | Yes | FheatherXv4 | Mixed LP position |

**Liquidity privacy**: LP positions use plaintext amounts. This is standard Uniswap v4 behavior.

---

### 3. Remove Liquidity

Removing liquidity withdraws tokens from a pool by burning LP position.

| Pool Pair | Remove Liquidity | Hook Used | Notes |
|-----------|------------------|-----------|-------|
| ERC20 : ERC20 | Yes | None | Standard Uniswap v4 |
| FHERC20 : FHERC20 | Yes | FheatherXv4 | Receive FHERC20 tokens |
| ERC20 : FHERC20 | Yes | FheatherXv4 | Receive mixed token types |

---

### 4. Place Limit Order

Placing a limit order specifies a price at which you want to buy or sell. This is FheatherX's core privacy feature.

#### The Privacy Rule

**The input token (what you're selling) must be FHERC20.**

This ensures the order size is encrypted and hidden from MEV bots.

#### Why This Rule Exists

When placing a limit order, the following is visible on-chain:

| Data | Always Visible |
|------|----------------|
| Target tick (price level) | Yes |
| Order side (buy vs sell) | Yes |
| User address | Yes |

| Data | Depends on Input Token |
|------|------------------------|
| Order size | FHERC20 input → Encrypted (hidden) |
| Order size | ERC20 input → Plaintext (visible) |

If the order size is visible (ERC20 input), MEV bots can:
1. See exactly how much is being sold
2. Calculate the profitability of price manipulation
3. Front-run or sandwich the order

If the order size is hidden (FHERC20 input), MEV bots:
1. Know an order exists at a price level
2. Don't know if it's $100 or $1,000,000
3. Cannot calculate attack profitability
4. Are deterred from manipulation

#### Limit Order Support Matrix

| Input Token (selling) | Output Token (buying) | Limit Order Allowed | Reason |
|-----------------------|-----------------------|---------------------|--------|
| FHERC20 | FHERC20 | Yes | Order size encrypted |
| FHERC20 | ERC20 | Yes | Order size encrypted |
| ERC20 | FHERC20 | **No** | Order size visible - MEV risk |
| ERC20 | ERC20 | **No** | Order size visible - MEV risk |

#### Limit Order Types by Pool

**FHERC20 : FHERC20 Pool (e.g., fheWETH : fheUSDC)**

| Order Type | Input Token | Output Token | Allowed |
|------------|-------------|--------------|---------|
| Limit Buy fheWETH | fheUSDC | fheWETH | Yes |
| Limit Sell fheWETH | fheWETH | fheUSDC | Yes |
| Stop-Loss (sell fheWETH) | fheWETH | fheUSDC | Yes |
| Take-Profit (sell fheWETH) | fheWETH | fheUSDC | Yes |

All 4 order types available - both tokens are FHERC20.

**ERC20 : FHERC20 Pool (e.g., WETH : fheUSDC)**

| Order Type | Input Token | Output Token | Allowed |
|------------|-------------|--------------|---------|
| Limit Buy WETH | fheUSDC | WETH | Yes |
| Limit Sell WETH | WETH | fheUSDC | **No** |
| Stop-Loss (sell WETH) | WETH | fheUSDC | **No** |
| Take-Profit (sell WETH) | WETH | fheUSDC | **No** |

Only orders with FHERC20 as input are allowed.

**ERC20 : ERC20 Pool (e.g., WETH : USDC)**

| Order Type | Input Token | Output Token | Allowed |
|------------|-------------|--------------|---------|
| Any limit order | ERC20 | ERC20 | **No** |

No limit orders - use standard Uniswap v4 for ERC20:ERC20 trading.

---

## Complete Feature Matrix

| Feature | ERC20:ERC20 | FHERC20:FHERC20 | ERC20:FHERC20 |
|---------|-------------|-----------------|---------------|
| Swap | Yes (Uniswap) | Yes | Yes |
| Add Liquidity | Yes (Uniswap) | Yes | Yes |
| Remove Liquidity | Yes (Uniswap) | Yes | Yes |
| Limit Order (FHERC20 input) | N/A | Yes (all 4 types) | Yes (partial) |
| Limit Order (ERC20 input) | No | N/A | No |
| Privacy | None | Full | Partial |

---

## User Flows

### User with ERC20 wants to place a limit order

```
1. User has: 100 WETH (ERC20)
2. User wants: Place limit sell order for WETH

Option A: Wrap first
   → User wraps WETH to fheWETH
   → User places limit order on fheWETH:fheUSDC pool
   → Order size is encrypted (safe)

Option B: Use FHERC20:ERC20 pool (if available)
   → User wraps WETH to fheWETH
   → User places limit order on fheWETH:USDC pool
   → Order size is encrypted (safe)

Not allowed:
   → User places limit order with WETH directly
   → Order size would be visible (unsafe)
```

### User wants to swap without privacy concerns

```
1. User has: 100 USDC (ERC20)
2. User wants: Swap for WETH at market price

→ Use any pool type (ERC20:ERC20, FHERC20:FHERC20, mixed)
→ Swaps are plaintext regardless of token type
→ No wrapping needed for swaps
```

---

## Implementation Notes

### Frontend Enforcement

The dApp UI should:

1. **Token selector**: Show available tokens with type badges (ERC20 / FHERC20)
2. **Limit order form**: Only enable when input token is FHERC20
3. **Wrap prompt**: If user selects ERC20 as input for limit order, prompt to wrap first
4. **Pool filtering**: Show appropriate pools based on user's token holdings

### Contract Enforcement

The FheatherXv4 hook should:

1. Verify input token is FHERC20 in `deposit()` function
2. Accept encrypted amount parameter (`InEuint128`) only
3. Reject plaintext amount parameters for limit orders

### Wrap/Unwrap Integration

For seamless UX:

1. **Auto-wrap on limit order**: Offer to wrap ERC20 → FHERC20 before placing order
2. **Unwrap on claim**: After limit order fills, user can unwrap FHERC20 → ERC20 if desired
3. **Batch operations**: Combine wrap + place order in single transaction (future: via periphery contract)

---

## Summary

| Operation | Rule |
|-----------|------|
| Swap | Any token combination allowed |
| Add/Remove Liquidity | Any token combination allowed |
| Place Limit Order | **Input token must be FHERC20** |

This ensures FheatherX's core value proposition - private limit orders that cannot be front-run - is preserved while still supporting the broader Uniswap v4 ecosystem.
