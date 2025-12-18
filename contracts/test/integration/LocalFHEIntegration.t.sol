// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {TaskManager} from "@fhenixprotocol/cofhe-mock-contracts/MockTaskManager.sol";
import {ACL} from "@fhenixprotocol/cofhe-mock-contracts/ACL.sol";
import {FHE, euint128, ebool, InEuint128, InEbool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {Utils} from "@fhenixprotocol/cofhe-contracts/ICofhe.sol";

/**
 * @title LocalFHEIntegration
 * @notice Local Anvil test using MockTaskManager for FHE operations
 *
 * This test validates FHE operations WITHOUT needing real CoFHE.
 * Gas costs are representative of real FHE operations.
 *
 * Usage:
 *   forge test --match-contract LocalFHEIntegration -vvv
 */
contract LocalFHEIntegration is Test {
    // Hardcoded in @fhenixprotocol/cofhe-contracts/FHE.sol
    address constant TASK_MANAGER_ADDRESS = 0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9;

    TaskManager public taskManager;
    ACL public acl;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    function setUp() public {
        // 1. Deploy ACL (needs initial owner)
        acl = new ACL(address(this));
        console2.log("ACL deployed at:", address(acl));

        // 2. Deploy TaskManager
        TaskManager impl = new TaskManager();
        impl.initialize(address(this));
        impl.setACLContract(address(acl));
        impl.setSecurityZones(-128, 127);

        // 3. Place TaskManager code at the hardcoded address using vm.etch
        bytes memory taskManagerCode = address(impl).code;
        vm.etch(TASK_MANAGER_ADDRESS, taskManagerCode);

        // 4. Initialize the etched TaskManager
        taskManager = TaskManager(TASK_MANAGER_ADDRESS);

        // Re-initialize since storage was not copied
        taskManager.initialize(address(this));
        taskManager.setACLContract(address(acl));
        taskManager.setSecurityZones(-128, 127);

        console2.log("TaskManager at hardcoded address:", TASK_MANAGER_ADDRESS);
        console2.log("TaskManager initialized:", taskManager.isInitialized());

        // Fund test accounts
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function test_MockTaskManagerIsSetup() public view {
        assertTrue(taskManager.isInitialized(), "TaskManager should be initialized");
        assertTrue(taskManager.exists(), "TaskManager should exist");
    }

    function test_FHE_AsEuint128() public {
        // Test basic FHE.asEuint128 (trivial encryption)
        vm.startPrank(alice);

        uint128 value = 1000;
        euint128 encrypted = FHE.asEuint128(value);

        console2.log("FHE.asEuint128 result:", euint128.unwrap(encrypted));
        assertTrue(euint128.unwrap(encrypted) != 0, "Encrypted value should not be zero");

        vm.stopPrank();
    }

    function test_FHE_Add() public {
        vm.startPrank(alice);

        euint128 a = FHE.asEuint128(100);
        euint128 b = FHE.asEuint128(200);
        euint128 sum = FHE.add(a, b);

        console2.log("a:", euint128.unwrap(a));
        console2.log("b:", euint128.unwrap(b));
        console2.log("sum:", euint128.unwrap(sum));

        // Verify using mock storage
        uint256 sumValue = taskManager.mockStorage(euint128.unwrap(sum));
        assertEq(sumValue, 300, "Sum should be 300");

        vm.stopPrank();
    }

    function test_FHE_Sub() public {
        vm.startPrank(alice);

        euint128 a = FHE.asEuint128(500);
        euint128 b = FHE.asEuint128(200);
        euint128 diff = FHE.sub(a, b);

        uint256 diffValue = taskManager.mockStorage(euint128.unwrap(diff));
        assertEq(diffValue, 300, "Diff should be 300");

        vm.stopPrank();
    }

    function test_FHE_Mul() public {
        vm.startPrank(alice);

        euint128 a = FHE.asEuint128(25);
        euint128 b = FHE.asEuint128(4);
        euint128 product = FHE.mul(a, b);

        uint256 productValue = taskManager.mockStorage(euint128.unwrap(product));
        assertEq(productValue, 100, "Product should be 100");

        vm.stopPrank();
    }

    function test_FHE_Select() public {
        vm.startPrank(alice);

        ebool condition = FHE.asEbool(true);
        euint128 ifTrue = FHE.asEuint128(100);
        euint128 ifFalse = FHE.asEuint128(200);

        euint128 result = FHE.select(condition, ifTrue, ifFalse);

        uint256 resultValue = taskManager.mockStorage(euint128.unwrap(result));
        assertEq(resultValue, 100, "Result should be 100 (ifTrue)");

        // Test with false condition
        ebool conditionFalse = FHE.asEbool(false);
        euint128 result2 = FHE.select(conditionFalse, ifTrue, ifFalse);

        uint256 result2Value = taskManager.mockStorage(euint128.unwrap(result2));
        assertEq(result2Value, 200, "Result2 should be 200 (ifFalse)");

        vm.stopPrank();
    }

    function test_FHE_Comparison() public {
        vm.startPrank(alice);

        euint128 a = FHE.asEuint128(100);
        euint128 b = FHE.asEuint128(200);

        ebool isLt = FHE.lt(a, b);
        ebool isGt = FHE.gt(a, b);
        ebool isEq = FHE.eq(a, b);

        assertEq(taskManager.mockStorage(ebool.unwrap(isLt)), 1, "a < b should be true");
        assertEq(taskManager.mockStorage(ebool.unwrap(isGt)), 0, "a > b should be false");
        assertEq(taskManager.mockStorage(ebool.unwrap(isEq)), 0, "a == b should be false");

        vm.stopPrank();
    }

    function test_FHE_Min_Max() public {
        vm.startPrank(alice);

        euint128 a = FHE.asEuint128(100);
        euint128 b = FHE.asEuint128(200);

        euint128 minVal = FHE.min(a, b);
        euint128 maxVal = FHE.max(a, b);

        assertEq(taskManager.mockStorage(euint128.unwrap(minVal)), 100, "Min should be 100");
        assertEq(taskManager.mockStorage(euint128.unwrap(maxVal)), 200, "Max should be 200");

        vm.stopPrank();
    }

    function test_GasProfile_FHE_Operations() public {
        vm.startPrank(alice);

        // Profile gas for various FHE operations
        uint256 gasBefore;
        uint256 gasAfter;

        console2.log("");
        console2.log("=== FHE Operation Gas Costs ===");
        console2.log("");

        // Setup values
        euint128 a = FHE.asEuint128(1000);
        euint128 b = FHE.asEuint128(2000);
        euint128 c = FHE.asEuint128(3000);
        ebool bTrue = FHE.asEbool(true);
        ebool bFalse = FHE.asEbool(false);

        // === Trivial Encryption (plaintext -> encrypted) ===
        console2.log("--- Trivial Encryption ---");

        gasBefore = gasleft();
        FHE.asEuint128(12345);
        gasAfter = gasleft();
        console2.log("FHE.asEuint128(plaintext):", gasBefore - gasAfter);

        gasBefore = gasleft();
        FHE.asEbool(true);
        gasAfter = gasleft();
        console2.log("FHE.asEbool(plaintext):", gasBefore - gasAfter);

        // === Arithmetic Operations ===
        console2.log("");
        console2.log("--- Arithmetic Operations ---");

        gasBefore = gasleft();
        FHE.add(a, b);
        gasAfter = gasleft();
        console2.log("FHE.add:", gasBefore - gasAfter);

        gasBefore = gasleft();
        FHE.sub(b, a);
        gasAfter = gasleft();
        console2.log("FHE.sub:", gasBefore - gasAfter);

        gasBefore = gasleft();
        FHE.mul(a, b);
        gasAfter = gasleft();
        console2.log("FHE.mul:", gasBefore - gasAfter);

        gasBefore = gasleft();
        FHE.div(b, a);
        gasAfter = gasleft();
        console2.log("FHE.div:", gasBefore - gasAfter);

        gasBefore = gasleft();
        FHE.rem(b, a);
        gasAfter = gasleft();
        console2.log("FHE.rem:", gasBefore - gasAfter);

        // === Comparison Operations ===
        console2.log("");
        console2.log("--- Comparison Operations ---");

        gasBefore = gasleft();
        FHE.lt(a, b);
        gasAfter = gasleft();
        console2.log("FHE.lt:", gasBefore - gasAfter);

        gasBefore = gasleft();
        FHE.lte(a, b);
        gasAfter = gasleft();
        console2.log("FHE.lte:", gasBefore - gasAfter);

        gasBefore = gasleft();
        FHE.gt(a, b);
        gasAfter = gasleft();
        console2.log("FHE.gt:", gasBefore - gasAfter);

        gasBefore = gasleft();
        FHE.gte(a, b);
        gasAfter = gasleft();
        console2.log("FHE.gte:", gasBefore - gasAfter);

        gasBefore = gasleft();
        FHE.eq(a, b);
        gasAfter = gasleft();
        console2.log("FHE.eq:", gasBefore - gasAfter);

        gasBefore = gasleft();
        FHE.ne(a, b);
        gasAfter = gasleft();
        console2.log("FHE.ne:", gasBefore - gasAfter);

        // === Min/Max ===
        console2.log("");
        console2.log("--- Min/Max Operations ---");

        gasBefore = gasleft();
        FHE.min(a, b);
        gasAfter = gasleft();
        console2.log("FHE.min:", gasBefore - gasAfter);

        gasBefore = gasleft();
        FHE.max(a, b);
        gasAfter = gasleft();
        console2.log("FHE.max:", gasBefore - gasAfter);

        // === Bitwise Operations ===
        console2.log("");
        console2.log("--- Bitwise Operations ---");

        gasBefore = gasleft();
        FHE.and(a, b);
        gasAfter = gasleft();
        console2.log("FHE.and:", gasBefore - gasAfter);

        gasBefore = gasleft();
        FHE.or(a, b);
        gasAfter = gasleft();
        console2.log("FHE.or:", gasBefore - gasAfter);

        gasBefore = gasleft();
        FHE.xor(a, b);
        gasAfter = gasleft();
        console2.log("FHE.xor:", gasBefore - gasAfter);

        gasBefore = gasleft();
        FHE.not(bTrue);
        gasAfter = gasleft();
        console2.log("FHE.not:", gasBefore - gasAfter);

        gasBefore = gasleft();
        FHE.shl(a, b);
        gasAfter = gasleft();
        console2.log("FHE.shl:", gasBefore - gasAfter);

        gasBefore = gasleft();
        FHE.shr(a, b);
        gasAfter = gasleft();
        console2.log("FHE.shr:", gasBefore - gasAfter);

        // === Conditional Selection ===
        console2.log("");
        console2.log("--- Conditional Selection ---");

        ebool condition = FHE.lt(a, b);
        gasBefore = gasleft();
        FHE.select(condition, a, b);
        gasAfter = gasleft();
        console2.log("FHE.select:", gasBefore - gasAfter);

        // === ACL Operations ===
        console2.log("");
        console2.log("--- ACL Operations ---");

        gasBefore = gasleft();
        FHE.allowThis(a);
        gasAfter = gasleft();
        console2.log("FHE.allowThis:", gasBefore - gasAfter);

        gasBefore = gasleft();
        FHE.allow(a, bob);
        gasAfter = gasleft();
        console2.log("FHE.allow:", gasBefore - gasAfter);

        gasBefore = gasleft();
        FHE.allowGlobal(a);
        gasAfter = gasleft();
        console2.log("FHE.allowGlobal:", gasBefore - gasAfter);

        gasBefore = gasleft();
        FHE.allowTransient(a, bob);
        gasAfter = gasleft();
        console2.log("FHE.allowTransient:", gasBefore - gasAfter);

        // allowSender for completeness
        gasBefore = gasleft();
        FHE.allowSender(a);
        gasAfter = gasleft();
        console2.log("FHE.allowSender:", gasBefore - gasAfter);

        console2.log("");
        console2.log("=== End Gas Profile ===");

        vm.stopPrank();
    }

    /// @notice Test with a simulated InEuint128 struct (like from frontend encryption)
    /// @dev This test demonstrates how encrypted inputs from the frontend would work.
    ///      The ctHash gets modified by verifyInput (metadata appended), so we need to
    ///      set the plaintext value AFTER verifyInput using the returned hash.
    function test_FHE_FromEncryptedInput() public {
        vm.startPrank(alice);

        // Simulate an encrypted input from the frontend
        // In real usage, this comes from cofhejs encryption
        uint256 ctHash = 0x1234567890abcdef << 16 | (Utils.EUINT128_TFHE << 8) | 0;
        uint8 securityZone = 0;
        uint8 utype = Utils.EUINT128_TFHE;
        bytes memory signature = new bytes(65);

        InEuint128 memory input = InEuint128({
            ctHash: ctHash,
            securityZone: securityZone,
            utype: utype,
            signature: signature
        });

        // Verify the input via TaskManager - this returns the MODIFIED ctHash
        euint128 verified = FHE.asEuint128(input);
        uint256 verifiedHash = euint128.unwrap(verified);
        console2.log("Verified ctHash:", verifiedHash);

        // Now set the plaintext value using the VERIFIED hash
        taskManager.MOCK_setInEuintKey(verifiedHash, 5000);

        // The verified value should be usable in FHE operations
        euint128 doubled = FHE.add(verified, verified);
        uint256 doubledValue = taskManager.mockStorage(euint128.unwrap(doubled));

        console2.log("Doubled value:", doubledValue);
        assertEq(doubledValue, 10000, "Doubled value should be 10000");

        vm.stopPrank();
    }

    /// @notice Test that allowTransient works for intermediate values
    /// @dev This verifies we can use allowTransient instead of allowThis for temps
    function test_AllowTransient_WorksForIntermediates() public {
        vm.startPrank(alice);

        // Create initial values
        euint128 a = FHE.asEuint128(100);
        euint128 b = FHE.asEuint128(200);

        // Compute intermediate with allowTransient
        euint128 sum = FHE.add(a, b);
        FHE.allowTransient(sum, address(this));  // Transient permission

        // Use intermediate in another operation - should work
        euint128 doubled = FHE.mul(sum, FHE.asEuint128(2));
        FHE.allowThis(doubled);  // Final result gets permanent permission

        // Verify correctness
        uint256 doubledValue = taskManager.mockStorage(euint128.unwrap(doubled));
        assertEq(doubledValue, 600, "Result should be (100+200)*2 = 600");

        vm.stopPrank();
    }

    /// @notice Test allowTransient in a chain of operations (simulates swap math)
    function test_AllowTransient_ChainedOperations() public {
        vm.startPrank(alice);

        // Simulate: amountOut = (amountIn * reserveOut) / (reserveIn + amountIn)
        euint128 amountIn = FHE.asEuint128(1000);
        euint128 reserveIn = FHE.asEuint128(10000);
        euint128 reserveOut = FHE.asEuint128(20000);

        // Intermediate 1: numerator
        euint128 numerator = FHE.mul(amountIn, reserveOut);
        FHE.allowTransient(numerator, address(this));

        // Intermediate 2: denominator
        euint128 denominator = FHE.add(reserveIn, amountIn);
        FHE.allowTransient(denominator, address(this));

        // Final: amountOut
        euint128 amountOut = FHE.div(numerator, denominator);
        FHE.allowThis(amountOut);  // This one needs permanent access

        // Verify: 1000 * 20000 / (10000 + 1000) = 20000000 / 11000 = 1818
        uint256 result = taskManager.mockStorage(euint128.unwrap(amountOut));
        assertEq(result, 1818, "AMM formula result should be 1818");

        vm.stopPrank();
    }

    /// @notice Compare gas: allowThis vs allowTransient
    function test_GasComparison_AllowThisVsTransient() public {
        vm.startPrank(alice);

        euint128 value = FHE.asEuint128(12345);

        uint256 gasBefore;
        uint256 gasAfter;

        // Measure allowThis
        gasBefore = gasleft();
        FHE.allowThis(value);
        gasAfter = gasleft();
        uint256 allowThisGas = gasBefore - gasAfter;

        // Measure allowTransient
        gasBefore = gasleft();
        FHE.allowTransient(value, address(this));
        gasAfter = gasleft();
        uint256 allowTransientGas = gasBefore - gasAfter;

        console2.log("allowThis gas:", allowThisGas);
        console2.log("allowTransient gas:", allowTransientGas);
        console2.log("Savings:", allowThisGas - allowTransientGas);
        console2.log("Savings %:", (allowThisGas - allowTransientGas) * 100 / allowThisGas);

        // allowTransient should be significantly cheaper
        assertTrue(allowTransientGas < allowThisGas, "allowTransient should be cheaper");

        vm.stopPrank();
    }
}
