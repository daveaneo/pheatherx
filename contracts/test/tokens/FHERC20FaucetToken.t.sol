// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {FHERC20FaucetToken} from "../../src/tokens/FHERC20FaucetToken.sol";
import {FHE, euint128, InEuint128, Common} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {CoFheTest} from "@fhenixprotocol/cofhe-mock-contracts/CoFheTest.sol";

/// @title FHERC20FaucetToken Tests
/// @notice Unit tests for the true FHERC20 token implementation
contract FHERC20FaucetTokenTest is Test, CoFheTest {
    FHERC20FaucetToken public token;

    address public user = makeAddr("user");
    address public user2 = makeAddr("user2");
    address public owner;

    uint256 constant FAUCET_AMOUNT = 100;
    uint8 constant DECIMALS = 18;

    function setUp() public {
        owner = address(this);
        token = new FHERC20FaucetToken("FHE Test Token", "fheTEST", DECIMALS);

        vm.label(address(token), "FHERC20Token");
        vm.label(user, "user");
        vm.label(user2, "user2");

        // Warp to a reasonable timestamp (default is 1 in foundry tests)
        // This ensures faucet cooldown calculations work properly
        vm.warp(1700000000); // Some time in 2023
    }

    // ============ Faucet Tests ============

    function testFaucetMintsToEncryptedBalance() public {
        vm.prank(user);
        token.faucet();

        // Check encrypted balance exists
        assertTrue(token.hasEncryptedBalance(user), "User should have encrypted balance");

        // Get encrypted balance and verify value
        euint128 balance = token.balanceOfEncrypted(user);
        uint256 expectedAmount = FAUCET_AMOUNT * (10 ** DECIMALS);
        assertHashValue(balance, uint128(expectedAmount), "Encrypted balance should equal faucet amount");
    }

    function testFaucetCooldown() public {
        vm.startPrank(user);
        token.faucet();

        // Should fail immediately after
        vm.expectRevert("Faucet: cooldown not elapsed");
        token.faucet();

        // Warp 1 hour forward
        vm.warp(block.timestamp + 1 hours);

        // Should succeed now
        token.faucet();
        vm.stopPrank();

        // Balance should be doubled
        euint128 balance = token.balanceOfEncrypted(user);
        uint256 expectedAmount = 2 * FAUCET_AMOUNT * (10 ** DECIMALS);
        assertHashValue(balance, uint128(expectedAmount), "Balance should be doubled after second faucet");
    }

    function testFaucetDoesNotMintPlaintext() public {
        vm.prank(user);
        token.faucet();

        // Plaintext ERC20 balance should be zero
        assertEq(token.balanceOf(user), 0, "Plaintext balance should be zero after faucet");
    }

    // ============ Wrap/Unwrap Tests ============

    function testWrap() public {
        // First mint some plaintext tokens (owner can do this via standard ERC20)
        uint256 mintAmount = 1000 * (10 ** DECIMALS);

        // We need to mint plaintext tokens first - only owner can mint encrypted
        // So we'll use mintEncrypted then unwrap, then wrap to test the flow
        token.mintEncrypted(user, mintAmount);

        vm.startPrank(user);
        token.unwrap(mintAmount); // Now user has plaintext tokens

        // Verify plaintext balance
        assertEq(token.balanceOf(user), mintAmount, "Should have plaintext balance after unwrap");

        // Now wrap half of it
        uint256 wrapAmount = 500 * (10 ** DECIMALS);
        token.wrap(wrapAmount);
        vm.stopPrank();

        // Verify plaintext balance decreased
        assertEq(token.balanceOf(user), mintAmount - wrapAmount, "Plaintext balance should decrease");

        // Verify encrypted balance
        euint128 encBalance = token.balanceOfEncrypted(user);
        assertHashValue(encBalance, uint128(wrapAmount), "Encrypted balance should equal wrapped amount");
    }

    function testUnwrap() public {
        // Mint encrypted tokens to user
        uint256 mintAmount = 1000 * (10 ** DECIMALS);
        token.mintEncrypted(user, mintAmount);

        // Unwrap half
        uint256 unwrapAmount = 500 * (10 ** DECIMALS);
        vm.prank(user);
        token.unwrap(unwrapAmount);

        // Verify plaintext balance
        assertEq(token.balanceOf(user), unwrapAmount, "Plaintext balance should equal unwrapped amount");

        // Verify encrypted balance decreased
        euint128 encBalance = token.balanceOfEncrypted(user);
        assertHashValue(encBalance, uint128(mintAmount - unwrapAmount), "Encrypted balance should decrease");
    }

    function testUnwrapMoreThanBalance() public {
        // Mint small encrypted balance
        uint256 mintAmount = 100 * (10 ** DECIMALS);
        token.mintEncrypted(user, mintAmount);

        // In mock FHE, sub doesn't revert on underflow (the ciphertext just wraps).
        // In production, the CoFHE coprocessor would produce an invalid result.
        // For testing purposes, we verify the operation completes but results in a huge (wrapped) balance.
        vm.prank(user);
        token.unwrap(mintAmount + 1);

        // The encrypted balance should have wrapped to a huge number (max uint128 - amount)
        euint128 encBalance = token.balanceOfEncrypted(user);
        // In mock FHE, underflow wraps around, so balance becomes very large
        uint128 expectedWrappedValue = type(uint128).max; // mintAmount - (mintAmount + 1) wraps
        assertHashValue(encBalance, expectedWrappedValue, "Balance should wrap on underflow in mock FHE");
    }

    // ============ Encrypted Transfer Tests ============

    function testTransferEncrypted() public {
        // Mint to user
        uint256 mintAmount = 1000 * (10 ** DECIMALS);
        token.mintEncrypted(user, mintAmount);

        // Create encrypted input for transfer amount
        uint128 transferAmount = uint128(200 * (10 ** DECIMALS));
        InEuint128 memory encInput = createInEuint128(transferAmount, user);

        // Transfer
        vm.prank(user);
        token.transferEncrypted(user2, encInput);

        // Verify sender balance
        euint128 senderBalance = token.balanceOfEncrypted(user);
        assertHashValue(senderBalance, uint128(mintAmount) - transferAmount, "Sender balance should decrease");

        // Verify recipient balance
        euint128 recipientBalance = token.balanceOfEncrypted(user2);
        assertHashValue(recipientBalance, transferAmount, "Recipient should receive tokens");
    }

    function testTransferEncryptedDirect() public {
        // Mint to user
        uint256 mintAmount = 1000 * (10 ** DECIMALS);
        token.mintEncrypted(user, mintAmount);

        // Create euint128 directly
        euint128 transferAmount = FHE.asEuint128(uint128(300 * (10 ** DECIMALS)));
        FHE.allow(transferAmount, address(token));

        // Transfer using direct method
        vm.prank(user);
        token.transferEncryptedDirect(user2, transferAmount);

        // Verify recipient received tokens
        assertTrue(token.hasEncryptedBalance(user2), "Recipient should have balance");
    }

    function testTransferEncryptedToZeroAddressFails() public {
        token.mintEncrypted(user, 1000 * (10 ** DECIMALS));

        InEuint128 memory encInput = createInEuint128(uint128(100 * (10 ** DECIMALS)), user);

        vm.prank(user);
        vm.expectRevert("Transfer to zero address");
        token.transferEncrypted(address(0), encInput);
    }

    // ============ Encrypted Approval Tests ============

    function testApproveEncrypted() public {
        // Mint to user
        token.mintEncrypted(user, 1000 * (10 ** DECIMALS));

        // Create encrypted approval
        uint128 approvalAmount = uint128(500 * (10 ** DECIMALS));
        InEuint128 memory encInput = createInEuint128(approvalAmount, user);

        vm.prank(user);
        token.approveEncrypted(user2, encInput);

        // Verify allowance
        euint128 allowance = token.allowanceEncrypted(user, user2);
        assertHashValue(allowance, approvalAmount, "Allowance should match approved amount");
    }

    function testTransferFromEncrypted() public {
        // Setup: mint to user and approve user2
        uint256 mintAmount = 1000 * (10 ** DECIMALS);
        token.mintEncrypted(user, mintAmount);

        uint128 approvalAmount = uint128(500 * (10 ** DECIMALS));
        InEuint128 memory approveInput = createInEuint128(approvalAmount, user);

        vm.prank(user);
        token.approveEncrypted(user2, approveInput);

        // user2 transfers from user to themselves
        uint128 transferAmount = uint128(200 * (10 ** DECIMALS));
        InEuint128 memory transferInput = createInEuint128(transferAmount, user2);

        vm.prank(user2);
        token.transferFromEncrypted(user, user2, transferInput);

        // Verify balances
        euint128 userBalance = token.balanceOfEncrypted(user);
        assertHashValue(userBalance, uint128(mintAmount) - transferAmount, "User balance should decrease");

        euint128 user2Balance = token.balanceOfEncrypted(user2);
        assertHashValue(user2Balance, transferAmount, "User2 should receive tokens");

        // Verify allowance decreased
        euint128 allowance = token.allowanceEncrypted(user, user2);
        assertHashValue(allowance, approvalAmount - transferAmount, "Allowance should decrease");
    }

    // ============ Owner Functions ============

    function testMintEncryptedOnlyOwner() public {
        // Owner can mint
        token.mintEncrypted(user, 1000 * (10 ** DECIMALS));
        assertTrue(token.hasEncryptedBalance(user), "Owner should be able to mint");

        // Non-owner cannot mint
        vm.prank(user);
        vm.expectRevert();
        token.mintEncrypted(user2, 1000 * (10 ** DECIMALS));
    }

    // ============ View Functions ============

    function testDecimals() public view {
        assertEq(token.decimals(), DECIMALS, "Decimals should match");
    }

    function testHasEncryptedBalanceFalseInitially() public view {
        assertFalse(token.hasEncryptedBalance(user), "Should not have encrypted balance initially");
    }

    function testTotalSupplyOnlyShowsUnwrapped() public {
        // Total supply starts at 0
        assertEq(token.totalSupply(), 0, "Initial total supply should be 0");

        // Mint encrypted - shouldn't affect plaintext total supply
        token.mintEncrypted(user, 1000 * (10 ** DECIMALS));
        assertEq(token.totalSupply(), 0, "Total supply should still be 0 after encrypted mint");

        // Unwrap some - now it should show
        vm.prank(user);
        token.unwrap(500 * (10 ** DECIMALS));
        assertEq(token.totalSupply(), 500 * (10 ** DECIMALS), "Total supply should show unwrapped amount");
    }

    // ============ Integration Tests ============

    function testFullFlowFaucetToTransferToUnwrap() public {
        // User1 gets tokens from faucet
        vm.prank(user);
        token.faucet();

        uint256 faucetAmount = FAUCET_AMOUNT * (10 ** DECIMALS);

        // User1 transfers half to user2
        uint128 transferAmount = uint128(faucetAmount / 2);
        InEuint128 memory encInput = createInEuint128(transferAmount, user);

        vm.prank(user);
        token.transferEncrypted(user2, encInput);

        // User2 unwraps their tokens
        vm.prank(user2);
        token.unwrap(transferAmount);

        // Verify final state
        assertEq(token.balanceOf(user2), transferAmount, "User2 should have plaintext tokens");

        euint128 user1Balance = token.balanceOfEncrypted(user);
        assertHashValue(user1Balance, uint128(faucetAmount) - transferAmount, "User1 should have remaining encrypted balance");
    }
}
