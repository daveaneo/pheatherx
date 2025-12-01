# PheatherX Web Application Specification

**Version:** 1.0
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

| Network | Chain ID | Purpose |
|---------|----------|---------|
| Local (Anvil) | 31337 | Development & testing |
| Base Sepolia | 84532 | Hookathon demo deployment |
| Fhenix Testnet | TBD | Production FHE testing |

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
   - Step 1: Connect wallet & deposit
   - Step 2: Execute encrypted trades
   - Step 3: Manage orders privately

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
│  └─────────────────────────────┘   │
│                                     │
│           [↓ Swap Arrow]            │
│                                     │
│  To                                 │
│  ┌─────────────────────────────┐   │
│  │ [Token Selector] │ [Amount] │   │
│  │ Balance: ••••••              │   │
│  └─────────────────────────────┘   │
│                                     │
│  ─────────────────────────────────  │
│  Rate: 1 ETH = 2,450.32 USDC       │
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
   - User token balances displayed
   - Token logos and symbols

2. **Amount Input**
   - Numeric input with decimal support
   - "MAX" button fills available balance
   - Real-time USD value estimate
   - Encrypted balance display (••••••)
   - "Reveal" button to decrypt balance

3. **Swap Details Panel**
   - Exchange rate (from reserves)
   - Price impact calculation
   - Minimum received (after slippage)
   - Network fee estimate

4. **Slippage Settings Modal**
   - Preset buttons: 0.1%, 0.5%, 1.0%
   - Custom input field
   - Warning for high slippage (>2%)

5. **Transaction Flow**
   - Step 1: Encrypt parameters (cofhejs)
   - Step 2: Sign transaction
   - Step 3: Confirm on-chain
   - Step 4: Show success/failure

**States:**
- Default (no wallet)
- Connected (ready to swap)
- Insufficient balance
- Loading (fetching rates)
- Confirming (wallet prompt)
- Pending (tx submitted)
- Success (with tx link)
- Error (with retry option)

---

### 3.3 Limit Orders (`/orders`)

**Purpose:** Create and manage encrypted limit orders.

#### 3.3.1 Order Types Explained

PheatherX supports 4 order types, all using the same underlying contract function:
```solidity
placeOrder(int24 triggerTick, ebool direction, euint128 amount, euint128 minOutput)
```

| Order Type | When to Use | Direction | Trigger Condition |
|------------|-------------|-----------|-------------------|
| **Limit Buy** | Buy at a better (lower) price | Buy token | Price falls to target |
| **Limit Sell** | Sell at a better (higher) price | Sell token | Price rises to target |
| **Stop-Loss** | Protect against downside | Sell token | Price falls to trigger |
| **Take-Profit** | Lock in gains | Sell token | Price rises to target |

#### 3.3.2 New Order Form (`/orders/new`)

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
│  │ ≈ 3,450.00 USDC                             │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  Slippage Tolerance                                 │
│  ┌─────────────────────────────────────────────┐   │
│  │ [0.5%] [1.0%] [2.0%] [Custom: _____ ]       │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ─────────────────────────────────────────────────  │
│  Protocol Fee: 0.001 ETH                           │
│  Min. Output: 1.485 ETH (after slippage)           │
│  ─────────────────────────────────────────────────  │
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
```

#### 3.3.3 Active Orders (`/orders/active`)

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
│  │ Amount: •••••• ETH        Trigger: $2,300.00                │ │
│  │ Current: $2,450.32        Distance: -6.1%                   │ │
│  │ Created: 2 hours ago      Status: ⏳ Waiting                 │ │
│  │ ──────────────────────────────────────────────────────────── │ │
│  │                                              [Cancel Order]  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ STOP-LOSS  •  ETH/USDC                           ID: #1231   │ │
│  │ ──────────────────────────────────────────────────────────── │ │
│  │ Amount: •••••• ETH        Trigger: $1,800.00                │ │
│  │ Current: $2,450.32        Distance: -26.5%                  │ │
│  │ Created: 1 day ago        Status: ⏳ Waiting                 │ │
│  │ ──────────────────────────────────────────────────────────── │ │
│  │                                              [Cancel Order]  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  No more active orders.                                           │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

**Order Card Details:**
- Order type badge (color-coded)
- Token pair
- Order ID
- Encrypted amount (with reveal option)
- Trigger price
- Current market price
- Distance to trigger (%)
- Creation timestamp
- Status: Waiting, Near Trigger (within 5%), Triggered
- Cancel button

**Cancel Flow:**
1. Click "Cancel Order"
2. Confirmation modal: "Cancel this order? Funds will be returned to your balance."
3. Sign transaction
4. Success: "Order cancelled. Funds returned."

#### 3.3.4 Order History (`/orders/history`)

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
│  │ Sold: 2.0 ETH             Received: 5,200.45 USDC           │ │
│  │ Trigger: $2,600.00        Fill Price: $2,600.23             │ │
│  │ Created: 3 days ago       Filled: 1 day ago                 │ │
│  │ ──────────────────────────────────────────────────────────── │ │
│  │                                              [View on Block] │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ ✗ CANCELLED  •  LIMIT BUY  •  ETH/USDC           ID: #1228   │ │
│  │ ──────────────────────────────────────────────────────────── │ │
│  │ Amount: 1.0 ETH           Trigger: $2,200.00                │ │
│  │ Created: 5 days ago       Cancelled: 4 days ago             │ │
│  │ ──────────────────────────────────────────────────────────── │ │
│  │                                              [View on Block] │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

**Status Types:**
- ✓ Filled (green)
- ✗ Cancelled (gray)
- ⚠️ Failed (red) — slippage exceeded

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
│  │  Balance: ••••••            [Reveal]                         │ │
│  │  ──────────────────────────────────────────────────────────  │ │
│  │  [Deposit]  [Withdraw]                                       │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  [USDC Logo]  USD Coin                                       │ │
│  │  Balance: ••••••            [Reveal]                         │ │
│  │  ──────────────────────────────────────────────────────────  │ │
│  │  [Deposit]  [Withdraw]                                       │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  RECENT ACTIVITY                                                   │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  ↓ Deposit     2.0 ETH       2 hours ago      [View Tx]     │ │
│  │  ↔ Swap        1.0 ETH → USDC    5 hours ago  [View Tx]     │ │
│  │  ↑ Withdraw    500 USDC      1 day ago        [View Tx]     │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

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
│  ⚠️ Deposited funds are held in    │
│  the PheatherX hook contract.      │
│  You can withdraw anytime.         │
│                                     │
│  [Step 1: Approve]  [Step 2: Deposit] │
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
│  └─────────────────────────────┘   │
│                                     │
│  Destination: Your connected wallet │
│  0x1234...5678                      │
│                                     │
│  [        WITHDRAW        ]         │
│                                     │
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
- 24H/7D/30D Volume (from events)
- Total orders placed
- Price chart (from reserve ratio over time)
- User's personal statistics

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
| Deep Magenta | `#D6246E` | Warm accents |
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
│   │   └── ...
│   ├── lib/
│   │   ├── contracts/          # Contract ABIs and addresses
│   │   ├── chains.ts           # Network configuration
│   │   ├── utils.ts            # Utility functions
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

