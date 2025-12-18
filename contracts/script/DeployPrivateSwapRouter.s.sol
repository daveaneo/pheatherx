// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PrivateSwapRouter} from "../src/PrivateSwapRouter.sol";

/// @title DeployPrivateSwapRouter
/// @notice Deploy PrivateSwapRouter only (for updates)
/// @dev Run with: PRIVATE_KEY=0x... forge script script/DeployPrivateSwapRouter.s.sol:DeployPrivateSwapRouter --rpc-url <RPC> --broadcast -vvv
contract DeployPrivateSwapRouter is Script {
    // Known Pool Manager addresses
    address constant ETH_SEPOLIA_PM = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant ARB_SEPOLIA_PM = 0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Select Pool Manager based on chain
        address poolManager;
        if (block.chainid == 11155111) {
            poolManager = ETH_SEPOLIA_PM;
        } else if (block.chainid == 421614) {
            poolManager = ARB_SEPOLIA_PM;
        } else {
            revert("Unsupported chain - set POOL_MANAGER env var");
        }

        console.log("===========================================");
        console.log("  PrivateSwapRouter Deployment");
        console.log("===========================================");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Pool Manager:", poolManager);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        PrivateSwapRouter router = new PrivateSwapRouter(IPoolManager(poolManager));

        vm.stopBroadcast();

        console.log("===========================================");
        console.log("  DEPLOYMENT COMPLETE");
        console.log("===========================================");
        console.log("PrivateSwapRouter:", address(router));
        console.log("");
        console.log("Update frontend/src/lib/contracts/addresses.ts:");
        console.log("  PRIVATE_SWAP_ROUTER_ADDRESSES[chainId] = 'address'");
        console.log("  Chain ID:", block.chainid);
        console.log("  Address:", address(router));
    }
}
