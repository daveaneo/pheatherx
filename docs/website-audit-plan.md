# Website Vision Compliance Audit Plan

This document outlines the plan for auditing the FheatherX website against the project vision and identifying necessary improvements.

---

## Audit Methodology

The audit compares three sources:
1. **Vision Documents**: `docs/VISION.md`, `docs/token-pair-support.md`
2. **Current Website**: Landing page, Vision page, Trade page, FAQ, Portfolio
3. **User Experience**: How the messaging and UI guide users

---

## Current Compliance Score: 85-90%

The core vision is well-executed. The privacy promise is genuine and implemented correctly. The main gaps are around user guidance and token-type visibility.

---

## Findings

### Aligned with Vision

| Aspect | Evidence |
|--------|----------|
| "Trade in Silence" messaging | Landing page headline, consistent throughout |
| Encrypted limit orders | LimitOrderForm shows "Order amount will be encrypted with FHE" |
| MEV protection narrative | Vision page explains front-running, sandwich attacks |
| Bucket/tick system | UI properly shows price ticks and bucket sides |
| Plaintext swap disclosure | MarketSwapForm notes swaps use plaintext amounts |
| FHE session requirement | FheSessionGuard enforces session before operations |
| Pro-rata fill model | Vision page explains proceeds-per-share system |

### Gaps to Address

#### 1. Token Type Visibility (Priority: High)

**Issue**: Users cannot easily distinguish ERC20 from FHERC20 tokens in the UI.

**Vision Requirement** (from `token-pair-support.md`):
> The dApp UI should: Show available tokens with type badges (ERC20 / FHERC20)

**Current State**: Token selectors don't show type badges.

**Action Items**:
- [ ] Add token type badge to token selector dropdowns
- [ ] Color-code tokens: FHERC20 = encrypted badge, ERC20 = standard badge
- [ ] Show tooltip explaining the difference when hovering

---

#### 2. Wrap Prompt for ERC20 Limit Orders (Priority: High)

**Issue**: Users with ERC20 tokens trying to place limit orders aren't guided to wrap first.

**Vision Requirement** (from `token-pair-support.md`):
> If user selects ERC20 as input for limit order, prompt to wrap first

**Current State**: No automatic wrap prompt exists.

**Action Items**:
- [ ] Detect when user has ERC20 balance but not FHERC20 for selected token
- [ ] Show "Wrap tokens to enable private limit orders" prompt
- [ ] Add inline wrap button in the order form
- [ ] Link to explanation of why wrapping is required

---

#### 3. Multiple Order Interfaces (Priority: Medium)

**Issue**: Three different paths to create orders creates confusion.

**Current Paths**:
1. `/orders/new` - OrderForm component
2. `/trade` - LimitOrderForm component
3. Portfolio page - DepositForm component

**Action Items**:
- [ ] Consolidate to single primary order creation path (`/trade`)
- [ ] Remove or redirect `/orders/new` to `/trade`
- [ ] Portfolio DepositForm should be "Add to existing position" only

---

#### 4. Landing Page Privacy Clarification (Priority: Medium)

**Issue**: "Your trades, your secret" could mislead users about market swaps.

**Current State**: Landing page doesn't clarify that market swaps use plaintext.

**Action Items**:
- [ ] Add clarification: "Limit orders are encrypted. Market swaps use plaintext for price discovery."
- [ ] Or update "trades" to "limit orders" in the tagline
- [ ] Ensure How It Works section explains the distinction

---

#### 5. Activity History Labels (Priority: Low)

**Issue**: Homepage maps all deposits as "order_placed" activity.

**Current State**: Activity types conflate deposits with limit orders.

**Action Items**:
- [ ] Use specific activity labels: "Limit Order Placed", "Tokens Deposited", "Order Filled"
- [ ] Ensure activity descriptions match actual operations

---

#### 6. Pool Type Selector UI (Priority: Low)

**Issue**: Users can't see which pool type they're interacting with.

**Vision Requirement** (from `token-pair-support.md`):
> Pool filtering: Show appropriate pools based on user's token holdings

**Action Items**:
- [ ] Add pool type indicator (FHERC20:FHERC20, ERC20:FHERC20, etc.)
- [ ] Filter available operations based on pool type
- [ ] Disable limit orders on ERC20:ERC20 pools

---

## Implementation Priority

### Phase 1: Critical UX (Week 1)
1. Token type badges in selectors
2. Wrap prompt for ERC20 limit orders
3. Landing page privacy clarification

### Phase 2: Consolidation (Week 2)
4. Consolidate order creation paths
5. Pool type indicators
6. Activity history labels

### Phase 3: Polish (Week 3)
7. End-to-end testing of all user flows
8. Documentation update
9. FAQ expansion for edge cases

---

## Testing Checklist

After implementation, verify:

- [ ] User can identify FHERC20 vs ERC20 tokens at a glance
- [ ] User attempting ERC20 limit order sees wrap prompt
- [ ] User understands market swaps are plaintext
- [ ] User can place all 4 limit order types on FHERC20:FHERC20 pool
- [ ] User sees error/guidance when attempting disallowed operations
- [ ] Activity history correctly labels all operation types
- [ ] FAQ answers all common token-related questions

---

## Success Metrics

| Metric | Target |
|--------|--------|
| User confusion reports | < 5 per week |
| Successful wrap-before-order flow | > 80% completion |
| Correct token type selection | > 95% of limit orders |
| Vision page bounce rate | < 30% |

---

## Appendix: Key Vision Statements

From `docs/VISION.md`:

> "Trade in Silence: Encrypted trading, invisible activity, fair prices."

> "FheatherX protects against... front-running, sandwich attacks, and order book sniping."

> "FheatherX operates as a Uniswap v4 Hook, automatically matching limit orders when prices cross."

From `docs/token-pair-support.md`:

> "The input token (what you're selling) must be FHERC20."

> "If the order size is visible (ERC20 input), MEV bots can... front-run or sandwich the order."
