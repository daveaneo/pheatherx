// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {FHE, euint128, ebool, InEuint128, InEbool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @title PrivateSwapRouter
/// @notice Router for executing encrypted swaps through FheatherX v8 hooks
/// @dev Encodes encrypted parameters into hookData format expected by v8FHE and v8Mixed hooks.
///      The router converts InEuint128 → euint128 handles to validate signatures,
///      then passes handles to the hook which wraps them back.
///      - v8FHE pools: Full privacy (encrypted direction and amounts)
///      - v8Mixed pools: Partial privacy (plaintext direction, encrypted amounts)
contract PrivateSwapRouter {
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

        // Prepare dummy SwapParams - the hook ignores these for encrypted swaps
        // Use valid price limit to pass PoolManager validation (hook handles actual swap)
        SwapParams memory params = SwapParams({
            zeroForOne: true,  // Dummy - hook uses encrypted direction
            amountSpecified: -1, // Dummy - hook uses encrypted amount
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
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

        // Prepare dummy SwapParams - the hook ignores these for encrypted swaps
        // Use valid price limit to pass PoolManager validation (hook handles actual swap)
        SwapParams memory params = SwapParams({
            zeroForOne: zeroForOne,  // Match for consistency
            amountSpecified: -1,     // Dummy - hook uses encrypted amount
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
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
