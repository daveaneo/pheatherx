# Future Features

This document outlines planned features and architectural improvements for FheatherX.

---

## 1. FheatherX Periphery: Seamless FHERC20 Integration with Uniswap v4

### Problem

FheatherX uses FHERC20 tokens (fheWETH, fheUSDC) which maintain two separate balances per user:

| Balance Type | Storage | Visibility | Used By |
|--------------|---------|------------|---------|
| Plaintext (ERC20) | `balanceOf()` | Public | Standard Uniswap routers, aggregators |
| Encrypted (FHERC20) | `_encBalances[]` | Private | FheatherX limit orders |

When users hold tokens in their **encrypted balance** (from faucet, limit order claims, or explicit wrapping), they cannot directly:

1. Swap through standard Uniswap v4 pools
2. Use aggregators (1inch, CoW, Paraswap)
3. Interact with any DeFi protocol expecting standard ERC20

The encrypted balance is invisible to external contracts that read `balanceOf()`.

**Current workaround:** Users must manually call `unwrap(amount)` first, then perform their swap - requiring two separate transactions.

### Solution: FheatherXPeriphery with Permit2

A periphery contract that atomically unwraps encrypted tokens and executes swaps in a single transaction, using Permit2 for gasless approvals.

#### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Wallet                             │
│                                                                 │
│  Encrypted Balance: 1000 fheUSDC                                │
│  Plaintext Balance: 0 fheUSDC                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 1. unwrapAndSwap(1000, swapParams, permit, sig)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FheatherXPeriphery                           │
│                                                                 │
│  1. Call fheUSDC.unwrapTo(1000, address(this))                  │
│     - User's encrypted balance: 1000 → 0                        │
│     - Periphery plaintext balance: 0 → 1000                     │
│                                                                 │
│  2. Approve Permit2 for fheUSDC                                 │
│                                                                 │
│  3. Execute swap via UniversalRouter                            │
│     - Input: 1000 fheUSDC                                       │
│     - Output: X WETH (sent to user)                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Uniswap v4                                 │
│                                                                 │
│  UniversalRouter → PoolManager → Pool(s) → User receives WETH  │
└─────────────────────────────────────────────────────────────────┘
```

#### Required Token Changes

Add `unwrapTo()` function to FHERC20FaucetToken:

```solidity
/// @notice Unwrap encrypted balance to plaintext, sending to a recipient
/// @dev Allows periphery contracts to receive unwrapped tokens atomically
/// @param amount Amount to unwrap (in base units)
/// @param recipient Address to receive plaintext tokens
function unwrapTo(uint256 amount, address recipient) external {
    require(amount > 0, "Amount must be > 0");
    require(recipient != address(0), "Invalid recipient");
    require(Common.isInitialized(_encBalances[msg.sender]), "No encrypted balance");

    euint128 encAmount = FHE.asEuint128(uint128(amount));

    // Subtract from sender's encrypted balance
    _encBalances[msg.sender] = FHE.sub(_encBalances[msg.sender], encAmount);
    _encTotalSupply = FHE.sub(_encTotalSupply, encAmount);

    // Update FHE permissions
    FHE.allowThis(_encBalances[msg.sender]);
    FHE.allow(_encBalances[msg.sender], msg.sender);
    FHE.allowThis(_encTotalSupply);

    // Mint plaintext to recipient
    _mint(recipient, amount);

    emit Unwrap(msg.sender, amount);
}
```

#### Periphery Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IFHERC20} from "./interface/IFHERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUniversalRouter} from "@uniswap/universal-router/contracts/interfaces/IUniversalRouter.sol";
import {IPermit2} from "@uniswap/permit2/contracts/interfaces/IPermit2.sol";

/// @title FheatherXPeriphery
/// @notice Enables seamless swaps from encrypted FHERC20 balances through Uniswap v4
/// @dev Uses Permit2 for gasless token approvals after initial setup
contract FheatherXPeriphery {
    using SafeERC20 for IERC20;

    IUniversalRouter public immutable universalRouter;
    IPermit2 public immutable permit2;

    error InvalidAmount();
    error SwapFailed();

    constructor(address _universalRouter, address _permit2) {
        universalRouter = IUniversalRouter(_universalRouter);
        permit2 = IPermit2(_permit2);
    }

    /// @notice Unwrap encrypted tokens and execute a swap in one transaction
    /// @param tokenIn The FHERC20 token to unwrap
    /// @param amountIn Amount to unwrap from encrypted balance
    /// @param commands Encoded UniversalRouter commands
    /// @param inputs Encoded inputs for each command
    /// @param deadline Transaction deadline
    function unwrapAndSwap(
        IFHERC20 tokenIn,
        uint256 amountIn,
        bytes calldata commands,
        bytes[] calldata inputs,
        uint256 deadline
    ) external {
        if (amountIn == 0) revert InvalidAmount();

        // 1. Unwrap user's encrypted balance to this contract
        tokenIn.unwrapTo(amountIn, address(this));

        // 2. Approve UniversalRouter (or use Permit2 for advanced flows)
        IERC20(address(tokenIn)).approve(address(universalRouter), amountIn);

        // 3. Execute swap - outputs go to destinations encoded in `inputs`
        universalRouter.execute(commands, inputs, deadline);
    }

    /// @notice Unwrap and swap using Permit2 signature (no prior approval needed)
    /// @param tokenIn The FHERC20 token to unwrap
    /// @param amountIn Amount to unwrap from encrypted balance
    /// @param permit Permit2 permit data
    /// @param signature User's signature for Permit2
    /// @param commands Encoded UniversalRouter commands
    /// @param inputs Encoded inputs for each command
    /// @param deadline Transaction deadline
    function unwrapAndSwapWithPermit(
        IFHERC20 tokenIn,
        uint256 amountIn,
        IPermit2.PermitSingle calldata permit,
        bytes calldata signature,
        bytes calldata commands,
        bytes[] calldata inputs,
        uint256 deadline
    ) external {
        if (amountIn == 0) revert InvalidAmount();

        // 1. Unwrap user's encrypted balance to this contract
        tokenIn.unwrapTo(amountIn, address(this));

        // 2. Use Permit2 for gasless approval
        permit2.permit(msg.sender, permit, signature);

        // 3. Transfer to router via Permit2
        permit2.transferFrom(
            address(this),
            address(universalRouter),
            uint160(amountIn),
            address(tokenIn)
        );

        // 4. Execute swap
        universalRouter.execute(commands, inputs, deadline);
    }

    /// @notice Wrap ERC20 tokens and deposit into FheatherX in one transaction
    /// @dev For users who have plaintext ERC20 and want to place limit orders
    /// @param token The FHERC20 token contract (must have wrap function)
    /// @param amount Amount of plaintext tokens to wrap
    function wrapTokens(IFHERC20 token, uint256 amount) external {
        // 1. Transfer plaintext from user
        IERC20(address(token)).safeTransferFrom(msg.sender, address(this), amount);

        // 2. Wrap to encrypted (goes to this contract's encrypted balance)
        token.wrap(amount);

        // 3. Transfer encrypted to user
        //    Note: Requires transferEncryptedDirect or similar
        //    Implementation depends on FHERC20 transfer capabilities
    }
}
```

#### Usage Flow

**First time setup (one-time per token):**
```
1. User approves Permit2 for fheUSDC: fheUSDC.approve(PERMIT2, MAX)
```

