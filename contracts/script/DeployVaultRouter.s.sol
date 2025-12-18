// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {FheVault} from "../src/FheVault.sol";
import {VaultRouter} from "../src/VaultRouter.sol";

/// @title DeployVaultRouter
/// @notice Deploy FheVault and VaultRouter contracts
/// @dev Run with: PRIVATE_KEY=0x... POOL_MANAGER=0x... forge script script/DeployVaultRouter.s.sol:DeployVaultRouter --rpc-url <RPC> --broadcast -vvv
///
/// Environment Variables:
///   - PRIVATE_KEY: Deployer private key
///   - POOL_MANAGER: Uniswap v4 PoolManager address
///
/// Optional Environment Variables (for token pair registration):
///   - WETH_ADDRESS: ERC20 WETH address
///   - USDC_ADDRESS: ERC20 USDC address
///   - FHE_WETH_ADDRESS: FHERC20 fheWETH address
///   - FHE_USDC_ADDRESS: FHERC20 fheUSDC address
contract DeployVaultRouter is Script {
    FheVault public vault;
    VaultRouter public router;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address poolManager = vm.envAddress("POOL_MANAGER");

        console.log("===========================================");
        console.log("  FheVault & VaultRouter Deployment");
        console.log("===========================================");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Pool Manager:", poolManager);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy FheVault
        console.log("--- Deploying FheVault ---");
        vault = new FheVault();
        console.log("FheVault:", address(vault));

        // Deploy VaultRouter
        console.log("--- Deploying VaultRouter ---");
        router = new VaultRouter(IPoolManager(poolManager));
        console.log("VaultRouter:", address(router));

        // Try to register token pairs if addresses are provided
        _tryRegisterTokenPairs();

        vm.stopBroadcast();

        console.log("");
        console.log("===========================================");
        console.log("  DEPLOYMENT COMPLETE");
        console.log("===========================================");
        console.log("FheVault:", address(vault));
        console.log("VaultRouter:", address(router));
        console.log("");
        console.log("Next Steps:");
        console.log("1. Add supported tokens to vault: vault.addSupportedTokens([...])");
        console.log("2. Register token pairs on router: router.registerTokenPair(erc20, fherc20)");
    }

    function _tryRegisterTokenPairs() internal {
        // Try to get token addresses from env
        address weth = vm.envOr("WETH_ADDRESS", address(0));
        address usdc = vm.envOr("USDC_ADDRESS", address(0));
        address fheWeth = vm.envOr("FHE_WETH_ADDRESS", address(0));
        address fheUsdc = vm.envOr("FHE_USDC_ADDRESS", address(0));

        bool hasWethPair = weth != address(0) && fheWeth != address(0);
        bool hasUsdcPair = usdc != address(0) && fheUsdc != address(0);

        if (!hasWethPair && !hasUsdcPair) {
            console.log("No token pairs provided - skipping registration");
            return;
        }

        console.log("--- Registering Token Pairs ---");

        // Add supported tokens to vault
        address[] memory supportedTokens = new address[](4);
        uint256 count = 0;

        if (weth != address(0)) {
            supportedTokens[count++] = weth;
            console.log("Adding WETH to vault:", weth);
        }
        if (usdc != address(0)) {
            supportedTokens[count++] = usdc;
            console.log("Adding USDC to vault:", usdc);
        }

        // Resize array to actual count
        assembly {
            mstore(supportedTokens, count)
        }

        if (count > 0) {
            vault.addSupportedTokens(supportedTokens);
        }

        // Register token pairs on router
        if (hasWethPair) {
            router.registerTokenPair(weth, fheWeth);
            console.log("Registered WETH <-> fheWETH pair");
        }

        if (hasUsdcPair) {
            router.registerTokenPair(usdc, fheUsdc);
            console.log("Registered USDC <-> fheUSDC pair");
        }
    }
}

/// @title DeployVaultOnly
/// @notice Deploy only FheVault
/// @dev Run with: PRIVATE_KEY=0x... forge script script/DeployVaultRouter.s.sol:DeployVaultOnly --rpc-url <RPC> --broadcast -vvv
contract DeployVaultOnly is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("===========================================");
        console.log("  FheVault Deployment");
        console.log("===========================================");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        FheVault vault = new FheVault();
        console.log("FheVault:", address(vault));

        vm.stopBroadcast();

        console.log("");
        console.log("Next Steps:");
        console.log("1. Add supported tokens: vault.addSupportedTokens([weth, usdc, ...])");
    }
}

/// @title DeployRouterOnly
/// @notice Deploy only VaultRouter (requires existing PoolManager)
/// @dev Run with: PRIVATE_KEY=0x... POOL_MANAGER=0x... forge script script/DeployVaultRouter.s.sol:DeployRouterOnly --rpc-url <RPC> --broadcast -vvv
contract DeployRouterOnly is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address poolManager = vm.envAddress("POOL_MANAGER");

        console.log("===========================================");
        console.log("  VaultRouter Deployment");
        console.log("===========================================");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Pool Manager:", poolManager);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        VaultRouter router = new VaultRouter(IPoolManager(poolManager));
        console.log("VaultRouter:", address(router));

        vm.stopBroadcast();

        console.log("");
        console.log("Next Steps:");
        console.log("1. Register token pairs: router.registerTokenPair(erc20, fherc20)");
    }
}
