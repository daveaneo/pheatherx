// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FheatherXv8FHE Arbitrum Sepolia Integration Tests
 * @notice Integration tests for v8FHE on Arbitrum Sepolia with REAL FHE operations
 *
 * Run with:
 *   cd contracts
 *   forge test --match-contract FheatherXv8FHEArbSepoliaIntegration \
 *     --fork-url $ARB_SEPOLIA_RPC \
 *     --ffi \
 *     -vvv
 *
 * Requirements:
 *   - ARB_SEPOLIA_RPC env var set
 *   - PRIVATE_KEY env var set (for FFI encryption)
 *   - Node.js with cofhejs installed
 */

import "forge-std/Test.sol";

// Uniswap v4 imports
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

// FHE imports
import {FHE, euint128, ebool, InEuint128, InEbool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

// OpenZeppelin
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @dev Interface for FHERC20 tokens
 */
interface IFHERC20 is IERC20 {
    function wrap(uint256 amount) external;
    function unwrap(uint256 amount) external;
    function faucet() external;
    function mintEncrypted(address to, uint256 amount) external;
    function approveEncrypted(address spender, InEuint128 calldata amount) external returns (bool);
    function balanceOfEncrypted(address account) external view returns (uint256);
    function hasEncryptedBalance(address account) external view returns (bool);
    function _transferFromEncrypted(address from, address to, euint128 amount) external;
    function _transferEncrypted(address to, euint128 amount) external;
}

/**
 * @dev Interface for FheatherXv8FHE hook
 */
interface IFheatherXv8FHE {
    enum BucketSide { BUY, SELL }

    function poolStates(bytes32 poolId) external view returns (
        address token0,
        address token1,
        bool initialized,
        uint256 protocolFeeBps
    );

    function getReserves(bytes32 poolId) external view returns (uint256, uint256);
    function getCurrentTick(bytes32 poolId) external view returns (int24);
    function getQuote(bytes32 poolId, bool zeroForOne, uint256 amountIn) external view returns (uint256);

    function deposit(
        bytes32 poolId,
        int24 tick,
        BucketSide side,
        InEuint128 calldata encryptedAmount,
        uint256 deadline,
        int24 maxTickDrift
    ) external;

    function claim(bytes32 poolId, int24 tick, BucketSide side) external;

    function addLiquidity(
        bytes32 poolId,
        InEuint128 calldata amount0,
        InEuint128 calldata amount1
    ) external returns (euint128);

    function positions(bytes32 poolId, address user, int24 tick, BucketSide side) external view returns (
        uint256 shares,
        uint256 proceedsPerShareSnapshot,
        uint256 filledPerShareSnapshot,
        uint256 realizedProceeds
    );

    function MOCK_setPlaintextReserves(bytes32 poolId, uint256 reserve0, uint256 reserve1) external;
}

/**
 * @dev Interface for PrivateSwapRouter
 */
interface IPrivateSwapRouter {
    function swapEncrypted(
        PoolKey calldata key,
        InEbool calldata encDirection,
        InEuint128 calldata encAmountIn,
        InEuint128 calldata encMinOutput
    ) external;
}

contract FheatherXv8FHEArbSepoliaIntegration is Test {
    using PoolIdLibrary for PoolKey;

    // ═══════════════════════════════════════════════════════════════════════
    //                        DEPLOYED ADDRESSES (ARB SEPOLIA)
    // ═══════════════════════════════════════════════════════════════════════

    address constant HOOK = 0xeF13A37401E1bb43aBED8F0108510eBb91401088;
    address constant PRIVATE_ROUTER = 0x19a9BAbF6e1bc6C7Af2634fB4061160dAb744B64;
    address constant POOL_MANAGER = 0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317;

    // FHERC20 tokens (sorted: WETH < USDC)
    address constant FHE_WETH = 0x7Da141eeA1F3c2dD0cC41915eE0AA19bE545d3e0;  // token0
    address constant FHE_USDC = 0x987731d456B5996E7414d79474D8aba58d4681DC;  // token1

    // Pool configuration
    bytes32 constant POOL_ID = 0x92c5e351bf239ffea024d746621c2046854ac042f5b3357b5aa9a67e1d9341de;
    uint24 constant POOL_FEE = 3000;
    int24 constant TICK_SPACING = 60;

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONTRACTS
    // ═══════════════════════════════════════════════════════════════════════

    IFheatherXv8FHE hook;
    IPrivateSwapRouter router;
    IFHERC20 fheWeth;
    IFHERC20 fheUsdc;

    // Test user
    address testUser;
    uint256 testUserPrivateKey;

    // ═══════════════════════════════════════════════════════════════════════
    //                              SETUP
    // ═══════════════════════════════════════════════════════════════════════

    function setUp() public {
        // Get contracts
        hook = IFheatherXv8FHE(HOOK);
        router = IPrivateSwapRouter(PRIVATE_ROUTER);
        fheWeth = IFHERC20(FHE_WETH);
        fheUsdc = IFHERC20(FHE_USDC);

        // Create test user from env private key (needed for FFI encryption)
        string memory privateKeyStr = vm.envString("PRIVATE_KEY");
        testUserPrivateKey = vm.parseUint(privateKeyStr);
        testUser = vm.addr(testUserPrivateKey);

        // Labels for debugging
        vm.label(testUser, "testUser");
        vm.label(HOOK, "FheatherXv8FHE");
        vm.label(PRIVATE_ROUTER, "PrivateSwapRouter");
        vm.label(FHE_WETH, "fheWETH");
        vm.label(FHE_USDC, "fheUSDC");

        // Fund test user with ETH for gas
        vm.deal(testUser, 10 ether);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         FFI ENCRYPTION HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Encrypt a uint128 value using FFI (calls cofhejs via Node.js)
     * @param value The value to encrypt
     * @return The encrypted value as InEuint128 struct
     */
    function encryptUint128(uint256 value) internal returns (InEuint128 memory) {
        string[] memory inputs = new string[](4);
        inputs[0] = "node";
        inputs[1] = "scripts/fhe-encrypt.cjs";
        inputs[2] = "uint128";
        inputs[3] = vm.toString(value);

        bytes memory result = vm.ffi(inputs);
        return abi.decode(result, (InEuint128));
    }

    /**
     * @dev Encrypt a boolean value using FFI
     * @param value The boolean to encrypt
     * @return The encrypted value as InEbool struct
     */
    function encryptBool(bool value) internal returns (InEbool memory) {
        string[] memory inputs = new string[](4);
        inputs[0] = "node";
        inputs[1] = "scripts/fhe-encrypt.cjs";
        inputs[2] = "bool";
        inputs[3] = value ? "true" : "false";

        bytes memory result = vm.ffi(inputs);
        return abi.decode(result, (InEbool));
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                        PHASE 1: POOL VERIFICATION
    // ═══════════════════════════════════════════════════════════════════════

    function test_Phase1_PoolInitialized() public view {
        (address token0, address token1, bool initialized, uint256 feeBps) = hook.poolStates(POOL_ID);

        assertTrue(initialized, "Pool should be initialized");
        assertEq(token0, FHE_WETH, "Token0 should be fheWETH");
        assertEq(token1, FHE_USDC, "Token1 should be fheUSDC");

        console.log("Pool verified:");
        console.log("  Token0 (fheWETH):", token0);
        console.log("  Token1 (fheUSDC):", token1);
        console.log("  Fee BPS:", feeBps);
    }

    function test_Phase1_PoolHasLiquidity() public view {
        (uint256 reserve0, uint256 reserve1) = hook.getReserves(POOL_ID);

        console.log("Pool reserves:");
        console.log("  Reserve0 (WETH):", reserve0);
        console.log("  Reserve1 (USDC):", reserve1);

        // Should have some liquidity from seeding
        assertGt(reserve0, 0, "Reserve0 should be > 0");
        assertGt(reserve1, 0, "Reserve1 should be > 0");
    }

    function test_Phase1_GetCurrentTick() public view {
        int24 tick = hook.getCurrentTick(POOL_ID);
        console.log("Current tick:", tick);

        // Tick should be within valid range
        assertTrue(tick >= -6000 && tick <= 6000, "Tick should be within valid range");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    PHASE 2: LIMIT ORDER DEPOSIT
    // ═══════════════════════════════════════════════════════════════════════

    function test_Phase2_DepositLimitOrder() public {
        vm.startPrank(testUser);

        // Step 1: Get tokens from faucet
        console.log("Step 1: Getting tokens from faucet...");
        fheWeth.faucet();  // 100 fheWETH
        fheUsdc.faucet();  // 100 fheUSDC

        uint256 wethBalance = fheWeth.balanceOf(testUser);
        uint256 usdcBalance = fheUsdc.balanceOf(testUser);
        console.log("  fheWETH balance:", wethBalance);
        console.log("  fheUSDC balance:", usdcBalance);
        assertGt(wethBalance, 0, "Should have fheWETH");
        assertGt(usdcBalance, 0, "Should have fheUSDC");

        // Step 2: Wrap tokens to encrypted
        console.log("Step 2: Wrapping tokens...");
        uint256 wrapAmount = 10 ether;  // 10 fheWETH
        fheWeth.wrap(wrapAmount);

        bool hasEncrypted = fheWeth.hasEncryptedBalance(testUser);
        console.log("  Has encrypted balance:", hasEncrypted);
        assertTrue(hasEncrypted, "Should have encrypted balance after wrap");

        // Step 3: Approve HOOK (not router!) for encrypted transfers
        console.log("Step 3: Approving HOOK for encrypted transfers...");
        uint256 maxU128 = type(uint128).max;
        InEuint128 memory encApproval = encryptUint128(maxU128);
        fheWeth.approveEncrypted(HOOK, encApproval);
        console.log("  Approval complete");

        // Step 4: Place limit order
        console.log("Step 4: Placing limit order...");
        int24 currentTick = hook.getCurrentTick(POOL_ID);
        int24 orderTick = (currentTick / TICK_SPACING) * TICK_SPACING + (TICK_SPACING * 2);
        console.log("  Current tick:", currentTick);
        console.log("  Order tick:", orderTick);

        uint256 orderAmount = 0.01 ether;  // 0.01 fheWETH
        InEuint128 memory encOrderAmount = encryptUint128(orderAmount);

        // SELL order: selling fheWETH (token0) for fheUSDC (token1)
        IFheatherXv8FHE.BucketSide side = IFheatherXv8FHE.BucketSide.SELL;
        uint256 deadline = block.timestamp + 3600;
        int24 maxTickDrift = 600;

        hook.deposit(POOL_ID, orderTick, side, encOrderAmount, deadline, maxTickDrift);
        console.log("  Limit order placed!");

        // Step 5: Verify position created
        (uint256 shares,,,) = hook.positions(POOL_ID, testUser, orderTick, side);
        console.log("  Position shares handle:", shares);
        assertGt(shares, 0, "Should have position shares");

        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                      PHASE 3: SWAP VIA ROUTER
    // ═══════════════════════════════════════════════════════════════════════

    function test_Phase3_SwapEncrypted() public {
        vm.startPrank(testUser);

        // Step 1: Get and wrap USDC for swap
        console.log("Step 1: Getting USDC for swap...");
        fheUsdc.faucet();
        fheUsdc.wrap(100e6);  // Wrap 100 USDC

        // Step 2: CRITICAL - Approve HOOK (not router!) for encrypted USDC transfers
        console.log("Step 2: Approving HOOK for encrypted USDC...");
        uint256 maxU128 = type(uint128).max;
        InEuint128 memory encApproval = encryptUint128(maxU128);
        fheUsdc.approveEncrypted(HOOK, encApproval);

        // Step 3: Build pool key
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(FHE_WETH),
            currency1: Currency.wrap(FHE_USDC),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(HOOK)
        });

        // Step 4: Encrypt swap parameters
        console.log("Step 3: Encrypting swap parameters...");
        // zeroForOne = false means selling token1 (USDC) for token0 (WETH)
        InEbool memory encDirection = encryptBool(false);
        uint256 swapAmount = 10e6;  // 10 USDC
        InEuint128 memory encAmountIn = encryptUint128(swapAmount);
        InEuint128 memory encMinOutput = encryptUint128(0);  // No slippage for test

        // Step 5: Execute swap
        console.log("Step 4: Executing encrypted swap...");
        router.swapEncrypted(key, encDirection, encAmountIn, encMinOutput);
        console.log("  Swap executed!");

        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                       PHASE 4: CLAIM PROCEEDS
    // ═══════════════════════════════════════════════════════════════════════

    function test_Phase4_ClaimProceeds() public {
        // First place an order
        vm.startPrank(testUser);

        fheWeth.faucet();
        fheWeth.wrap(1 ether);

        uint256 maxU128 = type(uint128).max;
        InEuint128 memory encApproval = encryptUint128(maxU128);
        fheWeth.approveEncrypted(HOOK, encApproval);

        int24 currentTick = hook.getCurrentTick(POOL_ID);
        int24 orderTick = (currentTick / TICK_SPACING) * TICK_SPACING + (TICK_SPACING * 2);

        InEuint128 memory encOrderAmount = encryptUint128(0.01 ether);
        hook.deposit(POOL_ID, orderTick, IFheatherXv8FHE.BucketSide.SELL, encOrderAmount, block.timestamp + 3600, 600);

        // Then claim (may or may not have proceeds depending on fills)
        console.log("Claiming proceeds...");
        hook.claim(POOL_ID, orderTick, IFheatherXv8FHE.BucketSide.SELL);
        console.log("  Claim executed!");

        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    FULL LIFECYCLE TEST
    // ═══════════════════════════════════════════════════════════════════════

    function test_FullLifecycle_LimitOrderFlow() public {
        console.log("=== FULL LIFECYCLE TEST: Limit Order Flow ===\n");

        vm.startPrank(testUser);

        // ─── Step 1: Fund wallet ─────────────────────────────────────────────
        console.log("Step 1: Funding wallet with faucet tokens...");
        fheWeth.faucet();
        fheUsdc.faucet();
        console.log("  fheWETH:", fheWeth.balanceOf(testUser) / 1e18, "tokens");
        console.log("  fheUSDC:", fheUsdc.balanceOf(testUser) / 1e6, "tokens");

        // ─── Step 2: Wrap tokens ─────────────────────────────────────────────
        console.log("\nStep 2: Wrapping tokens to encrypted form...");
        fheWeth.wrap(10 ether);
        fheUsdc.wrap(1000e6);
        assertTrue(fheWeth.hasEncryptedBalance(testUser), "Should have encrypted WETH");
        assertTrue(fheUsdc.hasEncryptedBalance(testUser), "Should have encrypted USDC");

        // ─── Step 3: Approve HOOK (CRITICAL!) ─────────────────────────────────
        console.log("\nStep 3: Approving HOOK for encrypted transfers...");
        uint256 maxU128 = type(uint128).max;
        InEuint128 memory encApproval = encryptUint128(maxU128);
        fheWeth.approveEncrypted(HOOK, encApproval);
        fheUsdc.approveEncrypted(HOOK, encApproval);
        console.log("  Both tokens approved to HOOK");

        // ─── Step 4: Place limit order ───────────────────────────────────────
        console.log("\nStep 4: Placing limit SELL order...");
        int24 currentTick = hook.getCurrentTick(POOL_ID);
        int24 orderTick = (currentTick / TICK_SPACING) * TICK_SPACING + (TICK_SPACING * 2);
        console.log("  Current tick:", currentTick);
        console.log("  Order tick:", orderTick);

        InEuint128 memory encOrderAmount = encryptUint128(0.1 ether);
        hook.deposit(
            POOL_ID,
            orderTick,
            IFheatherXv8FHE.BucketSide.SELL,
            encOrderAmount,
            block.timestamp + 3600,
            600
        );

        (uint256 shares,,,) = hook.positions(POOL_ID, testUser, orderTick, IFheatherXv8FHE.BucketSide.SELL);
        assertGt(shares, 0, "Position should have shares");
        console.log("  Order placed! Shares handle:", shares);

        // ─── Step 5: Execute swap to trigger order ───────────────────────────
        console.log("\nStep 5: Executing swap to trigger order...");

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(FHE_WETH),
            currency1: Currency.wrap(FHE_USDC),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(HOOK)
        });

        // Swap USDC for WETH (zeroForOne = false)
        InEbool memory encDirection = encryptBool(false);
        InEuint128 memory encAmountIn = encryptUint128(100e6);  // 100 USDC
        InEuint128 memory encMinOutput = encryptUint128(0);

        router.swapEncrypted(key, encDirection, encAmountIn, encMinOutput);
        console.log("  Swap executed!");

        int24 newTick = hook.getCurrentTick(POOL_ID);
        console.log("  New tick:", newTick);
        console.log("  Tick moved:", int256(newTick) - int256(currentTick));

        // ─── Step 6: Claim proceeds ──────────────────────────────────────────
        console.log("\nStep 6: Claiming proceeds...");
        hook.claim(POOL_ID, orderTick, IFheatherXv8FHE.BucketSide.SELL);
        console.log("  Claim executed!");

        // ─── Step 7: Verify final state ──────────────────────────────────────
        console.log("\nStep 7: Verifying final state...");
        (uint256 finalShares,,,) = hook.positions(POOL_ID, testUser, orderTick, IFheatherXv8FHE.BucketSide.SELL);
        console.log("  Final shares:", finalShares);

        vm.stopPrank();

        console.log("\n=== LIFECYCLE TEST COMPLETE ===");
    }
}
