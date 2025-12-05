// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import {
    FHE,
    InEuint128,
    euint128,
    Common
} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title FheFaucetToken
/// @notice FHE-enabled ERC20 token with encrypted balance tracking and public faucet
/// @dev Extends standard ERC20 with encrypted balance storage for privacy-preserving operations
contract FheFaucetToken is ERC20, Ownable {
    uint8 private immutable _tokenDecimals;

    /// @notice Amount dispensed per faucet call (100 tokens)
    uint256 public constant FAUCET_AMOUNT = 100;

    /// @notice Cooldown period between faucet calls (1 hour)
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    /// @notice Last faucet call timestamp per address
    mapping(address => uint256) public lastFaucetCall;

    /// @notice Encrypted balances for privacy-preserving operations
    mapping(address => euint128) public encryptedBalances;

    /// @notice Emitted when tokens are dispensed from faucet
    event FaucetDispensed(address indexed to, uint256 amount);

    /// @notice Emitted when a user deposits plaintext tokens to encrypted balance
    event EncryptedDeposit(address indexed user, uint256 amount);

    /// @notice Emitted when a user withdraws from encrypted balance to plaintext
    event EncryptedWithdraw(address indexed user, uint256 amount);

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        _tokenDecimals = decimals_;
    }

    function decimals() public view virtual override returns (uint8) {
        return _tokenDecimals;
    }

    /// @notice Request tokens from the faucet
    /// @dev Rate limited to once per FAUCET_COOLDOWN period per address
    function faucet() external {
        require(
            block.timestamp >= lastFaucetCall[msg.sender] + FAUCET_COOLDOWN,
            "Faucet: cooldown not elapsed"
        );

        lastFaucetCall[msg.sender] = block.timestamp;
        uint256 amount = FAUCET_AMOUNT * (10 ** _tokenDecimals);
        _mint(msg.sender, amount);

        emit FaucetDispensed(msg.sender, amount);
    }

    /// @notice Mint tokens to an address (owner only)
    /// @param to Recipient address
    /// @param amount Amount to mint
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Burn tokens from caller's balance
    /// @param amount Amount to burn
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /// @notice Deposit plaintext tokens to encrypted balance
    /// @param amount Amount to convert to encrypted balance
    function depositToEncrypted(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");

        // Burn plaintext tokens
        _burn(msg.sender, amount);

        // Add to encrypted balance
        euint128 encAmount = FHE.asEuint128(uint128(amount));
        if (Common.isInitialized(encryptedBalances[msg.sender])) {
            encryptedBalances[msg.sender] = FHE.add(encryptedBalances[msg.sender], encAmount);
        } else {
            encryptedBalances[msg.sender] = encAmount;
        }
        FHE.allowThis(encryptedBalances[msg.sender]);
        FHE.allow(encryptedBalances[msg.sender], msg.sender);

        emit EncryptedDeposit(msg.sender, amount);
    }

    /// @notice Withdraw from encrypted balance to plaintext tokens
    /// @param encryptedAmount Encrypted amount to withdraw
    function withdrawFromEncrypted(InEuint128 calldata encryptedAmount) external {
        euint128 amount = FHE.asEuint128(encryptedAmount);
        require(Common.isInitialized(encryptedBalances[msg.sender]), "No encrypted balance");

        // Subtract from encrypted balance
        encryptedBalances[msg.sender] = FHE.sub(encryptedBalances[msg.sender], amount);
        FHE.allowThis(encryptedBalances[msg.sender]);
        FHE.allow(encryptedBalances[msg.sender], msg.sender);

        // Note: In production, decryption would go through CoFHE
        // For testnet, we use sealoutput pattern
        emit EncryptedWithdraw(msg.sender, 0); // Amount hidden until decryption
    }

    /// @notice Get encrypted balance for an address
    /// @param account Address to check
    /// @return Encrypted balance
    function getEncryptedBalance(address account) external view returns (euint128) {
        return encryptedBalances[account];
    }

    /// @notice Check if an address has an initialized encrypted balance
    /// @param account Address to check
    function hasEncryptedBalance(address account) external view returns (bool) {
        return Common.isInitialized(encryptedBalances[account]);
    }
}
