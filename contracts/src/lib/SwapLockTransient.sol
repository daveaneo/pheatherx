// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

/// @title SwapLockTransient - Transient storage swap reentrancy lock
/// @notice Uses EIP-1153 transient storage (TLOAD/TSTORE) for 100 gas ops vs 2100/20000
/// @dev Automatically cleared at end of transaction - no cleanup needed
library SwapLockTransient {
    /// @dev Slot prefix for swap locks
    bytes32 private constant LOCK_SLOT = keccak256("fheatherx.swap.lock.transient");

    error SwapAlreadyExecuted();

    /// @notice Enforce one swap per pool per transaction
    /// @dev Uses transient storage - automatically cleared after TX
    function enforceOnce(PoolId poolId) internal {
        bytes32 slot = keccak256(abi.encode(LOCK_SLOT, PoolId.unwrap(poolId)));
        bool locked;
        assembly {
            locked := tload(slot)
        }
        if (locked) revert SwapAlreadyExecuted();
        assembly {
            tstore(slot, 1)
        }
    }

    /// @notice Check if pool is locked (for view functions)
    function isLocked(PoolId poolId) internal view returns (bool locked) {
        bytes32 slot = keccak256(abi.encode(LOCK_SLOT, PoolId.unwrap(poolId)));
        assembly {
            locked := tload(slot)
        }
    }

    /// @notice Explicitly unlock (rarely needed - TX end clears automatically)
    function unlock(PoolId poolId) internal {
        bytes32 slot = keccak256(abi.encode(LOCK_SLOT, PoolId.unwrap(poolId)));
        assembly {
            tstore(slot, 0)
        }
    }
}
