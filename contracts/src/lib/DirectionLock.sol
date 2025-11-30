// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, ebool, euint128} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title DirectionLock
/// @notice Prevents probe attacks by ensuring only one swap direction per transaction
/// @dev Uses transient storage (EIP-1153) to auto-reset between transactions
library DirectionLock {
    // Transient storage slots (pre-computed keccak256 hashes)
    // keccak256("private.trade.has.swapped")
    uint256 private constant HAS_SWAPPED_SLOT = 0x0f67df2990a3d081c7d41116fd7c916c5a3fc049b10f18def3cb97cd8b37a6fc;
    // keccak256("private.trade.first.direction")
    uint256 private constant FIRST_DIRECTION_SLOT = 0x5a93af3f15b984b1b78a2b74092fc80db5a6ea490979c014d652c509d7935b21;
    // keccak256("private.trade.plaintext.direction")
    uint256 private constant PLAINTEXT_DIRECTION_SLOT = 0x649f6d4f47f0ae1a17d16e383e2572e98b47b3efb22d095d66e635fb2861e8be;

    /// @notice Enforces direction lock for encrypted swaps
    /// @dev First swap stores direction, subsequent swaps must match or amount is zeroed
    /// @param direction The encrypted direction of the current swap
    /// @param amount The encrypted amount to swap
    /// @param encZero Cached encrypted zero value for gas efficiency
    /// @return adjustedAmount The amount (unchanged if same direction, zero if different)
    function enforceDirectionLock(
        ebool direction,
        euint128 amount,
        euint128 encZero
    ) internal returns (euint128 adjustedAmount) {
        bool hasSwapped;
        assembly {
            hasSwapped := tload(HAS_SWAPPED_SLOT)
        }

        if (!hasSwapped) {
            // First swap this TX - store encrypted direction handle
            // ebool is a uint256 handle under the hood
            uint256 dirHandle = ebool.unwrap(direction);
            assembly {
                tstore(HAS_SWAPPED_SLOT, 1)
                tstore(FIRST_DIRECTION_SLOT, dirHandle)
            }
            return amount; // First swap always proceeds
        }

        // Subsequent swap - compare directions
        uint256 storedHandle;
        assembly {
            storedHandle := tload(FIRST_DIRECTION_SLOT)
        }
        ebool storedDirection = ebool.wrap(storedHandle);

        // If direction matches first swap, proceed. If different, zero out amount.
        ebool sameDirection = FHE.eq(storedDirection, direction);
        return FHE.select(sameDirection, amount, encZero);
    }

    /// @notice Checks if a swap has already occurred this transaction
    /// @return True if a swap has occurred
    function hasSwappedThisTx() internal view returns (bool) {
        bool hasSwapped;
        assembly {
            hasSwapped := tload(HAS_SWAPPED_SLOT)
        }
        return hasSwapped;
    }

    /// @notice Enforces direction lock for plaintext swaps (simpler version)
    /// @param zeroForOne The plaintext direction
    function enforcePlaintextDirectionLock(bool zeroForOne) internal {
        uint256 locked;
        assembly {
            locked := tload(PLAINTEXT_DIRECTION_SLOT)
        }

        uint256 dir = zeroForOne ? 1 : 2;
        require(locked == 0 || locked == dir, "DirectionLock: no direction reversal");

        assembly {
            tstore(PLAINTEXT_DIRECTION_SLOT, dir)
        }
    }
}