**Every subsequent swap:**
```
1. User calls periphery.unwrapAndSwap(fheUSDC, 1000, commands, inputs, deadline)
2. Single transaction executes: unwrap → swap → receive output token
```

#### Benefits

| Aspect | Without Periphery | With Periphery |
|--------|-------------------|----------------|
| Transactions per swap | 2 (unwrap + swap) | 1 |
| Gas cost | Higher (2 tx overhead) | Lower |
| UX complexity | Must manually unwrap | Seamless |
| Aggregator compatible | No | Yes (can integrate) |
| Composability | Limited | Full Uniswap v4 ecosystem |

#### Security Considerations

1. **Periphery is stateless** - No funds stored, only transient during execution
2. **User controls amounts** - Explicit `amountIn` parameter
3. **Immutable dependencies** - Router and Permit2 addresses set at deployment
4. **Upgradeable via redeployment** - Deploy new periphery version if needed; old version keeps working

#### Future Extensions

1. **Multi-hop with mixed tokens** - Unwrap → Swap A → Swap B → Wrap (if desired)
2. **Aggregator integration** - Expose interface that 1inch/CoW can call
3. **Batch operations** - Unwrap multiple tokens in one transaction
4. **Callback pattern** - For advanced composability with other protocols

---

## 2. Additional Future Features

### 2.1 LP Creation for Different Pair Types

Support liquidity provision across token type combinations:

| Pair Type | Hook Required | Privacy Level |
|-----------|---------------|---------------|
| FHERC20 : FHERC20 | FheatherXv4 | Full (both sides encrypted) |
| ERC20 : ERC20 | None (standard Uniswap) | None |
| ERC20 : FHERC20 | Optional | Partial (one side visible) |

### 2.2 Auto-Wrap on Deposit

When depositing to FheatherX limit orders, automatically wrap ERC20 → FHERC20:

```solidity
function depositWithWrap(
    PoolId poolId,
    int24 tick,
    BucketSide side,
    uint256 plaintextAmount  // User sends ERC20
) external {
    // 1. Transfer ERC20 from user
    // 2. Wrap to FHERC20
    // 3. Deposit encrypted amount to bucket
}
```

### 2.3 Cross-Chain FHERC20 Bridges

Bridge encrypted balances across chains while maintaining privacy:
- Source chain: Lock encrypted balance
- Destination chain: Mint equivalent encrypted balance
- Challenge: FHE key management across chains

---

## 3. FHE Division Optimization

### Problem

`FHE.div` is extremely expensive in the FHE coprocessor, costing approximately **100-200x more** than other FHE operations like `mul`, `add`, or `shr`. FheatherXv5.sol currently contains **11 FHE.div calls**, primarily in pro-rata calculations for LP shares and order claims.

Example from `_computeProRataAmount`:
```solidity
// Current: expensive division
result = FHE.div(FHE.mul(userShare, totalReserves), totalSupply);
// Cost: 1 mul (~1 unit) + 1 div (~200 units) = ~201 units
```

### Potential Workarounds

#### 3.1 Newton-Raphson Approximation

Replace division with iterative multiplication using Newton-Raphson to compute the reciprocal:

```solidity
/// @notice Compute (userShare * totalReserves) / totalSupply without FHE.div
/// @param hintTotalSupply Plaintext hint from frontend (untrusted)
function computeProRataApprox(
    euint128 userShare,
    euint128 totalReserves,
    euint128 totalSupply,
    uint128 hintTotalSupply
) internal returns (euint128 result) {
    uint128 SHIFT = 64;
    uint128 SCALED_ONE = uint128(1) << 64;  // Q64.64 format: "1.0"
    uint128 SCALED_TWO = uint128(2) << 64;  // Q64.64 format: "2.0"

    // Initial guess: 2^64 / hint (plaintext computation)
    uint128 safeHint = hintTotalSupply == 0 ? 1 : hintTotalSupply;
    uint128 initialGuess = SCALED_ONE / safeHint;
    euint128 inverse = FHE.asEuint128(initialGuess);

    euint128 encScaledTwo = FHE.asEuint128(SCALED_TWO);
    euint128 encShift = FHE.asEuint128(SHIFT);

    // Newton-Raphson: x_new = x * (2 - supply * x)
    // 2 iterations typically sufficient
    for (uint i = 0; i < 2; i++) {
        euint128 product = FHE.mul(totalSupply, inverse);
        euint128 correction = FHE.sub(encScaledTwo, product);
        inverse = FHE.mul(inverse, correction);
        inverse = FHE.shr(inverse, encShift);
    }

    // Final: result = userShare * reserves * inverse >> 64
    result = FHE.mul(userShare, totalReserves);
    result = FHE.mul(result, inverse);
    result = FHE.shr(result, encShift);
}
```

**Cost Analysis:**
| Approach | FHE Operations | Estimated Cost (if div=200, others=1) |
|----------|----------------|---------------------------------------|
| Direct `FHE.div` | 1 mul + 1 div | ~201 units |
| Newton-Raphson | ~13 mul/shr/sub | ~13 units |
| **Savings** | | **~94%** |

**Limitations:**
- **Q64.64 Overflow**: The fixed-point format uses 2^64 as the scaling factor. For 18-decimal tokens (e.g., 500e18), the initial guess `2^64 / 500e18` truncates to 0 because 2^64 ≈ 18.4e18 < 500e18.
- **Requires Normalization**: To handle large values, tokens must be normalized (divided by a known scale) before computation, then denormalized after.
- **Hint Accuracy**: Newton-Raphson converges only if the initial guess is reasonably close to the true value. Bad hints can cause divergence.

**Status**: Gas tests created in `test/gas/FHEDivApproxGas.t.sol`. Works for small values. Needs normalization strategy for 18-decimal tokens.

#### 3.2 Off-Chain Encrypted Computation with On-Chain Verification

Compute the division off-chain, submit the encrypted result, and verify on-chain via multiplication:

```solidity
/// @notice Verify that encryptedResult ≈ numerator / denominator
/// @dev Uses multiplication check: result * denominator ≈ numerator
/// @param encryptedResult Encrypted result submitted by frontend (untrusted)
/// @param numerator Encrypted numerator (on-chain value)
/// @param denominator Encrypted denominator (on-chain value)
/// @return True if the result is within acceptable tolerance
function verifyDivisionResult(
    euint128 encryptedResult,
    euint128 numerator,
    euint128 denominator
) internal returns (ebool) {
    // If r = a/b, then r*b = a (with possible rounding error)
    euint128 reconstructed = FHE.mul(encryptedResult, denominator);

    // Check: reconstructed ≈ numerator
    // Need FHE comparison or tolerance check
    // For exact match: return FHE.eq(reconstructed, numerator);
    // For tolerance: check |reconstructed - numerator| < epsilon

    return FHE.eq(reconstructed, numerator);
}
```

**Challenges:**
- **Zero Trust**: The off-chain value cannot be trusted. Must verify on-chain.
- **Rounding**: Integer division has rounding; `r*b` may not exactly equal `a`.
- **Tolerance Checking**: FHE lacks efficient absolute value and comparison operations.
- **State Changes**: Pool state may change between off-chain computation and on-chain verification (front-running, other transactions).

