// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/StdJson.sol";
import {FaucetToken} from "../src/tokens/FaucetToken.sol";
import {FheFaucetToken} from "../src/tokens/FheFaucetToken.sol";

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
        FaucetToken usdc = new FaucetToken("Test USDC", "tUSDC", 6);
        console.log("tUSDC deployed at:", address(usdc));

        // ETH-like token (18 decimals)
        FaucetToken weth = new FaucetToken("Test WETH", "tWETH", 18);
        console.log("tWETH deployed at:", address(weth));

        // ============ Deploy FHE-Enabled Tokens ============
        console.log("");
        console.log("--- Deploying FHE-Enabled Tokens ---");

        // FHE USDC (6 decimals)
        FheFaucetToken fheUsdc = new FheFaucetToken("FHE Test USDC", "fheUSDC", 6);
        console.log("fheUSDC deployed at:", address(fheUsdc));

        // FHE ETH (18 decimals)
        FheFaucetToken fheWeth = new FheFaucetToken("FHE Test WETH", "fheWETH", 18);
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

        console.log("Minted 1,000,000 tUSDC to deployer");
        console.log("Minted 1,000 tWETH to deployer");
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
        console.log("  tUSDC:", address(usdc));
        console.log("  tWETH:", address(weth));
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
            '      "tUSDC": {\n',
            '        "address": "', vm.toString(usdc), '",\n',
            '        "symbol": "tUSDC",\n',
            '        "name": "Test USDC",\n',
            '        "decimals": 6,\n',
            '        "type": "erc20"\n',
            '      },\n',
            '      "tWETH": {\n',
            '        "address": "', vm.toString(weth), '",\n',
            '        "symbol": "tWETH",\n',
            '        "name": "Test WETH",\n',
            '        "decimals": 18,\n',
            '        "type": "erc20"\n',
            '      }\n',
            '    },\n',
            '    "fheerc20": {\n',
            '      "fheUSDC": {\n',
            '        "address": "', vm.toString(fheUsdc), '",\n',
            '        "symbol": "fheUSDC",\n',
            '        "name": "FHE Test USDC",\n',
            '        "decimals": 6,\n',
            '        "type": "fheerc20"\n',
            '      },\n',
            '      "fheWETH": {\n',
            '        "address": "', vm.toString(fheWeth), '",\n',
            '        "symbol": "fheWETH",\n',
            '        "name": "FHE Test WETH",\n',
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
