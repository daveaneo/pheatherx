# PheatherX v2 Black Hat Security Review

## Attacks Worth Investigating

### 1. Reserve Oracle Manipulation
The public reserve cache is your weak point. You say arbitrageurs keep prices current, but what if I *am* the arbitrageur? I could:
- Make a large trade on PheatherX
- The encrypted reserves update, but public cache is stale
- Immediately arbitrage against an external pool at the "old" price
- Profit from the lag window before the cache syncs

The question is: does the encrypted swap execute at the *real* price or the *cached* price? If real, I lose nothing. If cached, there's an exploit.

**Status:** NOT EXPLOITABLE

**Analysis:** All swap math executes on encrypted reserves, which are always accurate. The public reserve cache is only used for display/estimation purposes. When the cache is stale:
- The encrypted swap math still computes the correct output
- If the user's slippage tolerance was based on stale estimates, the transaction may revert
- No value extraction is possible - attacker gets exactly what the encrypted math allocates
- Worst case: transaction reverts, user retries with updated slippage

The attack premise assumed swaps execute at cached prices. They don't - they execute at real encrypted prices. Stale cache causes failed transactions, not exploitable arbitrage.

---

### 2. Statistical Analysis Over Time
You claim probing resistance, but I'd watch the pool over thousands of transactions:
- Total value locked changes are visible (token balances of the contract)
- If I track contract balance deltas per transaction, I learn trade *sizes* even if not direction
- Correlating with external market movements might reveal patterns

**Status:** KNOWN LIMITATION - BY DESIGN

**Analysis:** This attack only applies to the plaintext ERC20 path. For plaintext swaps:
- Input amount is visible in the `transferFrom` call
- Output amount is visible in the `transfer` call
- Trade direction can be inferred from which token goes in/out

This is an intentional tradeoff. The plaintext path exists for router compatibility and convenience. Users who require full privacy should use the FHERC20 path, where:
- All transfers use encrypted amounts
- Contract balances are encrypted
- No statistical analysis possible from balance deltas

The attack does not affect users who use the protocol with encrypted data.

---

### 3. FHERC20 Wrap/Unwrap Timing
When users wrap ERC20 → FHERC20 or unwrap, that's a plaintext operation. I'd watch:
- Who wraps tokens before PheatherX activity
- Who unwraps after
- Build a deanonymization graph of likely traders

**Status:** NOT A REAL ATTACK VECTOR

**Analysis:** The attack premise is flawed. It assumes users wrap → trade → unwrap → wrap → trade → unwrap. This is not how the protocol is designed to be used.

**Actual user flow:**
1. Wrap ERC20 → FHERC20 (one time)
2. Trade on PheatherX - receive FHERC20 output tokens
3. Trade again - balances update in FHERC20
4. Continue trading indefinitely with FHERC20 balances
5. Unwrap only when exiting the ecosystem entirely (days/weeks/months later)

**Why the attack fails:**
- Users have no reason to unwrap between trades
- Swap outputs are FHERC20 tokens, not ERC20
- A user's encrypted balance persists across all trading activity
- The wrap and unwrap events are separated by arbitrary time periods
- No timing correlation possible when wrap→unwrap gap is days or weeks

The attacker can see "User A entered the encrypted ecosystem" and later "User A left the encrypted ecosystem" but learns nothing about what happened in between.

---

### 4. Limit Order Existence Leakage
You say I can't tell order *type*, but I know orders *exist* at certain ticks (the bitmap is public, right?). I could:
- See clusters of orders at round numbers ($2000, $1900, etc.)
- Manipulate price to trigger those ticks and watch what happens
- The *outcome* of triggering reveals information about the orders

**Status:** PARTIAL LEAKAGE - ACCEPTABLE TRADEOFF

**Analysis:** The tick bitmap is public by necessity - we need O(1) lookup of which ticks have orders for efficient order processing. This reveals:
- **What leaks:** Which price levels have orders (not how many, not what type)
- **What doesn't leak:** Order type (buy/sell/limit/stop), amount, owner, direction

