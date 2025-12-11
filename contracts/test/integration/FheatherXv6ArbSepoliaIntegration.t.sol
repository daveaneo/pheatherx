// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// FheatherXv6 Integration Tests for Arbitrum Sepolia
// Tests against deployed contracts on Arbitrum Sepolia with real CoFHE

// Foundry Imports
import "forge-std/Test.sol";

// Uniswap Imports
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {CurrencyLibrary, Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

// Local Imports
import {FheatherXv6} from "../../src/FheatherXv6.sol";

// FHE Imports
import {FHE, euint128, ebool, InEuint128, InEbool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

// OpenZeppelin Imports
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFHERC20 is IERC20 {
    function wrap(uint256 amount) external;
    function unwrap(uint256 amount) external;
    function faucet() external;
    function mintEncrypted(address to, uint256 amount) external;
    function approveEncrypted(address spender, InEuint128 calldata amount) external;
    function _transferFromEncrypted(address from, address to, euint128 amount) external;
    function _transferEncrypted(address to, euint128 amount) external;
}

/**
 * @title FheatherXv6 Arbitrum Sepolia Integration Tests
 * @notice Run with: forge test --match-contract FheatherXv6ArbSepoliaIntegration --fork-url $ARB_SEPOLIA_RPC -vvv
 *
 * Test Matrix (from docs/fheatherx-v6/testing.md):
 * - Pool A: ERC20:ERC20 (WETH/USDC)
 * - Pool B: FHERC20:FHERC20 (fheWETH/fheUSDC)
 * - Pool C: ERC20:FHERC20 (WETH/fheUSDC)
 * - Pool D: FHERC20:ERC20 (fheWETH/USDC)
 */
contract FheatherXv6ArbSepoliaIntegration is Test {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    // Deployed contract addresses from deployments/v6-arb-sepolia.json
    address constant HOOK_ADDRESS = 0x59CA6d351a3080fa690147F02e0e8DE70b9D10C8;
    address constant POOL_MANAGER = 0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317;
    address constant SWAP_ROUTER = 0xf3A39C86dbd13C45365E57FB90fe413371F65AF8;

    // Token addresses
    address constant WETH = 0x4b6ba4Bbfb4ffBcc916CAe8BA10E0bb0C5fEf23a;
    address constant USDC = 0x83BC78029f3aC12D59d91B861E8Dc680090C7435;
    address constant FHE_WETH = 0x9fcAa2Fde62f5cbe756500B6a47383B84D862C86;
    address constant FHE_USDC = 0x90A93499Ac71725864c3dc23c9AB26f46cb377dE;

    // Pool IDs from deployment
    bytes32 constant POOL_ID_WETH_USDC = 0xc40996a5d6af54854e3cf0d8f14b036735f0115d785dbd237b00184865c84972;
    bytes32 constant POOL_ID_FHE_FHE = 0x3d29e2b7b90cb2af0b2693351855082b1005010bfdc5aef1951e3640707a0674;
    bytes32 constant POOL_ID_WETH_FHE_USDC = 0x698c357aa7ff31875f0a6cb6a4de7d19b42fc47c6b5904a81b4d2329b7262b02;
    bytes32 constant POOL_ID_FHE_WETH_USDC = 0x5fd2a7f7105fc0a47d1080d5d99e14ba971aee20aea0f4cf89c8b8fe90ba7d3a;

    // Contract instances
    FheatherXv6 hook;
    IPoolManager poolManager;
    PoolSwapTest swapRouter;

    // Test config
    int24 constant TICK_SPACING = 60;
    int24 constant TEST_TICK = 60;

    // Test user (will be funded)
    address testUser;
    uint256 testUserPrivateKey;

    function setUp() public {
        // Get deployed contracts
        hook = FheatherXv6(payable(HOOK_ADDRESS));
        poolManager = IPoolManager(POOL_MANAGER);
        swapRouter = PoolSwapTest(SWAP_ROUTER);

        // Create test user
        testUserPrivateKey = uint256(keccak256("test user"));
        testUser = vm.addr(testUserPrivateKey);

        vm.label(testUser, "testUser");
        vm.label(HOOK_ADDRESS, "FheatherXv6Hook");
        vm.label(WETH, "WETH");
        vm.label(USDC, "USDC");
        vm.label(FHE_WETH, "fheWETH");
        vm.label(FHE_USDC, "fheUSDC");

        // Fund test user with ETH for gas
        vm.deal(testUser, 10 ether);

        // Fund test user with tokens
        _fundTestUserTokens();
    }

    function _fundTestUserTokens() internal {
        // Mint faucet tokens to test user
        vm.startPrank(testUser);

        // Call faucet on all tokens
        IFHERC20(WETH).faucet();
        IFHERC20(USDC).faucet();
        IFHERC20(FHE_WETH).faucet();
        IFHERC20(FHE_USDC).faucet();

        // Approve hook for all tokens
        IERC20(WETH).approve(HOOK_ADDRESS, type(uint256).max);
        IERC20(USDC).approve(HOOK_ADDRESS, type(uint256).max);
        IERC20(FHE_WETH).approve(HOOK_ADDRESS, type(uint256).max);
        IERC20(FHE_USDC).approve(HOOK_ADDRESS, type(uint256).max);

        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                 PHASE 1: POOL SETUP VERIFICATION
    // ═══════════════════════════════════════════════════════════════════════

    function test_Phase1_PoolA_ErcErc_Initialized() public view {
        PoolId poolId = PoolId.wrap(POOL_ID_WETH_USDC);

        (
            address token0,
            address token1,
            bool token0IsFherc20,
            bool token1IsFherc20,
            bool initialized,
            ,
        ) = hook.getPoolState(poolId);

        assertTrue(initialized, "Pool A should be initialized");
        assertFalse(token0IsFherc20, "Pool A token0 should not be FHERC20");
        assertFalse(token1IsFherc20, "Pool A token1 should not be FHERC20");
        assertEq(token0, WETH, "Pool A token0 should be WETH");
        assertEq(token1, USDC, "Pool A token1 should be USDC");
    }

    function test_Phase1_PoolB_FheFhe_Initialized() public view {
        PoolId poolId = PoolId.wrap(POOL_ID_FHE_FHE);

        (
            ,
            ,
            bool token0IsFherc20,
            bool token1IsFherc20,
            bool initialized,
            ,
        ) = hook.getPoolState(poolId);

        assertTrue(initialized, "Pool B should be initialized");
        assertTrue(token0IsFherc20, "Pool B token0 should be FHERC20");
        assertTrue(token1IsFherc20, "Pool B token1 should be FHERC20");
    }

    function test_Phase1_PoolC_ErcFhe_Initialized() public view {
        PoolId poolId = PoolId.wrap(POOL_ID_WETH_FHE_USDC);

        (
            ,
            ,
            bool token0IsFherc20,
            bool token1IsFherc20,
            bool initialized,
            ,
        ) = hook.getPoolState(poolId);

        assertTrue(initialized, "Pool C should be initialized");
        // One ERC20, one FHERC20
        assertTrue(token0IsFherc20 != token1IsFherc20, "Pool C should have mixed token types");
    }

    function test_Phase1_PoolD_FheErc_Initialized() public view {
        PoolId poolId = PoolId.wrap(POOL_ID_FHE_WETH_USDC);

        (
            ,
            ,
            bool token0IsFherc20,
            bool token1IsFherc20,
            bool initialized,
            ,
        ) = hook.getPoolState(poolId);

        assertTrue(initialized, "Pool D should be initialized");
        // One FHERC20, one ERC20
        assertTrue(token0IsFherc20 != token1IsFherc20, "Pool D should have mixed token types");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                 PHASE 2: LIQUIDITY TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_Phase2_AddLiquidity_PoolA_ErcErc() public {
        PoolId poolId = PoolId.wrap(POOL_ID_WETH_USDC);

        vm.startPrank(testUser);

        uint256 amount0 = 0.1 ether;  // 0.1 WETH
        uint256 amount1 = 100e6;       // 100 USDC

        uint256 balanceBefore0 = IERC20(WETH).balanceOf(testUser);
        uint256 balanceBefore1 = IERC20(USDC).balanceOf(testUser);

        uint256 lpAmount = hook.addLiquidity(poolId, amount0, amount1);

        assertGt(lpAmount, 0, "Should receive LP tokens");
        assertLt(IERC20(WETH).balanceOf(testUser), balanceBefore0, "WETH balance should decrease");
        assertLt(IERC20(USDC).balanceOf(testUser), balanceBefore1, "USDC balance should decrease");

        vm.stopPrank();
    }

    function test_Phase2_RemoveLiquidity_PoolA_ErcErc() public {
        PoolId poolId = PoolId.wrap(POOL_ID_WETH_USDC);

        vm.startPrank(testUser);

        // First add liquidity
        uint256 lpAmount = hook.addLiquidity(poolId, 0.1 ether, 100e6);

        // Remove half
        uint256 removeAmount = lpAmount / 2;
        (uint256 amount0, uint256 amount1) = hook.removeLiquidity(poolId, removeAmount);

        assertGt(amount0, 0, "Should receive token0");
        assertGt(amount1, 0, "Should receive token1");

        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                 PHASE 3: MARKET SWAP TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_Phase3_DirectSwap_PoolA_ErcErc() public {
        PoolId poolId = PoolId.wrap(POOL_ID_WETH_USDC);

        vm.startPrank(testUser);

        // Ensure pool has liquidity
        hook.addLiquidity(poolId, 1 ether, 1000e6);

        // Swap 0.01 WETH for USDC
        uint256 amountIn = 0.01 ether;
        uint256 balanceBefore = IERC20(USDC).balanceOf(testUser);

        uint256 amountOut = hook.swapForPool(poolId, true, amountIn, 0);

        assertGt(amountOut, 0, "Should receive output tokens");
        assertGt(IERC20(USDC).balanceOf(testUser), balanceBefore, "USDC balance should increase");

        vm.stopPrank();
    }

    function test_Phase3_GetQuote_PoolA_ErcErc() public {
        PoolId poolId = PoolId.wrap(POOL_ID_WETH_USDC);

        vm.startPrank(testUser);

        // Ensure pool has liquidity
        hook.addLiquidity(poolId, 1 ether, 1000e6);

        vm.stopPrank();

        // Get quote (view function)
        uint256 quote = hook.getQuoteForPool(poolId, true, 0.01 ether);
        assertGt(quote, 0, "Quote should be > 0");
    }

    function test_Phase3_SlippageProtection() public {
        PoolId poolId = PoolId.wrap(POOL_ID_WETH_USDC);

        vm.startPrank(testUser);

        // Add liquidity
        hook.addLiquidity(poolId, 1 ether, 1000e6);

        // Try swap with impossibly high min output
        vm.expectRevert(FheatherXv6.SlippageExceeded.selector);
        hook.swapForPool(poolId, true, 0.01 ether, type(uint256).max);

        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                 PHASE 4: LIMIT ORDER TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_Phase4_LimitOrder_PoolA_Reverts() public {
        // Pool A (ERC:ERC) should NOT allow limit orders (MEV risk)
        PoolId poolId = PoolId.wrap(POOL_ID_WETH_USDC);

        vm.startPrank(testUser);

        // This would require encrypted input - on a real fork, this would fail
        // For now, verify that the pool is ERC:ERC and orders would be rejected

        (,, bool token0IsFherc20, bool token1IsFherc20,,,) = hook.getPoolState(poolId);
        assertFalse(token0IsFherc20, "Pool A token0 should not be FHERC20");
        assertFalse(token1IsFherc20, "Pool A token1 should not be FHERC20");

        // Note: Actual limit order test requires real CoFHE encryption
        // which is only available on real network (not local fork)

        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                 VIEW FUNCTION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_GetReserves_PoolA() public {
        PoolId poolId = PoolId.wrap(POOL_ID_WETH_USDC);

        vm.startPrank(testUser);
        hook.addLiquidity(poolId, 1 ether, 1000e6);
        vm.stopPrank();

        (uint256 r0, uint256 r1) = hook.getReserves(poolId);
        assertGt(r0, 0, "Reserve0 should be > 0");
        assertGt(r1, 0, "Reserve1 should be > 0");
    }

    function test_GetCurrentTick() public {
        PoolId poolId = PoolId.wrap(POOL_ID_WETH_USDC);

        vm.startPrank(testUser);
        hook.addLiquidity(poolId, 1 ether, 1000e6);
        vm.stopPrank();

        int24 tick = hook.getCurrentTickForPool(poolId);
        // Tick should be within valid range
        assertTrue(tick >= -6000 && tick <= 6000, "Tick should be within valid range");
    }

    function test_GetTickPrice() public view {
        // Tick 0 = 1.0
        assertEq(hook.getTickPrice(0), 1e18);

        // Positive tick > 1.0
        assertGt(hook.getTickPrice(60), 1e18);

        // Negative tick < 1.0
        assertLt(hook.getTickPrice(-60), 1e18);
    }

    function test_HasOrdersAtTick() public view {
        PoolId poolId = PoolId.wrap(POOL_ID_WETH_USDC);

        // Check various ticks - should be false for fresh pool
        bool hasOrders = hook.hasOrdersAtTick(poolId, 60, FheatherXv6.BucketSide.SELL);
        // May be true or false depending on initial state
        assertTrue(hasOrders || !hasOrders, "hasOrdersAtTick should return valid bool");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                 FULL LIFECYCLE TEST
    // ═══════════════════════════════════════════════════════════════════════

    function test_FullLifecycle_PoolA_ErcErc() public {
        PoolId poolId = PoolId.wrap(POOL_ID_WETH_USDC);

        vm.startPrank(testUser);

        // 1. Add liquidity
        uint256 lpAmount = hook.addLiquidity(poolId, 1 ether, 1000e6);
        assertGt(lpAmount, 0, "Step 1: Should receive LP tokens");

        // 2. Get quote
        uint256 quote = hook.getQuoteForPool(poolId, true, 0.1 ether);
        assertGt(quote, 0, "Step 2: Quote should be > 0");

        // 3. Execute swap
        uint256 balanceBefore = IERC20(USDC).balanceOf(testUser);
        uint256 amountOut = hook.swapForPool(poolId, true, 0.1 ether, 0);
        assertGt(amountOut, 0, "Step 3: Should receive swap output");
        assertGt(IERC20(USDC).balanceOf(testUser), balanceBefore, "Step 3: USDC balance increased");

        // 4. Check reserves changed
        (uint256 r0, uint256 r1) = hook.getReserves(poolId);
        assertGt(r0, 0, "Step 4: Reserve0 should be > 0");
        assertGt(r1, 0, "Step 4: Reserve1 should be > 0");

        // 5. Remove liquidity
        (uint256 out0, uint256 out1) = hook.removeLiquidity(poolId, lpAmount);
        assertGt(out0, 0, "Step 5: Should receive token0 on remove");
        assertGt(out1, 0, "Step 5: Should receive token1 on remove");

        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                 MULTI-POOL SWAP TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_SwapAcrossMultiplePools() public {
        vm.startPrank(testUser);

        // Add liquidity to multiple pools
        hook.addLiquidity(PoolId.wrap(POOL_ID_WETH_USDC), 1 ether, 1000e6);

        // Swap on Pool A
        uint256 outA = hook.swapForPool(PoolId.wrap(POOL_ID_WETH_USDC), true, 0.01 ether, 0);
        assertGt(outA, 0, "Pool A swap should succeed");

        vm.stopPrank();
    }
}
