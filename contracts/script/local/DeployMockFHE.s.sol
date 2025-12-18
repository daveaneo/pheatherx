// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {TaskManager} from "@fhenixprotocol/cofhe-mock-contracts/MockTaskManager.sol";
import {ACL} from "@fhenixprotocol/cofhe-mock-contracts/ACL.sol";

/**
 * @title DeployMockFHE
 * @notice Deploys MockTaskManager and ACL to Anvil for local FHE testing
 *
 * The FHE library uses a hardcoded TASK_MANAGER_ADDRESS. We deploy our mock there.
 *
 * Usage:
 *   anvil --host 127.0.0.1 --port 8545
 *   forge script script/local/DeployMockFHE.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
 */
contract DeployMockFHE is Script {
    // Hardcoded in @fhenixprotocol/cofhe-contracts/FHE.sol
    address constant TASK_MANAGER_ADDRESS = 0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9;

    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("Deployer:", deployer);
        console2.log("Target TaskManager address:", TASK_MANAGER_ADDRESS);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy ACL (needs initial owner)
        ACL acl = new ACL(deployer);
        console2.log("ACL deployed at:", address(acl));

        // 2. Deploy TaskManager (can't deploy at specific address, need to use vm.etch in tests)
        TaskManager taskManager = new TaskManager();
        taskManager.initialize(deployer);
        taskManager.setACLContract(address(acl));
        taskManager.setSecurityZones(-128, 127); // Allow all security zones

        console2.log("TaskManager deployed at:", address(taskManager));
        console2.log("");
        console2.log("NOTE: TaskManager is NOT at the hardcoded address!");
        console2.log("For Foundry tests, use vm.etch to place it at:", TASK_MANAGER_ADDRESS);
        console2.log("");
        console2.log("Example in your test setUp():");
        console2.log("  bytes memory taskManagerCode = address(taskManager).code;");
        console2.log("  vm.etch(TASK_MANAGER_ADDRESS, taskManagerCode);");

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== Mock FHE Deployment Complete ===");
        console2.log("ACL:", address(acl));
        console2.log("TaskManager:", address(taskManager));
    }
}