export function usePlaceOrder() {
  const { writeContract } = useWriteContract();

  return async (
    triggerTick: number,
    direction: EncryptedBool,
    amount: EncryptedUint128,
    minOutput: EncryptedUint128
  ) => {
    await writeContract({
      address: PHEATHERX_ADDRESSES[chainId],
      abi: PHEATHERX_ABI,
      functionName: 'placeOrder',
      args: [triggerTick, direction, amount, minOutput],
      value: PROTOCOL_FEE,
    });
  };
}
```

### 5.5 FHE Integration

```typescript
// hooks/useEncrypt.ts
import { FhenixClient } from 'cofhejs';

export function useEncrypt() {
  const fhenixClient = useMemo(() => new FhenixClient({ provider }), [provider]);

  const encryptBool = async (value: boolean) => {
    return fhenixClient.encrypt.bool(value);
  };

  const encryptUint128 = async (value: bigint) => {
    return fhenixClient.encrypt.uint128(value);
  };

  const decrypt = async (encrypted: EncryptedValue) => {
    return fhenixClient.decrypt(encrypted);
  };

  return { encryptBool, encryptUint128, decrypt };
}
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

---

## 8. Error Handling

### 8.1 Error States

**Wallet Not Connected**
- Message: "Connect your wallet to continue"
- Action: Show Connect Wallet button

**Insufficient Balance**
- Message: "Insufficient balance. You need X more [TOKEN]."
- Action: Link to deposit

**Transaction Failed**
- Message: "Transaction failed: [reason]"
- Action: Retry button, link to explorer

**Network Mismatch**
- Message: "Please switch to [Network Name]"
- Action: Switch Network button

**Slippage Exceeded**
- Message: "Price moved too much. Adjust slippage or try again."
- Action: Open slippage settings

### 8.2 Loading States

- Skeleton loaders for data-dependent UI
- Spinner for transaction pending
- Progress indicator for multi-step flows
- Optimistic updates where safe

---

## Appendix A: Contract Reference

### Key Functions

```solidity
// Deposit tokens into hook
function deposit(bool isToken0, uint256 amount) external;

// Withdraw tokens from hook
function withdraw(bool isToken0, uint256 amount) external;

// Place encrypted limit order
function placeOrder(
    int24 triggerTick,
    ebool direction,      // true = zeroForOne
    euint128 amount,
    euint128 minOutput
) external payable returns (uint256 orderId);

// Cancel active order
function cancelOrder(uint256 orderId) external;

// Get public reserves (for price display)
function getReserves() external returns (uint256, uint256);

// Get user's active orders
function getActiveOrders(address user) external view returns (uint256[] memory);

// Get encrypted balances
function getUserBalanceToken0(address user) external view returns (euint128);
function getUserBalanceToken1(address user) external view returns (euint128);
```

### Constants

```solidity
PROTOCOL_FEE = 0.001 ether  // Fee for placing orders
EXECUTOR_REWARD_BPS = 100   // 1% executor reward
```

---

*End of Specification Document*
