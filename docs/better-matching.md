# FheatherX v6 — Implementation Guide: 1× AMM + Momentum Closure + Bitmap Word Scan (Synchronous)

This guide describes how to upgrade your swap + order matching so that:
- Opposing limits match first (tick-price semantics, no AMM move)
- Same-direction “momentum/trigger” orders execute synchronously without cascades
- The AMM state updates exactly **once** per swap
- Activated momentum buckets are computed via **binary search** over final tick using **division-free** predicates
- Tick scanning uses Uniswap-style **word-level bitmap navigation** (fast) instead of tick-by-tick loops
- Works for plaintext markers (ticks/bitmap) and encrypted amounts (FHE), across ERC/FHE swap modes

---

## 0) Definitions and Core Invariants

### Order Types
- **Limit (maker)**: provides opposing liquidity; fills only when crossed by opposite flow. Fills at the bucket’s tick price semantics (no AMM).
- **Momentum / Trigger (taker-on-trigger)**: activates when price crosses its trigger tick; executes against AMM as taker flow.
  - Important: momentum orders can be large; they are allowed to move the AMM price. That is normal AMM behavior.

### Public vs Encrypted
- **Plaintext markers**: tick indices, initialized-bitmaps, tickSpacing, poolId, direction bit (often).
- **Encrypted values**: order sizes, user amounts (after ERC input is encrypted), reserves in the FHE AMM.

### 1× AMM invariant (critical)
For each swap transaction, the AMM reserve update happens **exactly once**, with total taker input:
- `totalIn = userRemainder + activatedMomentumIn`
Opposing limits are matched *outside* the AMM.

---

## 1) High-Level Pipeline (New Swap Flow)

### Inputs
- direction: `zeroForOne` (or tokenIn/tokenOut)
- amountIn (may be ERC plaintext initially; encrypt early)

### Outputs
- AMM output amounts (encrypted)
- bucket accounting updates for:
  - opposing limit fills
  - activated momentum fills (using “virtual slicing” allocation)
- final AMM encrypted reserves updated once

### Steps
1) **Normalize input**
   - Convert ERC->encrypted as soon as practical so one pipeline handles erc:erc, erc:fhe, fhe:erc, fhe:fhe.
   - Keep plaintext direction/ticks.

2) **Opposing limit matching (no AMM)**
   - Determine tick range crossed by the swap’s *potential* move (see notes; for opposing matching you can:
     - use a conservative scan window, or
     - compute boundary with a first pass ignoring momentum; then refine after closure).
   - Iterate active initialized ticks in that range (bitmap word scan).
   - For each opposing bucket: fill against user amount at tick price semantics, update `filledPerShare / proceedsPerShare`, reduce user remainder.
   - Stop when remainder is 0 or no more opposing liquidity.

3) **Compute activated momentum closure via binary search**
   - Find final tick `t*` such that the set of activated momentum buckets is consistent with the AMM’s end price under:
     - `totalIn = userRemainder + sum(momentumBuckets between t0 and t*)`
   - Use a division-free predicate to test whether `totalIn` pushes the price beyond a candidate tick `tm`.

4) **Execute AMM once**
   - Execute AMM math with `totalIn` and update encrypted reserves once.

5) **Allocate AMM output fairly to momentum buckets via virtual slicing**
   - Do NOT execute per-bucket AMM swaps.
   - Instead, compute each bucket’s “slice” of the total curve using prefix sums (virtual sequential execution), but only apply one final AMM update.
   - Update per-bucket accounting with the computed proceeds.

6) **Finalize transfers/settlement**
   - Handle ERC take/settle/mint/burn logic as you already do, but now driven by the single batched result.

---

## 2) Tick Bitmap: Word-Level Scan (Uniswap-style)

### Goal
Replace “check next 200 ticks linearly” with “scan within 256-bit word using bit tricks”.

### Storage layout
You likely have:
- `mapping(int16 => uint256) tickBitmap;`
Where `wordPos` indexes 256 ticks and `bitPos` selects a tick inside that word.

### IMPORTANT: compressed ticks
Always work with **compressed tick**:
- `compressed = tick / tickSpacing`  (round toward negative infinity!)
Uniswap uses careful math here. Implement a helper:
- `compress(tick) -> int24`
- If `tick < 0` and `tick % tickSpacing != 0`, subtract 1 after division to floor.

Then:
- `wordPos = int16(compressed >> 8)`
- `bitPos  = uint8(uint24(compressed & 255))`

### nextInitializedTickWithinOneWord
Given:
- startTick (compressed), direction (lte or gt)
- Find next set bit within the same word using masking and ctz/clz.

