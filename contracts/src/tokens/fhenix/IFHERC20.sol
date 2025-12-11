// SPDX-License-Identifier: MIT
// Adapted from Fhenix Protocol (last updated v0.1.0) (token/FHERC20/IFHERC20.sol)
// Modified to work with @fhenixprotocol/cofhe-contracts
pragma solidity >=0.8.19 <0.9.0;

import {euint128, InEuint128} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @dev Interface of the FHERC20 standard as defined by Fhenix.
 * Note: balanceOfEncrypted and allowanceEncrypted return euint128 handles
 * that can be unsealed client-side using cofhejs.
 */
interface IFHERC20 {
    /**
     * @dev Emitted when encrypted tokens are moved from one account to another.
     */
    event TransferEncrypted(address indexed from, address indexed to);

    /**
     * @dev Emitted when the encrypted allowance of a `spender` for an `owner` is set.
     */
    event ApprovalEncrypted(address indexed owner, address indexed spender);

    /**
     * @dev Returns the encrypted balance handle for `account`.
     * Use cofhejs to unseal the value client-side.
     */
    function balanceOfEncrypted(address account) external view returns (euint128);

    /**
     * @dev Moves encrypted `value` tokens from the caller's account to `to`.
     * Accepts the value as InEuint128 (encrypted input from EOA/frontend).
     * @return The euint128 amount that was actually transferred
     */
    function transferEncrypted(address to, InEuint128 calldata value) external returns (euint128);

    /**
     * @dev Moves encrypted `value` tokens from the caller's account to `to`.
     * Accepts the value as euint128 (for contract-to-contract calls).
     * @return The euint128 amount that was actually transferred
     */
    function _transferEncrypted(address to, euint128 value) external returns (euint128);

    /**
     * @dev Returns the encrypted allowance handle that `spender` is allowed to spend on behalf of `owner`.
     * Use cofhejs to unseal the value client-side.
     */
    function allowanceEncrypted(address owner, address spender) external view returns (euint128);

    /**
     * @dev Sets encrypted `value` as the allowance of `spender` over the caller's tokens.
     * Accepts the value as InEuint128 (encrypted input from EOA/frontend).
     * @return True if the operation succeeded
     */
    function approveEncrypted(address spender, InEuint128 calldata value) external returns (bool);

    /**
     * @dev Moves encrypted `value` tokens from `from` to `to` using the allowance mechanism.
     * Accepts the value as InEuint128 (encrypted input from EOA/frontend).
     * @return The euint128 amount that was actually transferred
     */
    function transferFromEncrypted(address from, address to, InEuint128 calldata value) external returns (euint128);

    /**
     * @dev Moves encrypted `value` tokens from `from` to `to` using the allowance mechanism.
     * Accepts the value as euint128 (for contract-to-contract calls).
     * @return The euint128 amount that was actually transferred
     */
    function _transferFromEncrypted(address from, address to, euint128 value) external returns (euint128);

    /**
     * @dev Checks if an account has an initialized encrypted balance.
     */
    function hasEncryptedBalance(address account) external view returns (bool);
}
