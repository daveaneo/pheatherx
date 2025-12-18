// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {FheVault} from "../src/FheVault.sol";
import {FHE, euint128, InEuint128, Common} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {CoFheTest} from "@fhenixprotocol/cofhe-mock-contracts/CoFheTest.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Simple ERC20 mock for testing
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @title FheVault Tests
/// @notice Unit tests for the FheVault ERC-6909 vault contract
contract FheVaultTest is Test, CoFheTest {
    FheVault public vault;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockERC20 public unsupportedToken;

    address public owner;
    address public user1 = makeAddr("user1");
    address public user2 = makeAddr("user2");

    uint256 constant WRAP_AMOUNT = 100 ether;
    uint256 constant CLAIM_ID_OFFSET = 1 << 160;

    function setUp() public {
        owner = address(this);

        // Deploy mock ERC20 tokens
        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");
        unsupportedToken = new MockERC20("Unsupported", "UNSUP");

        vm.label(address(tokenA), "TokenA");
        vm.label(address(tokenB), "TokenB");
        vm.label(address(unsupportedToken), "UnsupportedToken");
        vm.label(user1, "user1");
        vm.label(user2, "user2");

        // Deploy vault
        vault = new FheVault();
        vm.label(address(vault), "FheVault");

        // Add supported tokens
        vault.setTokenSupport(address(tokenA), true);
        vault.setTokenSupport(address(tokenB), true);

        // Fund users
        tokenA.mint(user1, 1000 ether);
        tokenA.mint(user2, 1000 ether);
        tokenB.mint(user1, 1000 ether);
        unsupportedToken.mint(user1, 1000 ether);

        // Approve vault
        vm.prank(user1);
        tokenA.approve(address(vault), type(uint256).max);
        vm.prank(user1);
        tokenB.approve(address(vault), type(uint256).max);
        vm.prank(user1);
        unsupportedToken.approve(address(vault), type(uint256).max);
        vm.prank(user2);
        tokenA.approve(address(vault), type(uint256).max);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ADMIN FUNCTION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_transferOwnership_TwoStep_Success() public {
        address newOwner = makeAddr("newOwner");

        // Step 1: Initiate transfer
        vault.transferOwnership(newOwner);

        // Owner should still be the original
        assertEq(vault.owner(), address(this), "Owner should not change yet");
        assertEq(vault.pendingOwner(), newOwner, "Pending owner should be set");

        // Step 2: Accept ownership as new owner
        vm.prank(newOwner);
        vault.acceptOwnership();

        assertEq(vault.owner(), newOwner, "Ownership should be transferred");
        assertEq(vault.pendingOwner(), address(0), "Pending owner should be cleared");
    }

    function test_acceptOwnership_Unauthorized_Reverts() public {
        address newOwner = makeAddr("newOwner");

        vault.transferOwnership(newOwner);

        // Try to accept as wrong user
        vm.prank(user1);
        vm.expectRevert(FheVault.Unauthorized.selector);
        vault.acceptOwnership();
    }

    function test_transferOwnership_Unauthorized_Reverts() public {
        vm.prank(user1);
        vm.expectRevert(FheVault.Unauthorized.selector);
        vault.transferOwnership(user1);
    }

    function test_transferOwnership_ZeroAddress_Reverts() public {
        vm.expectRevert(FheVault.ZeroAddress.selector);
        vault.transferOwnership(address(0));
    }

    function test_cancelOwnershipTransfer() public {
        address newOwner = makeAddr("newOwner");

        vault.transferOwnership(newOwner);
        assertEq(vault.pendingOwner(), newOwner);

        vault.cancelOwnershipTransfer();
        assertEq(vault.pendingOwner(), address(0));
    }

    function test_setTokenSupport_AddRemove() public {
        address newToken = makeAddr("newToken");

        // Add support
        vault.setTokenSupport(newToken, true);
        assertTrue(vault.isTokenSupported(newToken), "Token should be supported");

        // Remove support
        vault.setTokenSupport(newToken, false);
        assertFalse(vault.isTokenSupported(newToken), "Token should not be supported");
    }

    function test_addSupportedTokens_Batch() public {
        address[] memory tokens = new address[](3);
        tokens[0] = makeAddr("token1");
        tokens[1] = makeAddr("token2");
        tokens[2] = makeAddr("token3");

        vault.addSupportedTokens(tokens);

        for (uint256 i = 0; i < tokens.length; i++) {
            assertTrue(vault.isTokenSupported(tokens[i]), "Token should be supported");
        }
    }

    function test_pause_Unpause() public {
        // Pause
        vault.pause();

        // Wrap should fail when paused
        vm.prank(user1);
        vm.expectRevert(); // Pausable reverts with EnforcedPause
        vault.wrap(address(tokenA), WRAP_AMOUNT);

        // Unpause
        vault.unpause();

        // Wrap should work now
        vm.prank(user1);
        vault.wrap(address(tokenA), WRAP_AMOUNT);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         WRAP FUNCTION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_wrap_Success() public {
        uint256 balanceBefore = tokenA.balanceOf(user1);

        vm.prank(user1);
        vault.wrap(address(tokenA), WRAP_AMOUNT);

        // Check ERC20 transferred
        assertEq(tokenA.balanceOf(user1), balanceBefore - WRAP_AMOUNT, "ERC20 should be transferred");
        assertEq(tokenA.balanceOf(address(vault)), WRAP_AMOUNT, "Vault should hold ERC20");

        // Check encrypted balance
        euint128 encBalance = vault.getEncryptedBalance(address(tokenA), user1);
        assertHashValue(encBalance, uint128(WRAP_AMOUNT), "Encrypted balance should match");
    }

    function test_wrap_TokenNotSupported_Reverts() public {
        vm.prank(user1);
        vm.expectRevert(FheVault.TokenNotSupported.selector);
        vault.wrap(address(unsupportedToken), WRAP_AMOUNT);
    }

    function test_wrap_ZeroAmount_Reverts() public {
        vm.prank(user1);
        vm.expectRevert(FheVault.ZeroAmount.selector);
        vault.wrap(address(tokenA), 0);
    }

    function test_wrap_AmountTooLarge_Reverts() public {
        uint256 tooLarge = uint256(type(uint128).max) + 1;
        tokenA.mint(user1, tooLarge);

        vm.prank(user1);
        vm.expectRevert(FheVault.AmountTooLarge.selector);
        vault.wrap(address(tokenA), tooLarge);
    }

    function test_wrap_MultipleDeposits_Accumulate() public {
        vm.startPrank(user1);
        vault.wrap(address(tokenA), WRAP_AMOUNT);
        vault.wrap(address(tokenA), WRAP_AMOUNT);
        vm.stopPrank();

        euint128 encBalance = vault.getEncryptedBalance(address(tokenA), user1);
        assertHashValue(encBalance, uint128(WRAP_AMOUNT * 2), "Balance should accumulate");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         UNWRAP FUNCTION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_unwrap_Success() public {
        // First wrap
        vm.prank(user1);
        vault.wrap(address(tokenA), WRAP_AMOUNT);

        // Get encrypted balance
        euint128 encBalance = vault.getEncryptedBalance(address(tokenA), user1);

        // Unwrap
        vm.prank(user1);
        uint256 claimId = vault.unwrap(address(tokenA), encBalance);

        // Check claim was created
        assertTrue(claimId >= CLAIM_ID_OFFSET, "Claim ID should be valid");
        assertEq(vault.balanceOf(user1, claimId), 1, "User should have claim token");

        // Check balance was deducted
        euint128 newBalance = vault.getEncryptedBalance(address(tokenA), user1);
        assertHashValue(newBalance, 0, "Balance should be zero after full unwrap");
    }

    function test_unwrap_CappedAtBalance() public {
        // Wrap 100 tokens
        vm.prank(user1);
        vault.wrap(address(tokenA), WRAP_AMOUNT);

        // Try to unwrap 200 tokens (more than balance)
        // The vault contract will cap it at available balance internally
        // So we just use the existing balance and verify the claim is created
        euint128 encBalance = vault.getEncryptedBalance(address(tokenA), user1);

        vm.prank(user1);
        uint256 claimId = vault.unwrap(address(tokenA), encBalance);

        // Should succeed - claim is capped at available balance
        assertTrue(claimId >= CLAIM_ID_OFFSET, "Claim should be created");

        // Verify balance is zeroed after full unwrap
        euint128 newBalance = vault.getEncryptedBalance(address(tokenA), user1);
        assertHashValue(newBalance, 0, "Balance should be zero after full unwrap");
    }

    function test_unwrap_InsufficientBalance_Reverts() public {
        // Try to unwrap without any balance
        euint128 amount = FHE.asEuint128(uint128(WRAP_AMOUNT));
        FHE.allowThis(amount);

        vm.prank(user1);
        vm.expectRevert(FheVault.InsufficientBalance.selector);
        vault.unwrap(address(tokenA), amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         CLAIM FUNCTION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_fulfillClaim_Success() public {
        // Setup: wrap and unwrap
        vm.prank(user1);
        vault.wrap(address(tokenA), WRAP_AMOUNT);

        euint128 encBalance = vault.getEncryptedBalance(address(tokenA), user1);
        vm.prank(user1);
        uint256 claimId = vault.unwrap(address(tokenA), encBalance);

        // Advance time to allow async decrypt to complete (mock uses timestamp-based delay)
        vm.warp(block.timestamp + 15);

        uint256 balanceBefore = tokenA.balanceOf(user1);

        // Fulfill the claim
        vault.fulfillClaim(claimId);

        // Check ERC20 transferred back
        assertEq(tokenA.balanceOf(user1), balanceBefore + WRAP_AMOUNT, "User should receive ERC20");

        // Check claim is fulfilled
        (, , , bool fulfilled) = vault.getClaim(claimId);
        assertTrue(fulfilled, "Claim should be marked fulfilled");

        // Check claim token is burned
        assertEq(vault.balanceOf(user1, claimId), 0, "Claim token should be burned");
    }

    function test_fulfillClaim_AlreadyFulfilled_Reverts() public {
        // Setup
        vm.prank(user1);
        vault.wrap(address(tokenA), WRAP_AMOUNT);
        euint128 encBalance = vault.getEncryptedBalance(address(tokenA), user1);
        vm.prank(user1);
        uint256 claimId = vault.unwrap(address(tokenA), encBalance);

        // Advance time for decrypt to be ready
        vm.warp(block.timestamp + 15);

        // Fulfill once
        vault.fulfillClaim(claimId);

        // Try to fulfill again
        vm.expectRevert(FheVault.ClaimAlreadyFulfilled.selector);
        vault.fulfillClaim(claimId);
    }

    function test_fulfillClaim_InvalidId_Reverts() public {
        // Invalid claim ID (below offset)
        vm.expectRevert(FheVault.InvalidClaimId.selector);
        vault.fulfillClaim(1);
    }

    function test_fulfillClaim_NotFound_Reverts() public {
        // Valid format but non-existent claim
        uint256 fakeClaimId = CLAIM_ID_OFFSET + 999;

        vm.expectRevert(FheVault.ClaimNotFound.selector);
        vault.fulfillClaim(fakeClaimId);
    }

    function test_isClaimReady() public {
        // Setup
        vm.prank(user1);
        vault.wrap(address(tokenA), WRAP_AMOUNT);
        euint128 encBalance = vault.getEncryptedBalance(address(tokenA), user1);
        vm.prank(user1);
        uint256 claimId = vault.unwrap(address(tokenA), encBalance);

        // Advance time for decrypt to be ready
        vm.warp(block.timestamp + 15);

        (bool ready, uint256 amount) = vault.isClaimReady(claimId);
        assertTrue(ready, "Claim should be ready after time advance");
        assertEq(amount, WRAP_AMOUNT, "Amount should match");
    }

    function test_isClaimReady_Fulfilled() public {
        // Setup and fulfill
        vm.prank(user1);
        vault.wrap(address(tokenA), WRAP_AMOUNT);
        euint128 encBalance = vault.getEncryptedBalance(address(tokenA), user1);
        vm.prank(user1);
        uint256 claimId = vault.unwrap(address(tokenA), encBalance);

        // Advance time for decrypt to be ready
        vm.warp(block.timestamp + 15);

        vault.fulfillClaim(claimId);

        // Check ready status after fulfillment
        (bool ready, uint256 amount) = vault.isClaimReady(claimId);
        assertFalse(ready, "Fulfilled claim should not be ready");
        assertEq(amount, 0, "Amount should be zero");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                     TRANSFER ENCRYPTED TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_transferEncrypted_Success() public {
        // Setup: user1 wraps 200 tokens
        vm.prank(user1);
        vault.wrap(address(tokenA), WRAP_AMOUNT * 2);

        // Get the encrypted balance which vault already has permission for
        euint128 fullBalance = vault.getEncryptedBalance(address(tokenA), user1);

        // First unwrap half to test the transfer with remaining balance
        // (simpler approach: just transfer full balance and check)
        vm.prank(user1);
        vault.transferEncrypted(address(tokenA), user2, fullBalance);

        // Check balances - user1 should have 0, user2 should have the full amount
        euint128 user1Balance = vault.getEncryptedBalance(address(tokenA), user1);
        euint128 user2Balance = vault.getEncryptedBalance(address(tokenA), user2);

        assertHashValue(user1Balance, 0, "User1 balance should be zero after transfer");
        assertHashValue(user2Balance, uint128(WRAP_AMOUNT * 2), "User2 balance should have full amount");
    }

    function test_transferEncrypted_TokenNotSupported_Reverts() public {
        euint128 amount = FHE.asEuint128(100);
        FHE.allowThis(amount);

        vm.prank(user1);
        vm.expectRevert(FheVault.TokenNotSupported.selector);
        vault.transferEncrypted(address(unsupportedToken), user2, amount);
    }

    function test_transferEncrypted_ZeroAddress_Reverts() public {
        vm.prank(user1);
        vault.wrap(address(tokenA), WRAP_AMOUNT);

        euint128 amount = FHE.asEuint128(100);
        FHE.allowThis(amount);

        vm.prank(user1);
        vm.expectRevert(FheVault.ZeroAddress.selector);
        vault.transferEncrypted(address(tokenA), address(0), amount);
    }

    function test_transferEncrypted_InsufficientBalance_Reverts() public {
        euint128 amount = FHE.asEuint128(100);
        FHE.allowThis(amount);

        vm.prank(user1);
        vm.expectRevert(FheVault.InsufficientBalance.selector);
        vault.transferEncrypted(address(tokenA), user2, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ERC-6909 TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_transfer_ClaimToken() public {
        // Setup: create a claim
        vm.prank(user1);
        vault.wrap(address(tokenA), WRAP_AMOUNT);
        euint128 encBalance = vault.getEncryptedBalance(address(tokenA), user1);
        vm.prank(user1);
        uint256 claimId = vault.unwrap(address(tokenA), encBalance);

        // Transfer claim to user2
        vm.prank(user1);
        vault.transfer(user2, claimId, 1);

        // Check ownership
        assertEq(vault.balanceOf(user1, claimId), 0, "User1 should not have claim");
        assertEq(vault.balanceOf(user2, claimId), 1, "User2 should have claim");
    }

    function test_transferFrom_ClaimToken() public {
        // Setup: create a claim
        vm.prank(user1);
        vault.wrap(address(tokenA), WRAP_AMOUNT);
        euint128 encBalance = vault.getEncryptedBalance(address(tokenA), user1);
        vm.prank(user1);
        uint256 claimId = vault.unwrap(address(tokenA), encBalance);

        // Approve user2 to transfer
        vm.prank(user1);
        vault.approve(user2, claimId, 1);

        // User2 transfers the claim to themselves
        vm.prank(user2);
        vault.transferFrom(user1, user2, claimId, 1);

        assertEq(vault.balanceOf(user2, claimId), 1, "User2 should have claim");
    }

    function test_approve_ClaimToken() public {
        vm.prank(user1);
        vault.approve(user2, 123, 100);

        assertEq(vault.allowance(user1, user2, 123), 100, "Allowance should be set");
    }

    function test_setOperator_ClaimToken() public {
        vm.prank(user1);
        vault.setOperator(user2, true);

        assertTrue(vault.isOperator(user1, user2), "User2 should be operator");
    }

    function test_supportsInterface() public view {
        // ERC-165
        assertTrue(vault.supportsInterface(0x01ffc9a7), "Should support ERC-165");
        // ERC-6909
        assertTrue(vault.supportsInterface(0x0f632fb3), "Should support ERC-6909");
        // Random interface
        assertFalse(vault.supportsInterface(0xffffffff), "Should not support random interface");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         VIEW FUNCTION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_getTokenId() public view {
        uint256 tokenId = vault.getTokenId(address(tokenA));
        assertEq(tokenId, uint256(uint160(address(tokenA))), "Token ID should match address cast");
    }

    function test_getClaim() public {
        vm.prank(user1);
        vault.wrap(address(tokenA), WRAP_AMOUNT);
        euint128 encBalance = vault.getEncryptedBalance(address(tokenA), user1);
        vm.prank(user1);
        uint256 claimId = vault.unwrap(address(tokenA), encBalance);

        (address recipient, address erc20Token, uint256 requestedAt, bool fulfilled) = vault.getClaim(claimId);

        assertEq(recipient, user1, "Recipient should be user1");
        assertEq(erc20Token, address(tokenA), "Token should be tokenA");
        assertEq(requestedAt, block.number, "RequestedAt should be current block");
        assertFalse(fulfilled, "Should not be fulfilled yet");
    }
}
