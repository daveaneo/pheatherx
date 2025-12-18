// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {FHE, euint128, ebool, InEuint128, InEbool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

/// @title PrivateSwapRouter
/// @notice Router for executing encrypted swaps through FheatherX v8 hooks
/// @dev Encodes encrypted parameters into hookData format expected by v8FHE and v8Mixed hooks.
///      The router converts InEuint128 → euint128 handles to validate signatures,
///      then passes handles to the hook which wraps them back.
///      - v8FHE pools: Full privacy (encrypted direction and amounts)
///      - v8Mixed pools: Partial privacy (plaintext direction, encrypted amounts)
contract PrivateSwapRouter {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Magic byte to identify encrypted swap hookData
    bytes1 internal constant ENCRYPTED_SWAP_MAGIC = 0x01;

    // ═══════════════════════════════════════════════════════════════════════
    //                               STATE
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice The Uniswap v4 PoolManager
    IPoolManager public immutable poolManager;

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Emitted when an encrypted swap is initiated
    event EncryptedSwapInitiated(address indexed sender, address hook);

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error UnauthorizedCallback();

    // ═══════════════════════════════════════════════════════════════════════
    //                           CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                        ENCRYPTED SWAP (v8FHE)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Execute a fully private encrypted swap (for v8FHE pools)
    /// @dev Direction and amounts are all encrypted for maximum privacy.
    ///      Converts InEuint128 → euint128 handles (validates signatures here).
    ///      Requires user to have approved FHERC20 tokens to the HOOK (not router).
    /// @param key The pool key identifying the pool
    /// @param encDirection Encrypted direction (true = zeroForOne)
    /// @param encAmountIn Encrypted input amount
    /// @param encMinOutput Encrypted minimum output (slippage protection)
    function swapEncrypted(
        PoolKey calldata key,
        InEbool calldata encDirection,
        InEuint128 calldata encAmountIn,
        InEuint128 calldata encMinOutput
    ) external {
        // Convert to FHE types here (validates signatures with msg.sender = user)
        ebool direction = FHE.asEbool(encDirection);
        euint128 amountIn = FHE.asEuint128(encAmountIn);
        euint128 minOutput = FHE.asEuint128(encMinOutput);

        // Allow the hook to use these encrypted values
        FHE.allow(direction, address(key.hooks));
        FHE.allow(amountIn, address(key.hooks));
        FHE.allow(minOutput, address(key.hooks));

        // Extract handles (uint256) for encoding
        uint256 directionHandle = ebool.unwrap(direction);
        uint256 amountInHandle = euint128.unwrap(amountIn);
        uint256 minOutputHandle = euint128.unwrap(minOutput);

        // Encode hookData: magic + (sender, directionHandle, amountInHandle, minOutputHandle)
        bytes memory hookData = abi.encodePacked(
            ENCRYPTED_SWAP_MAGIC,
            abi.encode(msg.sender, directionHandle, amountInHandle, minOutputHandle)
        );

        // Query current pool price to determine valid swap direction
        // The hook handles the actual encrypted swap, but PoolManager validates price limits
        // before calling the hook. We must use valid limits to pass validation.
        PoolId poolId = key.toId();
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);

        // Choose dummy direction and limit that won't trigger PriceLimitAlreadyExceeded:
        // - For zeroForOne=true: limit must be < current price (selling token0 pushes price down)
        // - For zeroForOne=false: limit must be > current price (selling token1 pushes price up)
        //
        // To maximize validity regardless of current price:
        // - If current price is in the upper half (closer to MAX), use zeroForOne=true with MIN limit
        // - If current price is in the lower half (closer to MIN), use zeroForOne=false with MAX limit
        uint160 midPrice = (TickMath.MAX_SQRT_PRICE / 2) + (TickMath.MIN_SQRT_PRICE / 2);
        bool dummyZeroForOne = sqrtPriceX96 > midPrice;
        uint160 dummyLimit = dummyZeroForOne
            ? TickMath.MIN_SQRT_PRICE + 1
            : TickMath.MAX_SQRT_PRICE - 1;

        SwapParams memory params = SwapParams({
            zeroForOne: dummyZeroForOne,  // Dummy - hook uses encrypted direction
            amountSpecified: -1,           // Dummy - hook uses encrypted amount
            sqrtPriceLimitX96: dummyLimit  // Valid limit based on current price
        });

        emit EncryptedSwapInitiated(msg.sender, address(key.hooks));

        // Execute via PoolManager unlock pattern
        poolManager.unlock(abi.encode(CallbackData({
            sender: msg.sender,
            key: key,
            params: params,
            hookData: hookData
        })));
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                        ENCRYPTED SWAP (v8Mixed)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Execute a partially private encrypted swap (for v8Mixed pools)
    /// @dev Direction is plaintext (required for ERC20 handling), amounts are encrypted.
    ///      The FHERC20 side maintains privacy, ERC20 side is visible.
    /// @param key The pool key identifying the pool
    /// @param zeroForOne True if swapping token0 for token1 (plaintext for ERC20 handling)
    /// @param encAmountIn Encrypted input amount
    /// @param encMinOutput Encrypted minimum output (slippage protection)
    function swapMixed(
        PoolKey calldata key,
        bool zeroForOne,
        InEuint128 calldata encAmountIn,
        InEuint128 calldata encMinOutput
    ) external {
        // Convert to FHE types here (validates signatures with msg.sender = user)
        euint128 amountIn = FHE.asEuint128(encAmountIn);
        euint128 minOutput = FHE.asEuint128(encMinOutput);

        // Allow the hook to use these encrypted values
        FHE.allow(amountIn, address(key.hooks));
        FHE.allow(minOutput, address(key.hooks));

        // Extract handles (uint256) for encoding
        uint256 amountInHandle = euint128.unwrap(amountIn);
        uint256 minOutputHandle = euint128.unwrap(minOutput);

        // Encode hookData: magic + (sender, zeroForOne, amountInHandle, minOutputHandle)
        bytes memory hookData = abi.encodePacked(
            ENCRYPTED_SWAP_MAGIC,
            abi.encode(msg.sender, zeroForOne, amountInHandle, minOutputHandle)
        );

        // Query current pool price to validate the swap direction is valid
        // The hook handles the actual swap, but PoolManager validates price limits first
        PoolId poolId = key.toId();
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);

        // For v8Mixed, we use the actual direction but still need to ensure the price limit is valid
        // - For zeroForOne=true: limit must be < current price
        // - For zeroForOne=false: limit must be > current price
        //
        // Edge case: if current price is at the extreme, the swap may fail.
        // In that case, use a direction that's always valid.
        uint160 priceLimit;
        bool effectiveDirection = zeroForOne;

        if (zeroForOne) {
            // Check if MIN limit is valid (current price must be > MIN + 1)
            if (sqrtPriceX96 > TickMath.MIN_SQRT_PRICE + 1) {
                priceLimit = TickMath.MIN_SQRT_PRICE + 1;
            } else {
                // Current price is too low for zeroForOne, swap direction for PoolManager
                // Hook still uses the hookData direction
                effectiveDirection = false;
                priceLimit = TickMath.MAX_SQRT_PRICE - 1;
            }
        } else {
            // Check if MAX limit is valid (current price must be < MAX - 1)
            if (sqrtPriceX96 < TickMath.MAX_SQRT_PRICE - 1) {
                priceLimit = TickMath.MAX_SQRT_PRICE - 1;
            } else {
                // Current price is too high for oneForZero, swap direction for PoolManager
                effectiveDirection = true;
                priceLimit = TickMath.MIN_SQRT_PRICE + 1;
            }
        }

        SwapParams memory params = SwapParams({
            zeroForOne: effectiveDirection,
            amountSpecified: -1,  // Dummy - hook uses encrypted amount
            sqrtPriceLimitX96: priceLimit
        });

        emit EncryptedSwapInitiated(msg.sender, address(key.hooks));

        // Execute via PoolManager unlock pattern
        poolManager.unlock(abi.encode(CallbackData({
            sender: msg.sender,
            key: key,
            params: params,
            hookData: hookData
        })));
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                           CALLBACK
    // ═══════════════════════════════════════════════════════════════════════

    struct CallbackData {
        address sender;
        PoolKey key;
        SwapParams params;
        bytes hookData;
    }

    /// @notice Callback from PoolManager.unlock()
    /// @dev Executes the swap and handles any deltas (should be 0 for encrypted swaps)
    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert UnauthorizedCallback();

        CallbackData memory data = abi.decode(rawData, (CallbackData));

        // Execute the swap - hook will detect hookData and handle encrypted swap
        BalanceDelta delta = poolManager.swap(data.key, data.params, data.hookData);

        // For encrypted swaps, the hook handles all transfers directly via FHERC20
        // It returns NoOp deltas (0, 0), so no settlement is needed
        // Any non-zero deltas would indicate a bug or non-encrypted path

        return abi.encode(delta);
    }
}
