# PheatherX Web Application Specification

**Version:** 2.0
**Last Updated:** November 2024
**Status:** Specification Document

---

## Table of Contents

1. [Application Overview](#1-application-overview)
2. [Information Architecture](#2-information-architecture)
3. [Feature Specifications](#3-feature-specifications)
4. [UI/UX Design System](#4-uiux-design-system)
5. [Technical Architecture](#5-technical-architecture)
6. [Responsive Design](#6-responsive-design)
7. [Accessibility](#7-accessibility)
8. [Error Handling](#8-error-handling)

---

## 1. Application Overview

### 1.1 Product Vision

PheatherX is a private execution layer built on Fully Homomorphic Encryption (FHE) within the Fhenix ecosystem. The web application provides a premium, institutional-grade trading interface that enables users to execute swaps and limit orders with complete privacy—trade direction, size, and intent remain hidden from all observers.

*Named after the phoenix feather — a symbol of silent, precise movement — PheatherX delivers privacy without sacrificing atomicity, performance, or trustlessness.*

### 1.2 Target Users

- **Privacy-conscious DeFi traders** seeking protection from MEV extraction
- **Institutional traders** requiring confidential order execution
- **Advanced users** who understand limit orders and want encrypted execution
- **Early adopters** interested in FHE technology and Uniswap v4 hooks

### 1.3 Key Differentiators

| Feature | Traditional DEX | PheatherX |
|---------|-----------------|-----------|
| Trade Direction | Public | Encrypted |
| Trade Amount | Public | Encrypted |
| Order Intent | Visible to MEV | Hidden |
| Slippage Protection | On-chain | Encrypted comparison |
| Limit Orders | Public triggers | Encrypted parameters |

### 1.4 Supported Networks

| Network | Chain ID | Purpose | FHE Support |
|---------|----------|---------|-------------|
| Local (Anvil) | 31337 | Development & testing | Mock FHE |
| Base Sepolia | 84532 | Hookathon demo deployment | Mock FHE |
| Fhenix Testnet | TBD | Production FHE testing | Full FHE |

### 1.5 Core Concept: Deposit-First Trading

> **Important:** Unlike traditional DEXs where you swap directly from your wallet, PheatherX requires depositing tokens first. This enables encrypted accounting—your balance and trades remain private on-chain.

**User Flow:**
1. **Deposit** tokens from wallet into PheatherX balance
2. **Trade** using your encrypted PheatherX balance
3. **Withdraw** tokens back to wallet when needed

This architecture is fundamental to how FHE privacy works and cannot be bypassed.

---

## 2. Information Architecture

### 2.1 Site Map

```
/                         → Landing Page (Hero + Features)
├── /swap                 → Instant Swap Interface
├── /orders               → Limit Orders Hub
│   ├── /orders/new       → Create New Order (4 types)
│   ├── /orders/active    → Active Orders Management
│   └── /orders/history   → Order History
├── /portfolio            → Wallet & Balances Dashboard
├── /analytics            → Pool Stats & Charts
├── /auctions             → Coming Soon (Placeholder)
└── /launchpad            → Coming Soon (Placeholder)
```

### 2.2 Navigation Structure

**Primary Navigation (Header)**
- Logo (links to /)
- Swap
- Orders (dropdown: New, Active, History)
- Portfolio
- Analytics
- Auctions *(Coming Soon badge)*
- Launchpad *(Coming Soon badge)*
- [Connect Wallet Button]
- [Network Selector]

**Mobile Navigation (Bottom Bar)**
- Swap
- Orders
- Portfolio
- More (Analytics, Auctions, Launchpad)

---

## 3. Feature Specifications

### 3.1 Landing Page

**Purpose:** Introduce PheatherX and its privacy value proposition.

**Sections:**
1. **Hero Section**
   - Headline: "Trade in Silence"
   - Subheadline: "Private execution powered by FHE. Your trades, your secret."
   - Primary CTA: "Launch App" → /swap
   - Secondary CTA: "Learn More" → scroll to features

2. **Features Grid**
   - Encrypted Swaps
   - Private Limit Orders
   - MEV Protection
   - Institutional-Grade Privacy

3. **How It Works**
   - Step 1: **Deposit tokens into your PheatherX balance** — Unlike traditional DEXs, you deposit first to enable encrypted accounting
   - Step 2: **Execute encrypted trades** — Swap or place limit orders privately
   - Step 3: **Manage orders & withdraw** — Cancel orders, withdraw anytime

4. **Stats Bar** (live from chain)
   - Total Volume
   - Active Orders
   - Unique Users

---

### 3.2 Swap Interface (`/swap`)

**Purpose:** Execute instant encrypted token swaps.

**Layout:**
```
┌─────────────────────────────────────┐
│           SWAP CARD                 │
├─────────────────────────────────────┤
│  From                               │
│  ┌─────────────────────────────┐   │
│  │ [Token Selector] │ [Amount] │   │
│  │ Balance: ••••••  │ [MAX]    │   │
│  │         [Reveal]             │   │
│  └─────────────────────────────┘   │
│                                     │
│           [↓ Swap Arrow]            │
│                                     │
│  To                                 │
│  ┌─────────────────────────────┐   │
│  │ [Token Selector] │ [Amount] │   │
│  │ Balance: ••••••  [Reveal]    │   │
│  └─────────────────────────────┘   │
│                                     │
│  ─────────────────────────────────  │
│  Rate: 1 ETH = 2,450.32 USDC       │
│  ⓘ Rate may be slightly delayed    │
│  Price Impact: <0.01%              │
│  Slippage: 0.5% [⚙️ Settings]       │
│  ─────────────────────────────────  │
│                                     │
│  [        SWAP PRIVATELY        ]   │
│                                     │
└─────────────────────────────────────┘
```

**Components:**

1. **Token Selector Modal**
   - Search by name/symbol/address
   - Common tokens pinned at top
   - User token balances displayed (encrypted)
   - Token logos and symbols

2. **Amount Input**
   - Numeric input with decimal support
   - "MAX" button fills available PheatherX balance
   - Real-time USD value estimate
   - Encrypted balance display (••••••)
   - "Reveal" button to decrypt balance (async operation)

3. **Swap Details Panel**
   - Exchange rate (from reserves - may be slightly delayed)
   - Price impact calculation
   - Minimum received (after slippage)
   - Network fee estimate
   - Note: "Your trade uses real-time encrypted reserves. Slippage protects you."

4. **Slippage Settings Modal**
   - Preset buttons: 0.1%, 0.5%, 1.0%
   - Custom input field
   - Warning for high slippage (>2%)

5. **Privacy Mode Toggle** (Advanced)
   - **Maximum Privacy:** Encrypt parameters client-side via hookData
   - **Standard:** On-chain encryption (faster, still private execution)

6. **Transaction Flow**
   - Step 1: Encrypt parameters (cofhejs)
   - Step 2: Grant access to hook contract (FHE.allow)
   - Step 3: Sign transaction
   - Step 4: Confirm on-chain
   - Step 5: Show success/failure

**States:**

| State | Description | UI |
|-------|-------------|-----|
| No Wallet | Wallet not connected | "Connect Wallet" button |
| No Deposit | Wallet connected but no PheatherX balance | Deposit prompt (see below) |
| Ready | Has balance, can swap | Normal swap interface |
| Insufficient Balance | Amount exceeds available balance | Error message, deposit link |
| Loading | Fetching rates | Skeleton loaders |
| Confirming | Wallet prompt | Pending indicator |
| Pending | Transaction submitted | Transaction hash, explorer link |
| Success | Swap complete | Success message, new balances |
| Error | Transaction failed | Error message, retry button |

**No Deposit State:**
```
┌─────────────────────────────────────┐
│  ⚠️ Deposit Required                │
├─────────────────────────────────────┤
│                                     │
│  To trade privately, first deposit  │
│  tokens into your PheatherX balance.│
│                                     │
│  Wallet Balance: 2.5 ETH            │
│  PheatherX Balance: 0 ETH           │
│                                     │
│  Your funds remain under your       │
│  control and can be withdrawn       │
│  anytime.                           │
│                                     │
│  [     Deposit to Start Trading   ] │
│                                     │
└─────────────────────────────────────┘
```

---

### 3.3 Limit Orders (`/orders`)

**Purpose:** Create and manage encrypted limit orders.

#### 3.3.1 Order Types Explained

PheatherX supports 4 order types, all using the same underlying contract function:
```solidity
placeOrder(int24 triggerTick, ebool direction, euint128 amount, euint128 minOutput)
```

| Order Type | User Intent | Direction | Trigger Condition |
|------------|-------------|-----------|-------------------|
| **Limit Buy** | Buy token at lower price | oneForZero (false) | Price rises through trigger tick |
| **Limit Sell** | Sell token at higher price | zeroForOne (true) | Price falls through trigger tick |
| **Stop-Loss** | Sell if price drops | zeroForOne (true) | Price falls through trigger tick |
| **Take-Profit** | Sell at profit target | zeroForOne (true) | Price falls through trigger tick |

#### 3.3.2 Order Mechanics (Technical Detail)

**How Order Triggering Works:**

Orders trigger based on **price movement direction crossing the trigger tick**, not simply reaching a price level.

```
Price Movement Direction:
├── zeroForOne orders trigger when price moves DOWN through tick
└── oneForZero orders trigger when price moves UP through tick
```

**From Contract:**
```solidity
// zeroForOne (direction=true) triggers when price moves DOWN (movingUp=false)
// oneForZero (direction=false) triggers when price moves UP (movingUp=true)
ebool shouldTrigger = FHE.ne(order.direction, encMovingUp);
```

**UI Translation Logic:**
```typescript
function getOrderDirection(orderType: OrderType): boolean {
  switch (orderType) {
    case 'limit-sell':   return true;  // zeroForOne - sell token0
    case 'stop-loss':    return true;  // zeroForOne - sell token0
    case 'take-profit':  return true;  // zeroForOne - sell token0
    case 'limit-buy':    return false; // oneForZero - buy token0 (sell token1)
  }
}
```

**UI must validate:**
- Trigger tick is on the correct side of current price for the order type
- Amount doesn't exceed available PheatherX balance

#### 3.3.3 New Order Form (`/orders/new`)

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│  ORDER TYPE TABS                                    │
│  [Limit Buy] [Limit Sell] [Stop-Loss] [Take-Profit] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ ℹ️ LIMIT BUY                                   │ │
│  │ Buy tokens when the price drops to your       │ │
│  │ target. Your order executes automatically     │ │
│  │ when the market reaches your price.           │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  Token Pair                                         │
│  ┌─────────────────────────────────────────────┐   │
│  │ [ETH ▼]  →  [USDC ▼]                        │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  Current Price: 2,450.32 USDC per ETH              │
│                                                     │
│  Target Price                                       │
│  ┌─────────────────────────────────────────────┐   │
│  │ [          2,300.00          ] USDC         │   │
│  │ -6.1% from current                          │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  Amount to Buy                                      │
│  ┌─────────────────────────────────────────────┐   │
│  │ [            1.5             ] ETH          │   │
│  │ Cost: ≈ 3,450.00 USDC                       │   │
│  │ Available: •••••• USDC [Reveal]             │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  Slippage Tolerance                                 │
│  ┌─────────────────────────────────────────────┐   │
│  │ [0.5%] [1.0%] [2.0%] [Custom: _____ ]       │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ─────────────────────────────────────────────────  │
│  Protocol Fee: 0.001 ETH (~$2.45)                  │
│  ⓘ Paid in ETH. Non-refundable.                   │
│  Min. Output: 1.485 ETH (after slippage)           │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  ✓ Your order will execute when price FALLS to    │
│    2,300 USDC (when someone sells ETH)            │
│                                                     │
│  [         PLACE LIMIT BUY ORDER         ]         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Order Type Descriptions:**

**Limit Buy**
> "Buy [TOKEN] when the price drops to your target. Your order sits privately on-chain and executes automatically when the market reaches your price. Perfect for accumulating at lower prices."

**Limit Sell**
> "Sell [TOKEN] when the price rises to your target. Set your desired sell price above the current market and let PheatherX execute when the market comes to you. Ideal for selling at better prices."

**Stop-Loss**
> "Automatically sell [TOKEN] if the price drops to your trigger level. Protect your position from further losses. The market won't see your stop until it triggers—no front-running your exit."

**Take-Profit**
> "Automatically sell [TOKEN] when the price reaches your profit target. Lock in your gains without watching the market. Your target remains private until execution."

**Visual Price Indicator:**
```
         Stop-Loss          Current          Limit Sell/Take-Profit
              ▼                ▼                     ▼
    ──────────●────────────────●─────────────────────●──────────
         $1,800            $2,450                $3,000

         Limit Buy
              ▼
    ──────────●────────────────●──────────
         $2,200            $2,450
```

**Order Placement Transaction Flow:**
1. Encrypt direction, amount, minOutput (cofhejs)
2. Grant hook contract access to encrypted values (FHE.allow)
3. Sign transaction with protocol fee (0.001 ETH)
4. Confirm on-chain
5. Show success with order ID

#### 3.3.4 Active Orders (`/orders/active`)

**Layout:**
```
┌────────────────────────────────────────────────────────────────────┐
│  ACTIVE ORDERS                                      [+ New Order]  │
├────────────────────────────────────────────────────────────────────┤
│  Filter: [All Types ▼] [All Pairs ▼]    Sort: [Newest ▼]          │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ LIMIT BUY  •  ETH/USDC                           ID: #1234   │ │
│  │ ──────────────────────────────────────────────────────────── │ │
│  │ Amount: •••••• ETH  [Reveal] Trigger: $2,300.00             │ │
│  │ Current: $2,450.32           Distance: -6.1%                │ │
│  │ Created: 2 hours ago         Status: ⏳ Waiting              │ │
│  │ ──────────────────────────────────────────────────────────── │ │
│  │                                              [Cancel Order]  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ STOP-LOSS  •  ETH/USDC                           ID: #1231   │ │
│  │ ──────────────────────────────────────────────────────────── │ │
│  │ Amount: •••••• ETH  [Reveal] Trigger: $1,800.00             │ │
│  │ Current: $2,450.32           Distance: -26.5%               │ │
│  │ Created: 1 day ago           Status: ⏳ Waiting              │ │
│  │ ──────────────────────────────────────────────────────────── │ │
│  │                                              [Cancel Order]  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  No more active orders.                                           │
│                                                                    │
│  ⓘ Multiple orders can exist at the same trigger price.          │
│    All orders at a triggered price execute together.             │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

**Order Card Details:**
- Order type badge (color-coded)
- Token pair
- Order ID (1-indexed)
- Encrypted amount (with reveal option)
- Trigger price
- Current market price
- Distance to trigger (%)
- Creation timestamp
- Status: Waiting, Near Trigger (within 5%)
- Cancel button

**Cancel Flow:**
```
┌─────────────────────────────────────┐
│  Cancel Order #1234?                │
├─────────────────────────────────────┤
│                                     │
│  Your tokens will be returned to    │
│  your PheatherX balance (not your   │
│  wallet).                           │
│                                     │
│  You can withdraw from the          │
│  Portfolio page.                    │
│                                     │
│  ⚠️ Protocol fee is non-refundable │
│                                     │
│  [Keep Order]      [Cancel Order]   │
│                                     │
└─────────────────────────────────────┘
```

1. Click "Cancel Order"
2. Confirmation modal (shown above)
3. Sign transaction
4. Success: "Order cancelled. Funds returned to your PheatherX balance."

#### 3.3.5 Order History (`/orders/history`)

**Layout:**
```
┌────────────────────────────────────────────────────────────────────┐
│  ORDER HISTORY                                                     │
├────────────────────────────────────────────────────────────────────┤
│  Filter: [All Status ▼] [All Types ▼] [All Pairs ▼] [Date Range]  │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ ✓ FILLED  •  LIMIT SELL  •  ETH/USDC             ID: #1230   │ │
│  │ ──────────────────────────────────────────────────────────── │ │
│  │ Sold: 2.0 ETH             Received: 5,148.45 USDC           │ │
│  │ (1% executor reward deducted)                               │ │
│  │ Trigger: $2,600.00        Fill Price: $2,600.23             │ │
│  │ Created: 3 days ago       Filled: 1 day ago                 │ │
│  │ Executor: 0x1234...5678                                     │ │
│  │ ──────────────────────────────────────────────────────────── │ │
│  │                                              [View on Block] │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ ⚠️ SLIPPAGE FAILED  •  LIMIT BUY  •  ETH/USDC    ID: #1229   │ │
│  │ ──────────────────────────────────────────────────────────── │ │
│  │ Order triggered but couldn't fill at acceptable price.      │ │
│  │ Your 1,000 USDC was returned to your PheatherX balance.     │ │
│  │ Trigger: $2,200.00        Attempted: 1 day ago              │ │
│  │ ──────────────────────────────────────────────────────────── │ │
│  │                                              [View on Block] │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ ✗ CANCELLED  •  LIMIT BUY  •  ETH/USDC           ID: #1228   │ │
│  │ ──────────────────────────────────────────────────────────── │ │
│  │ Amount: 1.0 ETH           Trigger: $2,200.00                │ │
│  │ Created: 5 days ago       Cancelled: 4 days ago             │ │
│  │ Funds returned to PheatherX balance.                        │ │
│  │ ──────────────────────────────────────────────────────────── │ │
│  │                                              [View on Block] │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

**Status Types:**
- ✓ **Filled** (green) — Order executed successfully
- ⚠️ **Slippage Failed** (orange) — Triggered but price moved too much; funds returned
- ✗ **Cancelled** (gray) — User cancelled; funds returned

**Executor Reward Note:**
> "When your order fills, 1% of the output goes to the executor—the trader whose swap triggered your order. This incentivizes order execution."

---

### 3.4 Portfolio Dashboard (`/portfolio`)

**Purpose:** Manage encrypted balances, deposits, and withdrawals.

**Layout:**
```
┌────────────────────────────────────────────────────────────────────┐
│  PORTFOLIO                                                         │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Total Value (Estimated)                                           │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                        $12,450.32                             │ │
│  │                    [Reveal All Balances]                      │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  YOUR BALANCES                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  [ETH Logo]  Ethereum                                        │ │
│  │  Available: ••••••        [Reveal]                           │ │
│  │  In Orders: ••••••                                           │ │
│  │  Total:     ••••••                                           │ │
│  │  ──────────────────────────────────────────────────────────  │ │
│  │  [Deposit]  [Withdraw]                                       │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  [USDC Logo]  USD Coin                                       │ │
│  │  Available: ••••••        [Reveal]                           │ │
│  │  In Orders: ••••••                                           │ │
│  │  Total:     ••••••                                           │ │
│  │  ──────────────────────────────────────────────────────────  │ │
│  │  [Deposit]  [Withdraw]                                       │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  RECENT ACTIVITY                                                   │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  ↓ Deposit     2.0 ETH       2 hours ago      [View Tx]     │ │
│  │  ↔ Swap        1.0 ETH → USDC    5 hours ago  [View Tx]     │ │
│  │  📋 Order Placed  #1234      1 day ago        [View Tx]     │ │
│  │  ↑ Withdraw    500 USDC      2 days ago       [View Tx]     │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

**Balance Display:**
- **Available:** Can be used for swaps or new orders
- **In Orders:** Reserved for pending limit orders (calculated client-side from active orders)
- **Total:** Available + In Orders

**Deposit Modal:**
```
┌─────────────────────────────────────┐
│  DEPOSIT ETH                        │
├─────────────────────────────────────┤
│                                     │
│  Amount                             │
│  ┌─────────────────────────────┐   │
│  │ [        1.5        ] ETH   │   │
│  │ Wallet Balance: 4.25 ETH    │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌───────────────────────────────┐ │
│  │ ℹ️ About Deposits              │ │
│  │ Deposited funds are held in   │ │
│  │ the PheatherX hook contract.  │ │
│  │ You can withdraw anytime.     │ │
│  │                               │ │
│  │ This enables encrypted        │ │
│  │ balance accounting for        │ │
│  │ private trading.              │ │
│  └───────────────────────────────┘ │
│                                     │
│  [Step 1: Approve]                  │
│  [Step 2: Deposit]                  │
│                                     │
└─────────────────────────────────────┘
```

**Withdraw Modal:**
```
┌─────────────────────────────────────┐
│  WITHDRAW ETH                       │
├─────────────────────────────────────┤
│                                     │
│  Amount                             │
│  ┌─────────────────────────────┐   │
│  │ [        1.0        ] ETH   │   │
│  │ Available: •••••• ETH [Reveal] │ │
│  │ In Orders: •••••• ETH        │ │
│  └─────────────────────────────┘   │
│                                     │
│  ⚠️ You can only withdraw your     │
│  available balance, not funds      │
│  reserved in active orders.        │
│                                     │
│  Destination: Your connected wallet │
│  0x1234...5678                      │
│                                     │
│  [        WITHDRAW        ]         │
│                                     │
└─────────────────────────────────────┘
```

**Balance Reveal Flow:**
```
User clicks [Reveal]
         │
         ▼
┌─────────────────────────────────────┐
│  Decrypting your balance...         │
│  [████████░░░░░░░░] ~5 seconds      │
│                                     │
│  Your balance is encrypted on-chain.│
│  Decryption requires network        │
│  consensus.                         │
└─────────────────────────────────────┘
         │
         ▼ (after decrypt completes)
┌─────────────────────────────────────┐
│  Balance: 2.458 ETH                 │
│  [Hide] [Keep visible for session]  │
└─────────────────────────────────────┘
```

---

### 3.5 Analytics Dashboard (`/analytics`)

**Purpose:** Display pool metrics, volume, and user statistics.

**Layout:**
```
┌────────────────────────────────────────────────────────────────────┐
│  ANALYTICS                                         [24H] [7D] [30D] │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  POOL OVERVIEW                                                     │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐         │
│  │ Total Value    │ │ 24H Volume     │ │ Total Orders   │         │
│  │ Locked         │ │                │ │                │         │
│  │ $2.4M          │ │ $542K          │ │ 1,234          │         │
│  │ ↑ 12.3%        │ │ ↑ 8.7%         │ │ ↑ 23 today     │         │
│  └────────────────┘ └────────────────┘ └────────────────┘         │
│                                                                    │
│  PRICE CHART                                                       │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                                                              │ │
│  │         ╭──────╮                                             │ │
│  │        ╱        ╲      ╭───╮                                 │ │
│  │   ╭───╯          ╲────╯   ╲────                             │ │
│  │  ╱                                                           │ │
│  │ ╱                                                            │ │
│  │ ETH/USDC  Current: $2,450.32                                │ │
│  │ ⓘ Price derived from public reserve cache                   │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  YOUR STATS (Connected Wallet)                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ Total Trades: 47    │ Volume: $24,500    │ Fees Paid: 0.05 ETH │
│  │ Orders Filled: 12   │ Orders Cancelled: 3│ Active Orders: 2   │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  VOLUME BREAKDOWN                                                  │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  [Bar chart showing daily volume over selected period]       │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

**Metrics to Display:**
- Pool TVL (from `getReserves()`)
- 24H/7D/30D Volume (from indexed events)
- Total orders placed
- Price chart (from reserve ratio over time)
- User's personal statistics

**Note on Price Staleness:**
> Displayed prices are derived from the public reserve cache, which may lag behind actual reserves by a few blocks. All trades execute against real-time encrypted reserves with slippage protection.

---

### 3.6 Auctions (Placeholder) (`/auctions`)

**Purpose:** Placeholder for upcoming FHE-powered auction feature.

**Layout:**
```
┌────────────────────────────────────────────────────────────────────┐
│                                                                    │
│                         [Feather Icon]                             │
│                                                                    │
│                    PRIVATE AUCTIONS                                │
│                      COMING SOON                                   │
│                                                                    │
│  Auction assets with complete bid privacy.                         │
│  No one sees your bid until the auction closes.                   │
│                                                                    │
│  • Sealed-bid auctions powered by FHE                             │
│  • Fair price discovery without front-running                     │
│  • Support for NFTs, tokens, and more                             │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Get notified when Auctions launches:                       │  │
│  │  [        your@email.com        ] [Notify Me]               │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

### 3.7 Launchpad (Placeholder) (`/launchpad`)

**Purpose:** Placeholder for phERC20 token launch platform.

**Layout:**
```
┌────────────────────────────────────────────────────────────────────┐
│                                                                    │
│                         [Phoenix Icon]                             │
│                                                                    │
│                    PHEATHERX LAUNCHPAD                             │
│                      COMING SOON                                   │
│                                                                    │
│  Launch privacy-enabled tokens on the phERC20 standard.           │
│                                                                    │
│  WHY LAUNCH ON PHEATHERX?                                         │
│  • Built-in encrypted balances                                    │
│  • Private transfers from day one                                 │
│  • Seamless PheatherX DEX integration                            │
│  • Fair launch mechanics                                          │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Join the waitlist:                                         │  │
│  │  [        your@email.com        ] [Join Waitlist]           │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## 4. UI/UX Design System

### 4.1 Color Palette

#### Primary Colors
| Name | Hex | Usage |
|------|-----|-------|
| Phoenix Ember | `#FF6A3D` | Primary actions, heat, movement |
| Feather Gold | `#F0C27B` | Accents, premium elements |
| Obsidian Black | `#0A0A0F` | Primary background |
| Ash Gray | `#1C1E26` | Secondary background |

#### Secondary Colors
| Name | Hex | Usage |
|------|-----|-------|
| Iridescent Violet | `#6B5BFF` | Highlights, encrypted elements |
| Deep Magenta | `#D6246E` | Warm accents, errors |
| Electric Teal | `#19C9A0` | Success states, positive indicators |

#### Neutral Colors
| Name | Hex | Usage |
|------|-----|-------|
| Carbon Gray | `#2B2D36` | Cards, inputs, dividers |
| Feather White | `#F9F7F1` | Primary text |

#### Semantic Colors
| State | Color |
|-------|-------|
| Success | Electric Teal `#19C9A0` |
| Error | Deep Magenta `#D6246E` |
| Warning | Feather Gold `#F0C27B` |
| Info | Iridescent Violet `#6B5BFF` |

### 4.2 Gradients

**Flame Gradient (Primary Actions)**
```css
background: linear-gradient(135deg, #FF6A3D 0%, #D6246E 50%, #6B5BFF 100%);
```

**Feather Edge Gradient (Accents)**
```css
background: linear-gradient(90deg, #F0C27B 0%, #19C9A0 100%);
```

**Obsidian Glow (Backgrounds)**
```css
background: linear-gradient(180deg, #0A0A0F 0%, #1C1E26 100%);
```

### 4.3 Typography

| Element | Font | Weight | Size |
|---------|------|--------|------|
| H1 | Inter Tight | Bold | 48px |
| H2 | Inter Tight | Bold | 32px |
| H3 | Inter Tight | Medium | 24px |
| H4 | Inter Tight | Medium | 20px |
| Body | Satoshi | Regular | 16px |
| Body Small | Satoshi | Regular | 14px |
| Caption | Satoshi | Regular | 12px |
| Code/Numbers | IBM Plex Mono | Regular | 14px |
| Display | Neue Machina | Bold | 64px+ |

**Line Heights:**
- Headings: 1.2
- Body: 1.5-1.65
- Code: 1.4

### 4.4 Spacing System

Base unit: 4px

| Token | Value |
|-------|-------|
| xs | 4px |
| sm | 8px |
| md | 16px |
| lg | 24px |
| xl | 32px |
| 2xl | 48px |
| 3xl | 64px |

### 4.5 Component Specifications

#### Buttons

**Primary Button**
- Background: Flame gradient
- Text: Feather White
- Border: None
- Border Radius: 12px
- Padding: 16px 32px
- Shadow: 0 4px 12px rgba(255, 106, 61, 0.3)
- Hover: Brightness 110%, shadow increase
- Active: Scale 0.98

**Secondary Button**
- Background: Transparent
- Text: Feather White
- Border: 1px solid Carbon Gray
- Border Radius: 12px
- Padding: 16px 32px
- Hover: Border color Phoenix Ember

**Danger Button**
- Background: Deep Magenta
- Text: Feather White
- Border Radius: 12px

#### Cards

- Background: Carbon Gray (`#2B2D36`)
- Border: 1px solid with feather gradient (subtle)
- Border Radius: 16px
- Padding: 24px
- Shadow: 0 4px 24px rgba(0, 0, 0, 0.2)
- Hover: Micro-glow effect (2-4px ember shadow)

#### Inputs

- Background: Ash Gray (`#1C1E26`)
- Border: 1px solid Carbon Gray
- Border Radius: 12px
- Padding: 16px
- Focus: Border color Phoenix Ember, subtle glow
- Text: Feather White
- Placeholder: Carbon Gray

#### Modals

- Backdrop: Obsidian Black at 80% opacity
- Card: Carbon Gray background
- Border Radius: 20px
- Max Width: 480px
- Padding: 32px
- Animation: Fade in + scale from 0.95

### 4.6 Animations

**Hover Float**
```css
transform: translateY(-2px);
transition: transform 0.2s ease;
```

**Gradient Shimmer**
```css
background-size: 200% 200%;
animation: shimmer 2s ease infinite;
@keyframes shimmer {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
```

**Ember Pulse (Loading)**
```css
animation: pulse 1.5s ease-in-out infinite;
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 8px #FF6A3D; }
  50% { box-shadow: 0 0 20px #FF6A3D; }
}
```

**Page Transition**
```css
animation: fadeIn 0.3s ease;
@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.98); }
  to { opacity: 1; transform: scale(1); }
}
```

### 4.7 Iconography

- Style: Single-line, feather-inspired with tapered ends
- Stroke: 1.5-2px
- Size: 20x20 (default), 24x24 (large)
- Color: Inherit from text or accent colors

Recommended icon set: Custom SVGs based on styleguide, or Lucide icons with customization.

---

## 5. Technical Architecture

### 5.1 Technology Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| State Management | TanStack Query (server state), Zustand (client state) |
| Wallet Connection | RainbowKit + wagmi v2 |
| Contract Interaction | viem |
| FHE Operations | cofhejs |
| Charts | Lightweight Charts or Recharts |
| Forms | React Hook Form + Zod |
| Animations | Framer Motion |

### 5.2 Project Structure

```
frontend/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── layout.tsx
│   │   ├── page.tsx            # Landing
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
│   │   ├── ui/                 # Primitive components
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Modal.tsx
│   │   │   └── ...
│   │   ├── layout/             # Layout components
│   │   │   ├── Header.tsx
│   │   │   ├── Footer.tsx
│   │   │   └── Sidebar.tsx
│   │   ├── swap/               # Swap feature components
│   │   ├── orders/             # Orders feature components
│   │   ├── portfolio/          # Portfolio feature components
│   │   └── analytics/          # Analytics feature components
│   ├── hooks/                  # Custom React hooks
│   │   ├── useContract.ts
│   │   ├── useEncrypt.ts
│   │   ├── useOrders.ts
│   │   ├── useBalances.ts
│   │   └── ...
│   ├── lib/
│   │   ├── contracts/          # Contract ABIs and addresses
│   │   ├── chains.ts           # Network configuration
│   │   ├── fhe.ts              # FHE utilities
│   │   ├── ticks.ts            # Tick/price conversion utilities
│   │   ├── utils.ts            # General utilities
│   │   └── constants.ts
│   ├── styles/
│   │   └── globals.css         # Tailwind + custom styles
│   └── types/                  # TypeScript types
├── public/
│   ├── icons/
│   └── images/
├── tailwind.config.ts
├── next.config.js
└── package.json
```

### 5.3 Network Configuration

```typescript
// lib/chains.ts
import { Chain } from 'wagmi/chains';

export const localAnvil: Chain = {
  id: 31337,
  name: 'Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://localhost:8545'] },
  },
};

export const baseSepolia: Chain = {
  id: 84532,
  name: 'Base Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://sepolia.base.org'] },
  },
  blockExplorers: {
    default: { name: 'BaseScan', url: 'https://sepolia.basescan.org' },
  },
};

export const fhenixTestnet: Chain = {
  id: 8008135, // TBD - placeholder
  name: 'Fhenix Testnet',
  nativeCurrency: { name: 'Fhenix', symbol: 'FHE', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet.fhenix.io'] },
  },
};

export const supportedChains = [localAnvil, baseSepolia, fhenixTestnet];

// Network-specific FHE support
export const fheSupport: Record<number, 'full' | 'mock'> = {
  31337: 'mock',    // Local - mock FHE
  84532: 'mock',    // Base Sepolia - mock FHE for demo
  8008135: 'full',  // Fhenix - full FHE
};
```

### 5.4 Contract Integration

```typescript
// lib/contracts/pheatherx.ts
export const PHEATHERX_ABI = [...] as const;

export const PHEATHERX_ADDRESSES: Record<number, `0x${string}`> = {
  31337: '0x...', // Local
  84532: '0x...', // Base Sepolia
  8008135: '0x...', // Fhenix Testnet
};

// Constants
export const PROTOCOL_FEE = 0.001; // ETH
export const EXECUTOR_REWARD_BPS = 100; // 1%

// hooks/usePheatherX.ts
import { useReadContract, useWriteContract } from 'wagmi';

export function useDeposit() {
  const { writeContract } = useWriteContract();

  return async (isToken0: boolean, amount: bigint) => {
    await writeContract({
      address: PHEATHERX_ADDRESSES[chainId],
      abi: PHEATHERX_ABI,
      functionName: 'deposit',
      args: [isToken0, amount],
    });
  };
}

export function useWithdraw() {
  const { writeContract } = useWriteContract();

  return async (isToken0: boolean, amount: bigint) => {
    await writeContract({
      address: PHEATHERX_ADDRESSES[chainId],
      abi: PHEATHERX_ABI,
      functionName: 'withdraw',
      args: [isToken0, amount],
    });
  };
}

export function usePlaceOrder() {
  const { writeContract } = useWriteContract();
  const { encryptBool, encryptUint128, allow } = useEncrypt();

  return async (
    triggerTick: number,
    direction: boolean,
    amount: bigint,
    minOutput: bigint
  ) => {
    // Encrypt values
    const encDirection = await encryptBool(direction);
    const encAmount = await encryptUint128(amount);
    const encMinOutput = await encryptUint128(minOutput);

    // Grant hook access to encrypted values
    const hookAddress = PHEATHERX_ADDRESSES[chainId];
    await allow(encDirection, hookAddress);
    await allow(encAmount, hookAddress);
    await allow(encMinOutput, hookAddress);

    // Place order
    await writeContract({
      address: hookAddress,
      abi: PHEATHERX_ABI,
      functionName: 'placeOrder',
      args: [triggerTick, encDirection, encAmount, encMinOutput],
      value: parseEther(PROTOCOL_FEE.toString()),
    });
  };
}

export function useCancelOrder() {
  const { writeContract } = useWriteContract();

  return async (orderId: bigint) => {
    await writeContract({
      address: PHEATHERX_ADDRESSES[chainId],
      abi: PHEATHERX_ABI,
      functionName: 'cancelOrder',
      args: [orderId],
    });
  };
}

export function useActiveOrders(userAddress: `0x${string}`) {
  return useReadContract({
    address: PHEATHERX_ADDRESSES[chainId],
    abi: PHEATHERX_ABI,
    functionName: 'getActiveOrders',
    args: [userAddress],
  });
}

export function useOrderCount(userAddress: `0x${string}`) {
  return useReadContract({
    address: PHEATHERX_ADDRESSES[chainId],
    abi: PHEATHERX_ABI,
    functionName: 'getOrderCount',
    args: [userAddress],
  });
}

export function useReserves() {
  return useReadContract({
    address: PHEATHERX_ADDRESSES[chainId],
    abi: PHEATHERX_ABI,
    functionName: 'getReserves',
  });
}

export function useHasOrdersAtTick(tick: number) {
  return useReadContract({
    address: PHEATHERX_ADDRESSES[chainId],
    abi: PHEATHERX_ABI,
    functionName: 'hasOrdersAtTick',
    args: [tick],
  });
}
```

### 5.5 FHE Integration

```typescript
// lib/fhe.ts
import { FhenixClient } from 'cofhejs';

export function useEncrypt() {
  const { provider } = useProvider();
  const fhenixClient = useMemo(() => new FhenixClient({ provider }), [provider]);

  const encryptBool = async (value: boolean) => {
    return fhenixClient.encrypt.bool(value);
  };

  const encryptUint128 = async (value: bigint) => {
    return fhenixClient.encrypt.uint128(value);
  };

  const decrypt = async (encrypted: EncryptedValue) => {
    // Note: Decryption is async and may take several seconds
    return fhenixClient.decrypt(encrypted);
  };

  const allow = async (encrypted: EncryptedValue, contractAddress: `0x${string}`) => {
    // Grant contract access to use this encrypted value
    return fhenixClient.allow(encrypted, contractAddress);
  };

  return { encryptBool, encryptUint128, decrypt, allow };
}

// Balance reveal state management
interface BalanceRevealState {
  status: 'hidden' | 'revealing' | 'revealed';
  value?: bigint;
  revealedAt?: number;
  sessionPersist: boolean;
}

export function useBalanceReveal(encryptedBalance: EncryptedValue) {
  const [state, setState] = useState<BalanceRevealState>({
    status: 'hidden',
    sessionPersist: false,
  });
  const { decrypt } = useEncrypt();

  const reveal = async () => {
    setState(prev => ({ ...prev, status: 'revealing' }));
    try {
      const value = await decrypt(encryptedBalance);
      setState({
        status: 'revealed',
        value,
        revealedAt: Date.now(),
        sessionPersist: false,
      });
    } catch (error) {
      setState(prev => ({ ...prev, status: 'hidden' }));
      throw error;
    }
  };

  const hide = () => {
    setState({ status: 'hidden', sessionPersist: false });
  };

  const keepForSession = () => {
    setState(prev => ({ ...prev, sessionPersist: true }));
  };

  return { ...state, reveal, hide, keepForSession };
}
```

### 5.6 Tick/Price Utilities

```typescript
// lib/ticks.ts

// Uniswap v3/v4 tick math
const LOG_BASE = Math.log(1.0001);

/**
 * Convert a human-readable price to a Uniswap tick
 * @param price - Price of token1 in terms of token0 (e.g., 2450 USDC per ETH)
 * @param token0Decimals - Decimals of token0
 * @param token1Decimals - Decimals of token1
 */
export function priceToTick(
  price: number,
  token0Decimals: number = 18,
  token1Decimals: number = 18
): number {
  // Adjust for decimal differences
  const adjustedPrice = price * Math.pow(10, token0Decimals - token1Decimals);
  return Math.floor(Math.log(adjustedPrice) / LOG_BASE);
}

/**
 * Convert a Uniswap tick to a human-readable price
 */
export function tickToPrice(
  tick: number,
  token0Decimals: number = 18,
  token1Decimals: number = 18
): number {
  const rawPrice = Math.pow(1.0001, tick);
  return rawPrice * Math.pow(10, token1Decimals - token0Decimals);
}

/**
 * Get the nearest usable tick (respecting tick spacing)
 * @param tick - Raw tick value
 * @param tickSpacing - Pool's tick spacing (e.g., 60 for 0.3% fee tier)
 */
export function nearestUsableTick(tick: number, tickSpacing: number): number {
  return Math.round(tick / tickSpacing) * tickSpacing;
}

/**
 * Calculate price from reserves
 */
export function priceFromReserves(
  reserve0: bigint,
  reserve1: bigint,
  token0Decimals: number = 18,
  token1Decimals: number = 18
): number {
  const adjusted0 = Number(reserve0) / Math.pow(10, token0Decimals);
  const adjusted1 = Number(reserve1) / Math.pow(10, token1Decimals);
  return adjusted1 / adjusted0;
}

/**
 * Validate trigger tick for order type
 */
export function validateTriggerTick(
  orderType: 'limit-buy' | 'limit-sell' | 'stop-loss' | 'take-profit',
  triggerTick: number,
  currentTick: number
): { valid: boolean; error?: string } {
  switch (orderType) {
    case 'limit-buy':
      // Buy orders trigger on price rise (oneForZero)
      // Trigger tick should be... depends on implementation
      return { valid: true };
    case 'limit-sell':
    case 'stop-loss':
    case 'take-profit':
      // Sell orders trigger on price fall (zeroForOne)
      return { valid: true };
    default:
      return { valid: false, error: 'Unknown order type' };
  }
}
```

### 5.7 Event Indexing

For analytics and order history, index contract events:

```typescript
// Events to index
const EVENTS = {
  Deposit: 'Deposit(address indexed user, bool isToken0, uint256 amount)',
  Withdraw: 'Withdraw(address indexed user, bool isToken0, uint256 amount)',
  OrderPlaced: 'OrderPlaced(uint256 indexed orderId, address indexed owner, int24 triggerTick)',
  OrderCancelled: 'OrderCancelled(uint256 indexed orderId, address indexed owner)',
  OrderFilled: 'OrderFilled(uint256 indexed orderId, address indexed owner, address indexed executor)',
};

// Options for indexing:
// 1. The Graph subgraph (recommended for production)
// 2. Direct RPC event fetching (simpler, works for testnet)
// 3. Custom indexer service
```

---

## 6. Responsive Design

### 6.1 Breakpoints

| Name | Width | Target |
|------|-------|--------|
| sm | 640px | Mobile |
| md | 768px | Tablet |
| lg | 1024px | Desktop |
| xl | 1280px | Large Desktop |
| 2xl | 1536px | Ultra-wide |

### 6.2 Layout Adaptations

**Desktop (lg+)**
- Full sidebar navigation
- Multi-column layouts
- Expanded charts and tables

**Tablet (md)**
- Collapsible sidebar
- Single column with wider cards
- Simplified charts

**Mobile (sm)**
- Bottom navigation bar
- Full-width cards
- Stacked form layouts
- Swipe gestures for tabs
- Order type tabs become scrollable

---

## 7. Accessibility

### 7.1 Requirements

- WCAG 2.1 AA compliance
- Keyboard navigation for all interactive elements
- Screen reader support with ARIA labels
- Color contrast ratio minimum 4.5:1
- Focus indicators on all interactive elements
- Skip navigation link

### 7.2 Implementation Notes

- Use semantic HTML elements
- Add `aria-label` to icon-only buttons
- Implement focus trap in modals
- Announce dynamic content changes with `aria-live`
- Test with screen readers (NVDA, VoiceOver)
- Encrypted balance fields should announce "Balance hidden" or actual value when revealed

---

## 8. Error Handling

### 8.1 Error States

**Wallet Not Connected**
- Message: "Connect your wallet to continue"
- Action: Show Connect Wallet button

**No PheatherX Balance**
- Message: "Deposit tokens to start trading privately"
- Action: Link to deposit modal

**Insufficient Balance**
- Message: "Insufficient balance. You need X more [TOKEN]."
- Action: Link to deposit

**Insufficient ETH for Protocol Fee**
- Message: "You need 0.001 ETH to place an order"
- Action: Show wallet ETH balance

**Transaction Failed**
- Message: "Transaction failed: [reason]"
- Action: Retry button, link to explorer

**Network Mismatch**
- Message: "Please switch to [Network Name]"
- Action: Switch Network button

**Slippage Exceeded (Swap)**
- Message: "Price moved too much. Adjust slippage or try again."
- Action: Open slippage settings

**Slippage Failed (Order)**
- Message: "Order triggered but couldn't fill at acceptable price. Your tokens have been returned."
- Action: Link to place new order

**FHE Decryption Failed**
- Message: "Unable to decrypt balance. Please try again."
- Action: Retry button

**FHE Decryption Timeout**
- Message: "Decryption is taking longer than expected. This can happen during high network activity."
- Action: Keep waiting or cancel

### 8.2 Loading States

- Skeleton loaders for data-dependent UI
- Spinner for transaction pending
- Progress indicator for multi-step flows (deposit: approve → deposit)
- FHE decryption progress bar with estimated time
- Optimistic updates where safe

### 8.3 Notifications

**Order Fill Notification:**
When listening for `OrderFilled` events:
```typescript
contract.on('OrderFilled', (orderId, owner, executor) => {
  if (owner === connectedAddress) {
    showNotification({
      type: 'success',
      title: 'Order Filled!',
      message: `Your order #${orderId} was executed.`,
      action: { label: 'View Details', href: `/orders/history` },
    });
    refetchOrders();
    refetchBalances();
  }
});
```

---

## Appendix A: Contract Reference

### Key Functions

```solidity
// Deposit tokens into hook
function deposit(bool isToken0, uint256 amount) external;

// Withdraw tokens from hook
function withdraw(bool isToken0, uint256 amount) external;

// Place encrypted limit order
// Note: direction, amount, minOutput are already-encrypted values
function placeOrder(
    int24 triggerTick,
    ebool direction,      // true = zeroForOne (sell token0)
    euint128 amount,
    euint128 minOutput
) external payable returns (uint256 orderId);

// Cancel active order (funds returned to PheatherX balance)
function cancelOrder(uint256 orderId) external;

// Get public reserves (display cache, may lag slightly)
function getReserves() external view returns (uint256, uint256);

// Get user's active order IDs
function getActiveOrders(address user) external view returns (uint256[] memory);

// Get count of user's active orders
function getOrderCount(address user) external view returns (uint256);

// Check if a tick has any orders
function hasOrdersAtTick(int24 tick) external view returns (bool);

// Get encrypted balances
function getUserBalanceToken0(address user) external view returns (euint128);
function getUserBalanceToken1(address user) external view returns (euint128);

// Force sync public reserves (anyone can call)
function forceSyncReserves() external;

// Admin functions (owner only)
function withdrawProtocolFees(address payable recipient) external;
function emergencyTokenRecovery(address token, address to, uint256 amount) external;
```

### Constants

```solidity
PROTOCOL_FEE = 0.001 ether  // Fee for placing orders (paid in ETH)
EXECUTOR_REWARD_BPS = 100   // 1% executor reward (deducted from fill output)
```

### Events

```solidity
event Deposit(address indexed user, bool isToken0, uint256 amount);
event Withdraw(address indexed user, bool isToken0, uint256 amount);
event OrderPlaced(uint256 indexed orderId, address indexed owner, int24 triggerTick);
event OrderCancelled(uint256 indexed orderId, address indexed owner);
event OrderFilled(uint256 indexed orderId, address indexed owner, address indexed executor);
```

### Notes

1. **Order IDs are 1-indexed** — First order has ID 1, not 0
2. **Protocol fee is in ETH** — Not the order token
3. **Cancellation returns funds to hook balance** — Not wallet; user must withdraw separately
4. **Slippage failure returns funds** — Order consumed but tokens returned to hook balance
5. **Executor reward is 1%** — Deducted from order output, not additional charge

---

## Appendix B: Changelog from v1

### Added
- Section 1.5: Core Concept explaining deposit-first trading model
- "No Deposit State" UI for swap page
- Order mechanics technical section explaining trigger direction logic
- FHE `allow()` step in transaction flows
- Balance reveal flow with loading states
- "In Orders" balance breakdown in portfolio
- Slippage failed status in order history
- Cancel confirmation modal clarifying funds return to hook balance
- Price staleness indicators throughout
- `getOrderCount()` and `hasOrdersAtTick()` contract functions
- Event indexing section
- Tick/price utility functions
- Notification system for order fills
- Network-specific FHE support indicator

### Changed
- Order type table now includes direction and trigger mechanics
- Protocol fee clarified as ETH payment, non-refundable
- Executor reward explanation added to order history
- Reserve/price displays note potential staleness
- Admin functions documented in contract reference

### Removed
- Nothing removed, only additions and clarifications

---

*End of Specification Document*
