// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHERC20} from "./fhenix/FHERC20.sol";

/// @title FhenixFHERC20Faucet
/// @notice Official Fhenix FHERC20 with faucet functionality for testnet
/// @dev Extends FHERC20 with public faucet() and mint() functions
contract FhenixFHERC20Faucet is FHERC20 {
    uint8 private immutable _decimals;

    /// @notice Amount dispensed per faucet call (100 tokens)
    uint256 public constant FAUCET_AMOUNT = 100;

    /// @notice Cooldown period between faucet calls (1 hour)
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    /// @notice Last faucet call timestamp per address
    mapping(address => uint256) public lastFaucetCall;

    /// @notice Emitted when tokens are dispensed from faucet
    event FaucetDispensed(address indexed to, uint256 amount);

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) FHERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Request tokens from faucet - mints directly to encrypted balance
    /// @dev Tokens go to encrypted balance (not plaintext) for immediate privacy
    function faucet() external {
        require(
            block.timestamp >= lastFaucetCall[msg.sender] + FAUCET_COOLDOWN,
            "Faucet: cooldown not elapsed"
        );

        lastFaucetCall[msg.sender] = block.timestamp;
        uint256 amount = FAUCET_AMOUNT * (10 ** _decimals);

        // Mint directly to encrypted balance - no plaintext balance visible
        _mintEncrypted(msg.sender, amount);

        emit FaucetDispensed(msg.sender, amount);
    }

    /// @notice Mint tokens to any address (unrestricted for testnet)
    /// @param to Recipient address
    /// @param amount Amount to mint (in base units)
    function mint(address to, uint256 amount) external {
        _mintEncrypted(to, amount);
    }

    /// @notice Alias for mint() for backward compatibility
    function mintEncrypted(address to, uint256 amount) external {
        _mintEncrypted(to, amount);
    }

    /// @notice Mint tokens to recipient's plaintext balance (for wrap testing / deployment)
    /// @param to Recipient address
    /// @param amount Amount to mint (in base units)
    function mintPlaintext(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
