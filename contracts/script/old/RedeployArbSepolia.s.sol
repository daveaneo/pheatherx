// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/StdJson.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {FheatherXv6} from "../src/FheatherXv6.sol";

/// @title RedeployArbSepolia
/// @notice Redeploy FheatherXv6 hook on Arbitrum Sepolia using EXISTING tokens
/// @dev Run with: source .env && forge script script/RedeployArbSepolia.s.sol:RedeployArbSepolia --rpc-url $ARB_SEPOLIA_RPC --broadcast -vvv
contract RedeployArbSepolia is Script {
    using stdJson for string;
    using PoolIdLibrary for PoolKey;

    // ============ Arbitrum Sepolia Addresses ============
    address constant POOL_MANAGER = 0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317;
    address constant SWAP_ROUTER = 0xf3A39C86dbd13C45365E57FB90fe413371F65AF8;
    address constant POSITION_MANAGER = 0xAc631556d3d4019C95769033B5E719dD77124BAc;
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    // ============ EXISTING Token Addresses ============
    address constant WETH = 0xC5EcD76Db9f00B07088DDbFbdf7BF9927F6DDE13;
    address constant USDC = 0x00F7DC53A57b980F839767a6C6214b4089d916b1;
    address constant FHE_WETH = 0x7Da141eeA1F3c2dD0cC41915eE0AA19bE545d3e0;
    address constant FHE_USDC = 0x987731d456B5996E7414d79474D8aba58d4681DC;

    // ============ Config ============
    uint256 constant SWAP_FEE_BPS = 30;
    uint24 constant POOL_FEE = 3000;
    int24 constant TICK_SPACING = 60;
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    // Liquidity amounts
    uint256 constant INIT_WETH_AMOUNT = 10 ether;
    uint256 constant INIT_USDC_AMOUNT = 10_000 * 1e6;
    uint256 constant INIT_FHE_WETH_AMOUNT = 10 ether;
    uint256 constant INIT_FHE_USDC_AMOUNT = 10_000 * 1e6;

    string constant DEPLOYMENTS_PATH = "deployments/v6-arb-sepolia.json";

    bytes32 poolIdA;
    bytes32 poolIdB;
    bytes32 poolIdC;
    bytes32 poolIdD;
    bytes32 poolIdE;
    bytes32 poolIdF;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("===========================================");
        console.log("  FheatherXv6 REDEPLOY (Bugfix)");
        console.log("  Arbitrum Sepolia - Using Existing Tokens");
        console.log("===========================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("Pool Manager:", POOL_MANAGER);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // ============ Step 1: Deploy Hook ============
        console.log("--- Step 1: Deploying FheatherXv6 Hook ---");

        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG |
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.AFTER_SWAP_FLAG |
            Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        );

        bytes memory creationCode = type(FheatherXv6).creationCode;
        bytes memory constructorArgs = abi.encode(
            IPoolManager(POOL_MANAGER),
            deployer,
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

        bytes memory bytecode = abi.encodePacked(creationCode, constructorArgs);
        (bool success,) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, bytecode));
        require(success, "CREATE2 deployment failed");

        FheatherXv6 hook = FheatherXv6(payable(hookAddress));
        require(address(hook).code.length > 0, "Hook not deployed");
        console.log("Hook deployed at:", hookAddress);
        console.log("");

        // ============ Step 2: Initialize Pools ============
        console.log("--- Step 2: Initializing Pools ---");
        IPoolManager pm = IPoolManager(POOL_MANAGER);

        // Pool A: WETH/USDC
        (address t0A, address t1A) = _sort(WETH, USDC);
        pm.initialize(_key(t0A, t1A, hookAddress), SQRT_PRICE_1_1);
        poolIdA = PoolId.unwrap(_key(t0A, t1A, hookAddress).toId());
        console.log("Pool A (WETH/USDC):", vm.toString(poolIdA));

        // Pool B: fheWETH/fheUSDC
        (address t0B, address t1B) = _sort(FHE_WETH, FHE_USDC);
        pm.initialize(_key(t0B, t1B, hookAddress), SQRT_PRICE_1_1);
        poolIdB = PoolId.unwrap(_key(t0B, t1B, hookAddress).toId());
        console.log("Pool B (fheWETH/fheUSDC):", vm.toString(poolIdB));

        // Pool C: WETH/fheUSDC
        (address t0C, address t1C) = _sort(WETH, FHE_USDC);
        pm.initialize(_key(t0C, t1C, hookAddress), SQRT_PRICE_1_1);
        poolIdC = PoolId.unwrap(_key(t0C, t1C, hookAddress).toId());
        console.log("Pool C (WETH/fheUSDC):", vm.toString(poolIdC));

        // Pool D: fheWETH/USDC
        (address t0D, address t1D) = _sort(FHE_WETH, USDC);
        pm.initialize(_key(t0D, t1D, hookAddress), SQRT_PRICE_1_1);
        poolIdD = PoolId.unwrap(_key(t0D, t1D, hookAddress).toId());
        console.log("Pool D (fheWETH/USDC):", vm.toString(poolIdD));

        // Pool E: WETH/fheWETH
        (address t0E, address t1E) = _sort(WETH, FHE_WETH);
        pm.initialize(_key(t0E, t1E, hookAddress), SQRT_PRICE_1_1);
        poolIdE = PoolId.unwrap(_key(t0E, t1E, hookAddress).toId());
        console.log("Pool E (WETH/fheWETH):", vm.toString(poolIdE));

        // Pool F: USDC/fheUSDC
        (address t0F, address t1F) = _sort(USDC, FHE_USDC);
        pm.initialize(_key(t0F, t1F, hookAddress), SQRT_PRICE_1_1);
        poolIdF = PoolId.unwrap(_key(t0F, t1F, hookAddress).toId());
        console.log("Pool F (USDC/fheUSDC):", vm.toString(poolIdF));
        console.log("");

        // ============ Step 3: Seed Liquidity ============
        console.log("--- Step 3: Seeding Liquidity ---");

        // Check balances
        console.log("Deployer balances:");
        console.log("  WETH:", IERC20(WETH).balanceOf(deployer));
        console.log("  USDC:", IERC20(USDC).balanceOf(deployer));
        console.log("  fheWETH:", IERC20(FHE_WETH).balanceOf(deployer));
        console.log("  fheUSDC:", IERC20(FHE_USDC).balanceOf(deployer));

        // Approve
        IERC20(WETH).approve(hookAddress, type(uint256).max);
        IERC20(USDC).approve(hookAddress, type(uint256).max);
        IERC20(FHE_WETH).approve(hookAddress, type(uint256).max);
        IERC20(FHE_USDC).approve(hookAddress, type(uint256).max);

        // Pool A
        (uint256 a0, uint256 a1) = _amounts(t0A, WETH, INIT_WETH_AMOUNT, INIT_USDC_AMOUNT);
        hook.addLiquidity(PoolId.wrap(poolIdA), a0, a1);
        console.log("Added liquidity to Pool A");

        // Pool B
        (uint256 b0, uint256 b1) = _amounts(t0B, FHE_WETH, INIT_FHE_WETH_AMOUNT, INIT_FHE_USDC_AMOUNT);
        hook.addLiquidity(PoolId.wrap(poolIdB), b0, b1);
        console.log("Added liquidity to Pool B");

        // Pool C
        (uint256 c0, uint256 c1) = _amounts(t0C, WETH, INIT_WETH_AMOUNT, INIT_FHE_USDC_AMOUNT);
        hook.addLiquidity(PoolId.wrap(poolIdC), c0, c1);
        console.log("Added liquidity to Pool C");

        // Pool D
        (uint256 d0, uint256 d1) = _amounts(t0D, FHE_WETH, INIT_FHE_WETH_AMOUNT, INIT_USDC_AMOUNT);
        hook.addLiquidity(PoolId.wrap(poolIdD), d0, d1);
        console.log("Added liquidity to Pool D");

        // Pool E
        (uint256 e0, uint256 e1) = _amounts(t0E, WETH, INIT_WETH_AMOUNT, INIT_FHE_WETH_AMOUNT);
        hook.addLiquidity(PoolId.wrap(poolIdE), e0, e1);
        console.log("Added liquidity to Pool E");

        // Pool F
        (uint256 f0, uint256 f1) = _amounts(t0F, USDC, INIT_USDC_AMOUNT, INIT_FHE_USDC_AMOUNT);
        hook.addLiquidity(PoolId.wrap(poolIdF), f0, f1);
        console.log("Added liquidity to Pool F");

        vm.stopBroadcast();

        // ============ Save Deployment ============
        _saveDeployment(hookAddress, t0A, t1A, t0B, t1B, t0C, t1C, t0D, t1D, t0E, t1E, t0F, t1F);

        console.log("");
        console.log("===========================================");
        console.log("  REDEPLOYMENT COMPLETE");
        console.log("===========================================");
        console.log("Hook:", hookAddress);
        console.log("Saved to:", DEPLOYMENTS_PATH);
        console.log("");
        console.log("UPDATE frontend/src/lib/contracts/addresses.ts:");
        console.log("  421614: '", hookAddress, "'");
    }

    function _sort(address a, address b) internal pure returns (address, address) {
        return a < b ? (a, b) : (b, a);
    }

    function _key(address t0, address t1, address hook) internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(t0),
            currency1: Currency.wrap(t1),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });
    }

    function _amounts(address t0, address wantT0, uint256 amt0, uint256 amt1) internal pure returns (uint256, uint256) {
        return t0 == wantT0 ? (amt0, amt1) : (amt1, amt0);
    }

    function _saveDeployment(
        address hook,
        address t0A, address t1A,
        address t0B, address t1B,
        address t0C, address t1C,
        address t0D, address t1D,
        address t0E, address t1E,
        address t0F, address t1F
    ) internal {
        string memory json = string.concat(
            '{\n',
            '  "version": "v6",\n',
            '  "network": "arb-sepolia",\n',
            '  "chainId": 421614,\n',
            '  "deployedAt": "', vm.toString(block.timestamp), '",\n',
            '  "contracts": {\n',
            '    "hook": "', vm.toString(hook), '",\n',
            '    "poolManager": "', vm.toString(POOL_MANAGER), '",\n',
            '    "swapRouter": "', vm.toString(SWAP_ROUTER), '",\n',
            '    "positionManager": "', vm.toString(POSITION_MANAGER), '"\n',
            '  },\n',
            '  "tokens": {\n',
            '    "WETH": { "address": "', vm.toString(WETH), '", "decimals": 18, "type": "ERC20" },\n',
            '    "USDC": { "address": "', vm.toString(USDC), '", "decimals": 6, "type": "ERC20" },\n',
            '    "fheWETH": { "address": "', vm.toString(FHE_WETH), '", "decimals": 18, "type": "FHERC20" },\n',
            '    "fheUSDC": { "address": "', vm.toString(FHE_USDC), '", "decimals": 6, "type": "FHERC20" }\n',
            '  },\n'
        );

        json = string.concat(json,
            '  "pools": {\n',
            '    "WETH_USDC": { "poolId": "', vm.toString(poolIdA), '", "token0": "', vm.toString(t0A), '", "token1": "', vm.toString(t1A), '", "type": "ERC:ERC" },\n',
            '    "fheWETH_fheUSDC": { "poolId": "', vm.toString(poolIdB), '", "token0": "', vm.toString(t0B), '", "token1": "', vm.toString(t1B), '", "type": "FHE:FHE" },\n',
            '    "WETH_fheUSDC": { "poolId": "', vm.toString(poolIdC), '", "token0": "', vm.toString(t0C), '", "token1": "', vm.toString(t1C), '", "type": "ERC:FHE" },\n',
            '    "fheWETH_USDC": { "poolId": "', vm.toString(poolIdD), '", "token0": "', vm.toString(t0D), '", "token1": "', vm.toString(t1D), '", "type": "FHE:ERC" },\n',
            '    "WETH_fheWETH": { "poolId": "', vm.toString(poolIdE), '", "token0": "', vm.toString(t0E), '", "token1": "', vm.toString(t1E), '", "type": "ERC:FHE" },\n',
            '    "USDC_fheUSDC": { "poolId": "', vm.toString(poolIdF), '", "token0": "', vm.toString(t0F), '", "token1": "', vm.toString(t1F), '", "type": "ERC:FHE" }\n',
            '  },\n'
        );

        json = string.concat(json,
            '  "poolConfig": { "fee": 3000, "tickSpacing": 60, "swapFeeBps": 30 },\n',
            '  "features": { "multiPool": true, "encryptedAMM": true, "limitOrders": true, "mixedPairs": true, "v4Settlement": true }\n',
            '}'
        );

        vm.writeFile(DEPLOYMENTS_PATH, json);
    }
}