Pseudo:
- `word = tickBitmap[wordPos]`
- if searching to the right (greater):
  - `mask = ~((1 << bitPos) - 1)`  (keep bitPos and above)
  - `masked = word & mask`
  - if masked != 0:
    - `nextBit = ctz(masked)` (index of least significant 1)
    - `nextCompressed = (wordPos << 8) + nextBit`
  - else advance to next wordPos and repeat
- if searching to the left (lte):
  - `mask = (1 << (bitPos + 1)) - 1` (keep bits <= bitPos)
  - `masked = word & mask`
  - if masked != 0:
    - `nextBit = msb(masked)` (index of most significant 1)
    - `nextCompressed = (wordPos << 8) + nextBit`
  - else move to previous wordPos and repeat

You can implement:
- `ctz(x)` via `BitMath.leastSignificantBit(x)`
- `msb(x)` via `BitMath.mostSignificantBit(x)`
(You can copy Uniswap v3/v4 BitMath approach.)

### Complexity
- O(#words jumped), usually tiny.
- Great for both plaintext + encrypted modes because ticks are plaintext.

---

## 3) Momentum Closure: Binary Search Over Final Tick (Encrypted Amounts)

### Problem
Same-direction momentum activates more buckets as price moves, which itself depends on how much momentum flow is included.
We solve via binary search on final tick `t*`.

### Inputs
- start tick `t0` (plaintext)
- direction (plaintext)
- `userRemainderEnc` (encrypted)
- momentum bucket liquidity values `bucketInEnc[tick]` (encrypted)
- optional skip guards (see section 6)

### Output
- `t*` (plaintext)
- activated tick range: `(t0, t*]` (buy-on-rise) or `[t*, t0)` (sell-on-fall)

### Key tool: range sum of encrypted bucket inputs
You need `sumBucketsEnc(t0..tm)`.
Options:
1) **Fenwick / segment tree** over compressed ticks (best asymptotic; updates O(logN)).
2) **Page sums** (coarse blocks) + scan within page (simpler).
3) **Bounded bitmap enumeration** up to K active ticks (works if you cap maximum ticks per swap).

Recommended: Page sums if you already have bitmap; Fenwick if you want max scalability.

### Division-free predicate (avoid FHE.div inside binary search)

Let reserves be encrypted (x0, y0) and k = x0*y0 (encrypted mult only).

BUY exact-in of quote `dy`:
- y1 = y0 + dy
- final price p1 = y1 / x1 = y1^2 / k
Test whether p1 >= p(tm):
- `y1^2 >= k * p(tm)`
Only add/mul/square and multiply-by-plaintext `p(tm)`.

SELL exact-in of base `dx`:
- x1 = x0 + dx
- final price p1 = k / x1^2
Test whether p1 <= p(tm):
- `k <= p(tm) * x1^2`

Notes:
- `p(tm)` is plaintext (tick price). Use `sqrtPriceX96` or fixed-point price.
- Prefer using sqrtPrice form if you have stable constants:
  - compare `p1 >= p(tm)` using squared values to avoid sqrt/div.

### Binary Search
For BUY-on-rise momentum:
- search tm in [t0, tHigh]
For SELL-on-fall:
- search tm in [tLow, t0]

At each step:
1) `momEnc = sumBucketsEnc(range up to tm)`
2) `totalEnc = userRemainderEnc + momEnc`
3) Evaluate predicate “Does totalEnc push beyond tm?”
4) Narrow bounds based on predicate result
Stop after fixed iterations (e.g., 16–24).

Bracketing:
- tHigh/tLow can be derived from:
  - max/min initialized ticks in bitmap within a bounded window, or
  - a configured maxTickMove per swap (recommended safety anyway).

---

## 4) Execute AMM Once (After Closure)

After you compute `t*`:
- activatedRange is fixed (plaintext)
- `momEnc = sumBucketsEnc(activatedRange)`
- `totalEnc = userRemainderEnc + momEnc`

Execute your AMM math once with `totalEnc`:
- update encrypted reserves
- compute total output `outEnc`

Avoid FHE.div here too if possible:
- Use reciprocal approximation (Newton-Raphson) to get `1/(y0+dy)` once,
- then x1 = k * inv(y1)
This pays the “division-like cost” once per swap, not per binary-search step.

---

## 5) Fair Allocation to Momentum Buckets (Virtual Slicing, No Extra AMM Moves)

### Goal
Give earlier/closer-to-trigger buckets “better” curve fills (B-like fairness), but still 1× AMM update.

Group by tick bucket in priority order.

BUY case (quote-in buckets):
- Let initial y0 and encrypted k = x0*y0.
- For buckets i in priority order, with input `dy_i`:
  - prefix `Y_i = y0 + sum_{j<i} dy_j`
  - bucket output (base out) is:
    - `dx_i = k / Y_i  -  k / (Y_i + dy_i)`

