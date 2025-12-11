// SPDX-License-Identifier: MIT
// Adapted from Fhenix Protocol (last updated v0.1.0) (token/FHERC20/FHERC20.sol)
// Modified to work with @fhenixprotocol/cofhe-contracts
pragma solidity >=0.8.19 <0.9.0;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {FHE, euint128, InEuint128, Common} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

import {IFHERC20} from "./IFHERC20.sol";

error ErrorInsufficientFunds();
error ERC20InvalidApprover(address);
error ERC20InvalidSpender(address);
error TransferToZeroAddress();

/**
 * @title FHERC20
 * @notice ERC20 token with encrypted balances using Fhenix FHE
 * @dev Follows Fhenix FHERC20 standard with wrap/unwrap pattern.
 *
 * Key features:
 * - `wrap()` converts plaintext ERC20 -> encrypted balance
 * - `unwrap()` converts encrypted balance -> plaintext ERC20
 * - `balanceOfEncrypted()` returns encrypted balance handle
 * - `transferEncrypted()` for private transfers
 * - `_transferEncrypted()` for contract-to-contract transfers
 *
 * The plaintext ERC20 functions (balanceOf, transfer) only show unwrapped tokens.
 * A user's "true" balance is their encrypted balance.
 */
contract FHERC20 is IFHERC20, ERC20 {
    /// @notice Encrypted balances - the source of truth for FHERC20
    mapping(address => euint128) internal _encBalances;

    /// @notice Encrypted allowances for transferFromEncrypted
    mapping(address => mapping(address => euint128)) internal _encAllowances;

    /// @notice Total encrypted supply (separate from ERC20 totalSupply)
    euint128 internal _encTotalSupply;

    constructor(
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) {
        _encTotalSupply = FHE.asEuint128(0);
        FHE.allowThis(_encTotalSupply);
    }

    // ============ Encrypted Balance Functions ============

    /// @inheritdoc IFHERC20
    function balanceOfEncrypted(address account) public view virtual override returns (euint128) {
        return _encBalances[account];
    }

    /// @inheritdoc IFHERC20
    function hasEncryptedBalance(address account) external view override returns (bool) {
        return Common.isInitialized(_encBalances[account]);
    }

    // ============ Encrypted Allowance Functions ============

    /// @inheritdoc IFHERC20
    function allowanceEncrypted(address owner, address spender) public view virtual override returns (euint128) {
        return _encAllowances[owner][spender];
    }

    /// @inheritdoc IFHERC20
    function approveEncrypted(address spender, InEuint128 calldata value) public virtual override returns (bool) {
        _approveEncrypted(msg.sender, spender, FHE.asEuint128(value));
        return true;
    }

    function _approveEncrypted(address owner, address spender, euint128 value) internal {
        if (owner == address(0)) {
            revert ERC20InvalidApprover(address(0));
        }
        if (spender == address(0)) {
            revert ERC20InvalidSpender(address(0));
        }
        _encAllowances[owner][spender] = value;

        // Allow relevant parties to access the allowance
        FHE.allowThis(_encAllowances[owner][spender]);
        FHE.allow(_encAllowances[owner][spender], owner);
        FHE.allow(_encAllowances[owner][spender], spender);

        emit ApprovalEncrypted(owner, spender);
    }

    function _spendAllowance(address owner, address spender, euint128 value) internal virtual returns (euint128) {
        euint128 currentAllowance = _encAllowances[owner][spender];
        euint128 spent = FHE.min(currentAllowance, value);
        _approveEncrypted(owner, spender, FHE.sub(currentAllowance, spent));
        return spent;
    }

    // ============ Encrypted Transfer Functions ============

    /// @inheritdoc IFHERC20
    function transferEncrypted(address to, InEuint128 calldata value) public virtual override returns (euint128) {
        return _transferEncrypted(to, FHE.asEuint128(value));
    }

    /// @inheritdoc IFHERC20
    function _transferEncrypted(address to, euint128 value) public virtual override returns (euint128) {
        return _transferImpl(msg.sender, to, value);
    }

    /// @inheritdoc IFHERC20
    function transferFromEncrypted(address from, address to, InEuint128 calldata value) public virtual override returns (euint128) {
        return _transferFromEncrypted(from, to, FHE.asEuint128(value));
    }

    /// @inheritdoc IFHERC20
    function _transferFromEncrypted(address from, address to, euint128 value) public virtual override returns (euint128) {
        euint128 spent = _spendAllowance(from, msg.sender, value);
        return _transferImpl(from, to, spent);
    }

    /// @notice Internal transfer implementation
    function _transferImpl(address from, address to, euint128 amount) internal virtual returns (euint128) {
        if (to == address(0)) {
            revert TransferToZeroAddress();
        }

        // Make sure the sender has enough tokens (cap at balance if insufficient)
        euint128 amountToSend = FHE.select(
            FHE.lte(amount, _encBalances[from]),
            amount,
            FHE.asEuint128(0)
        );

        // Subtract from sender
        _encBalances[from] = FHE.sub(_encBalances[from], amountToSend);

        // Add to recipient
        if (Common.isInitialized(_encBalances[to])) {
            _encBalances[to] = FHE.add(_encBalances[to], amountToSend);
        } else {
            _encBalances[to] = amountToSend;
        }

        // Update permissions
        FHE.allowThis(_encBalances[from]);
        FHE.allow(_encBalances[from], from);
        FHE.allowThis(_encBalances[to]);
        FHE.allow(_encBalances[to], to);

        emit TransferEncrypted(from, to);

        return amountToSend;
    }

    // ============ Wrap/Unwrap (ERC20 <-> FHERC20 conversion) ============

    /// @notice Convert plaintext ERC20 tokens to encrypted balance
    /// @param amount Amount to wrap (burns from ERC20 balance, adds to encrypted)
    function wrap(uint256 amount) public virtual {
        if (balanceOf(msg.sender) < amount) {
            revert ErrorInsufficientFunds();
        }

        _burn(msg.sender, amount);

        euint128 encAmount = FHE.asEuint128(uint128(amount));
        if (Common.isInitialized(_encBalances[msg.sender])) {
            _encBalances[msg.sender] = FHE.add(_encBalances[msg.sender], encAmount);
        } else {
            _encBalances[msg.sender] = encAmount;
        }
        _encTotalSupply = FHE.add(_encTotalSupply, encAmount);

        FHE.allowThis(_encBalances[msg.sender]);
        FHE.allow(_encBalances[msg.sender], msg.sender);
        FHE.allowThis(_encTotalSupply);
    }

    /// @notice Convert encrypted balance to plaintext ERC20 tokens
    /// @param amount Plaintext amount to unwrap (user must know their balance)
    /// @dev For testnet: trusts user-provided amount. Production should use async decrypt callback.
    function unwrap(uint256 amount) public virtual {
        require(amount > 0, "Amount must be > 0");
        require(Common.isInitialized(_encBalances[msg.sender]), "No encrypted balance");

        euint128 encAmount = FHE.asEuint128(uint128(amount));

        // Subtract from encrypted balance (will fail silently via FHE if insufficient)
        _encBalances[msg.sender] = FHE.sub(_encBalances[msg.sender], encAmount);
        _encTotalSupply = FHE.sub(_encTotalSupply, encAmount);

        FHE.allowThis(_encBalances[msg.sender]);
        FHE.allow(_encBalances[msg.sender], msg.sender);
        FHE.allowThis(_encTotalSupply);

        // Mint plaintext tokens (trusting user-provided amount for testnet)
        _mint(msg.sender, amount);
    }

    // ============ Internal Mint Functions ============

    /// @notice Internal mint to encrypted balance (from plaintext amount)
    function _mintEncrypted(address to, uint256 amount) internal virtual {
        euint128 encAmount = FHE.asEuint128(uint128(amount));

        if (Common.isInitialized(_encBalances[to])) {
            _encBalances[to] = FHE.add(_encBalances[to], encAmount);
        } else {
            _encBalances[to] = encAmount;
        }

        _encTotalSupply = FHE.add(_encTotalSupply, encAmount);

        FHE.allowThis(_encBalances[to]);
        FHE.allow(_encBalances[to], to);
        FHE.allowThis(_encTotalSupply);
    }
}
