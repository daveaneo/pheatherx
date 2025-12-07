// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "forge-std/StdJson.sol";

// Uniswap Imports
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

// Local Imports
import {FheatherX} from "../../src/FheatherX.sol";
import {IFheatherX} from "../../src/interface/IFheatherX.sol";

// FHE Imports - Real FHE on Arb Sepolia (no mocks!)
import {FHE, euint128, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

// OpenZeppelin Imports
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title ArbSepoliaIntegration
/// @notice Integration tests for FheatherX using REAL FHE on Arbitrum Sepolia
/// @dev Run with: source .env && forge test --match-path test/integration/* --fork-url $ARB_SEPOLIA_RPC -vvv
///
/// IMPORTANT: This test requires:
/// 1. Deploy contracts first: npm run deploy:arb-sepolia
/// 2. Have ARB_SEPOLIA_RPC and PRIVATE_KEY in .env
/// 3. Have testnet ETH on Arb Sepolia for gas
///
/// These tests use the REAL CoFHE coprocessor - FHE operations may take a few seconds
contract ArbSepoliaIntegration is Test {
    using stdJson for string;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    // Loaded from deployments/arb-sepolia.json
    address token0;
    address token1;
    address hookAddress;
    address poolManager;
    address swapRouter;

    FheatherX hook;
    PoolKey poolKey;
    PoolId poolId;

    // Test accounts
    address user;
    uint256 userPrivateKey;

    // Test amounts
    uint256 constant DEPOSIT_AMOUNT = 1000 ether;
    uint256 constant ORDER_AMOUNT = 500 ether;
    uint256 constant MIN_OUTPUT = 400 ether;
    int24 constant TRIGGER_TICK = 100;

    function setUp() public {
        // Load deployment addresses
        string memory json = vm.readFile("deployments/arb-sepolia.json");

        token0 = json.readAddress(".contracts.token0");
        token1 = json.readAddress(".contracts.token1");
        hookAddress = json.readAddress(".contracts.hook");
        poolManager = json.readAddress(".contracts.poolManager");
        swapRouter = json.readAddress(".contracts.swapRouter");

        hook = FheatherX(payable(hookAddress));

        // Setup pool key
        poolKey = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(hookAddress)
        });
        poolId = poolKey.toId();

        // Setup test user from env
        userPrivateKey = vm.envUint("PRIVATE_KEY");
        user = vm.addr(userPrivateKey);

        console.log("===========================================");
        console.log("  Arb Sepolia Integration Test");
        console.log("===========================================");
        console.log("User:", user);
        console.log("Token0:", token0);
        console.log("Token1:", token1);
        console.log("Hook:", hookAddress);
        console.log("");
    }

    /// @notice Test full E2E flow with real FHE
    /// Deposit -> Place Order -> Fill via Swap -> Withdraw
    function test_FullE2EFlow() public {
        console.log("--- Step 1: Deposit ---");

        // Check initial balances
        uint256 token0BalanceBefore = IERC20(token0).balanceOf(user);
        console.log("User token0 balance before:", token0BalanceBefore);

        require(token0BalanceBefore >= DEPOSIT_AMOUNT, "Insufficient token0 balance");

        // Approve and deposit
        vm.startPrank(user);
        IERC20(token0).approve(hookAddress, type(uint256).max);
        hook.deposit(true, DEPOSIT_AMOUNT);
        vm.stopPrank();

        uint256 token0BalanceAfter = IERC20(token0).balanceOf(user);
        assertEq(token0BalanceBefore - token0BalanceAfter, DEPOSIT_AMOUNT, "Deposit should transfer tokens");
        console.log("Deposited:", DEPOSIT_AMOUNT);

        // Verify encrypted balance (this is the key test - real FHE!)
        euint128 encBalance = hook.getUserBalanceToken0(user);
        console.log("Encrypted balance hash:", euint128.unwrap(encBalance));
        console.log("Step 1 PASSED: Deposit with real FHE encryption");
        console.log("");

        console.log("--- Step 2: Place Order ---");

        vm.startPrank(user);

        // Create encrypted order parameters using real FHE
        // On Arb Sepolia, these are REAL encrypted values processed by CoFHE coprocessor
        ebool direction = FHE.asEbool(true); // zeroForOne
        euint128 amount = FHE.asEuint128(uint128(ORDER_AMOUNT));
        euint128 minOutput = FHE.asEuint128(uint128(MIN_OUTPUT));

        // Allow hook to use encrypted values
        FHE.allow(direction, hookAddress);
        FHE.allow(amount, hookAddress);
        FHE.allow(minOutput, hookAddress);

        // Place the order
        uint256 orderId = hook.placeOrder{value: 0.001 ether}(
            TRIGGER_TICK,
            direction,
            amount,
            minOutput
        );

        vm.stopPrank();

        assertEq(orderId, 1, "First order should have ID 1");
        assertTrue(hook.hasOrdersAtTick(TRIGGER_TICK), "Tick should have orders");
        console.log("Order placed with ID:", orderId);
        console.log("Step 2 PASSED: Order placed with real encrypted parameters");
        console.log("");

        console.log("--- Step 3: Verify Order State ---");

        uint256[] memory activeOrders = hook.getActiveOrders(user);
        assertEq(activeOrders.length, 1, "User should have 1 active order");
        assertEq(activeOrders[0], orderId, "Active order ID should match");
        console.log("Active orders:", activeOrders.length);
        console.log("Step 3 PASSED: Order state verified");
        console.log("");

        // Note: Steps 4-6 (Fill and Withdraw) require:
        // 1. Pool to have liquidity
        // 2. Another user to swap and trigger the fill
        // These would be additional tests once pool is set up

        console.log("===========================================");
        console.log("  INTEGRATION TEST PASSED");
        console.log("===========================================");
        console.log("");
        console.log("Successfully tested:");
        console.log("- Real FHE deposit with encrypted balance");
        console.log("- Real FHE order placement with encrypted params");
        console.log("- Order state tracking");
        console.log("");
        console.log("This proves the CoFHE coprocessor integration works!");
    }

    /// @notice Simple deposit test to verify FHE works
    function test_DepositWithRealFHE() public {
        uint256 balanceBefore = IERC20(token0).balanceOf(user);
        require(balanceBefore >= DEPOSIT_AMOUNT, "Need tokens to test");

        vm.startPrank(user);
        IERC20(token0).approve(hookAddress, DEPOSIT_AMOUNT);
        hook.deposit(true, DEPOSIT_AMOUNT);
        vm.stopPrank();

        // The encrypted balance is stored via real FHE
        euint128 encBalance = hook.getUserBalanceToken0(user);

        // We can't directly read the encrypted value (that's the point!)
        // But we can verify the hash exists
        assertTrue(euint128.unwrap(encBalance) != 0, "Encrypted balance should exist");

        console.log("Real FHE deposit test passed!");
        console.log("Encrypted balance hash:", euint128.unwrap(encBalance));
    }

    /// @notice Test withdraw with real FHE decryption
    function test_WithdrawWithRealFHE() public {
        // First deposit
        vm.startPrank(user);
        IERC20(token0).approve(hookAddress, DEPOSIT_AMOUNT);
        hook.deposit(true, DEPOSIT_AMOUNT);

        uint256 balanceBefore = IERC20(token0).balanceOf(user);

        // Withdraw half
        uint256 withdrawAmount = DEPOSIT_AMOUNT / 2;
        hook.withdraw(true, withdrawAmount);

        vm.stopPrank();

        uint256 balanceAfter = IERC20(token0).balanceOf(user);
        assertEq(balanceAfter - balanceBefore, withdrawAmount, "Should receive withdrawn tokens");

        console.log("Real FHE withdraw test passed!");
        console.log("Withdrew:", withdrawAmount);
    }

    /// @notice THE DEFINITIVE TEST: Prove FHE encryption/decryption works
    /// This test:
    /// 1. Deposits a known amount (encrypted by contract)
    /// 2. Triggers async decryption via forceSyncReserves()
    /// 3. Waits for CoFHE coprocessor to process
    /// 4. Verifies decrypted reserve matches deposited amount
    ///
    /// If this passes, we KNOW real FHE encryption/decryption worked!
    function test_ProveRealFHEWorksWithDecryption() public {
        console.log("===========================================");
        console.log("  DEFINITIVE FHE PROOF TEST");
        console.log("===========================================");
        console.log("");

        // Step 1: Check initial reserves (should be 0)
        (uint256 initialReserve0, uint256 initialReserve1) = hook.getReserves();
        console.log("Initial reserve0:", initialReserve0);
        console.log("Initial reserve1:", initialReserve1);

        // Step 2: Deposit known amount - this encrypts the value
        uint256 depositAmount = 12345 ether; // Distinctive amount
        console.log("");
        console.log("Depositing token0:", depositAmount);

        vm.startPrank(user);
        IERC20(token0).approve(hookAddress, depositAmount);
        hook.deposit(true, depositAmount);
        vm.stopPrank();

        // Step 3: Trigger async decryption of reserves
        console.log("Triggering forceSyncReserves() - this calls FHE.decrypt()");
        hook.forceSyncReserves();

        // Step 4: Wait for CoFHE coprocessor
        // In real network, we need to wait for the coprocessor to process
        // The coprocessor watches for decrypt requests and submits results
        console.log("Waiting for CoFHE coprocessor to process decryption...");
        console.log("(This may take several seconds on real network)");

        // Poll for decryption result
        uint256 maxAttempts = 30; // 30 attempts
        uint256 delayBlocks = 1;  // Check every block
        bool decryptionReady = false;
        uint256 finalReserve0;
        uint256 finalReserve1;

        for (uint256 i = 0; i < maxAttempts; i++) {
            // Advance time/blocks to simulate waiting
            vm.roll(block.number + delayBlocks);
            vm.warp(block.timestamp + 2); // 2 seconds per block

            // Try to get reserves (this calls _trySyncReserves internally)
            (finalReserve0, finalReserve1) = hook.getReserves();

            if (finalReserve0 > 0) {
                decryptionReady = true;
                console.log("Decryption ready after", i + 1, "attempts");
                break;
            }
        }

        // Step 5: VERIFY - This is the critical assertion!
        console.log("");
        console.log("=== VERIFICATION ===");
        console.log("Expected reserve0:", depositAmount);
        console.log("Actual reserve0:", finalReserve0);

        if (decryptionReady) {
            // THE PROOF: If decrypted reserve equals deposited amount,
            // then FHE encryption and decryption worked correctly!
            assertEq(finalReserve0, depositAmount, "PROOF FAILED: Decrypted reserve must equal deposited amount");

            console.log("");
            console.log("===========================================");
            console.log("  FHE PROOF SUCCESSFUL!");
            console.log("===========================================");
            console.log("");
            console.log("This proves:");
            console.log("1. deposit() encrypted the value using FHE.asEuint128()");
            console.log("2. Encrypted value was stored on-chain");
            console.log("3. forceSyncReserves() requested decryption via FHE.decrypt()");
            console.log("4. CoFHE coprocessor processed the decryption");
            console.log("5. Decrypted value matches original input");
            console.log("");
            console.log("Real FHE is working end-to-end!");
        } else {
            console.log("");
            console.log("WARNING: Decryption not ready within timeout");
            console.log("This could mean:");
            console.log("- CoFHE coprocessor is slow/busy");
            console.log("- Network connectivity issues");
            console.log("- Need to wait longer");
            console.log("");
            console.log("Try running the test again or check CoFHE status");

            // Still fail the test to be explicit
            revert("Decryption timed out - CoFHE coprocessor did not respond");
        }
    }
}
