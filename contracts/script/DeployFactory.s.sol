// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {FheatherXFactory} from "../src/FheatherXFactory.sol";

/// @title DeployFactory
/// @notice Deploy FheatherXFactory and register the existing FheatherX hook
/// @dev Run with: source .env && forge script script/DeployFactory.s.sol:DeployFactory --rpc-url $ETH_SEPOLIA_RPC --broadcast
contract DeployFactory is Script {
    // Existing deployment addresses from DeployEthSepolia.s.sol
    // Token0 (WETH - 18 decimals)
    address constant TOKEN0 = 0x453bA98F2318c7BA0bBA9C202c2a68d7ec11a659;
    // Token1 (USDC - 6 decimals)
    address constant TOKEN1 = 0xF6f6a3162Ca3162E3855d0B201d2264de64a52F6;
    // FheatherX Hook
    address constant FHEATHERX_HOOK = 0x47712BED8Ae60A41B5d092A3Dc04cb19FF508AC8;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("===========================================");
        console.log("  FheatherX Factory Deployment");
        console.log("===========================================");
        console.log("");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("");
        console.log("Existing contracts to register:");
        console.log("  Token0:", TOKEN0);
        console.log("  Token1:", TOKEN1);
        console.log("  Hook:", FHEATHERX_HOOK);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // ============ Deploy Factory ============
        console.log("--- Deploying Factory ---");

        FheatherXFactory factory = new FheatherXFactory();
        console.log("Factory deployed at:", address(factory));

        // ============ Register Existing Pool ============
        console.log("");
        console.log("--- Registering Existing Pool ---");

        factory.registerPool(TOKEN0, TOKEN1, FHEATHERX_HOOK);
        console.log("Pool registered successfully");

        // Verify registration
        address registeredHook = factory.getPool(TOKEN0, TOKEN1);
        require(registeredHook == FHEATHERX_HOOK, "Pool registration verification failed");
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
        console.log("NEXT_PUBLIC_FHEATHERX_FACTORY_ADDRESS_ETH_SEPOLIA=", address(factory));
        console.log("");
    }
}
