# PheatherX Vision

## What Is PheatherX?

PheatherX is a private decentralized exchange built on Fully Homomorphic Encryption. It allows users to trade tokens on-chain without revealing their trade direction, size, or strategy to anyone - not even the blockchain itself.

## The Problem

Today's decentralized exchanges are transparent by design. Every trade you make is visible to the entire world before it even executes. This transparency creates a hostile environment for traders:

**Front-running**: When you submit a large buy order, bots see it in the mempool and buy ahead of you, driving up the price you pay.

**Sandwich attacks**: Sophisticated actors wrap your transaction between two of their own - buying before you push the price up, then selling after you at the inflated price. You pay more, they pocket the difference.

**Order book sniping**: If you place a limit order or stop-loss, others can see exactly where your orders sit. They can trade against you with perfect information about your positions and intentions.

**Strategy exposure**: Professional traders cannot use on-chain DEXs for serious trading because their strategies become public knowledge the moment they execute.

The result is that DEX users consistently get worse prices than they should. Billions of dollars are extracted from ordinary traders every year through these information asymmetries.

## The Solution

PheatherX encrypts everything. Your trade direction, your trade size, your limit order prices, your stop-loss levels - all encrypted on-chain using Fully Homomorphic Encryption. The smart contract performs all the AMM math on encrypted values. No one - not other traders, not block builders, not even node operators - can see what you're trading.

When you swap tokens on PheatherX, observers see that a swap happened. They cannot tell if you bought or sold. They cannot tell how much. They cannot determine your slippage tolerance or minimum output. Your trade executes in complete privacy.

## Two Ways to Trade

PheatherX supports both regular ERC20 tokens and encrypted FHERC20 tokens, giving users flexibility based on their privacy needs:

**Regular Tokens (ERC20)**: Connect your wallet, enter the amount you want to swap, click trade. Your transaction goes through a standard interface compatible with existing DEX aggregators and routers. The moment your tokens enter PheatherX, the trade parameters are encrypted. From that point forward, your trade is private. This path is ideal for users who want privacy protection without changing their workflow.

**Encrypted Tokens (FHERC20)**: For maximum privacy, users can wrap their tokens into FHERC20 format first. These tokens store balances encrypted on-chain - even your token balance is private. When trading with FHERC20 tokens, your entire trade is encrypted end-to-end. The amounts going in and coming out never appear in plaintext. Not even the entry point reveals your intentions.

Both paths execute on the same liquidity pools and benefit from the same privacy protections once inside PheatherX.

## Ecosystem Integration

PheatherX operates as a Uniswap v4 hook, which means it lives within the existing Uniswap ecosystem rather than as an isolated protocol. This design enables powerful integrations:

**Arbitrage Keeps Prices Current**: Other Uniswap pools trading the same token pairs can arbitrage against PheatherX. When our prices drift from market prices, arbitrageurs profit by correcting them. This keeps PheatherX prices aligned with the broader market without requiring users to trust a single price source.

**Router Compatibility**: The plaintext entry path works with existing DEX routers and aggregators. Users can route trades through PheatherX without special tooling. Protocols building on top of Uniswap v4 can integrate PheatherX pools seamlessly.

**Shared Liquidity Benefits**: By building on Uniswap v4's architecture, PheatherX inherits battle-tested AMM mechanics, established security patterns, and the network effects of the largest DEX ecosystem.

## Limit Orders

PheatherX supports four types of limit orders, all with encrypted parameters:

**Buy Limit**: Automatically buy when the price drops to your target. Set it and forget it - no one knows where your order sits.

**Sell Limit**: Take profit automatically when price rises. Your exit strategy stays hidden.

**Buy Stop**: Enter a position when price breaks above a level. Perfect for breakout strategies without broadcasting your intentions.

**Sell Stop**: Protect your positions with stop-losses that others cannot hunt.

All four order types look identical on-chain. An observer cannot tell if you placed a buy or sell, a limit or stop, or at what price. They only know an order exists.

## Security: Attacks We Prevent

