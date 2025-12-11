// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {euint128, InEuint128} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title IFHERC20
/// @notice Interface for FHERC20 tokens with encrypted balances
/// @dev Follows Fhenix FHERC20 standard function names
interface IFHERC20 {
    /// @notice Transfer encrypted tokens from one address to another (EOA/frontend input)
    /// @param from The address to transfer from
    /// @param to The address to transfer to
    /// @param encryptedAmount The encrypted amount to transfer
    /// @return amount The euint128 amount that was transferred (for use by caller)
    function transferFromEncrypted(
        address from,
        address to,
        InEuint128 calldata encryptedAmount
    ) external returns (euint128 amount);

    /// @notice Transfer encrypted tokens (direct euint128 for contract-to-contract)
    /// @dev Fhenix standard name with underscore prefix
    /// @param to The address to transfer to
    /// @param amount The encrypted amount handle
    /// @return The euint128 amount that was transferred
    function _transferEncrypted(
        address to,
        euint128 amount
    ) external returns (euint128);

    /// @notice Transfer encrypted tokens from one address to another (direct euint128 for contract-to-contract)
    /// @dev Fhenix standard name with underscore prefix
    /// @param from The address to transfer from
    /// @param to The address to transfer to
    /// @param amount The encrypted amount handle (caller must have allowance)
    /// @return The euint128 amount that was transferred
    function _transferFromEncrypted(
        address from,
        address to,
        euint128 amount
    ) external returns (euint128);

    /// @notice Get encrypted balance handle
    /// @param account The address to query
    /// @return The encrypted balance handle
    function balanceOfEncrypted(address account) external view returns (euint128);

    /// @notice Check if account has an initialized encrypted balance
    /// @param account The address to check
    /// @return True if the account has an encrypted balance
    function hasEncryptedBalance(address account) external view returns (bool);

    /// @notice Approve spender to transfer encrypted tokens
    /// @param spender The address to approve
    /// @param amount The encrypted amount to approve
    function approveEncrypted(address spender, InEuint128 calldata amount) external returns (bool);
}
