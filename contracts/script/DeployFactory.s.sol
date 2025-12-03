// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {PheatherXFactory} from "../src/PheatherXFactory.sol";

/// @title DeployFactory
/// @notice Deploy PheatherXFactory and register the existing PheatherX hook
/// @dev Run with: source .env && forge script script/DeployFactory.s.sol:DeployFactory --rpc-url $ETH_SEPOLIA_RPC --broadcast
contract DeployFactory is Script {
    // Existing deployment addresses from DeployEthSepolia.s.sol
    // Token0 (tWETH - 18 decimals)
    address constant TOKEN0 = 0x453bA98F2318c7BA0bBA9C202c2a68d7ec11a659;
    // Token1 (tUSDC - 6 decimals)
    address constant TOKEN1 = 0xF6f6a3162Ca3162E3855d0B201d2264de64a52F6;
    // PheatherX Hook
    address constant PHEATHERX_HOOK = 0x47712BED8Ae60A41B5d092A3Dc04cb19FF508AC8;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("===========================================");
        console.log("  PheatherX Factory Deployment");
        console.log("===========================================");
        console.log("");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("");
        console.log("Existing contracts to register:");
        console.log("  Token0:", TOKEN0);
        console.log("  Token1:", TOKEN1);
        console.log("  Hook:", PHEATHERX_HOOK);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // ============ Deploy Factory ============
        console.log("--- Deploying Factory ---");

        PheatherXFactory factory = new PheatherXFactory();
        console.log("Factory deployed at:", address(factory));

        // ============ Register Existing Pool ============
        console.log("");
        console.log("--- Registering Existing Pool ---");

        factory.registerPool(TOKEN0, TOKEN1, PHEATHERX_HOOK);
        console.log("Pool registered successfully");

        // Verify registration
        address registeredHook = factory.getPool(TOKEN0, TOKEN1);
        require(registeredHook == PHEATHERX_HOOK, "Pool registration verification failed");
        console.log("Verification passed: Hook correctly registered");

        uint256 poolCount = factory.poolCount();
        console.log("Total pools registered:", poolCount);

        vm.stopBroadcast();

        // ============ Print Summary ============
        console.log("");
        console.log("===========================================");
        console.log("  DEPLOYMENT COMPLETE");
        console.log("===========================================");
        console.log("");
        console.log("Factory:", address(factory));
        console.log("");
        console.log("Update your .env.local with:");
        console.log("NEXT_PUBLIC_PHEATHERX_FACTORY_ADDRESS_ETH_SEPOLIA=", address(factory));
        console.log("");
    }
}