**What an attacker can do:**
1. See that "some orders exist at tick X"
2. Manipulate price to cross tick X
3. Observe that orders triggered

**What an attacker cannot learn from triggering:**
- Whether orders were buys or sells (all 4 types use identical execution paths)
- Order amounts (encrypted)
- Who placed the orders (unless they watch FHERC20 transfers, which are encrypted)

**Why this is acceptable:**
- Traditional order books expose ALL order info (price, size, side)
- PheatherX only exposes that orders exist at certain prices
- An attacker knows "there's activity at $2000" but not "there's $1M of stop-losses at $2000"
- This is massively less information than centralized exchanges or on-chain limit order books

**Mitigation consideration:** Could obscure the bitmap by adding dummy ticks, but this adds gas cost and complexity. The current leakage is minimal and acceptable.

---

### 5. Gas Profiling
"Constant-time execution" is a claim. I'd verify it:
- Submit identical-looking transactions with different encrypted values
- Measure gas used precisely
- FHE operations on different values might have subtle gas differences
- CoFHE coprocessor calls might leak timing information

**Status:** VERIFIED - CONSTANT GAS ON OUR SIDE

**Analysis:** We audited all `if` statements in PheatherXv2.sol. Every conditional branches on **plaintext values only**:
- Input validation (amountIn == 0, msg.value checks)
- Order state (order.active, order.owner)
- Pool state (reserve0 == 0, totalLpSupply)
- Tick/bitmap lookups (hasOrdersAtTick, currentTick)

**All encrypted value branching uses `FHE.select()`:**
- Trade direction: `FHE.select(dir, amt, ENC_ZERO)`
- Order type (isSell): `FHE.select(order.isSell, ...)`
- Trigger condition: `FHE.select(order.triggerAbove, ...)`
- Slippage check: `FHE.select(slippageOk, amountOut, ENC_ZERO)`
- Refunds: `FHE.select(slippageFailed, order.amount, ENC_ZERO)`

**Solidity gas is constant** because:
- Same code path executes regardless of encrypted values
- Both branches of FHE.select() are always computed
- No early returns or skipped operations based on encrypted state

**Remaining dependency:** CoFHE coprocessor must also provide constant-time FHE operations. This is stated as a design goal of CoFHE. Assuming CoFHE implements constant-time FHE (which is standard for FHE libraries), gas profiling reveals nothing.

---

### 6. Grief via Slippage Boundary
You say failed trades just revert. But what if I:
- Watch for large pending swaps in mempool (plaintext path reveals amount)
- Front-run with a trade that moves price *just* past their slippage
- Their trade reverts, mine succeeds
- This isn't stopped by encryption if entry is plaintext

**Status:** KNOWN LIMITATION - PLAINTEXT PATH ONLY

**Analysis:** This attack only works against the plaintext ERC20 path where `swap(zeroForOne, amountIn, minAmountOut)` is visible in the mempool. The attacker can:
1. See the trade direction, amount, and slippage tolerance
2. Front-run to move price past the victim's slippage
3. Victim's trade reverts, attacker profits

**Why this is not a PheatherX-specific vulnerability:**
- This is standard MEV that exists on ALL DEXs (Uniswap, Sushiswap, etc.)
- The victim loses only gas fees, not funds
- This is exactly why the encrypted path exists

**Mitigations:**
- Use the FHERC20 path - attacker cannot see amount or direction
- Use private mempools (Flashbots Protect, MEV Blocker, etc.)
- The plaintext path is a convenience feature with known tradeoffs

The encrypted path is completely immune to this attack.

---

### 7. Coprocessor Trust
The CoFHE coprocessor is doing the actual FHE computation. Questions:
- Who runs it?
- Can they see decrypted values?
- Is it a single point of failure/trust?
- What happens if coprocessor is compromised or goes offline?

**Status:** ANALYZED - LIMITED IMPACT

**Understanding CoFHE Architecture:**

CoFHE operations fall into two categories:

**Synchronous Operations (on-chain, always available):**
These execute within the EVM transaction via the on-chain TaskManager contract. They return immediately and do not depend on external infrastructure.

