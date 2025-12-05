// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import {
    FHE,
    euint128,
    InEuint128,
    Common
} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title FHERC20FaucetToken
/// @notice True FHERC20 token where ALL balances are stored encrypted
/// @dev Follows Fhenix FHERC20 standard with wrap/unwrap pattern
///
/// Key differences from regular ERC20:
/// - `faucet()` mints directly to encrypted balance (no plaintext balance visible)
/// - `wrap()` converts plaintext ERC20 -> encrypted balance
/// - `unwrap()` converts encrypted balance -> plaintext ERC20
/// - `balanceOfEncrypted()` returns sealed encrypted balance (requires permit)
/// - `transferEncrypted()` for private transfers between encrypted balances
///
/// The plaintext ERC20 functions (balanceOf, transfer) only show tokens that have been
/// unwrapped. A user's "true" balance is their encrypted balance.
contract FHERC20FaucetToken is ERC20, Ownable {
    uint8 private immutable _tokenDecimals;

    // === FHERC20 Storage ===

    /// @notice Encrypted balances - the source of truth for FHERC20
    mapping(address => euint128) internal _encBalances;

    /// @notice Encrypted allowances for transferFromEncrypted
    mapping(address => mapping(address => euint128)) internal _encAllowances;

    /// @notice Total encrypted supply (separate from ERC20 totalSupply)
    euint128 internal _encTotalSupply;

    // === Faucet Storage ===

    /// @notice Amount dispensed per faucet call (100 tokens)
    uint256 public constant FAUCET_AMOUNT = 100;

    /// @notice Cooldown period between faucet calls (1 hour)
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    /// @notice Last faucet call timestamp per address
    mapping(address => uint256) public lastFaucetCall;

    // === Events ===

    event FaucetDispensed(address indexed to, uint256 amount);
    event Wrap(address indexed account, uint256 amount);
    event Unwrap(address indexed account, uint256 amount);
    event TransferEncrypted(address indexed from, address indexed to);
    event ApprovalEncrypted(address indexed owner, address indexed spender);

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        _tokenDecimals = decimals_;
        _encTotalSupply = FHE.asEuint128(0);
        // Allow this contract to access _encTotalSupply
        FHE.allowThis(_encTotalSupply);
    }

    function decimals() public view virtual override returns (uint8) {
        return _tokenDecimals;
    }

    // ============ Faucet Functions ============

    /// @notice Request tokens from faucet - mints directly to encrypted balance
    /// @dev Unlike regular ERC20 faucet, tokens go to encrypted balance (private)
    function faucet() external {
        require(
            block.timestamp >= lastFaucetCall[msg.sender] + FAUCET_COOLDOWN,
            "Faucet: cooldown not elapsed"
        );

        lastFaucetCall[msg.sender] = block.timestamp;
        uint256 amount = FAUCET_AMOUNT * (10 ** _tokenDecimals);

        // Mint directly to encrypted balance - no plaintext balance visible
        _mintEncrypted(msg.sender, amount);

        emit FaucetDispensed(msg.sender, amount);
    }

    /// @notice Mint to encrypted balance (owner only)
    /// @param to Recipient address
    /// @param amount Amount to mint (in base units)
    function mintEncrypted(address to, uint256 amount) external onlyOwner {
        _mintEncrypted(to, amount);
    }

    /// @notice Internal mint to encrypted balance
    function _mintEncrypted(address to, uint256 amount) internal {
        euint128 encAmount = FHE.asEuint128(uint128(amount));

        if (Common.isInitialized(_encBalances[to])) {
            _encBalances[to] = FHE.add(_encBalances[to], encAmount);
        } else {
            _encBalances[to] = encAmount;
        }

        _encTotalSupply = FHE.add(_encTotalSupply, encAmount);

        // Allow the contract and user to access this balance
        FHE.allowThis(_encBalances[to]);
        FHE.allow(_encBalances[to], to);
        // Allow contract to access updated total supply
        FHE.allowThis(_encTotalSupply);
    }

    // ============ Wrap/Unwrap (ERC20 <-> FHERC20 conversion) ============

    /// @notice Convert plaintext ERC20 tokens to encrypted balance
    /// @param amount Amount to wrap (burns from ERC20 balance, adds to encrypted)
    function wrap(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(balanceOf(msg.sender) >= amount, "Insufficient ERC20 balance");

        // Burn plaintext tokens
        _burn(msg.sender, amount);

        // Add to encrypted balance
        _mintEncrypted(msg.sender, amount);

        emit Wrap(msg.sender, amount);
    }

    /// @notice Convert encrypted balance to plaintext ERC20 tokens
    /// @param amount Plaintext amount to unwrap (user knows their own balance)
    /// @dev User must know their balance to unwrap - can query via balanceOfEncrypted
    function unwrap(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(Common.isInitialized(_encBalances[msg.sender]), "No encrypted balance");

        euint128 encAmount = FHE.asEuint128(uint128(amount));

        // Subtract from encrypted balance (will underflow if insufficient)
        _encBalances[msg.sender] = FHE.sub(_encBalances[msg.sender], encAmount);
        _encTotalSupply = FHE.sub(_encTotalSupply, encAmount);

        // Update permissions
        FHE.allowThis(_encBalances[msg.sender]);
        FHE.allow(_encBalances[msg.sender], msg.sender);
        // Allow contract to access updated total supply
        FHE.allowThis(_encTotalSupply);

        // Mint plaintext tokens
        _mint(msg.sender, amount);

        emit Unwrap(msg.sender, amount);
    }

    // ============ FHERC20 Balance Functions ============

    /// @notice Get encrypted balance handle
    /// @dev The returned euint128 handle is used by cofhejs to unseal the value client-side
    /// @param account Address to query
    /// @return euint128 handle to encrypted balance
    function balanceOfEncrypted(address account) external view returns (euint128) {
        return _encBalances[account];
    }

    /// @notice Alias for balanceOfEncrypted for compatibility
    function getEncryptedBalance(address account) external view returns (euint128) {
        return _encBalances[account];
    }

    /// @notice Check if account has an initialized encrypted balance
    /// @param account Address to check
    function hasEncryptedBalance(address account) external view returns (bool) {
        return Common.isInitialized(_encBalances[account]);
    }

    // ============ FHERC20 Transfer Functions ============

    /// @notice Transfer encrypted tokens (with InEuint128 input from client)
    /// @param to Recipient address
    /// @param encryptedAmount Encrypted amount from cofhejs
    function transferEncrypted(
        address to,
        InEuint128 calldata encryptedAmount
    ) external returns (bool) {
        euint128 amount = FHE.asEuint128(encryptedAmount);
        _transferEncrypted(msg.sender, to, amount);
        return true;
    }

    /// @notice Transfer encrypted tokens (with euint128 for contract-to-contract)
    /// @param to Recipient address
    /// @param amount euint128 amount handle
    function transferEncryptedDirect(address to, euint128 amount) external returns (bool) {
        _transferEncrypted(msg.sender, to, amount);
        return true;
    }

    /// @notice Internal encrypted transfer
    function _transferEncrypted(address from, address to, euint128 amount) internal {
        require(to != address(0), "Transfer to zero address");
        require(Common.isInitialized(_encBalances[from]), "Sender has no encrypted balance");

        // Subtract from sender (will underflow if insufficient - FHE handles this)
        _encBalances[from] = FHE.sub(_encBalances[from], amount);

        // Add to recipient
        if (Common.isInitialized(_encBalances[to])) {
            _encBalances[to] = FHE.add(_encBalances[to], amount);
        } else {
            _encBalances[to] = amount;
        }

        // Update permissions
        FHE.allowThis(_encBalances[from]);
        FHE.allow(_encBalances[from], from);
        FHE.allowThis(_encBalances[to]);
        FHE.allow(_encBalances[to], to);

        emit TransferEncrypted(from, to);
    }

    // ============ FHERC20 Approval Functions ============

    /// @notice Approve encrypted spending allowance
    /// @param spender Address to approve
    /// @param encryptedAmount Encrypted amount from cofhejs
    function approveEncrypted(
        address spender,
        InEuint128 calldata encryptedAmount
    ) external returns (bool) {
        euint128 amount = FHE.asEuint128(encryptedAmount);
        _encAllowances[msg.sender][spender] = amount;

        // Allow relevant parties to access the allowance
        FHE.allowThis(_encAllowances[msg.sender][spender]);
        FHE.allow(_encAllowances[msg.sender][spender], msg.sender);
        FHE.allow(_encAllowances[msg.sender][spender], spender);

        emit ApprovalEncrypted(msg.sender, spender);
        return true;
    }

    /// @notice Get encrypted allowance handle
    /// @dev The returned euint128 handle is used by cofhejs to unseal the value client-side
    /// @param owner Token owner
    /// @param spender Approved spender
    /// @return euint128 handle to encrypted allowance
    function allowanceEncrypted(
        address owner,
        address spender
    ) external view returns (euint128) {
        return _encAllowances[owner][spender];
    }

    /// @notice Transfer from encrypted allowance
    /// @param from Token owner
    /// @param to Recipient
    /// @param encryptedAmount Encrypted amount from cofhejs
    /// @return amount The euint128 amount that was transferred (for use by caller)
    function transferFromEncrypted(
        address from,
        address to,
        InEuint128 calldata encryptedAmount
    ) external returns (euint128 amount) {
        amount = FHE.asEuint128(encryptedAmount);

        // Subtract from allowance (will underflow if insufficient)
        _encAllowances[from][msg.sender] = FHE.sub(_encAllowances[from][msg.sender], amount);

        // Update allowance permissions
        FHE.allowThis(_encAllowances[from][msg.sender]);
        FHE.allow(_encAllowances[from][msg.sender], from);
        FHE.allow(_encAllowances[from][msg.sender], msg.sender);

        // Transfer
        _transferEncrypted(from, to, amount);

        // Allow the caller (e.g., hook contract) to use the returned amount
        FHE.allow(amount, msg.sender);

        return amount;
    }

    // ============ View Helpers ============

    /// @notice Get the plaintext ERC20 total supply (unwrapped tokens only)
    /// @dev For total encrypted supply, there's no public view - it's private
    function totalSupply() public view virtual override returns (uint256) {
        return super.totalSupply();
    }
}
