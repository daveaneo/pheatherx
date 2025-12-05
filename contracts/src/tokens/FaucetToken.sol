// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title FaucetToken
/// @notice Standard ERC20 token with a public faucet function for testnet usage
/// @dev Anyone can call faucet() to get 100 tokens (rate limited per address)
contract FaucetToken is ERC20, Ownable {
    uint8 private immutable _tokenDecimals;

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
}