| Function | Purpose |
|----------|---------|
| `FHE.asEuint128()` | Convert plaintext to encrypted value |
| `FHE.asEbool()` | Convert plaintext bool to encrypted bool |
| `FHE.add()` | Add two encrypted values |
| `FHE.sub()` | Subtract encrypted values |
| `FHE.mul()` | Multiply encrypted values |
| `FHE.div()` | Divide encrypted values |
| `FHE.select()` | Conditional select (if-then-else on encrypted) |
| `FHE.gte()` | Greater-than-or-equal comparison |
| `FHE.gt()` | Greater-than comparison |
| `FHE.and()` | Logical AND on encrypted bools |
| `FHE.not()` | Logical NOT on encrypted bool |
| `FHE.allow()` | Grant access permission to address |
| `FHE.allowThis()` | Grant access to current contract |

**Asynchronous Operations (require off-chain coprocessor):**
These create tasks that are processed by the off-chain threshold network. Results must be retrieved later.

| Function | Purpose |
|----------|---------|
| `FHE.decrypt()` | Request decryption of encrypted value |
| `FHE.getDecryptResult()` | Retrieve completed decryption result |
| `FHE.getDecryptResultSafe()` | Retrieve result with ready flag |

**PheatherX Functions and Their FHE Dependencies:**

| Function | Sync FHE | Async FHE | Works if coprocessor down? |
|----------|----------|-----------|---------------------------|
| `swap()` | Yes | No | YES |
| `swapEncrypted()` | Yes | No | YES |
| `addLiquidity()` | Yes | No | YES |
| `removeLiquidity()` | Yes | No | YES |
| `addLiquidityEncrypted()` | Yes | No | YES |
| `removeLiquidityEncrypted()` | Yes | No | YES |
| `placeOrder()` | Yes | No | YES |
| `cancelOrder()` | Yes | No | YES |
| `executeOrders()` | Yes | No | YES |
| `_requestReserveSync()` | No | Yes (decrypt) | NO - but non-critical |
| `_trySyncReserves()` | No | Yes (getResult) | NO - but non-critical |

**Impact of Coprocessor Failure:**

If the Fhenix coprocessor network goes down:

**What continues to work:**
- All swaps (plaintext and encrypted paths)
- All liquidity operations (add/remove)
- Placing and canceling limit orders
- Order execution when price crosses triggers
- All encrypted balance transfers

**What stops working:**
- `_requestReserveSync()` - the async reserve cache update
- Public reserve values (`reserve0`, `reserve1`) become stale

**Practical Impact:**
- The protocol remains fully functional for trading
- Users can still swap, add/remove liquidity, manage orders
- The only effect is the public reserve cache doesn't update
- This means price estimates for plaintext swaps may be slightly off
- Slippage protection still works (reverts if estimate too far from reality)
- Encrypted path users are completely unaffected

**Conclusion:** Coprocessor failure degrades UX slightly (stale price estimates) but does not lock funds or prevent any core operations. All user funds remain accessible and tradeable.

---

### 8. Liquidity Provider Inference
LPs add/remove liquidity. Even with encrypted amounts:
- LP token minting/burning is likely visible
- Large LP position changes correlate with market views
- I can infer whale LP behavior over time

**Status:** PARTIAL LEAKAGE - TWO PATHS WITH DIFFERENT PRIVACY LEVELS

**Analysis:** PheatherX offers two LP paths with different privacy characteristics:

**Plaintext Path (`addLiquidity`, `removeLiquidity`):**
- LP balances are stored in plaintext: `mapping(address => uint256) public lpBalances`
- `totalLpSupply` is public
- Events emit exact amounts: `emit LiquidityAdded(msg.sender, amount0, amount1, lpAmount)`
- **Full visibility:** Anyone can see who added/removed liquidity, how much, and when

**Encrypted Path (`addLiquidityEncrypted`, `removeLiquidityEncrypted`):**
- Uses FHERC20 transfers with encrypted amounts
- LP tokens returned as `euint128` (encrypted)
- **No amount visibility** from transaction data
- However: The current implementation has a limitation - encrypted LP is simplified and doesn't track proportional ownership properly

