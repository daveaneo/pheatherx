// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/StdJson.sol";
import {FhenixFHERC20Faucet} from "../src/tokens/FhenixFHERC20Faucet.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

/// @title RedeployFHERC20Tokens
/// @notice Redeploy FHERC20 tokens with proper balanceOfEncrypted() interface
/// @dev Run with: source .env && forge script script/RedeployFHERC20Tokens.s.sol:RedeployFHERC20Tokens --rpc-url $ETH_SEPOLIA_RPC --broadcast -vvv
contract RedeployFHERC20Tokens is Script {
    using stdJson for string;

    string constant DEPLOYMENTS_PATH = "deployments/fherc20-tokens-eth-sepolia.json";

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("===========================================");
        console.log("  FHERC20 Tokens Redeployment");
        console.log("  With balanceOfEncrypted() interface");
        console.log("===========================================");
        console.log("");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // ============ Deploy FHE-Enabled Tokens ============
        console.log("--- Deploying FHERC20 Tokens ---");

        // FHE USDC (6 decimals) - with proper FHERC20 interface
        FhenixFHERC20Faucet fheUsdc = new FhenixFHERC20Faucet("FHE USDC", "fheUSDC", 6);
        console.log("fheUSDC deployed at:", address(fheUsdc));

        // FHE WETH (18 decimals) - with proper FHERC20 interface
        FhenixFHERC20Faucet fheWeth = new FhenixFHERC20Faucet("FHE WETH", "fheWETH", 18);
        console.log("fheWETH deployed at:", address(fheWeth));

        // ============ Mint initial supply to deployer ============
        console.log("");
        console.log("--- Minting Initial Supply ---");

        uint256 usdcMint = 1_000_000 * 1e6;  // 1M fheUSDC
        uint256 wethMint = 1_000 * 1e18;     // 1000 fheWETH

        // Mint to plaintext balance first (for deployment script compatibility)
        fheUsdc.mintPlaintext(deployer, usdcMint);
        fheWeth.mintPlaintext(deployer, wethMint);

        console.log("Minted 1,000,000 fheUSDC to deployer (plaintext)");
        console.log("Minted 1,000 fheWETH to deployer (plaintext)");

        vm.stopBroadcast();

        // ============ Verify Interface ============
        console.log("");
        console.log("--- Verifying FHERC20 Interface ---");

        // Test that balanceOfEncrypted exists and returns without revert
        try fheUsdc.balanceOfEncrypted(address(0)) {
            console.log("fheUSDC.balanceOfEncrypted() - OK");
        } catch {
            console.log("fheUSDC.balanceOfEncrypted() - FAILED");
        }

        try fheWeth.balanceOfEncrypted(address(0)) {
            console.log("fheWETH.balanceOfEncrypted() - OK");
        } catch {
            console.log("fheWETH.balanceOfEncrypted() - FAILED");
        }

        // ============ Save Deployment ============
        _saveDeployment(address(fheUsdc), address(fheWeth));

        // ============ Print Summary ============
        console.log("");
        console.log("===========================================");
        console.log("  DEPLOYMENT COMPLETE");
        console.log("===========================================");
        console.log("");
        console.log("New FHERC20 Tokens (with balanceOfEncrypted):");
        console.log("  fheUSDC:", address(fheUsdc));
        console.log("  fheWETH:", address(fheWeth));
        console.log("");
        console.log("Deployment saved to:", DEPLOYMENTS_PATH);
        console.log("");
        console.log("IMPORTANT: Update DeployV8Complete.s.sol with new addresses:");
        console.log("  FHE_WETH =", address(fheWeth));
        console.log("  FHE_USDC =", address(fheUsdc));
    }

    function _saveDeployment(
        address fheUsdc,
        address fheWeth
    ) internal {
        string memory json = string.concat(
            '{\n',
            '  "chainId": ', vm.toString(block.chainid), ',\n',
            '  "deployedAt": "', vm.toString(block.timestamp), '",\n',
            '  "tokens": {\n',
            '    "fheUSDC": {\n',
            '      "address": "', vm.toString(fheUsdc), '",\n',
            '      "symbol": "fheUSDC",\n',
            '      "name": "FHE USDC",\n',
            '      "decimals": 6,\n',
            '      "type": "fherc20",\n',
            '      "hasBalanceOfEncrypted": true\n',
            '    },\n',
            '    "fheWETH": {\n',
            '      "address": "', vm.toString(fheWeth), '",\n',
            '      "symbol": "fheWETH",\n',
            '      "name": "FHE WETH",\n',
            '      "decimals": 18,\n',
            '      "type": "fherc20",\n',
            '      "hasBalanceOfEncrypted": true\n',
            '    }\n',
            '  },\n',
            '  "faucetConfig": {\n',
            '    "amount": 100,\n',
            '    "cooldownSeconds": 3600\n',
            '  }\n',
            '}'
        );

        vm.writeFile(DEPLOYMENTS_PATH, json);
    }
}
