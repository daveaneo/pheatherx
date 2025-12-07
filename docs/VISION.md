# FheatherX Vision

## Trade in Silence

FheatherX is a private decentralized exchange built on Fully Homomorphic Encryption. It allows users to trade tokens on-chain without revealing their trade direction, size, or strategy to anyone - not even the blockchain itself.

## The Problem

Today's decentralized exchanges are transparent by design. Every trade you make is visible to the entire world before it even executes. This transparency creates a hostile environment for traders:

**Front-running**: When you submit a large buy order, bots see it in the mempool and buy ahead of you, driving up the price you pay.

**Sandwich attacks**: Sophisticated actors wrap your transaction between two of their own - buying before you push the price up, then selling after you at the inflated price. You pay more, they pocket the difference.

**Order book sniping**: If you place a limit order or stop-loss, others can see exactly where your orders sit. They can trade against you with perfect information about your positions and intentions.

**Strategy exposure**: Professional traders cannot use on-chain DEXs for serious trading because their strategies become public knowledge the moment they execute.

The result is that DEX users consistently get worse prices than they should. Billions of dollars are extracted from ordinary traders every year through these information asymmetries.

## The Solution

FheatherX encrypts everything. Your trade direction, your trade size, your limit order prices, your stop-loss levels - all encrypted on-chain using Fully Homomorphic Encryption. The smart contract performs all the AMM math on encrypted values. No one - not other traders, not block builders, not even node operators - can see what you're trading.

When you swap tokens on FheatherX, observers see that a swap happened. They cannot tell if you bought or sold. They cannot tell how much. They cannot determine your slippage tolerance or minimum output. Your trade executes in complete privacy.

## How It Works

FheatherX operates as a Uniswap v4 Hook, integrating directly into the world's most battle-tested DEX infrastructure:

### Deposit
Tokens are encrypted and added to your private balance using Fhenix's CoFHE (Coprocessor for Fully Homomorphic Encryption). From this point, your positions are hidden.

### Place Orders
Submit limit orders at specific tick price levels (buckets). Your order amount remains encrypted - others can see that orders exist at a price level, but not how much or in which direction.

### Order Matching
When swaps move the price through your order's tick, the order is filled. The `afterSwap` hook handles matching automatically.

### Fair Distribution
The proceeds-per-share accumulator model ensures all LPs in a bucket receive their fair share of fills proportionally.

### Withdraw
Claim your filled proceeds or withdraw unfilled orders. Amounts remain encrypted throughout.

## The Technology

### Fhenix CoFHE
- **euint128**: 128-bit encrypted unsigned integers for all balances and amounts
- **FHE.allowThis()**: ACL permissions for contract operations on encrypted values
- **Constant-time execution**: All encrypted branching uses `FHE.select()` to prevent timing attacks

### Uniswap v4 Hooks
- **BaseHook**: Native integration with v4's modular architecture
- **afterSwap**: Callback for processing limit orders when price moves
- **afterInitialize**: Set up encrypted pool state

### FHERC20 Tokens
- ERC20 tokens with fully encrypted balances
- Seamless integration with existing DeFi
- Hidden balance accounting

## Security Model

FheatherX is designed to resist sophisticated attacks:

**Probing Attacks**: All execution paths are constant-time. Both branches of every conditional are computed, with the encrypted result selecting the correct output.

**Gas Analysis**: Gas consumption reveals nothing because the same code path executes regardless of encrypted values.

**Balance Inference**: With FHERC20 tokens, even user balances are encrypted. An attacker cannot determine holdings or infer trading activity.

**Order Type Discrimination**: All limit order types (buy/sell, limit/stop) use identical on-chain representations.

## Why This Matters

Privacy in trading is not about hiding wrongdoing. It is about fair markets.

When everyone can see your orders, you are at a fundamental disadvantage against sophisticated actors with faster systems. When your strategy is public, it gets front-run. When your stop-losses are visible, they get hunted.

FheatherX levels the playing field. A retail trader gets the same information protection as an institution. Your trades execute at fair prices because no one can extract value from knowing your intentions.

This is how markets should work.

## Current Status

FheatherX is deployed on Ethereum Sepolia testnet integrated with Fhenix's CoFHE coprocessor. The system demonstrates that practical private trading is possible today. As FHE technology matures and becomes more efficient, FheatherX provides a foundation for the private DeFi future.

---

*Built for Hookathon 2024. Private trading, powered by FHE.*
