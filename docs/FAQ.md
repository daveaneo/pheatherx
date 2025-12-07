# FheatherX FAQ

## Privacy

### What exactly is encrypted?

All user balances and order amounts are encrypted using FHE (Fully Homomorphic Encryption). This includes:
- Your deposited token balances
- Order sizes when placing limit orders
- Filled proceeds from matched orders
- Liquidity positions in buckets

The only public information is the existence of activity at a price level, not the amounts involved.

### Can validators see my orders?

No. Validators process encrypted data without being able to decrypt it. They can verify that operations are valid (e.g., you have sufficient encrypted balance) but cannot see the actual amounts. This eliminates the possibility of front-running or MEV extraction based on your order size.

### What can others see about my activity?

**Others can see:**
- That you interacted with the FheatherX contract
- The transaction hash and gas costs
- Which price buckets have activity (but not amounts)

**Others cannot see:**
- Your order sizes
- Your token balances
- How much was filled
- Your trading strategy or patterns

### What about the plaintext entry path?

FheatherX offers two paths:

1. **FHERC20 Path (Maximum Privacy)**: All amounts are encrypted end-to-end
2. **Plaintext Path (Compatibility)**: For router/aggregator integration

The plaintext path exposes trade parameters in the mempool (standard MEV risk). Use FHERC20 for full privacy.

---

## Security

### Is FHE secure?

Yes. Fully Homomorphic Encryption is based on well-studied lattice-based cryptography problems that are believed to be secure even against quantum computers. FheatherX uses Fhenix's CoFHE implementation, which has been audited and battle-tested in production environments.

### What if the FHE system is compromised?

FheatherX uses a threshold decryption system where multiple parties must cooperate to decrypt any value. No single party (including the FheatherX team) can unilaterally decrypt user data. Additionally, the underlying ERC20 tokens in the pools remain secure even if FHE were compromised - only the encrypted accounting layer would be affected.

### Are smart contracts audited?

FheatherX contracts inherit security from battle-tested foundations:
- Uniswap v4's PoolManager (extensively audited)
- OpenZeppelin's security primitives (Ownable, Pausable, ReentrancyGuard)
- Fhenix's FHE library (audited by multiple firms)

### What happens if the coprocessor goes down?

If the Fhenix coprocessor network goes down:

**What continues to work:**
- All swaps (plaintext and encrypted paths)
- All liquidity operations (add/remove)
- Placing and canceling limit orders
- Order execution when price crosses triggers

**What stops working:**
- Public reserve cache updates (price estimates may be stale)

The protocol remains fully functional. Only the reserve sync becomes unavailable.

---

## Technical

### How does the bucketed order system work?

Orders are placed at specific price levels called "ticks" (multiples of 60). Each tick has two buckets:
- **SELL bucket**: Orders to sell token0 for token1
- **BUY bucket**: Orders to buy token0 with token1

When a swap moves the price through these ticks, orders in the buckets are matched. All LPs in a bucket share fills proportionally using a proceeds-per-share accumulator model.

### What is an FHE session?

Before performing encrypted operations, you must initialize an FHE session. This creates a secure channel between your browser and the FHE coprocessor, allowing you to:
- Encrypt amounts client-side before submission
- Decrypt your balances when viewing your portfolio
- Authorize operations on your encrypted values

Sessions are tied to your wallet address and the connected chain.

### Why is gas higher than regular DEXs?

FHE operations are computationally intensive. Each encrypted addition, comparison, or transfer requires cryptographic operations that cost more gas than plaintext alternatives. However, this is the cost of privacy - you're paying for the assurance that no one can see your trading activity.

Typical gas costs:
- Deposit: ~500k-800k gas
- Swap: ~200k-400k gas
- Withdraw: ~400k-600k gas

### Can attackers learn information from gas profiling?

No. All encrypted value branching uses `FHE.select()`, which computes both branches and selects the result. The same code path executes regardless of encrypted values, making gas consumption constant and revealing nothing.

### What about limit order existence leakage?

The tick bitmap is public by necessity for efficient order processing. This reveals:
- **What leaks**: Which price levels have orders (not how many, not what type)
- **What doesn't leak**: Order type (buy/sell/limit/stop), amount, owner, direction

This is significantly less information than traditional order books expose.

---

## Usage

### How do I get started?

1. Connect your wallet to a supported network (Ethereum Sepolia, Arbitrum Sepolia)
2. Get test tokens from the Faucet page
3. Click "Initialize FHE Session" to set up encryption
4. Deposit tokens to your encrypted balance
5. Place orders or swap tokens privately

### Why do I need to deposit before trading?

Unlike traditional DEXs where you swap directly from your wallet, FheatherX uses an encrypted balance system. Depositing moves tokens from your wallet into the encrypted accounting layer. This enables:
- Hidden order sizes (you can't hide an amount that's visible in your wallet)
- Efficient order matching without revealing individual positions
- Fair distribution of fills across all participants

### How do I see my encrypted balance?

Go to the Portfolio page and click "Initialize FHE Session" if you haven't already. This establishes a secure connection that allows you to decrypt and view your balances. The decryption happens client-side - your balances are never revealed to the network.

### What's the recommended workflow for maximum privacy?

1. Wrap tokens to FHERC20 once when entering the ecosystem
2. Use encrypted swap functions instead of plaintext
3. Stay in encrypted balances for all trading activity
4. Unwrap only when fully exiting (days/weeks later)
5. Avoid patterns that correlate wrap/unwrap with trades

---

## Attack Vectors Addressed

| Attack | Status | Notes |
|--------|--------|-------|
| Reserve Oracle Manipulation | Protected | Swaps use encrypted reserves, not cached values |
| Statistical Analysis | Use FHERC20 | Plaintext path exposes amounts by design |
| Wrap/Unwrap Timing | Protected | Users stay in encrypted ecosystem |
| Limit Order Existence | Acceptable | Only reveals ticks have orders, not type/amount |
| Gas Profiling | Protected | Constant-time via FHE.select() |
| Slippage Griefing | Use FHERC20 | Standard MEV on plaintext path |
| Coprocessor Failure | Limited Impact | Only reserve sync affected |

---

*For more details, see the [Vision](./VISION.md) document or the security analysis in the old docs.*
