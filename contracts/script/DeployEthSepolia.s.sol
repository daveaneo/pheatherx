// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/StdJson.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {FheatherXv5} from "../src/FheatherXv5.sol";

/// @title DeployEthSepolia
/// @notice Deploy FheatherXv5 hook on Ethereum Sepolia
/// @dev Run with: source .env && forge script script/DeployEthSepolia.s.sol:DeployEthSepolia --rpc-url $ETH_SEPOLIA_RPC --broadcast
///
/// This script deploys ONLY the FheatherXv5 hook contract.
/// Tokens are deployed separately via DeployFaucetTokens.s.sol
/// Pools are initialized via the frontend when adding liquidity.
///
/// Available faucet tokens on Sepolia (from tokens.ts):
///   - WETH:    0xe9Df64F549Eb1d2778909F339B9Bd795d14cF32E
///   - USDC:    0xF7Ff2A5E74eaA6E0463358BB26780049d3D45C56
///   - fheWETH: 0xf0F8f49b4065A1B01050Fa358d287106B676a25F
///   - fheUSDC: 0x1D77eE754b2080B354733299A5aC678539a0D740
contract DeployEthSepolia is Script {
    using stdJson for string;

    // Ethereum Sepolia addresses (from Uniswap v4 docs: https://docs.uniswap.org/contracts/v4/deployments)
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant SWAP_ROUTER = 0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe;  // PoolSwapTest
    address constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;

    // CREATE2 Deployer Proxy (standard across EVM chains)
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    // Deployment config
    uint256 constant SWAP_FEE_BPS = 30; // 0.3%

    string constant DEPLOYMENTS_PATH = "deployments/eth-sepolia.json";

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("===========================================");
        console.log("  FheatherXv5 Ethereum Sepolia Deployment");
        console.log("===========================================");
        console.log("");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Pool Manager:", POOL_MANAGER);
        console.log("");

        // Check if we already have a deployment
        bool hasExistingDeployment = _checkExistingDeployment();
        if (hasExistingDeployment) {
            console.log("Found existing deployment. Delete deployments/eth-sepolia.json to redeploy.");
            return;
        }

        vm.startBroadcast(deployerPrivateKey);

        // ============ Deploy Hook with CREATE2 ============
        console.log("--- Deploying FheatherXv5 Hook (CREATE2) ---");

        // Calculate required hook flags for v5
        // v5 needs: AFTER_INITIALIZE, BEFORE_SWAP, AFTER_SWAP, BEFORE_SWAP_RETURNS_DELTA
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG |
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.AFTER_SWAP_FLAG |
            Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        );

        console.log("Required flags:", flags);

        // Mine a salt that produces a valid hook address
        bytes memory creationCode = type(FheatherXv5).creationCode;
        bytes memory constructorArgs = abi.encode(
            IPoolManager(POOL_MANAGER),
            deployer,  // owner
            SWAP_FEE_BPS
        );

        console.log("Mining valid hook address...");
        (address hookAddress, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER,
            flags,
            creationCode,
            constructorArgs
        );
        console.log("Found valid address:", hookAddress);
        console.log("Salt:", vm.toString(salt));

        // Deploy using CREATE2 via the deployer proxy
        bytes memory bytecode = abi.encodePacked(creationCode, constructorArgs);

        // Call CREATE2 deployer
        (bool success,) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, bytecode));
        require(success, "CREATE2 deployment failed");

        // Verify deployment
        FheatherXv5 hook = FheatherXv5(payable(hookAddress));
        require(address(hook).code.length > 0, "Hook not deployed");

        console.log("Hook deployed at:", hookAddress);

        vm.stopBroadcast();

        // ============ Save Deployment ============
        _saveDeployment(hookAddress);

        // ============ Print Summary ============
        console.log("");
        console.log("===========================================");
        console.log("  DEPLOYMENT COMPLETE - FheatherXv5");
        console.log("===========================================");
        console.log("");
        console.log("Hook:", hookAddress);
        console.log("Pool Manager:", POOL_MANAGER);
        console.log("Swap Router:", SWAP_ROUTER);
        console.log("");
        console.log("Deployment saved to:", DEPLOYMENTS_PATH);
        console.log("");
        console.log("Available tokens (from faucet deployment):");
        console.log("  WETH:    0xe9Df64F549Eb1d2778909F339B9Bd795d14cF32E");
        console.log("  USDC:    0xF7Ff2A5E74eaA6E0463358BB26780049d3D45C56");
        console.log("  fheWETH: 0xf0F8f49b4065A1B01050Fa358d287106B676a25F");
        console.log("  fheUSDC: 0x1D77eE754b2080B354733299A5aC678539a0D740");
        console.log("");
        console.log("Next steps:");
        console.log("1. Update frontend .env with hook address");
        console.log("2. Pools are initialized automatically when adding liquidity");
        console.log("3. Use faucet() on tokens to get test tokens");
    }

    function _checkExistingDeployment() internal view returns (bool) {
        try vm.readFile(DEPLOYMENTS_PATH) returns (string memory) {
            return true;
        } catch {
            return false;
        }
    }

    function _saveDeployment(address hook) internal {
        string memory json = string.concat(
            '{\n',
            '  "version": "v5",\n',
            '  "chainId": ', vm.toString(block.chainid), ',\n',
            '  "deployedAt": "', vm.toString(block.timestamp), '",\n',
            '  "contracts": {\n',
            '    "hook": "', vm.toString(hook), '",\n',
            '    "poolManager": "', vm.toString(POOL_MANAGER), '",\n',
            '    "swapRouter": "', vm.toString(SWAP_ROUTER), '",\n',
            '    "positionManager": "', vm.toString(POSITION_MANAGER), '"\n',
            '  },\n',
            '  "tokens": {\n',
            '    "WETH": "0xe9Df64F549Eb1d2778909F339B9Bd795d14cF32E",\n',
            '    "USDC": "0xF7Ff2A5E74eaA6E0463358BB26780049d3D45C56",\n',
            '    "fheWETH": "0xf0F8f49b4065A1B01050Fa358d287106B676a25F",\n',
            '    "fheUSDC": "0x1D77eE754b2080B354733299A5aC678539a0D740"\n',
            '  },\n',
            '  "poolConfig": {\n',
            '    "fee": 3000,\n',
            '    "tickSpacing": 60,\n',
            '    "swapFeeBps": ', vm.toString(SWAP_FEE_BPS), '\n',
            '  },\n',
            '  "features": {\n',
            '    "multiPool": true,\n',
            '    "encryptedAMM": true,\n',
            '    "limitOrders": true,\n',
            '    "tickBitmap": true\n',
            '  }\n',
            '}'
        );

        vm.writeFile(DEPLOYMENTS_PATH, json);
    }
}
