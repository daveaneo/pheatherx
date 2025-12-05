// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/StdJson.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {PheatherXv2} from "../src/PheatherXv2.sol";
import {FHERC20FaucetToken} from "../src/tokens/FHERC20FaucetToken.sol";

/// @title DeployPheatherXv2
/// @notice Deploy PheatherXv2 with FHERC20 tokens for private AMM
/// @dev Run with: source .env && forge script script/DeployPheatherXv2.s.sol:DeployPheatherXv2 --rpc-url $ETH_SEPOLIA_RPC --broadcast
contract DeployPheatherXv2 is Script {
    using stdJson for string;

    // Ethereum Sepolia addresses (from Uniswap v4 docs)
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant SWAP_ROUTER = 0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe;
    address constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;

    // CREATE2 Deployer Proxy (standard across EVM chains)
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    // Deployment config
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336; // 1:1 price
    uint24 constant POOL_FEE = 3000; // 0.3%
    int24 constant TICK_SPACING = 60;
    uint24 constant SWAP_FEE_BPS = 30; // 0.3%

    string constant DEPLOYMENTS_PATH = "deployments/pheatherx-v2.json";

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("===========================================");
        console.log("  PheatherXv2 Deployment (Private AMM)");
        console.log("===========================================");
        console.log("");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Pool Manager:", POOL_MANAGER);
        console.log("");

        // Check if we already have a deployment
        bool hasExistingDeployment = _checkExistingDeployment();
        if (hasExistingDeployment) {
            console.log("Found existing deployment. Delete deployments/pheatherx-v2.json to redeploy.");
            return;
        }

        vm.startBroadcast(deployerPrivateKey);

        // ============ Deploy FHERC20 Tokens ============
        console.log("--- Deploying FHERC20 Tokens ---");

        FHERC20FaucetToken tokenA = new FHERC20FaucetToken("PheatherX Test USDC", "tUSDC", 6);
        FHERC20FaucetToken tokenB = new FHERC20FaucetToken("PheatherX Test WETH", "tWETH", 18);

        // Sort tokens (Uniswap requirement: token0 < token1)
        (address token0Addr, address token1Addr) = address(tokenA) < address(tokenB)
            ? (address(tokenA), address(tokenB))
            : (address(tokenB), address(tokenA));

        console.log("Token0 (FHERC20):", token0Addr);
        console.log("Token1 (FHERC20):", token1Addr);

        // ============ Deploy Hook with CREATE2 ============
        console.log("");
        console.log("--- Deploying PheatherXv2 Hook (CREATE2) ---");

        // Calculate required hook flags
        uint160 flags = uint160(
            Hooks.BEFORE_ADD_LIQUIDITY_FLAG |
            Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG |
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.AFTER_SWAP_FLAG |
            Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        );

        console.log("Required flags:", flags);

        // Mine a salt that produces a valid hook address
        bytes memory creationCode = type(PheatherXv2).creationCode;
        bytes memory constructorArgs = abi.encode(
            IPoolManager(POOL_MANAGER),
            token0Addr,
            token1Addr,
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
        PheatherXv2 hook = PheatherXv2(payable(hookAddress));
        require(address(hook).code.length > 0, "Hook not deployed");

        console.log("Hook deployed at:", hookAddress);

        // ============ Initialize Pool ============
        console.log("");
        console.log("--- Initializing Pool ---");

        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(token0Addr),
            currency1: Currency.wrap(token1Addr),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hookAddress)
        });

        IPoolManager(POOL_MANAGER).initialize(poolKey, SQRT_PRICE_1_1);
        console.log("Pool initialized with 1:1 price ratio");

        vm.stopBroadcast();

        // ============ Save Deployment ============
        _saveDeployment(token0Addr, token1Addr, hookAddress);

        // ============ Print Summary ============
        console.log("");
        console.log("===========================================");
        console.log("  DEPLOYMENT COMPLETE - PheatherXv2");
        console.log("===========================================");
        console.log("");
        console.log("FHERC20 Token0:", token0Addr);
        console.log("FHERC20 Token1:", token1Addr);
        console.log("PheatherXv2 Hook:", hookAddress);
        console.log("Pool Manager:", POOL_MANAGER);
        console.log("");
        console.log("Deployment saved to:", DEPLOYMENTS_PATH);
        console.log("");
        console.log("Features:");
        console.log("  - Single-transaction swaps (no deposit/withdraw)");
        console.log("  - Plaintext swap() for router compatibility");
        console.log("  - Encrypted swapEncrypted() for full privacy");
        console.log("  - 4 limit order types (Buy/Sell x Limit/Stop)");
        console.log("  - FHERC20 tokens with encrypted balances");
        console.log("");
        console.log("Next steps:");
        console.log("1. Get tokens from faucet: token.faucet()");
        console.log("2. Add liquidity: hook.addLiquidity(amount0, amount1)");
        console.log("3. Swap: hook.swap(zeroForOne, amountIn, minAmountOut)");
    }

    function _checkExistingDeployment() internal view returns (bool) {
        try vm.readFile(DEPLOYMENTS_PATH) returns (string memory) {
            return true;
        } catch {
            return false;
        }
    }

    function _saveDeployment(address token0, address token1, address hook) internal {
        string memory json = string.concat(
            '{\n',
            '  "version": "v2",\n',
            '  "chainId": ', vm.toString(block.chainid), ',\n',
            '  "deployedAt": "', vm.toString(block.timestamp), '",\n',
            '  "contracts": {\n',
            '    "token0": "', vm.toString(token0), '",\n',
            '    "token1": "', vm.toString(token1), '",\n',
            '    "hook": "', vm.toString(hook), '",\n',
            '    "poolManager": "', vm.toString(POOL_MANAGER), '",\n',
            '    "swapRouter": "', vm.toString(SWAP_ROUTER), '",\n',
            '    "positionManager": "', vm.toString(POSITION_MANAGER), '"\n',
            '  },\n',
            '  "poolConfig": {\n',
            '    "fee": ', vm.toString(POOL_FEE), ',\n',
            '    "tickSpacing": ', vm.toString(int256(TICK_SPACING)), ',\n',
            '    "swapFeeBps": ', vm.toString(SWAP_FEE_BPS), '\n',
            '  },\n',
            '  "features": {\n',
            '    "singleTxSwaps": true,\n',
            '    "plaintextPath": true,\n',
            '    "encryptedPath": true,\n',
            '    "limitOrders": ["buyLimit", "buyStop", "sellLimit", "sellStop"],\n',
            '    "fherc20Tokens": true\n',
            '  }\n',
            '}'
        );

        vm.writeFile(DEPLOYMENTS_PATH, json);
    }
}