**Potential Flow:**
1. Frontend reads encrypted numerator/denominator from chain
2. Frontend decrypts locally (with user's session key), computes division
3. Frontend encrypts result, submits to contract
4. Contract verifies via `FHE.mul` and accepts if valid

**Status**: Theoretical. Needs more design work to handle rounding tolerance and state changes.

#### 3.3 Hybrid Approach

Combine Newton-Raphson with FHE.div fallback:

```solidity
function computeWithFallback(
    euint128 numerator,
    euint128 denominator,
    uint128 hint
) internal returns (euint128) {
    // Check hint quality (plaintext comparison)
    // If hint is within 10x of expected range, use Newton-Raphson
    // Otherwise, fall back to expensive but correct FHE.div

    if (isHintReasonable(hint)) {
        return computeApprox(numerator, denominator, hint);
    } else {
        return FHE.div(numerator, denominator);
    }
}
```

**Trade-off**: Most operations save 94% gas, worst-case falls back to standard behavior.

### Recommendation

1. **Short-term**: Keep `FHE.div` - it's correct and the codebase works.
2. **Medium-term**: Implement and test Newton-Raphson with normalization on Fhenix testnet where real FHE gas costs can be measured.
3. **Long-term**: Explore off-chain verified computation for complex multi-division operations.

### Test File

Gas comparison tests are available in:
```
contracts/test/gas/FHEDivApproxGas.t.sol
```

Run with: `forge test --match-contract FHEDivApproxGas -vv`

---

---

## 4. Official Fhenix FHERC20 Token Support

### Current State

FheatherXv6 uses a custom FHERC20 detection mechanism that is **not compatible** with official Fhenix FHERC20 tokens.

**Our implementation:**
```solidity
// FheatherXv6._isFherc20() checks for:
function balanceOfEncrypted(address account) external view returns (euint128);
// Selector: 0xc33d0b56
```

**Official Fhenix FHERC20 standard:**
```solidity
// Requires Permission struct for access control:
function balanceOfEncrypted(address account, Permission memory auth) external view returns (string memory);
// Selector: 0x60277204 (different due to Permission parameter)
```

The `Permission` struct provides cryptographic proof that the caller is authorized to view the encrypted balance. Our simplified version skips this because:
1. We only use it for token type detection (does this function exist?)
2. The actual balance decryption happens off-chain through CoFHE
3. Our `balanceOfEncrypted(address)` returns an opaque `euint128` handle, not the decrypted value

### Impact

| Token Type | Detection Result | Limit Orders Work? |
|------------|------------------|-------------------|
| Our `FheFaucetToken` | ✅ Detected as FHERC20 | ✅ Yes |
| Official Fhenix FHERC20 | ❌ Detected as ERC20 | ❌ No (`InputTokenMustBeFherc20`) |

### Solutions (To Be Decided)

#### Option A: Multi-Selector Detection

Update `_isFherc20()` to check for multiple known selectors:

```solidity
function _isFherc20(address token) internal view returns (bool) {
    // Check our simplified interface
    (bool success1, ) = token.staticcall(
        abi.encodeWithSelector(bytes4(0xc33d0b56), address(0)) // balanceOfEncrypted(address)
    );
    if (success1) return true;

    // Check official Fhenix interface (will fail without valid Permission, but selector exists)
    // Note: This may not work reliably as the call will revert without valid Permission
    // May need ERC-165 supportsInterface instead

    return false;
}
```

**Pros:** Backward compatible, automatic detection
**Cons:** Fragile, selector-based detection can have false positives

#### Option B: Explicit Token Type Registration

Add admin function to manually set token types:

```solidity
function setTokenTypes(
    PoolId poolId,
    bool token0IsFherc20,
    bool token1IsFherc20
) external onlyOwner {
    PoolState storage state = poolStates[poolId];
    require(state.initialized, "Pool not initialized");
    state.token0IsFherc20 = token0IsFherc20;
    state.token1IsFherc20 = token1IsFherc20;
    emit TokenTypesUpdated(poolId, token0IsFherc20, token1IsFherc20);
}
```

**Pros:** Explicit, works with any token, can fix misdetection
**Cons:** Manual setup required per pool

#### Option C: hookData Parameter at Pool Init

Pass token types explicitly via Uniswap v4's `hookData`:

```solidity
function _afterInitialize(
    address,
    PoolKey calldata key,
    uint160,
    int24,
    bytes calldata hookData  // <-- decode token types from here
) internal override returns (bytes4) {
    (bool t0IsFherc20, bool t1IsFherc20) = abi.decode(hookData, (bool, bool));
    // Use explicit values instead of detection
}
```

**Pros:** Explicit at deploy time, no post-hoc admin calls
**Cons:** Requires deployment script changes, can't auto-detect

#### Option D: ERC-165 Interface Detection

If Fhenix tokens implement ERC-165, check for a standard interface ID:

```solidity
function _isFherc20(address token) internal view returns (bool) {
    try IERC165(token).supportsInterface(FHERC20_INTERFACE_ID) returns (bool supported) {
        return supported;
    } catch {
        return false;
    }
}
```

**Pros:** Standard approach, explicit support declaration
**Cons:** Requires Fhenix tokens to implement ERC-165

### Additional Work Required

1. **Use official Fhenix token contracts** - Either import `@fhenixprotocol/fhenix-contracts` or create compatible mock tokens that match the official interface

2. **Update IFHERC20 interface** - Align with official Fhenix signatures including `Permission` parameter

3. **Frontend permit handling** - If using official tokens, the frontend must generate and pass `Permission` structs for balance queries

4. **Testing** - Deploy against actual Fhenix testnet tokens to verify compatibility

### Recommended Approach

**Short-term (testnet):** Keep current implementation with our custom tokens. Add Option B (admin override) as a safety valve.

**Medium-term:** Implement Option C (hookData) for explicit declaration at pool creation, keeping Option B for corrections.

**Long-term:** Once Fhenix standardizes on ERC-165 or another detection method, adopt that. Consider contributing to Fhenix standards discussion.

### References

- [Fhenix FHERC20 Contract](https://github.com/FhenixProtocol/fhenix-contracts/blob/main/contracts/experimental/token/FHERC20/FHERC20.sol)
- [Fhenix Permission Struct](https://docs.fhenix.zone) - Used for sealed/encrypted data access control

---

## 5. Cancel Order Function (Full Position Withdrawal)

### Current State

FheatherXv6 uses a generic `withdraw()` function that accepts an encrypted amount parameter:

```solidity
function withdraw(
    PoolId poolId,
    int24 tick,
    BucketSide side,
    InEuint128 calldata encryptedAmount  // Can be partial
) external whenNotPaused
```

**Problem:** After withdrawal, the frontend cannot easily determine if a position is fully closed:

1. **Encrypted shares handle persists** - The contract doesn't clear `position.shares`; it subtracts, leaving an encrypted zero
2. **Handle ≠ Value** - A non-zero handle can point to an encrypted zero value
3. **Unsealing required** - To know actual remaining shares, must decrypt the handle (slow, ~2+ minutes)
4. **No "position closed" event** - Only generic `Withdraw` event emitted

### Proposed Solution: `cancelOrder()` Function

Add a dedicated function that always withdraws the **entire position** at a tick/side:

```solidity
/// @notice Cancel an order by withdrawing ALL shares at a specific tick/side
/// @dev Withdraws entire position - no partial withdrawals
/// @param poolId The pool identifier
/// @param tick The tick of the position to cancel
/// @param side BucketSide.BUY or BucketSide.SELL
event OrderCancelled(PoolId indexed poolId, address indexed user, int24 indexed tick, BucketSide side);

function cancelOrder(
    PoolId poolId,
    int24 tick,
    BucketSide side
) external whenNotPaused nonReentrant {
    UserPosition storage position = positions[poolId][msg.sender][tick][side];

    // Check position exists
    require(Common.isInitialized(position.shares), "NoPosition");

    // Get full share amount
    euint128 sharesToWithdraw = position.shares;

    // ... existing withdrawal logic using sharesToWithdraw ...

    // Clear position completely (optional - helps with detection)
    delete positions[poolId][msg.sender][tick][side];

    emit OrderCancelled(poolId, msg.sender, tick, side);
}
```

### Key Design Decisions

#### 1. Full Withdrawal Only

| Aspect | `withdraw(amount)` | `cancelOrder()` |
|--------|-------------------|-----------------|
| Amount | User-specified (encrypted) | All shares |
| Partial? | Yes | No |
| Use case | Granular control | Simple exit |
| UI tracking | Requires unsealing | Tx success = position gone |

#### 2. Position Deletion

**Option A: Delete position mapping entry**
```solidity
delete positions[poolId][msg.sender][tick][side];
```
- Pro: Clean state, handle becomes 0
- Con: Gas cost for storage clear (but refund applies)

**Option B: Keep entry, set shares to encrypted zero**
- Pro: Preserves history
- Con: Frontend still can't easily detect

**Recommendation:** Option A - delete the entry for clean state.

#### 3. Dedicated Event

The `OrderCancelled` event clearly signals full position closure:
```solidity
event OrderCancelled(PoolId indexed poolId, address indexed user, int24 indexed tick, BucketSide side);
```

Frontend can:
1. Listen for `OrderCancelled` events
2. Immediately remove position from UI on tx success
3. No unsealing needed

### Compounding Behavior

When users make multiple deposits at the same tick/side, shares compound:

| Action | Shares at tick 100, SELL |
|--------|--------------------------|
| Deposit 50 | 50 |
| Deposit 30 | 80 |
| **cancelOrder()** | 0 (all 80 withdrawn) |

`cancelOrder()` withdraws the **entire combined position**. This matches traditional order book UX where "Cancel" cancels the whole order.

Users who want different exit strategies can place orders at different ticks (tick spacing = 60 provides granularity).

### Frontend Changes

With `cancelOrder()`:

```typescript
// After successful cancel transaction
const handleCancel = async (position: ActivePosition) => {
  const hash = await cancelOrder(position.poolId, position.tick, position.side);

  // Transaction success = position is gone
  // Optimistically remove from UI immediately
  removePositionFromUI(position.tick, position.side);
};
```

No unsealing needed. Transaction success guarantees position is fully closed.

### Migration Path

1. **Keep `withdraw()`** - For advanced users who want partial withdrawals
2. **Add `cancelOrder()`** - For simple "exit entire position" use case
3. **Frontend uses `cancelOrder()`** - For the Cancel/Withdraw button in Active Orders panel

### Implementation Priority

**Medium-High** - Significantly improves UX by eliminating the need to unseal shares just to know if a position is active.

---

## 6. Hybrid Order Book + AMM: Direct Order Matching

### Current State

FheatherXv6 limit orders are "triggered" by price movement but **never match directly** with incoming swaps. The current flow:

```
1. User submits swap (10 ETH → USDC)
2. Entire swap goes through AMM (x*y=k math)
3. Price moves from tick 100 → tick 95
4. AFTER swap: _processTriggeredOrders() finds orders at crossed ticks
5. Those orders ALSO swap against AMM
```

**Problem:** A BUY order wanting ETH at tick 97 exists, but instead of directly matching with the incoming SELL, both sides hit the AMM separately. This is:
- Inefficient (double AMM math)
- Worse execution (slippage on both sides)
- Not how order books work

### Proposed Architecture: Tick-by-Tick Order Matching

Incoming swaps should **first consume opposite-direction limit orders** at each price level, then use AMM for any remainder.

```
User wants to sell 10 ETH, starting at tick 100

Tick 100: Check for BUY orders → Found 2 ETH worth
  → Match directly at tick 100 price (no AMM)
  → Remaining: 8 ETH

Tick 99: Check for BUY orders → None
  → Trade against AMM (some portion consumed)
  → Price drops, continue...

Tick 98: Check for BUY orders → Found 3 ETH worth
  → Match directly at tick 98 price
  → Remaining: 5 ETH

Tick 97: Has SELL orders (same direction)
  → Skip for now (they trigger AFTER)
  → Trade remaining against AMM

... continues until swap amount exhausted ...

Finally: Trigger SELL orders (same direction) at crossed ticks
  → These fill against AMM as counterparty
```

### Key Concepts

| Order Direction | Relationship to Swap | Behavior |
|-----------------|---------------------|----------|
| **Opposite** (BUY when swapping SELL) | Acts as liquidity | Match directly at agreed price, no AMM |
| **Same** (SELL when swapping SELL) | Gets triggered | Fill against AMM after price moves through |

### Benefits

| Aspect | Current | With Order Matching |
|--------|---------|---------------------|
| Order fill price | AMM price (with slippage) | Exact tick price (no slippage for matched portion) |
| Gas efficiency | Two separate AMM calls | Single direct swap for matched portions |
| Capital efficiency | Orders compete with AMM | Orders complement AMM |
| MEV protection | Limited | Better (direct matching is atomic) |

### Implementation Approach

#### New Core Function: `_matchAndSwap()`

```solidity
/// @notice Execute swap by first matching against opposite-direction orders, then AMM
/// @param poolId The pool to swap in
/// @param direction Swap direction (encrypted)
/// @param amountIn Amount to swap (encrypted)
/// @return amountOut Total output received
function _matchAndSwap(
    PoolId poolId,
    ebool direction,
    euint128 amountIn
) internal returns (euint128 amountOut) {
    int24 currentTick = _getCurrentTick(poolId);
    euint128 remaining = amountIn;
    amountOut = ENC_ZERO;

    // Determine which side has opposite-direction orders
    // If direction=true (zeroForOne), look for BUY orders (they want to buy token0)
    // If direction=false (oneForZero), look for SELL orders (they want to sell token0)

    // Iterate through ticks until remaining is exhausted
    while (FHE.decrypt(FHE.gt(remaining, ENC_ZERO))) {  // Note: requires careful handling
        // 1. Check for opposite-direction orders at current tick
        euint128 matchedInput;
        euint128 matchedOutput;
        (matchedInput, matchedOutput) = _matchAgainstOrders(poolId, currentTick, direction, remaining);

        remaining = FHE.sub(remaining, matchedInput);
        amountOut = FHE.add(amountOut, matchedOutput);

        // 2. If remaining, use AMM for this tick's liquidity
        if (/* remaining > 0 */) {
            euint128 ammOutput = _executeSwapMathForPool(poolId, direction, remaining);
            amountOut = FHE.add(amountOut, ammOutput);
            remaining = ENC_ZERO;  // AMM consumes all remaining
        }

        // 3. Move to next tick
        currentTick = /* next tick based on direction */;
    }

    // 4. Trigger same-direction orders that were crossed
    _triggerSameDirectionOrders(poolId, direction, startTick, currentTick);

    return amountOut;
}
```

#### New Helper: `_matchAgainstOrders()`

```solidity
/// @notice Match incoming swap against opposite-direction orders at a tick
/// @dev Direct trade at tick price, no AMM involvement
function _matchAgainstOrders(
    PoolId poolId,
    int24 tick,
    ebool incomingDirection,
    euint128 incomingAmount
) internal returns (euint128 matchedInput, euint128 matchedOutput) {
    // Determine opposite side
    // incomingDirection=true (selling token0) matches with BUY orders (wanting token0)
    BucketSide oppositeSide = /* BUY if direction else SELL */;

    Bucket storage bucket = buckets[poolId][tick][oppositeSide];
    if (!bucket.initialized) return (ENC_ZERO, ENC_ZERO);

    // Match against bucket liquidity
    euint128 availableLiquidity = bucket.liquidity;
    euint128 matchAmount = FHE.min(incomingAmount, availableLiquidity);

    // Calculate output at tick price (direct trade, no slippage)
    uint256 tickPrice = getTickPrice(tick);
    matchedOutput = FHE.mul(matchAmount, FHE.asEuint128(tickPrice));
    matchedOutput = FHE.div(matchedOutput, ENC_PRECISION);

    // Update bucket (reduce liquidity, increase proceeds)
    bucket.liquidity = FHE.sub(bucket.liquidity, matchAmount);
    _updateBucketOnFill(bucket, matchAmount, matchedOutput);

    matchedInput = matchAmount;
}
```

### FHE Considerations

1. **Encrypted Iteration**: The while loop with `FHE.decrypt()` is problematic. Need to redesign as bounded iteration or use `FHE.select()` for conditional execution.

2. **Direction Handling**: Use `FHE.select()` to handle both directions without revealing which:
   ```solidity
   BucketSide side = FHE.select(direction, BucketSide.BUY, BucketSide.SELL);
   ```

3. **Tick Traversal**: May need to process a fixed number of ticks per swap, or batch multiple ticks into single FHE operations.

### Gas Optimization Ideas

1. **Batch tick processing**: Instead of per-tick iteration, aggregate all matching orders in a range and compute total match in one FHE operation.

2. **Precompute tick ranges**: Use bitmap to find all active order ticks in the swap path upfront.

3. **Combined AMM math**: After matching, compute single AMM swap for total remaining amount rather than per-tick.

### Migration Path

1. **Phase 1 (Current Bug Fix)**: Add `_processTriggeredOrders()` to encrypted swaps via `trySyncReserves()` - orders trigger after reserve sync (delayed but works)

2. **Phase 2 (This Feature)**: Implement `_matchAndSwap()` for direct order matching - better execution, proper order book behavior

3. **Phase 3 (Optimization)**: Batch FHE operations, optimize gas for multi-tick swaps

### Implementation Priority

**Medium-High** - This transforms FheatherX from "AMM with triggered orders" to "true hybrid order book + AMM", significantly improving execution quality for limit orders.

### Related Research

See `/docs/research/claim-detection-deep-research.md` for analysis of current order triggering bugs and the architectural gap between encrypted swaps and order processing.

---

---

## 7. FheatherX Router: Unified Interface Across Pool Types

### Current State

With FheatherXv8, we have two separate contracts:

| Contract | Pool Types | Token Requirements |
|----------|-----------|-------------------|
| **FheatherXv8FHE** | FHE:FHE only | Both tokens must be FHERC20 |
| **FheatherXv8Mixed** | FHE:ERC, ERC:FHE | One FHERC20, one ERC20 |

**Problem:** Frontend/users must:
1. Determine token types for each pair
2. Call the correct contract address
3. Handle different function signatures (v8FHE is encrypted-only)

This complexity increases integration burden and potential for errors.

### Proposed Solution: FheatherXRouter

A router contract that provides a **single entry point** for all FheatherX operations, automatically routing to the correct underlying pool contract.

```
┌─────────────────────────────────────────────────────────────────┐
│                         User/Frontend                            │
│                                                                  │
│  "I want to swap fheWETH for fheUSDC"                           │
│  "I want to add liquidity to fheWETH/USDC"                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Single API call
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      FheatherXRouter                             │
│                                                                  │
│  1. Detect token types (isFHERC20?)                             │
│  2. Determine target contract                                    │
│  3. Route call with appropriate parameters                       │
│  4. Handle wrap/unwrap if integrated (see Feature 8)            │
└─────────────────────────────────────────────────────────────────┘
                    │                          │
                    ▼                          ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐
│     FheatherXv8FHE          │  │     FheatherXv8Mixed        │
│                             │  │                             │
│  - fheWETH/fheUSDC pool     │  │  - fheWETH/USDC pool       │
│  - Encrypted operations     │  │  - fheUSDC/WETH pool       │
│                             │  │  - Mixed operations         │
└─────────────────────────────┘  └─────────────────────────────┘
```

### Core Functions

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IFheatherXv8FHE} from "./interfaces/IFheatherXv8FHE.sol";
import {IFheatherXv8Mixed} from "./interfaces/IFheatherXv8Mixed.sol";
import {InEuint128} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title FheatherXRouter
/// @notice Unified interface for FheatherX v8 pool contracts
/// @dev Routes operations to v8FHE or v8Mixed based on pool/token types
contract FheatherXRouter {

    IFheatherXv8FHE public immutable v8FHE;
    IFheatherXv8Mixed public immutable v8Mixed;

    // Registry: poolId -> contract type
    enum PoolType { NONE, FHE_FHE, FHE_ERC, ERC_FHE }
    mapping(PoolId => PoolType) public poolTypes;

    // ═══════════════════════════════════════════════════════════
    //                      LIQUIDITY
    // ═══════════════════════════════════════════════════════════

    /// @notice Add liquidity to any pool type
    /// @dev Routes to v8FHE or v8Mixed based on registered pool type
    function addLiquidity(
        PoolId poolId,
        InEuint128 calldata encAmount0,
        InEuint128 calldata encAmount1
    ) external {
        PoolType ptype = poolTypes[poolId];

        if (ptype == PoolType.FHE_FHE) {
            // Both tokens FHERC20 - use v8FHE
            v8FHE.addLiquidity(poolId, encAmount0, encAmount1);
        } else if (ptype == PoolType.FHE_ERC || ptype == PoolType.ERC_FHE) {
            // Mixed - use v8Mixed encrypted path
            v8Mixed.addLiquidityEncrypted(poolId, encAmount0, encAmount1);
        } else {
            revert("Pool not registered");
        }
    }

    /// @notice Remove liquidity from any pool type
    function removeLiquidity(
        PoolId poolId,
        InEuint128 calldata encLpAmount
    ) external {
        PoolType ptype = poolTypes[poolId];

        if (ptype == PoolType.FHE_FHE) {
            v8FHE.removeLiquidity(poolId, encLpAmount);
        } else {
            v8Mixed.removeLiquidityEncrypted(poolId, encLpAmount);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //                      LIMIT ORDERS
    // ═══════════════════════════════════════════════════════════

    /// @notice Place a limit order (deposit to bucket)
    function deposit(
        PoolId poolId,
        int24 tick,
        uint8 side,  // 0=BUY, 1=SELL
        InEuint128 calldata encAmount,
        uint256 deadline,
        int24 maxTickDrift
    ) external {
        PoolType ptype = poolTypes[poolId];

        if (ptype == PoolType.FHE_FHE) {
            v8FHE.deposit(poolId, tick, IFheatherXv8FHE.BucketSide(side), encAmount, deadline, maxTickDrift);
        } else {
            v8Mixed.deposit(poolId, tick, IFheatherXv8Mixed.BucketSide(side), encAmount, deadline, maxTickDrift);
        }
    }

    /// @notice Cancel/withdraw from a limit order
    function withdraw(
        PoolId poolId,
        int24 tick,
        uint8 side,
        InEuint128 calldata encAmount
    ) external {
        PoolType ptype = poolTypes[poolId];

        if (ptype == PoolType.FHE_FHE) {
            v8FHE.withdraw(poolId, tick, IFheatherXv8FHE.BucketSide(side), encAmount);
        } else {
            v8Mixed.withdraw(poolId, tick, IFheatherXv8Mixed.BucketSide(side), encAmount);
        }
    }

    /// @notice Claim proceeds from filled orders
    function claim(PoolId poolId, int24 tick, uint8 side) external {
        PoolType ptype = poolTypes[poolId];

        if (ptype == PoolType.FHE_FHE) {
            v8FHE.claim(poolId, tick, IFheatherXv8FHE.BucketSide(side));
        } else {
            v8Mixed.claim(poolId, tick, IFheatherXv8Mixed.BucketSide(side));
        }
    }

    // ═══════════════════════════════════════════════════════════
    //                      VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    /// @notice Get quote for a swap (routes to correct contract)
    function getQuote(
        PoolId poolId,
        bool zeroForOne,
        uint256 amountIn
    ) external view returns (uint256) {
        PoolType ptype = poolTypes[poolId];

        if (ptype == PoolType.FHE_FHE) {
            return v8FHE.getQuote(poolId, zeroForOne, amountIn);
        } else {
            return v8Mixed.getQuote(poolId, zeroForOne, amountIn);
        }
    }

    /// @notice Get reserves (routes to correct contract)
    function getReserves(PoolId poolId) external view returns (uint256, uint256) {
        PoolType ptype = poolTypes[poolId];

        if (ptype == PoolType.FHE_FHE) {
            return v8FHE.getReserves(poolId);
        } else {
            return v8Mixed.getReserves(poolId);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //                      ADMIN: POOL REGISTRATION
    // ═══════════════════════════════════════════════════════════

    /// @notice Register a pool's type for routing
    /// @dev Called after pool initialization
    function registerPool(PoolId poolId, PoolType ptype) external onlyOwner {
        require(poolTypes[poolId] == PoolType.NONE, "Already registered");
        poolTypes[poolId] = ptype;
        emit PoolRegistered(poolId, ptype);
    }
}
```

### Multi-Hop Swaps

The router can also enable **multi-hop swaps** across different pool types:

```solidity
/// @notice Execute multi-hop swap across multiple pools
/// @param path Array of tokens in swap path
/// @param poolIds Array of pool IDs (length = path.length - 1)
/// @param amountIn Input amount (encrypted)
/// @param minAmountOut Minimum output (encrypted)
function swapMultiHop(
    address[] calldata path,
    PoolId[] calldata poolIds,
    InEuint128 calldata amountIn,
    InEuint128 calldata minAmountOut
) external returns (uint256 amountOut) {
    // Example: fheWETH -> fheUSDC -> WETH
    // Hop 1: fheWETH/fheUSDC via v8FHE
    // Hop 2: fheUSDC/WETH via v8Mixed

    require(path.length >= 2 && poolIds.length == path.length - 1, "Invalid path");

    // Execute each hop, carrying output to next input
    // ... implementation details ...
}
```

### Integration with FHE Vault (Feature 8)

When combined with the FHE Token Vault (see next feature), the router can auto-wrap/unwrap:

```solidity
/// @notice Swap with automatic wrapping of input token
/// @dev User sends ERC20, router wraps to FHERC20, swaps, returns result
function swapWithAutoWrap(
    address tokenIn,      // ERC20 token
    address tokenOut,     // Can be ERC20 or FHERC20
    uint256 amountIn,
    uint256 minAmountOut
) external returns (uint256 amountOut) {
    // 1. Transfer ERC20 from user
    // 2. Wrap via FheVault -> get FHERC20
    // 3. Execute swap through appropriate pool
    // 4. If tokenOut is ERC20, unwrap via FheVault
    // 5. Return output to user
}
```

### Benefits

| Without Router | With Router |
|---------------|-------------|
| Frontend must detect token types | Single API for all pools |
| Different addresses per pool type | One router address |
| Manual pool contract selection | Automatic routing |
| No multi-hop | Cross-pool-type swaps possible |
| Manual wrap/unwrap | Auto wrap/unwrap (with Vault) |

### Implementation Priority

**Medium-High** - Simplifies frontend integration significantly. Can be implemented incrementally:
1. Phase 1: Basic routing (addLiquidity, deposit, withdraw, claim)
2. Phase 2: Multi-hop swaps
3. Phase 3: Auto wrap/unwrap integration with FHE Vault

---

## 8. FHE Token Vault: Universal ERC20 to FHERC20 Wrapper

### Problem

Currently, to trade privately on FheatherX, users need FHERC20 tokens. But:

1. **Limited FHERC20 supply** - Only tokens with native FHERC20 implementations work
2. **No wrapping standard** - Each FHERC20 has its own wrap/unwrap implementation
3. **Friction** - Users must manually wrap tokens before trading

### Proposed Solution: FheVault

A **universal vault contract** that can wrap **any ERC20** into a standardized FHERC20 wrapper token.

```
┌─────────────────────────────────────────────────────────────────┐
│                          User                                    │
│                                                                  │
│  Has: 1000 USDC (standard ERC20)                                │
│  Wants: Private trading on FheatherX                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ deposit(USDC, 1000)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         FheVault                                 │
│                                                                  │
│  1. Transfer 1000 USDC from user to vault                       │
│  2. Mint 1000 fheUSDC (wrapped) to user's encrypted balance     │
│  3. Store: totalDeposited[USDC] += 1000                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FheWrappedToken (fheUSDC)                     │
│                                                                  │
│  - Standard FHERC20 interface                                   │
│  - Backed 1:1 by USDC in vault                                  │
│  - Can be used in any FheatherX pool                            │
└─────────────────────────────────────────────────────────────────┘
```

### Core Architecture

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {FHE, euint128, InEuint128} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {FheWrappedToken} from "./FheWrappedToken.sol";

/// @title FheVault
/// @notice Universal wrapper for converting any ERC20 to FHERC20
/// @dev Creates and manages FheWrappedToken contracts for each underlying token
contract FheVault {
    using SafeERC20 for IERC20;

    // Mapping: underlying ERC20 -> wrapped FHERC20 token
    mapping(address => FheWrappedToken) public wrappedTokens;

    // Track total deposits per underlying token
    mapping(address => uint256) public totalDeposited;

    event TokenWrapped(address indexed underlying, address indexed wrapper);
    event Deposit(address indexed underlying, address indexed user, uint256 amount);
    event Withdraw(address indexed underlying, address indexed user, uint256 amount);

    // ═══════════════════════════════════════════════════════════
    //                      WRAPPER CREATION
    // ═══════════════════════════════════════════════════════════

    /// @notice Create a wrapped FHERC20 for an underlying ERC20
    /// @dev One wrapper per underlying token
    function createWrapper(
        address underlying,
        string memory name,
        string memory symbol
    ) external returns (FheWrappedToken wrapper) {
        require(address(wrappedTokens[underlying]) == address(0), "Wrapper exists");

        // Deploy new FheWrappedToken
        wrapper = new FheWrappedToken(
            underlying,
            name,      // e.g., "FHE Wrapped USDC"
            symbol,    // e.g., "fheUSDC"
            IERC20(underlying).decimals()
        );

        wrappedTokens[underlying] = wrapper;
        emit TokenWrapped(underlying, address(wrapper));
    }

    // ═══════════════════════════════════════════════════════════
    //                      DEPOSIT (WRAP)
    // ═══════════════════════════════════════════════════════════

    /// @notice Deposit ERC20 and receive FHERC20 wrapper tokens
    /// @param underlying The ERC20 token to wrap
    /// @param amount Amount to deposit
    function deposit(address underlying, uint256 amount) external {
        FheWrappedToken wrapper = wrappedTokens[underlying];
        require(address(wrapper) != address(0), "No wrapper");
        require(amount > 0, "Zero amount");

        // Transfer underlying from user to vault
        IERC20(underlying).safeTransferFrom(msg.sender, address(this), amount);

        // Track deposits
        totalDeposited[underlying] += amount;

        // Mint wrapped tokens to user's encrypted balance
        wrapper.mintEncrypted(msg.sender, amount);

        emit Deposit(underlying, msg.sender, amount);
    }

    /// @notice Deposit with percentage-based accounting (for reflection tokens)
    /// @dev Handles tokens that have transfer fees or rebasing mechanics
    function depositWithSlippage(
        address underlying,
        uint256 amount,
        uint256 minReceived
    ) external {
        FheWrappedToken wrapper = wrappedTokens[underlying];
        require(address(wrapper) != address(0), "No wrapper");

        uint256 balanceBefore = IERC20(underlying).balanceOf(address(this));
        IERC20(underlying).safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = IERC20(underlying).balanceOf(address(this));

        // Actual received (handles reflection/fee tokens)
        uint256 received = balanceAfter - balanceBefore;
        require(received >= minReceived, "Slippage too high");

        totalDeposited[underlying] += received;
        wrapper.mintEncrypted(msg.sender, received);

        emit Deposit(underlying, msg.sender, received);
    }

    // ═══════════════════════════════════════════════════════════
    //                      WITHDRAW (UNWRAP)
    // ═══════════════════════════════════════════════════════════

    /// @notice Withdraw underlying ERC20 by burning FHERC20 wrapper tokens
    /// @param underlying The underlying ERC20 token
    /// @param encAmount Encrypted amount to withdraw
    function withdraw(
        address underlying,
        InEuint128 calldata encAmount
    ) external {
        FheWrappedToken wrapper = wrappedTokens[underlying];
        require(address(wrapper) != address(0), "No wrapper");

        // Burn from user's encrypted balance
        uint256 amount = wrapper.burnEncryptedFrom(msg.sender, encAmount);

        // Transfer underlying to user
        totalDeposited[underlying] -= amount;
        IERC20(underlying).safeTransfer(msg.sender, amount);

        emit Withdraw(underlying, msg.sender, amount);
    }

    /// @notice Withdraw with percentage-based redemption
    /// @dev For rebasing tokens where 1:1 ratio may not hold
    function withdrawProRata(
        address underlying,
        InEuint128 calldata encShares
    ) external {
        FheWrappedToken wrapper = wrappedTokens[underlying];

        // Calculate pro-rata share of underlying
        // userAmount = (userShares / totalWrappedSupply) * vaultBalance
        uint256 vaultBalance = IERC20(underlying).balanceOf(address(this));
        uint256 totalSupply = wrapper.totalSupply();

        // Burn shares
        uint256 shares = wrapper.burnEncryptedFrom(msg.sender, encShares);

        // Pro-rata calculation
        uint256 amount = (shares * vaultBalance) / totalSupply;

        IERC20(underlying).safeTransfer(msg.sender, amount);
        emit Withdraw(underlying, msg.sender, amount);
    }

    // ═══════════════════════════════════════════════════════════
    //                      VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    /// @notice Get the wrapper token for an underlying
    function getWrapper(address underlying) external view returns (address) {
        return address(wrappedTokens[underlying]);
    }

    /// @notice Get exchange rate (for rebasing tokens)
    /// @return rate Tokens per share (1e18 = 1:1)
    function getExchangeRate(address underlying) external view returns (uint256 rate) {
        FheWrappedToken wrapper = wrappedTokens[underlying];
        uint256 totalSupply = wrapper.totalSupply();
        if (totalSupply == 0) return 1e18;

        uint256 vaultBalance = IERC20(underlying).balanceOf(address(this));
        return (vaultBalance * 1e18) / totalSupply;
    }
}
```

### FheWrappedToken Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint128, InEuint128, Common} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @title FheWrappedToken
/// @notice FHERC20 wrapper token created by FheVault
/// @dev Standard FHERC20 interface, backed by underlying ERC20 in vault
contract FheWrappedToken is IERC20Metadata {
    address public immutable vault;
    address public immutable underlying;
    string private _name;
    string private _symbol;
    uint8 private _decimals;

    // Encrypted balances
    mapping(address => euint128) private _encBalances;
    euint128 private _encTotalSupply;

    // Plaintext tracking for compatibility
    uint256 private _totalSupply;

    modifier onlyVault() {
        require(msg.sender == vault, "Only vault");
        _;
    }

    constructor(
        address _underlying,
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) {
        vault = msg.sender;
        underlying = _underlying;
        _name = name_;
        _symbol = symbol_;
        _decimals = decimals_;
    }

    // ═══════════════════════════════════════════════════════════
    //                      VAULT FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    /// @notice Mint to user's encrypted balance (called by vault on deposit)
    function mintEncrypted(address to, uint256 amount) external onlyVault {
        euint128 encAmount = FHE.asEuint128(uint128(amount));

        if (Common.isInitialized(_encBalances[to])) {
            _encBalances[to] = FHE.add(_encBalances[to], encAmount);
        } else {
            _encBalances[to] = encAmount;
        }

        _encTotalSupply = FHE.add(_encTotalSupply, encAmount);
        _totalSupply += amount;

        FHE.allowThis(_encBalances[to]);
        FHE.allow(_encBalances[to], to);
        FHE.allowThis(_encTotalSupply);
    }

    /// @notice Burn from user's encrypted balance (called by vault on withdraw)
    /// @return amount The decrypted amount burned
    function burnEncryptedFrom(
        address from,
        InEuint128 calldata encAmount
    ) external onlyVault returns (uint256 amount) {
        euint128 burnAmount = FHE.asEuint128(encAmount);

        // Subtract from user balance
        _encBalances[from] = FHE.sub(_encBalances[from], burnAmount);
        _encTotalSupply = FHE.sub(_encTotalSupply, burnAmount);

        // Decrypt to get actual amount for underlying transfer
        FHE.decrypt(burnAmount);
        amount = FHE.getDecryptResult(burnAmount);

        _totalSupply -= amount;

        FHE.allowThis(_encBalances[from]);
        FHE.allow(_encBalances[from], from);
        FHE.allowThis(_encTotalSupply);
    }

    // ... standard FHERC20 interface functions ...
}
```

### Handling Special Token Types

#### Reflection Tokens (e.g., SAFEMOON-style)

```solidity
/// @notice Check if token has transfer fees
function hasTransferFee(address token) public view returns (bool) {
    // Send 1 wei to self, check if received < sent
    // Or use known registry of fee tokens
}
```

For reflection tokens, use `depositWithSlippage()` and `withdrawProRata()`:
- Deposit records actual tokens received (after reflection fee)
- Withdraw calculates pro-rata share of vault balance

#### Rebasing Tokens (e.g., stETH, aUSDC)

For tokens that change balance over time:
1. Use share-based accounting (not 1:1)
2. Exchange rate = vaultBalance / totalShares
3. Users redeem shares for proportional underlying

```solidity
// User deposits 100 stETH when vault has 1000 stETH, 1000 shares
// User gets 100 shares (100/1000 * 1000)
// Later, stETH rebases +10%, vault now has 1100 stETH
// User's 100 shares are worth 110 stETH (100/1000 * 1100)
```

### Existing Models to Research

| Protocol | Mechanism | Notes |
|----------|-----------|-------|
| **Wrapped ETH (WETH)** | 1:1 deposit/withdraw | Simple, no rebasing |
| **Compound cTokens** | Exchange rate model | Handles yield accrual |
| **Aave aTokens** | Rebasing balance | Balance changes automatically |
| **Yearn yVaults** | Share-based | pricePerShare increases over time |
| **Lido wstETH** | Wrapped rebasing | Non-rebasing wrapper for stETH |

**Recommendation:** Start with **Yearn yVault model** (share-based) as it handles both:
- Simple 1:1 tokens (exchange rate stays 1.0)
- Rebasing/yield tokens (exchange rate increases)

### Integration with Router

The FheVault can be integrated with FheatherXRouter for seamless UX:

```solidity
/// @notice Swap with automatic wrapping (user sends ERC20)
function swapWithWrap(
    address tokenIn,      // ERC20 (will be wrapped)
    address tokenOut,     // FHERC20 or ERC20
    uint256 amountIn,
    uint256 minAmountOut
) external {
    // 1. Wrap tokenIn via vault
    fheVault.deposit(tokenIn, amountIn);
    address wrappedIn = fheVault.getWrapper(tokenIn);

    // 2. Execute swap through FheatherX
    // ... swap logic using wrapped token ...

    // 3. If tokenOut is ERC20, unwrap result
    // ... unwrap logic ...
}
```

### Security Considerations

1. **Reentrancy**: Use ReentrancyGuard on deposit/withdraw
2. **Token Whitelist**: Consider allowlist for supported underlying tokens
3. **Oracle Manipulation**: For rebasing tokens, use time-weighted averages
4. **Decimal Handling**: Handle tokens with non-18 decimals correctly
5. **Approval Race**: Use safeIncreaseAllowance patterns

### Implementation Priority

**Medium** - Enables any ERC20 to participate in FheatherX, dramatically expanding supported tokens:
- Phase 1: Basic vault for standard ERC20 tokens (1:1 wrap/unwrap)
- Phase 2: Share-based accounting for rebasing tokens
- Phase 3: Router integration for auto-wrap swaps

---

---

## 9. Maker/Taker Race Condition Protection

### Problem

**REVIEW NEEDED:** There is a potential race condition when users place limit orders where a **maker order could become a taker order** due to price movement between UI display and transaction execution.

#### Scenario

1. User sees current price at tick 1000
2. User wants to place a **limit-buy** (maker) at tick 940 (below current)
3. User submits transaction
4. While transaction is pending, price drops to tick 900
5. Tick 940 is now **above** current (900), not below
6. What was intended as a **limit-buy (maker)** becomes a **stop-buy (taker)**

#### Impact

| Intended | Actual (after race) | Consequence |
|----------|---------------------|-------------|
| Maker (limit-buy) | Taker (stop-buy) | Up to 100% slippage instead of exact price |
| Maker (limit-sell) | Taker (stop-loss) | Up to 100% slippage instead of exact price |

The user's order classification changes based on tick position relative to current price at execution time, not submission time.

### Current Frontend Handling

The `LimitOrderForm` has `maxTickDrift` parameter passed to the contract:

```typescript
// From deposit function call
deadline: bigint,
maxTickDrift: number  // e.g., 10 ticks
```

**Question:** Does the contract currently enforce that the order type (maker vs taker) cannot change? Or does it only prevent orders if price has moved too far from expected?

### Potential Solutions

#### Option A: Order Type Lock-in at Submission

Store the intended order type (maker/taker) in the transaction and validate on-chain:

```solidity
function deposit(
    PoolId poolId,
    int24 tick,
    BucketSide side,
    InEuint128 calldata encAmount,
    uint256 deadline,
    int24 maxTickDrift,
    bool isMakerOrder  // NEW: explicit order type from user
) external {
    int24 currentTick = _getCurrentTick(poolId);

    if (isMakerOrder) {
        // Maker orders: tick must be on the "resting" side
        // BUY maker: tick <= currentTick
        // SELL maker: tick >= currentTick
        require(_isValidMakerPosition(tick, side, currentTick), "Would become taker");
    }
    // ... rest of deposit logic
}
```

#### Option B: Stricter maxTickDrift Enforcement

Ensure `maxTickDrift` prevents the order from crossing from maker to taker territory:

```solidity
// If user intended maker order at tick 940 when current was 1000
// maxTickDrift should prevent execution if current is now < 940
// (which would make 940 a taker position)
```

#### Option C: Separate Contract Functions

Have distinct functions for maker vs taker orders with different validation:

```solidity
function depositMaker(...) external {
    // Validates tick is on maker side (resting liquidity)
}

function depositTaker(...) external {
    // Validates tick is on taker side (momentum order)
}
```

### Questions to Resolve

1. **What is the current `maxTickDrift` behavior?** Does it prevent maker→taker transitions?
2. **Should we fail the transaction or auto-adjust?** If order would become taker, reject or allow with warning?
3. **How do other DEXs handle this?** Research dYdX, GMX, etc.
4. **Is this a real problem in practice?** How often does price move enough during transaction pending time?

### Related Code

- `LimitOrderForm.tsx`: `maxTickDrift` parameter
- `FheatherXv8Mixed.sol` / `FheatherXv8FHE.sol`: `deposit()` function
- `types/bucket.ts`: `ORDER_TYPE_CONFIG` defines maker/taker modes

### Priority

**High** - This could cause unexpected slippage for users who believe they're placing exact-price maker orders.

---

## Implementation Priority

1. **High Priority:** FheatherXPeriphery (unlocks ecosystem integration)
2. **High Priority:** Maker/Taker Race Condition Protection (prevents unexpected slippage)
3. **Medium-High Priority:** Hybrid Order Book + AMM matching (proper limit order execution)
4. **Medium-High Priority:** cancelOrder function (improves position tracking UX)
5. **Medium-High Priority:** FheatherXRouter (unified interface, simplifies frontend)
6. **Medium Priority:** FHE Token Vault (universal ERC20 wrapping)
7. **Medium Priority:** Auto-wrap on deposit (improves UX)
8. **Medium Priority:** FHE.div optimization (reduces gas costs)
9. **Medium Priority:** Official Fhenix FHERC20 support (ecosystem compatibility)
10. **Lower Priority:** Cross-chain bridges (complex, future roadmap)