Beyond the standard MEV protections, PheatherX is designed to resist sophisticated attacks specific to encrypted systems:

**Probing Attacks**: An attacker might try to learn information by observing how the system responds to different inputs - measuring gas consumption, timing differences, or state changes. PheatherX uses constant-time execution paths. Both branches of every conditional are computed, with the encrypted result selecting the correct output. Gas consumption and execution time reveal nothing about the encrypted values.

**Timing Analysis**: All swap operations complete in predictable time regardless of the trade direction or size. An observer watching transaction execution cannot infer trade parameters from timing patterns.

**Balance Inference**: With FHERC20 tokens, even user balances are encrypted. An attacker cannot determine how much you hold or infer your trading activity by watching balance changes.

**Order Type Discrimination**: All four limit order types use identical on-chain representations. The encrypted boolean flags that determine order behavior are indistinguishable to observers. You cannot tell a stop-loss from a take-profit from a limit buy.

## Synchronous Execution: An Improvement Over Existing Approaches

Previous attempts at private DEXs, such as iceberg order contracts, relied on two-phase commit-reveal schemes: submit an encrypted order in one transaction, reveal and execute in another. This approach has fundamental problems:

**Grief Attacks**: An attacker can submit the first transaction and never submit the second, locking up user funds or pool state until timeout periods expire.

**MEV Windows**: The gap between commit and reveal creates opportunities for manipulation. Sophisticated actors can analyze patterns across the two phases.

**User Experience**: Users must wait for multiple transactions and confirmations, adding complexity and potential for errors.

PheatherX executes everything synchronously in a single transaction. You submit a swap, it executes, you receive your tokens - all atomically. There is no window for grief attacks, no multi-step process to manage, no reveal phase that could be front-run. The FHE coprocessor handles encrypted computation without requiring user interaction between steps.

## The One Tradeoff: Price Freshness

PheatherX maintains two representations of pool reserves: the encrypted reserves (the source of truth) and a public cache used for price estimation.

The encrypted reserves update synchronously with every trade. The public cache updates asynchronously - there is a brief period after trades where the cached prices may be slightly stale.

This creates a tradeoff:

**What Can Happen**: If you trade immediately after a large trade by someone else, the price estimate shown to you might be slightly off from the actual execution price.

**What Cannot Happen**: This is not exploitable for grief attacks. Trades always execute against the accurate encrypted reserves. If the estimated price differs too much from actual execution, your slippage protection triggers and the trade reverts. You can simply retry with updated slippage tolerance.

**Why This Is Acceptable**: The staleness is brief - typically resolved within a few blocks. The failure mode is benign - your trade reverts and you try again rather than losing funds. And the alternative (revealing reserve values in real-time) would destroy the privacy guarantees that make PheatherX valuable.

## Why This Matters

Privacy in trading is not about hiding wrongdoing. It is about fair markets.

When everyone can see your orders, you are at a fundamental disadvantage against sophisticated actors with faster systems. When your strategy is public, it gets front-run. When your stop-losses are visible, they get hunted.

PheatherX levels the playing field. A retail trader gets the same information protection as an institution. Your trades execute at fair prices because no one can extract value from knowing your intentions.

This is how markets should work.

## The Technology

PheatherX is built on Fhenix's CoFHE (Coprocessor for Fully Homomorphic Encryption) system. This allows smart contracts to perform computations on encrypted data without ever decrypting it. The AMM formula, the limit order logic, the balance updates - all happen on encrypted values.

The underlying Uniswap v4 hook architecture provides battle-tested AMM mechanics. PheatherX adds a privacy layer on top, inheriting the security and efficiency of Uniswap while eliminating information leakage.

## Current Status

PheatherX v2 implements single-transaction swaps with both plaintext and encrypted entry paths, four encrypted limit order types, and FHERC20 token support. It is deployed on Ethereum Sepolia testnet integrated with Fhenix's CoFHE coprocessor.

The system demonstrates that practical private trading is possible today. As FHE technology matures and becomes more efficient, PheatherX provides a foundation for the private DeFi future.