SELL case (base-in buckets):
- prefix `X_i = x0 + sum_{j<i} dx_j`
- bucket output (quote out):
  - `dy_i = k / X_i  -  k / (X_i + dx_i)`

Implementation notes:
- This requires per-bucket reciprocals/divisions if computed literally.
- Practical approach:
  - compute `inv(Y)` via Newton iteration using mul/add only
  - update Y by adding dy_i
  - compute inv(Y + dy_i) similarly (or update inv using a refinement step)
- In Solidity FHE, you may choose:
  - “average price pro-rata” (cheap) if you can accept A-style fairness, OR
  - “virtual slicing per page” (coarser) to reduce divisions.

Within each bucket:
- Split `dx_i` pro-rata by shares (or order size) using a single division per bucket.
- Update bucket accumulators:
  - `proceedsPerShare += dx_i / bucketShares`
  - `filledPerShare += dy_i / bucketShares`
(or your equivalent accounting variables)

### Limit constraint (optional)
If you store a limit price for each bucket/order:
- For BUY limit, ensure average price `dy_i / dx_i <= p_limit`
- Because prices worsen along curve, once violated you can stop filling later buckets.

---

## 6) Safeguards / “Skip” Rules (Make FHE Cheaper)

You can add guards that reduce heavy math without breaking accounting, but they must be consistent:
- If you skip a bucket/order, it must NOT be included in:
  - activation sum
  - totalEnc AMM input
  - allocation updates

Recommended safeguards:
- cap maximum tick movement per swap (plaintext)
- cap max momentum notional per swap (encrypted, compare using mul/square inequalities)
- skip buckets where `bucketIn` is too large relative to reserves:
  - BUY: skip if `dy_i > y0 * RATIO_MAX`
  - SELL: skip if `dx_i > x0 * RATIO_MAX`
Use an encrypted compare if `dy_i` is encrypted; you can approximate using bounded windows or store plaintext caps.

---

## 7) How This Fits Your “4 Swap Modes”

You have:
- erc:erc
- erc:fhe
- fhe:erc
- fhe:fhe

Recommendation:
- Convert ERC amounts to encrypted immediately (or wrap them into an encrypted “amount handle”).
- Run the same pipeline:
  - opposing match
  - momentum closure (binary search)
  - one AMM
  - virtual slicing allocation
- Only at the edges do you:
  - transfer ERC
  - mint/burn FHE-wrapped tokens
  - settle balances

Plaintext markers remain the same in all modes.

---

## 8) Minimal Refactor Checklist (Practical)

1) Replace per-bucket “fill against AMM” loops with:
   - `t* = findFinalTickByBinarySearch(...)`
   - `totalEnc = userRemainderEnc + sumMomentumEnc(t0..t*)`
   - `ammResult = executeAMMOnce(totalEnc)`
   - `applyBucketAccountingByVirtualSlicing(t0..t*, ammResult)`

2) Upgrade tick scanning to word-level bitmap:
   - `nextInitializedTickWithinOneWord(...)`
   - Use compressed ticks with correct negative rounding

3) Add a range-sum structure for momentum bucket inputs:
   - page sums or Fenwick tree

4) Keep opposing limits matched first outside AMM.
   - decrement remainder properly
   - update bucket accounting

5) Keep everything synchronous and deterministic:
   - fixed number of binary search iterations
   - bounded tick word scanning and/or bounded activated ticks

---

## 9) Suggested Function Skeletons (Names are illustrative)

- `compressTick(int24 tick) -> int24 compressed`
- `wordPosBitPos(int24 compressed) -> (int16 wordPos, uint8 bitPos)`
- `nextInitializedTick(int24 fromTick, bool lte) -> (int24 nextTick, bool found)`

- `sumMomentumEnc(int24 t0, int24 tm) -> euint`
  - via page sums / Fenwick

- `predCrossesTickBuy(euint x0, euint y0, euint dy, uint256 p_tm_fp) -> ebool`
  - check ` (y0+dy)^2 >= (x0*y0) * p_tm`

- `findFinalTickBinary(...) -> int24 tStar`

- `executeAMMOnce(poolId, dir, totalEnc) -> (euint outEnc, newReservesEnc)`
- `allocateVirtualSlicing(poolId, dir, t0, tStar, totalEnc, outEnc)`
  - per bucket/page; update accounting

---

## 10) Final Notes

- Bitmap tricks make scanning fast, but do not remove the need for binary search in encrypted mode.
- Division-free predicates make binary search feasible without FHE.div.
- You can keep 1× AMM update while still providing B-like fairness by virtual slicing.
- Bucket-level aggregation is the key to gas + FHE efficiency; per-order operations should be minimized.

--- 
End of guide.



