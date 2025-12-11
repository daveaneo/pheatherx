// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/StdJson.sol";
import {FaucetToken} from "../src/tokens/FaucetToken.sol";
import {FhenixFHERC20Faucet} from "../src/tokens/FhenixFHERC20Faucet.sol";

/// @title DeployFaucetTokens
/// @notice Deploy 4 faucet tokens (2 ERC20 + 2 FHE-enabled) on Ethereum Sepolia
/// @dev Run with: source .env && forge script script/DeployFaucetTokens.s.sol:DeployFaucetTokens --rpc-url https://ethereum-sepolia-rpc.publicnode.com --broadcast -vvv
contract DeployFaucetTokens is Script {
    using stdJson for string;

    string constant DEPLOYMENTS_PATH = "deployments/faucet-tokens-eth-sepolia.json";

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("===========================================");
        console.log("  Faucet Tokens Deployment");
        console.log("===========================================");
        console.log("");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // ============ Deploy Standard ERC20 Tokens ============
        console.log("--- Deploying Standard ERC20 Tokens ---");

        // USDC-like stablecoin (6 decimals)
        FaucetToken usdc = new FaucetToken("USDC", "USDC", 6);
        console.log("USDC deployed at:", address(usdc));

        // ETH-like token (18 decimals)
        FaucetToken weth = new FaucetToken("WETH", "WETH", 18);
        console.log("WETH deployed at:", address(weth));

        // ============ Deploy FHE-Enabled Tokens ============
        console.log("");
        console.log("--- Deploying FHE-Enabled Tokens ---");

        // FHE USDC (6 decimals)
        FhenixFHERC20Faucet fheUsdc = new FhenixFHERC20Faucet("FHE USDC", "fheUSDC", 6);
        console.log("fheUSDC deployed at:", address(fheUsdc));

        // FHE WETH (18 decimals)
        FhenixFHERC20Faucet fheWeth = new FhenixFHERC20Faucet("FHE WETH", "fheWETH", 18);
        console.log("fheWETH deployed at:", address(fheWeth));

        // ============ Mint initial supply to deployer ============
        console.log("");
        console.log("--- Minting Initial Supply ---");

        uint256 usdcMint = 1_000_000 * 1e6;  // 1M USDC
        uint256 wethMint = 1_000 * 1e18;     // 1000 WETH

        usdc.mint(deployer, usdcMint);
        weth.mint(deployer, wethMint);
        fheUsdc.mint(deployer, usdcMint);
        fheWeth.mint(deployer, wethMint);

        console.log("Minted 1,000,000 USDC to deployer");
        console.log("Minted 1,000 WETH to deployer");
        console.log("Minted 1,000,000 fheUSDC to deployer");
        console.log("Minted 1,000 fheWETH to deployer");

        vm.stopBroadcast();

        // ============ Save Deployment ============
        _saveDeployment(address(usdc), address(weth), address(fheUsdc), address(fheWeth));

        // ============ Print Summary ============
        console.log("");
        console.log("===========================================");
        console.log("  DEPLOYMENT COMPLETE");
        console.log("===========================================");
        console.log("");
        console.log("Standard ERC20 Tokens:");
        console.log("  USDC:", address(usdc));
        console.log("  WETH:", address(weth));
        console.log("");
        console.log("FHE-Enabled Tokens:");
        console.log("  fheUSDC:", address(fheUsdc));
        console.log("  fheWETH:", address(fheWeth));
        console.log("");
        console.log("Deployment saved to:", DEPLOYMENTS_PATH);
        console.log("");
        console.log("Faucet Details:");
        console.log("  - Each call dispenses 100 tokens");
        console.log("  - 1 hour cooldown between calls");
        console.log("  - Anyone can call faucet()");
    }

    function _saveDeployment(
        address usdc,
        address weth,
        address fheUsdc,
        address fheWeth
    ) internal {
        string memory json = string.concat(
            '{\n',
            '  "chainId": ', vm.toString(block.chainid), ',\n',
            '  "deployedAt": "', vm.toString(block.timestamp), '",\n',
            '  "tokens": {\n',
            '    "erc20": {\n',
            '      "USDC": {\n',
            '        "address": "', vm.toString(usdc), '",\n',
            '        "symbol": "USDC",\n',
            '        "name": "USDC",\n',
            '        "decimals": 6,\n',
            '        "type": "erc20"\n',
            '      },\n',
            '      "WETH": {\n',
            '        "address": "', vm.toString(weth), '",\n',
            '        "symbol": "WETH",\n',
            '        "name": "WETH",\n',
            '        "decimals": 18,\n',
            '        "type": "erc20"\n',
            '      }\n',
            '    },\n',
            '    "fheerc20": {\n',
            '      "fheUSDC": {\n',
            '        "address": "', vm.toString(fheUsdc), '",\n',
            '        "symbol": "fheUSDC",\n',
            '        "name": "FHE USDC",\n',
            '        "decimals": 6,\n',
            '        "type": "fheerc20"\n',
            '      },\n',
            '      "fheWETH": {\n',
            '        "address": "', vm.toString(fheWeth), '",\n',
            '        "symbol": "fheWETH",\n',
            '        "name": "FHE WETH",\n',
            '        "decimals": 18,\n',
            '        "type": "fheerc20"\n',
            '      }\n',
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
