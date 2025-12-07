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

## Implementation Priority

1. **High Priority:** FheatherXPeriphery (unlocks ecosystem integration)
2. **Medium Priority:** Auto-wrap on deposit (improves UX)
3. **Lower Priority:** Cross-chain bridges (complex, future roadmap)