**What an attacker can learn (plaintext path):**
- Exact LP positions of all addresses
- Timing of add/remove liquidity events
- Correlation with market movements ("Alice added liquidity before the price dump")
- Whale LP behavior patterns

**What an attacker cannot learn (encrypted path):**
- Amount of liquidity added/removed
- Proportional share of the pool
- Whether user is adding or removing (both paths execute similar code)

**Practical Impact:**
The plaintext LP path exists for:
1. Compatibility with LP management tools and dashboards
2. Users who want visible LP positions (for reputation, proof of participation)
3. Initial liquidity bootstrapping where visibility is desired

**Recommendation for privacy-conscious LPs:**
- Use `addLiquidityEncrypted()` / `removeLiquidityEncrypted()`
- Keep FHERC20 tokens wrapped between LP operations
- Don't unwrap LP rewards between operations

**Implementation Note:**
The encrypted LP math is currently simplified (returns `amt0 + amt1` as LP tokens). A production system would need proper encrypted proportional LP calculation, which is non-trivial with FHE but possible.

---

## What We Claim Is Protected

- Direct trade parameter extraction (if FHE is sound)
- Distinguishing order types (if constant-time is real)
- Grief attacks on synchronous operations (no commit-reveal window)

---

## Summary Assessment

### Attack Vector Summary Table

| # | Attack | Status | Impact |
|---|--------|--------|--------|
| 1 | Reserve Oracle Manipulation | NOT EXPLOITABLE | Swaps use encrypted reserves, not cached values |
| 2 | Statistical Analysis Over Time | KNOWN LIMITATION | Plaintext path only; use FHERC20 for privacy |
| 3 | FHERC20 Wrap/Unwrap Timing | NOT A REAL ATTACK | Users stay in encrypted ecosystem |
| 4 | Limit Order Existence Leakage | ACCEPTABLE TRADEOFF | Only reveals ticks have orders, not type/amount |
| 5 | Gas Profiling | VERIFIED - CONSTANT GAS | All encrypted branches use FHE.select() |
| 6 | Grief via Slippage Boundary | KNOWN LIMITATION | Standard MEV, plaintext path only |
| 7 | Coprocessor Trust | LIMITED IMPACT | Only reserve sync is async; trading continues |
| 8 | Liquidity Provider Inference | TWO PATHS | Use encrypted LP path for privacy |

### Key Findings

**The plaintext entry path** is an intentional tradeoff for ecosystem compatibility. Users who require full privacy should use the FHERC20 path. The plaintext path exists for:
- Router/aggregator compatibility
- Arbitrageur price correction
- Users who don't need full privacy

**Reserve sync staleness** (5 blocks cooldown) affects only price estimates, not actual swap execution. Slippage protection prevents losses. This is acceptable because:
- Encrypted reserves are always accurate
- Failed trades revert, not exploit
- Users retry with updated slippage

**The tick bitmap** reveals order existence at price levels but not order type, amount, or direction. This is significantly less information than traditional order books expose.

**Coprocessor dependency** is minimal - only `FHE.decrypt()` requires the off-chain network. If it fails:
- All swaps continue working
- All limit orders continue working
- All liquidity operations continue working
- Only public reserve cache becomes stale

### What PheatherX Successfully Protects

- Trade direction (buy/sell) - encrypted with `ebool`
- Trade amounts - encrypted with `euint128`
- Limit order types - 4 types indistinguishable on-chain
- User balances - encrypted in FHERC20 tokens
- Order execution details - constant-time via `FHE.select()`

### Recommended User Practices for Maximum Privacy

1. Wrap tokens to FHERC20 once when entering the ecosystem
2. Use `swapEncrypted()` instead of `swap()`
3. Use `addLiquidityEncrypted()` / `removeLiquidityEncrypted()` for LP
4. Stay in encrypted balance for all trading activity
5. Unwrap only when fully exiting (days/weeks later)
6. Avoid patterns that correlate wrap/unwrap with trades
