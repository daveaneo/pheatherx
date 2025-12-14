// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

/// @title SeedNativePool
/// @notice Seeds liquidity for Pool A (WETH/USDC) - native Uniswap v4 pool with no hook
/// @dev Run with: source .env && forge script script/SeedNativePool.s.sol:SeedNativePool --rpc-url $ETH_SEPOLIA_RPC --broadcast -vvv
contract SeedNativePool is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // ============ v8 Deployment Addresses (Eth Sepolia) ============
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // Tokens (sorted by address: WETH < USDC)
    address constant WETH = 0xe9Df64F549Eb1d2778909F339B9Bd795d14cF32E;
    address constant USDC = 0xF7Ff2A5E74eaA6E0463358BB26780049d3D45C56;

    // Pool config
    uint24 constant POOL_FEE = 3000;
    int24 constant TICK_SPACING = 60;

    // Initial liquidity amounts
    uint256 constant INIT_WETH_AMOUNT = 10 ether;          // 10 WETH
    uint256 constant INIT_USDC_AMOUNT = 10_000 * 1e6;      // 10,000 USDC

    // Full-range position (max range for tickSpacing=60)
    // Max tick for tickSpacing=60 is 887220 (must be divisible by 60)
    int24 constant TICK_LOWER = -887220;
    int24 constant TICK_UPPER = 887220;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("==========================================");
        console.log("  Seed Native Pool A (WETH/USDC)");
        console.log("  Ethereum Sepolia");
        console.log("==========================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("Position Manager:", POSITION_MANAGER);
        console.log("");

        // Check token balances
        uint256 wethBal = IERC20(WETH).balanceOf(deployer);
        uint256 usdcBal = IERC20(USDC).balanceOf(deployer);

        console.log("--- Token Balances ---");
        console.log("WETH balance:", wethBal / 1e18, "WETH");
        console.log("USDC balance:", usdcBal / 1e6, "USDC");

        require(wethBal >= INIT_WETH_AMOUNT, "Insufficient WETH balance");
        require(usdcBal >= INIT_USDC_AMOUNT, "Insufficient USDC balance");

        // Create pool key for native pool (no hook)
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))  // No hook for native pool
        });

        PoolId poolId = key.toId();
        console.log("");
        console.log("--- Pool Info ---");
        console.log("Pool ID:", vm.toString(PoolId.unwrap(poolId)));

        // Check if pool is initialized
        IPoolManager pm = IPoolManager(POOL_MANAGER);
        (uint160 sqrtPriceX96,,,) = pm.getSlot0(poolId);
        require(sqrtPriceX96 > 0, "Pool not initialized - run DeployV8Complete first");
        console.log("Pool initialized: YES");
        console.log("Current sqrtPriceX96:", sqrtPriceX96);

        vm.startBroadcast(deployerPrivateKey);

        // Approve tokens via Permit2 (required for Position Manager)
        // Step 1: Approve tokens to Permit2
        // Step 2: Approve Position Manager on Permit2
        console.log("");
        console.log("--- Approving Tokens (via Permit2) ---");
        IAllowanceTransfer permit2 = IAllowanceTransfer(PERMIT2);

        // Approve Permit2 to spend tokens
        IERC20(WETH).approve(PERMIT2, type(uint256).max);
        IERC20(USDC).approve(PERMIT2, type(uint256).max);
        console.log("Tokens approved to Permit2");

        // Approve Position Manager as spender on Permit2
        permit2.approve(WETH, POSITION_MANAGER, type(uint160).max, type(uint48).max);
        permit2.approve(USDC, POSITION_MANAGER, type(uint160).max, type(uint48).max);
        console.log("Position Manager approved on Permit2");

        // Calculate liquidity from amounts
        // For a full-range position at 1:1 price, we use a conservative liquidity estimate
        // The actual amounts used will depend on current price
        uint128 liquidity = _calculateLiquidity(sqrtPriceX96, INIT_WETH_AMOUNT, INIT_USDC_AMOUNT);
        console.log("");
        console.log("--- Adding Liquidity ---");
        console.log("Target WETH:", INIT_WETH_AMOUNT / 1e18, "WETH");
        console.log("Target USDC:", INIT_USDC_AMOUNT / 1e6, "USDC");
        console.log("Liquidity:", liquidity);

        // Encode the mint action
        // MINT_POSITION params: (PoolKey, tickLower, tickUpper, liquidity, amount0Max, amount1Max, recipient, hookData)
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            key,
            TICK_LOWER,
            TICK_UPPER,
            liquidity,
            INIT_WETH_AMOUNT,  // amount0Max (WETH)
            INIT_USDC_AMOUNT,  // amount1Max (USDC)
            deployer,          // recipient
            bytes("")          // hookData (empty for native)
        );
        params[1] = abi.encode(Currency.wrap(WETH), Currency.wrap(USDC));

        // Execute MINT_POSITION + SETTLE_PAIR
        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes memory callData = abi.encode(actions, params);

        uint256 deadline = block.timestamp + 3600; // 1 hour deadline

        IPositionManager posm = IPositionManager(POSITION_MANAGER);
        posm.modifyLiquidities(callData, deadline);

        vm.stopBroadcast();

        // Verify
        console.log("");
        console.log("--- Verifying ---");
        uint128 poolLiquidity = pm.getLiquidity(poolId);
        console.log("Pool liquidity after seeding:", poolLiquidity);

        console.log("");
        console.log("==========================================");
        console.log("  Pool A Seeded Successfully!");
        console.log("==========================================");
    }

    /// @notice Calculate liquidity from token amounts for a full-range position
    /// @dev Simplified calculation - actual amounts may differ based on price
    function _calculateLiquidity(
        uint160 sqrtPriceX96,
        uint256 amount0,
        uint256 amount1
    ) internal pure returns (uint128) {
        // For a full-range position, liquidity is approximately:
        // L = sqrt(amount0 * amount1) for 1:1 price
        // This is a simplified estimate - PositionManager will use actual amounts

        // Use a conservative liquidity value based on amounts
        // L ≈ 2 * sqrt(amount0 * amount1) / (2^96 / sqrtPriceX96)
        // For simplicity, use amount0 as the base (will be adjusted by PM)

        // Conservative estimate: use the smaller equivalent amount
        // At 1:1 price, 1 WETH = 1000 USDC assumption for initial seeding
        // Liquidity unit is roughly amount0 * sqrtPrice / 2^48

        // Simpler approach: use a fixed reasonable liquidity for initial seeding
        // This will use approximately our target amounts at current price
        uint256 sqrtAmount = sqrt(amount0 * amount1);
        return uint128(sqrtAmount / 1e9); // Scale down for reasonable liquidity value
    }

    /// @notice Calculate square root using Babylonian method
    function sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }
}