# Addendum: Risk Analysis, Constraints, and Hardening Notes  
*(Audit-style supplement to “1× AMM + Momentum Closure + Bitmap Word Scan”)*

This addendum documents **assumptions, risks, and required hardening measures** for the proposed system. It should be treated as normative guidance for a production Solidity + FHE implementation.

---

## A. Explicit Assumptions (Must Hold)

1. **Monotonic momentum activation**
   - Momentum/trigger orders are strictly same-direction.
   - Activation is monotone in tick:
     - BUY-on-rise: higher ticks activate more orders.
     - SELL-on-fall: lower ticks activate more orders.
   - No mixed-direction or conditional deactivation logic is allowed.

2. **Exact-in semantics**
   - All momentum execution is exact-in (input fixed, output derived).
   - This is required for aggregation and closure correctness.

3. **Constant-product AMM core**
   - Closure and division-free predicates rely on CPAMM monotonicity.
   - Extensions (fees, TWAMM-style drift) must preserve monotonic behavior.

4. **Plaintext geometry**
   - Tick indices, bitmap state, tickSpacing, and direction are plaintext.
   - Only amounts and reserves are encrypted.

Violating any of the above invalidates the binary-search closure logic.

---

## B. Binary Search: Cost and Guardrails

**Risk:**  
Binary search still performs encrypted math (mul/square) per iteration.

**Required constraints:**
- Cap binary search iterations (e.g., 12–16).
- Cap maximum tick delta per swap (protocol constant).
- Pre-bracket search range using bitmap word jumps when possible.

**Rationale:**  
Without hard caps, an attacker can force worst-case FHE cost via dense momentum buckets or wide tick ranges.

---

## C. Momentum Closure Sequencing (Critical)

**Rule (must be enforced):**  
> Momentum closure is computed **only on the post–opposing-limit remainder**.

**Risk if violated:**  
Over-activation of momentum buckets that should never execute because opposing liquidity absorbs the flow.

---

## D. Virtual Slicing & Accounting Consistency

**Risk:**  
Virtual slicing (k/Y math) introduces approximation and rounding drift.

**Required mitigation (choose at least one):**
- Last-bucket reconciliation (absorb rounding dust).
- Conservation clamp:  
  `Σ allocated_output ≤ total_AMM_output`
- Periodic invariant checks in tests (sum of bucket proceeds vs AMM delta).

**Note:**  
This is especially important under FHE approximate reciprocals.

---

## E. Safeguards Are Security Controls (Not Optional)

Safeguards must be treated as **mandatory protocol limits**, not gas optimizations.

**Minimum required caps:**
- Max activated momentum notional per swap.
- Max number of momentum buckets processed.
- Max tick movement per swap.
- Max bucket size relative to reserves (BUY: dy ≤ α·y₀, SELL: dx ≤ α·x₀).

**Threat model:**  
Without these, users can grief via:
- Many small buckets,
- Pathological Newton iterations,
- Forcing deep binary search.

---

## F. ERC ↔ FHE Normalization Risk

**Observation:**  
Encrypting ERC inputs eagerly increases FHE cost even if no AMM execution occurs.

**Recommended refinement:**
- Attempt opposing-limit matching with plaintext bounds first.
- Encrypt only the remainder that actually reaches the AMM path.

This preserves correctness while reducing unnecessary FHE work.

---

## G. Tick Bitmap Correctness (High Risk Area)

**Risk:**  
Incorrect compressed-tick or bitmap math leads to silent mis-matching.

**Requirements:**
- Reuse Uniswap v4 tick compression logic exactly (or byte-for-byte equivalent).
- Do not hand-roll negative-tick handling.
- Use word-level scans (`ctz` / `clz`) only on compressed ticks.

**Guidance:**  
Treat bitmap logic as consensus-critical code.

---

## H. Economic Semantics (User-Facing Guarantees)

The protocol should clearly state:

- **Limit orders**: constraints, not price guarantees (unless matched by opposing flow).
- **Momentum orders**: taker-on-trigger; execution price may be worse than trigger.
- **Fairness model**: priority by trigger tick via virtual slicing, not exact tick-price fills.
- **Atomicity**: one price per transaction, one AMM update.

This avoids mismatched expectations and downstream disputes.

---

## I. Overall Assessment

**What is strong:**
- Cascade-free synchronous execution.
- 1× AMM invariant preserved.
- FHE-aware, division-minimizing design.
- Scales via bucket aggregation and bitmap navigation.

**Primary risks to manage:**
- Worst-case FHE cost without hard caps.
- Hidden monotonicity assumptions.
- Rounding and reconciliation drift.
- Bitmap edge cases.

**Final guidance:**  
The core design is **sound**, but production safety depends on **explicit bounds, invariants, and reconciliation rules**. This addendum should be considered part of the protocol specification.

---
End of addendum.
