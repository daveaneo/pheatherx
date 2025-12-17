// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {FheatherXv8FHE} from "../src/FheatherXv8FHE.sol";
import {FheatherXv8Mixed} from "../src/FheatherXv8Mixed.sol";
import {PrivateSwapRouter} from "../src/PrivateSwapRouter.sol";

/// @title DeployV8Only
/// @notice Deploy v8 hooks only (no pool initialization)
/// @dev Run with: PRIVATE_KEY=0x... POOL_MANAGER=0x... forge script script/DeployV8Only.s.sol:DeployV8Only --rpc-url <RPC> --broadcast -vvv
contract DeployV8Only is Script {
    using PoolIdLibrary for PoolKey;

    // CREATE2 Deployer Proxy (standard across EVM chains)
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    uint256 constant SWAP_FEE_BPS = 30; // 0.3%

    address public v8FheHook;
    address public v8MixedHook;
    address public privateSwapRouter;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address poolManager = vm.envAddress("POOL_MANAGER");

        console.log("===========================================");
        console.log("  FheatherXv8 Hook Deployment Only");
        console.log("===========================================");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Pool Manager:", poolManager);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy v8FHE Hook
        console.log("--- Deploying FheatherXv8FHE Hook ---");
        v8FheHook = _deployV8FHEHook(deployer, poolManager);
        console.log("v8FHE Hook:", v8FheHook);

        // Deploy v8Mixed Hook
        console.log("--- Deploying FheatherXv8Mixed Hook ---");
        v8MixedHook = _deployV8MixedHook(deployer, poolManager);
        console.log("v8Mixed Hook:", v8MixedHook);

        // Deploy PrivateSwapRouter (for encrypted swap path)
        console.log("--- Deploying PrivateSwapRouter ---");
        privateSwapRouter = address(new PrivateSwapRouter(IPoolManager(poolManager)));
        console.log("PrivateSwapRouter:", privateSwapRouter);

        vm.stopBroadcast();

        console.log("");
        console.log("===========================================");
        console.log("  DEPLOYMENT COMPLETE");
        console.log("===========================================");
        console.log("v8FHE Hook:", v8FheHook);
        console.log("v8Mixed Hook:", v8MixedHook);
        console.log("PrivateSwapRouter:", privateSwapRouter);
    }

    function _deployV8FHEHook(address deployer, address poolManager) internal returns (address) {
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG |
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        );

        bytes memory creationCode = type(FheatherXv8FHE).creationCode;
        bytes memory constructorArgs = abi.encode(
            IPoolManager(poolManager),
            deployer,
            SWAP_FEE_BPS
        );

        (address hookAddress, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER,
            flags,
            creationCode,
            constructorArgs
        );

        bytes memory bytecode = abi.encodePacked(creationCode, constructorArgs);
        (bool success,) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, bytecode));
        require(success, "CREATE2 deployment failed for v8FHE");
        require(hookAddress.code.length > 0, "v8FHE Hook not deployed");

        return hookAddress;
    }

    function _deployV8MixedHook(address deployer, address poolManager) internal returns (address) {
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG |
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        );

        bytes memory creationCode = type(FheatherXv8Mixed).creationCode;
        bytes memory constructorArgs = abi.encode(
            IPoolManager(poolManager),
            deployer,
            SWAP_FEE_BPS
        );

        (address hookAddress, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER,
            flags,
            creationCode,
            constructorArgs
        );

        bytes memory bytecode = abi.encodePacked(creationCode, constructorArgs);
        (bool success,) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, bytecode));
        require(success, "CREATE2 deployment failed for v8Mixed");
        require(hookAddress.code.length > 0, "v8Mixed Hook not deployed");

        return hookAddress;
    }
}
