# FHE Swap Gas Optimization – Consolidated, Iterated Plan

This document provides a single, unified set of optimization recommendations to reduce gas usage in the fully encrypted swap pipeline while preserving full privacy guarantees. The focus is on eliminating structural inefficiencies specific to FHE execution, not cosmetic Solidity tweaks.

================================================================
CORE RULE (MOST IMPORTANT)
================================================================

Call FHE.allowThis(x) ONLY when x:
- is written to contract storage
- is passed to an external contract
- is decrypted, emitted, or otherwise leaves the contract

Intermediates that are only consumed by subsequent FHE operations do NOT require ACL permissions in most Fhenix deployments.

This rule alone removes hundreds of thousands of gas.

================================================================
1. _executeSwapMath (AMM CORE)
================================================================

1.1 Remove ACLs on intermediates (SAFE)

Remove FHE.allowThis for:
- amountInAfterFee
- numerator
- denominator
- safeDenominator
- amountOut (internal-only return)

Keep FHE.allowThis ONLY for:
- r.encReserve0
- r.encReserve1 (stored state)

1.2 Update reserves using amountInAfterFee

Current logic credits reserves with amountIn. Instead, credit only amountInAfterFee so the fee remains inside the pool without over-accounting liquidity.

This improves correctness and does not add FHE operations.

1.3 Remove safeDenominator guard if invariants hold (BIG WIN)

The pattern:
- FHE.gt(denominator, 0)
- FHE.select(denominator, 1)

Costs ~250k gas per swap.

If you can enforce BOTH:
- pool reserves are never zero after initialization
- zero-input swaps are rejected in plaintext before entering FHE

Then divide directly by denominator and delete the guard entirely.

================================================================
2. Maker Matching (_matchMakerOrdersEncrypted)
================================================================

2.1 Cache encrypted tick prices (HUGE)

Calling FHE.asEuint128(calculateTickPrice(tick)) inside loops is extremely expensive (~92k gas each time).

Tick price depends ONLY on plaintext tick, so cache it once:

- mapping(PoolId => mapping(int24 => euint128)) encTickPriceCache
- mapping(PoolId => mapping(int24 => bool)) encTickPriceCached

On first use:
- encrypt tick price
- allowThis once
- store

On subsequent swaps:
- reuse cached encrypted value

This is one of the largest remaining wins once ACL spam is removed.

2.2 Eliminate redundant selects

You currently compute multiple conditional values derived from the same condition (shouldApply). Example:
- actualOutput
- liquidityReduction

If two values are identical under the same condition, compute once and reuse.

Every removed FHE.select saves ~133k gas.

2.3 Purge ACLs inside loops

Inside maker loops, remove allowThis from:
- fill
- outputFromBucket
- remainder
- userOutput
- capacity
- encTickPrice (if cached and stored)

Keep allowThis ONLY on:
- bucket.liquidity (stored)
- values passed to external bucket accounting helpers

================================================================
3. Plaintext Short-Circuiting (CRITICAL)
================================================================

3.1 Skip maker matching when plaintext bitmaps are empty

If both BUY and SELL maker bitmaps are zero:
- skip both calls to _matchMakerOrdersEncrypted
- set userRemainder = amountIn
- set outputFromMakers = ENC_ZERO

This leaks no new information (bitmaps are already plaintext) and saves ~500–600k gas per swap in the common case.

3.2 Apply the same idea to taker momentum

If plaintext momentum discovery finds no taker buckets:
- skip _sumTakerBucketsEncrypted
- skip _allocateTakerOutputEncrypted

This saves ~200k+ gas in common empty-book scenarios.

================================================================
4. Direction Handling
================================================================

4.1 Compute not(direction) once

FHE.not costs ~77k gas. You currently recompute it in multiple functions.

Compute once at the top level:
- notDirection = FHE.not(direction)
- allowThis(notDirection)

Pass both direction and notDirection into subroutines.

4.2 Reduce paired selects where algebra allows

Example pattern:
- token0 = select(dir, x, 0)
- token1 = select(dir, 0, x)

Replace with:
- token0 = select(dir, x, 0)
- token1 = x - token0

This removes one select at the cost of one sub, saving ~15–20k gas per occurrence.

Not a huge win alone, but stacks across transfers and fees.

================================================================
5. Protocol Fee Path
================================================================

5.1 Cache encrypted protocol fee BPS

Instead of encrypting feeBps on every swap:
- store encProtocolFeeBps in PoolState
- update it only when the fee changes
- allowThis once at update time

This removes ~90k gas per swap.

5.2 Remove ACLs on fee intermediates

Remove allowThis from:
- feeNumerator
- fee
- outputAfterFee

Keep allowThis ONLY for:
- finalOutput
- finalFee (passed to external token transfers)

================================================================
6. Transfers
================================================================

6.1 Keep ACLs only where required

For transfers:
- allowThis only for amounts passed to IFHERC20 calls
- do not allow intermediates that never leave the contract

6.2 (Optional, Large) Batch token transfers if FHERC20 supports it

If the token interface can accept both token0 and token1 amounts in one call:
- replace two encrypted transfers with one
- large gas reduction

If not supported, ignore.

================================================================
EXPECTED RESULTS (CONSERVATIVE)
================================================================

- ACL purge:            ~400k–700k gas
- Tick price caching:   massive with deep books
- Skip empty maker:     ~500k–600k gas
- Skip empty takers:    ~200k+ gas
- Remove safety guard:  ~250k gas
- Fee caching:          ~90k gas
- Select reductions:    incremental

Common-case swaps (no orders, shallow books) should land near or below ~1.7–2.0M gas, with worst-case still materially lower than current.

================================================================
FINAL NOTE
================================================================

If Fhenix ACL semantics REQUIRE permission even for ciphertext-to-ciphertext ops, narrow the ACL purge to:
- loop intermediates
- duplicated values
- cached constants

If ACL is only required for storage/external boundaries, the above plan is close to optimal without protocol-level changes.
