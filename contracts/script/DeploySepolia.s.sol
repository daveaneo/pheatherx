// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Simple mock ERC20 token for testing
contract TestToken is ERC20 {
    uint8 private _decimals;

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}

/// @title DeploySepolia
/// @notice Deploy test tokens on Ethereum Sepolia for PheatherX testing
/// @dev Run with: forge script script/DeploySepolia.s.sol:DeploySepolia --rpc-url https://ethereum-sepolia-rpc.publicnode.com --broadcast
contract DeploySepolia is Script {
    // Token amounts
    uint256 constant INITIAL_MINT = 1_000_000 ether; // 1M tokens each

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("===========================================");
        console.log("  PheatherX Sepolia Test Token Deployment");
        console.log("===========================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // ============ Deploy Tokens ============
        console.log("--- Deploying Tokens ---");

        TestToken tokenA = new TestToken("PheatherX Test USDC", "tUSDC", 6);
        TestToken tokenB = new TestToken("PheatherX Test WETH", "tWETH", 18);

        // Sort tokens (Uniswap requirement: token0 < token1)
        (address token0Addr, address token1Addr) = address(tokenA) < address(tokenB)
            ? (address(tokenA), address(tokenB))
            : (address(tokenB), address(tokenA));

        console.log("Token A (tUSDC):", address(tokenA));
        console.log("Token B (tWETH):", address(tokenB));
        console.log("");
        console.log("Sorted:");
        console.log("Token0:", token0Addr);
        console.log("Token1:", token1Addr);

        // Mint tokens to deployer
        tokenA.mint(deployer, INITIAL_MINT);
        tokenB.mint(deployer, INITIAL_MINT);
        console.log("");
        console.log("Minted 1,000,000 of each token to deployer");

        vm.stopBroadcast();

        // ============ Print Summary ============
        console.log("");
        console.log("===========================================");
        console.log("  DEPLOYMENT COMPLETE");
        console.log("===========================================");
        console.log("");
        console.log("--- Frontend .env.local Values ---");
        console.log("");
        console.log("NEXT_PUBLIC_TOKEN0_ADDRESS_SEPOLIA=", token0Addr);
        console.log("NEXT_PUBLIC_TOKEN1_ADDRESS_SEPOLIA=", token1Addr);
        console.log("");
        console.log("===========================================");
    }
}
