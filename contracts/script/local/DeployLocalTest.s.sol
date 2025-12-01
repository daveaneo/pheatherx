// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {MockPheatherX} from "./MockPheatherX.sol";

/// @notice Simple mock ERC20 token for local testing
contract MockToken is ERC20 {
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

/// @notice Mock swap router for local testing
contract MockSwapRouter {
    event Swap(address indexed sender, bool zeroForOne, int256 amountSpecified);

    /// @notice Mock swap function that matches Uniswap v4 router interface
    function swap(
        bytes calldata, // key (ignored in mock)
        bytes calldata params, // SwapParams
        bytes calldata // hookData
    ) external payable returns (int256 delta) {
        // Decode basic params - this is a simplified mock
        // In real v4, this would interact with PoolManager
        emit Swap(msg.sender, true, 0);

        // Return a mock delta (negative = tokens out)
        return -1e18; // Mock: 1 token out
    }
}

/// @title DeployLocalTest
/// @notice Deploy mock contracts for local frontend testing
/// @dev This is separate from production deployment scripts
///      Run with: forge script script/local/DeployLocalTest.s.sol:DeployLocalTest --rpc-url http://localhost:8545 --broadcast
contract DeployLocalTest is Script {
    // Test account (first Anvil account)
    address constant TEST_ACCOUNT = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    uint256 constant TEST_PRIVATE_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    // Token amounts
    uint256 constant INITIAL_MINT = 1_000_000 ether; // 1M tokens each
    uint256 constant LIQUIDITY_AMOUNT = 100_000 ether; // 100K for initial liquidity

    function run() external {
        console.log("===========================================");
        console.log("  PheatherX Local Test Deployment");
        console.log("===========================================");
        console.log("");
        console.log("Deployer/Test Account:", TEST_ACCOUNT);
        console.log("");

        vm.startBroadcast(TEST_PRIVATE_KEY);

        // ============ Deploy Tokens ============
        console.log("--- Deploying Tokens ---");

        MockToken tokenA = new MockToken("Test Token Alpha", "ALPHA", 18);
        MockToken tokenB = new MockToken("Test Token Beta", "BETA", 18);

        // Sort tokens (Uniswap requirement: token0 < token1)
        (address token0Addr, address token1Addr) = address(tokenA) < address(tokenB)
            ? (address(tokenA), address(tokenB))
            : (address(tokenB), address(tokenA));

        MockToken token0 = MockToken(token0Addr);
        MockToken token1 = MockToken(token1Addr);

        console.log("Token0 (ALPHA):", address(token0));
        console.log("Token1 (BETA):", address(token1));

        // Mint tokens to test account
        token0.mint(TEST_ACCOUNT, INITIAL_MINT);
        token1.mint(TEST_ACCOUNT, INITIAL_MINT);
        console.log("Minted", INITIAL_MINT / 1e18, "of each token to test account");

        // ============ Deploy Mock PheatherX ============
        console.log("");
        console.log("--- Deploying MockPheatherX ---");

        MockPheatherX pheatherX = new MockPheatherX(address(token0), address(token1));
        console.log("MockPheatherX:", address(pheatherX));

        // ============ Deploy Mock Router ============
        console.log("");
        console.log("--- Deploying MockSwapRouter ---");

        MockSwapRouter router = new MockSwapRouter();
        console.log("MockSwapRouter:", address(router));

        // ============ Seed Initial Liquidity ============
        console.log("");
        console.log("--- Seeding Initial Liquidity ---");

        // Approve tokens for PheatherX
        token0.approve(address(pheatherX), type(uint256).max);
        token1.approve(address(pheatherX), type(uint256).max);

        // Deposit initial liquidity
        pheatherX.deposit(true, LIQUIDITY_AMOUNT);  // Deposit token0
        pheatherX.deposit(false, LIQUIDITY_AMOUNT); // Deposit token1

        console.log("Deposited", LIQUIDITY_AMOUNT / 1e18, "of each token as initial liquidity");

        vm.stopBroadcast();

        // ============ Print Summary ============
        console.log("");
        console.log("===========================================");
        console.log("  DEPLOYMENT COMPLETE");
        console.log("===========================================");
        console.log("");
        console.log("Contract Addresses:");
        console.log("  Token0 (ALPHA):    ", address(token0));
        console.log("  Token1 (BETA):     ", address(token1));
        console.log("  MockPheatherX:     ", address(pheatherX));
        console.log("  MockSwapRouter:    ", address(router));
        console.log("");
        console.log("Test Account:", TEST_ACCOUNT);
        console.log("  Token0 Balance:", (INITIAL_MINT - LIQUIDITY_AMOUNT) / 1e18, "ALPHA");
        console.log("  Token1 Balance:", (INITIAL_MINT - LIQUIDITY_AMOUNT) / 1e18, "BETA");
        console.log("  Hook Balance:  ", LIQUIDITY_AMOUNT / 1e18, "of each (deposited)");
        console.log("");
        console.log("--- Frontend .env.local Values ---");
        console.log("");
        console.log("NEXT_PUBLIC_PHEATHERX_ADDRESS_LOCAL=", address(pheatherX));
        console.log("NEXT_PUBLIC_SWAP_ROUTER_ADDRESS_LOCAL=", address(router));
        console.log("NEXT_PUBLIC_TOKEN0_ADDRESS_LOCAL=", address(token0));
        console.log("NEXT_PUBLIC_TOKEN1_ADDRESS_LOCAL=", address(token1));
        console.log("");
        console.log("===========================================");
    }
}
