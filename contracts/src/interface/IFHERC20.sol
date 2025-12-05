// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {euint128, InEuint128} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title IFHERC20
/// @notice Interface for FHERC20 tokens with encrypted balances
interface IFHERC20 {
    /// @notice Transfer encrypted tokens from one address to another
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
    /// @param to The address to transfer to
    /// @param amount The encrypted amount handle
    /// @return success True if the transfer succeeded
    function transferEncryptedDirect(
        address to,
        euint128 amount
    ) external returns (bool);

    /// @notice Transfer encrypted tokens from one address to another (direct euint128 for contract-to-contract)
    /// @param from The address to transfer from
    /// @param to The address to transfer to
    /// @param amount The encrypted amount handle (caller must have allowance)
    /// @return success True if the transfer succeeded
    function transferFromEncryptedDirect(
        address from,
        address to,
        euint128 amount
    ) external returns (bool);

    /// @notice Get encrypted balance handle
    /// @param account The address to query
    /// @return The encrypted balance handle
    function balanceOfEncrypted(address account) external view returns (euint128);

    /// @notice Check if account has an initialized encrypted balance
    /// @param account The address to check
    /// @return True if the account has an encrypted balance
    function hasEncryptedBalance(address account) external view returns (bool);
}
