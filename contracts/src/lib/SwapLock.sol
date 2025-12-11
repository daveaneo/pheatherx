// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

/// @title SwapLock
/// @notice Prevents atomic sandwich attacks by limiting to one swap per pool per transaction
/// @dev Uses transient storage (EIP-1153) with pool-specific keys that auto-reset between transactions
library SwapLock {
    // keccak256("fheatherx.swap.lock.v1")
    bytes32 private constant SWAP_LOCK_SEED = 0x7a2c4f8e9d3b1a0c5f2e8d7b6a9c4f3e2d1b0a9c8f7e6d5c4b3a2918d7c6b5a4;

    /// @notice Ensures only one swap per pool per transaction
    /// @dev First swap on a pool sets the lock, subsequent swaps on the same pool revert
    /// @param poolId The pool being swapped on
    function enforceOnce(PoolId poolId) internal {
        bytes32 slot = keccak256(abi.encodePacked(SWAP_LOCK_SEED, PoolId.unwrap(poolId)));
        uint256 locked;
        assembly {
            locked := tload(slot)
        }
        require(locked == 0, "SwapLock: one swap per pool per tx");
        assembly {
            tstore(slot, 1)
        }
    }

    /// @notice Check if a swap has already occurred for a pool this transaction
    /// @param poolId The pool to check
    /// @return True if a swap has occurred for this pool in this transaction
    function hasSwapped(PoolId poolId) internal view returns (bool) {
        bytes32 slot = keccak256(abi.encodePacked(SWAP_LOCK_SEED, PoolId.unwrap(poolId)));
        uint256 locked;
        assembly {
            locked := tload(slot)
        }
        return locked != 0;
    }
}
