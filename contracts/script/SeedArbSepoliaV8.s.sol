// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {FheatherXv8Mixed} from "../src/FheatherXv8Mixed.sol";

/// @title SeedArbSepoliaV8
/// @notice Seeds liquidity for v8Mixed pools on Arbitrum Sepolia
/// @dev Run with: PRIVATE_KEY=0x... forge script script/SeedArbSepoliaV8.s.sol:SeedArbSepoliaV8 --rpc-url https://sepolia-rollup.arbitrum.io/rpc --broadcast -vvv
/// @dev NOTE: v8FHE pools require encrypted inputs (InEuint128) and must be seeded via frontend/CoFHE
contract SeedArbSepoliaV8 is Script {
    using PoolIdLibrary for PoolId;

    // ============ Arbitrum Sepolia Addresses ============
    address constant POOL_MANAGER = 0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317;
    address constant V8_MIXED_HOOK = 0xB058257E3C8347059690605163384BA933B0D088;

    // Tokens
    address constant WETH = 0xC5EcD76Db9f00B07088DDbFbdf7BF9927F6DDE13;
    address constant USDC = 0x00F7DC53A57b980F839767a6C6214b4089d916b1;
    address constant FHE_WETH = 0x7Da141eeA1F3c2dD0cC41915eE0AA19bE545d3e0;
    address constant FHE_USDC = 0x987731d456B5996E7414d79474D8aba58d4681DC;

    // Pool IDs for v8Mixed pools (ERC20:FHERC20 pairs)
    bytes32 constant POOL_ID_WETH_FHEUSDC = 0x41916bfac052f6e4b5d8eff9fbc5bdcac0c45ddcc75548af8a6e2d3cc413bb3e;
    bytes32 constant POOL_ID_FHEWETH_USDC = 0xbd854dfc04217be8e5d32fee22fddcc4c2bc65bfa69ea87eed9213664d63546c;
    bytes32 constant POOL_ID_WETH_FHEWETH = 0xa462a29413849701e0888361ccbd32580cde3859dede02aea081ef56250e5a1a;
    bytes32 constant POOL_ID_USDC_FHEUSDC = 0x1f2e4b37512fb968c5dcf9f71dc788a65b8b87ba2b23324ae61ef6d1615bec4e;

    // Initial liquidity amounts
    uint256 constant INIT_WETH_AMOUNT = 10 ether;           // 10 WETH
    uint256 constant INIT_USDC_AMOUNT = 10_000 * 1e6;       // 10,000 USDC
    uint256 constant INIT_FHE_WETH_AMOUNT = 10 ether;       // 10 fheWETH
    uint256 constant INIT_FHE_USDC_AMOUNT = 10_000 * 1e6;   // 10,000 fheUSDC

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("==========================================");
        console.log("  Seed V8 Mixed Pools - Arbitrum Sepolia");
        console.log("==========================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("v8Mixed Hook:", V8_MIXED_HOOK);
        console.log("");
        console.log("NOTE: v8FHE pools (fheWETH/fheUSDC) require encrypted");
        console.log("      inputs and must be seeded via frontend/CoFHE");
        console.log("");

        // Check token balances
        console.log("--- Token Balances ---");
        console.log("WETH:", IERC20(WETH).balanceOf(deployer) / 1e18);
        console.log("USDC:", IERC20(USDC).balanceOf(deployer) / 1e6);
        console.log("fheWETH:", IERC20(FHE_WETH).balanceOf(deployer) / 1e18);
        console.log("fheUSDC:", IERC20(FHE_USDC).balanceOf(deployer) / 1e6);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Approve all tokens to v8Mixed hook
        console.log("--- Approving Tokens to v8Mixed ---");
        IERC20(WETH).approve(V8_MIXED_HOOK, type(uint256).max);
        IERC20(USDC).approve(V8_MIXED_HOOK, type(uint256).max);
        IERC20(FHE_WETH).approve(V8_MIXED_HOOK, type(uint256).max);
        IERC20(FHE_USDC).approve(V8_MIXED_HOOK, type(uint256).max);
        console.log("All tokens approved");
        console.log("");

        FheatherXv8Mixed mixed = FheatherXv8Mixed(payable(V8_MIXED_HOOK));

        // ============ Seed v8Mixed Pools ============
        console.log("--- Seeding v8Mixed Pools ---");

        // Pool: WETH/fheUSDC (token0=fheUSDC, token1=WETH based on address sort)
        console.log("Pool: WETH/fheUSDC");
        mixed.addLiquidity(PoolId.wrap(POOL_ID_WETH_FHEUSDC), INIT_FHE_USDC_AMOUNT, INIT_WETH_AMOUNT);
        console.log("  Added liquidity: 10000 fheUSDC + 10 WETH");

        // Pool: fheWETH/USDC (token0=USDC, token1=fheWETH based on address sort)
        console.log("Pool: fheWETH/USDC");
        mixed.addLiquidity(PoolId.wrap(POOL_ID_FHEWETH_USDC), INIT_USDC_AMOUNT, INIT_FHE_WETH_AMOUNT);
        console.log("  Added liquidity: 10000 USDC + 10 fheWETH");

        // Pool: WETH/fheWETH (token0=fheWETH, token1=WETH based on address sort)
        console.log("Pool: WETH/fheWETH");
        mixed.addLiquidity(PoolId.wrap(POOL_ID_WETH_FHEWETH), INIT_FHE_WETH_AMOUNT, INIT_WETH_AMOUNT);
        console.log("  Added liquidity: 10 fheWETH + 10 WETH");

        // Pool: USDC/fheUSDC (token0=USDC, token1=fheUSDC based on address sort)
        console.log("Pool: USDC/fheUSDC");
        mixed.addLiquidity(PoolId.wrap(POOL_ID_USDC_FHEUSDC), INIT_USDC_AMOUNT, INIT_FHE_USDC_AMOUNT);
        console.log("  Added liquidity: 10000 USDC + 10000 fheUSDC");

        vm.stopBroadcast();

        // ============ Verify ============
        console.log("");
        console.log("--- Verifying Reserves ---");

        (uint256 r0, uint256 r1) = mixed.getReserves(PoolId.wrap(POOL_ID_WETH_FHEUSDC));
        console.log("WETH/fheUSDC reserves:", r0 / 1e6, "/", r1 / 1e18);

        (r0, r1) = mixed.getReserves(PoolId.wrap(POOL_ID_FHEWETH_USDC));
        console.log("fheWETH/USDC reserves:", r0 / 1e6, "/", r1 / 1e18);

        (r0, r1) = mixed.getReserves(PoolId.wrap(POOL_ID_WETH_FHEWETH));
        console.log("WETH/fheWETH reserves:", r0 / 1e18, "/", r1 / 1e18);

        (r0, r1) = mixed.getReserves(PoolId.wrap(POOL_ID_USDC_FHEUSDC));
        console.log("USDC/fheUSDC reserves:", r0 / 1e6, "/", r1 / 1e6);

        console.log("");
        console.log("==========================================");
        console.log("  V8 Mixed Pools Seeded Successfully!");
        console.log("==========================================");
    }
}
