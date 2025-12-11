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

## Implementation Priority

1. **High Priority:** FheatherXPeriphery (unlocks ecosystem integration)
2. **Medium-High Priority:** cancelOrder function (improves position tracking UX)
3. **Medium Priority:** Auto-wrap on deposit (improves UX)
4. **Medium Priority:** FHE.div optimization (reduces gas costs)
5. **Medium Priority:** Official Fhenix FHERC20 support (ecosystem compatibility)
6. **Lower Priority:** Cross-chain bridges (complex, future roadmap)
