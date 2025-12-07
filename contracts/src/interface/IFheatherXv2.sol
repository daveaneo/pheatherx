// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {euint128, ebool, InEuint128, InEbool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title IFheatherXv2
/// @notice Interface for FheatherXv2 - Private AMM with FHE
/// @dev Single-transaction swaps with two entry paths: plaintext (router-compatible) and encrypted (full privacy)
interface IFheatherXv2 {
    // ============ Events ============

    /// @notice Emitted when a plaintext swap is executed
    event Swap(
        address indexed user,
        bool zeroForOne,
        uint256 amountIn,
        uint256 amountOut
    );

    /// @notice Emitted when an encrypted swap is executed
    event SwapEncrypted(address indexed user);

    /// @notice Emitted when a limit order is placed
    event OrderPlaced(
        uint256 indexed orderId,
        address indexed owner,
        int24 triggerTick
    );

    /// @notice Emitted when a limit order is cancelled
    event OrderCancelled(uint256 indexed orderId, address indexed owner);

    /// @notice Emitted when a limit order is filled
    event OrderFilled(
        uint256 indexed orderId,
        address indexed owner,
        address indexed executor
    );

    /// @notice Emitted when reserve sync is requested
    event ReserveSyncRequested(uint256 blockNumber);

    /// @notice Emitted when reserves are synced from encrypted to public cache
    event ReservesSynced(uint256 reserve0, uint256 reserve1);

    /// @notice Emitted when liquidity is added
    event LiquidityAdded(
        address indexed provider,
        uint256 amount0,
        uint256 amount1,
        uint256 lpAmount
    );

    /// @notice Emitted when liquidity is removed
    event LiquidityRemoved(
        address indexed provider,
        uint256 amount0,
        uint256 amount1,
        uint256 lpAmount
    );

    // ============ Errors ============

    error SlippageExceeded();
    error InsufficientLiquidity();
    error InsufficientFee();
    error OrderNotFound();
    error OrderNotActive();
    error NotOrderOwner();
    error InvalidTick();
    error ZeroAmount();
    error StaleReserves();

    // ============ Structs ============

    /// @notice Limit order structure with 4 order types via isSell × triggerAbove
    /// @dev isSell=false, triggerAbove=false → Buy Limit (buy when price drops below)
    /// @dev isSell=false, triggerAbove=true  → Buy Stop (buy when price rises above)
    /// @dev isSell=true,  triggerAbove=true  → Sell Limit (sell when price rises above)
    /// @dev isSell=true,  triggerAbove=false → Sell Stop (sell when price drops below)
    struct Order {
        address owner;
        int24 triggerTick;      // The price point (plaintext - needed for bitmap)
        ebool isSell;           // true = selling token0, false = buying token0
        ebool triggerAbove;     // true = trigger when price goes ABOVE tick
        euint128 amount;        // Encrypted amount
        euint128 minOutput;     // Encrypted slippage protection
        bool active;
    }

    // ============ Swap Functions ============

    /// @notice Swap with plaintext ERC20 tokens (router-compatible)
    /// @dev Hook takes input, encrypts, executes swap math, estimates output, sends to user
    /// @param zeroForOne True to swap token0 for token1, false for opposite
    /// @param amountIn Amount of input token to swap
    /// @param minAmountOut Minimum output amount (slippage protection)
    /// @return amountOut The actual output amount
    function swap(
        bool zeroForOne,
        uint256 amountIn,
        uint256 minAmountOut
    ) external returns (uint256 amountOut);

    /// @notice Swap with FHERC20 tokens (full privacy - amount never revealed)
    /// @dev Uses transferFromEncrypted for input, transferEncryptedDirect for output
    /// @param direction Encrypted direction (true = zeroForOne)
    /// @param amountIn Encrypted amount to swap
    /// @param minOutput Encrypted minimum output (slippage protection)
    /// @return amountOut The encrypted output amount
    function swapEncrypted(
        InEbool calldata direction,
        InEuint128 calldata amountIn,
        InEuint128 calldata minOutput
    ) external returns (euint128 amountOut);

    // ============ Limit Order Functions ============

    /// @notice Place a limit order (locks FHERC20 tokens)
    /// @dev Transfers encrypted tokens from user to contract
    /// @param triggerTick The tick at which the order triggers
    /// @param isSell Encrypted: true = selling token0 for token1
    /// @param triggerAbove Encrypted: true = trigger when price goes above tick
    /// @param amount Encrypted amount to trade
    /// @param minOutput Encrypted minimum output for slippage protection
    /// @return orderId The ID of the created order
    function placeOrder(
        int24 triggerTick,
        InEbool calldata isSell,
        InEbool calldata triggerAbove,
        InEuint128 calldata amount,
        InEuint128 calldata minOutput
    ) external payable returns (uint256 orderId);

    /// @notice Cancel an active order (returns FHERC20 tokens)
    /// @param orderId The ID of the order to cancel
    function cancelOrder(uint256 orderId) external;

    // ============ Liquidity Functions ============

    /// @notice Add liquidity with plaintext ERC20 tokens
    /// @param amount0 Amount of token0 to add
    /// @param amount1 Amount of token1 to add
    /// @return lpAmount The LP tokens minted
    function addLiquidity(
        uint256 amount0,
        uint256 amount1
    ) external returns (uint256 lpAmount);

    /// @notice Remove liquidity and receive plaintext ERC20 tokens
    /// @param lpAmount Amount of LP tokens to burn
    /// @return amount0 Amount of token0 received
    /// @return amount1 Amount of token1 received
    function removeLiquidity(
        uint256 lpAmount
    ) external returns (uint256 amount0, uint256 amount1);

    /// @notice Add liquidity with FHERC20 tokens (encrypted)
    /// @param amount0 Encrypted amount of token0 to add
    /// @param amount1 Encrypted amount of token1 to add
    /// @return lpAmount The encrypted LP tokens minted
    function addLiquidityEncrypted(
        InEuint128 calldata amount0,
        InEuint128 calldata amount1
    ) external returns (euint128 lpAmount);

    /// @notice Remove liquidity and receive FHERC20 tokens (encrypted)
    /// @param lpAmount Encrypted amount of LP tokens to burn
    /// @return amount0 Encrypted amount of token0 received
    /// @return amount1 Encrypted amount of token1 received
    function removeLiquidityEncrypted(
        InEuint128 calldata lpAmount
    ) external returns (euint128 amount0, euint128 amount1);

    // ============ View Functions ============

    /// @notice Get the public (cached) reserves
    /// @dev These are eventually consistent with encrypted reserves
    /// @return reserve0 The cached reserve of token0
    /// @return reserve1 The cached reserve of token1
    function getReserves() external returns (uint256 reserve0, uint256 reserve1);

    /// @notice Get all active order IDs for a user
    /// @param user The user address
    /// @return An array of active order IDs
    function getActiveOrders(address user) external view returns (uint256[] memory);

    /// @notice Get the count of active orders for a user
    /// @param user The user address
    /// @return The number of active orders
    function getOrderCount(address user) external view returns (uint256);

    /// @notice Check if a tick has orders
    /// @param tick The tick to check
    /// @return True if the tick has orders
    function hasOrdersAtTick(int24 tick) external view returns (bool);

    /// @notice Force a reserve sync (anyone can call, pays gas)
    function forceSyncReserves() external;

    /// @notice Estimate output for a plaintext swap
    /// @param zeroForOne True to swap token0 for token1
    /// @param amountIn Amount of input token
    /// @return amountOut Estimated output amount
    function estimateOutput(
        bool zeroForOne,
        uint256 amountIn
    ) external view returns (uint256 amountOut);
}
