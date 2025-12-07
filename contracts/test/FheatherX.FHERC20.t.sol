// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Foundry Imports
import "forge-std/Test.sol";

// Uniswap Imports
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {CurrencyLibrary, Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";

// Local Imports
import {FheatherX} from "../src/FheatherX.sol";
import {IFheatherX} from "../src/interface/IFheatherX.sol";
import {FHERC20FaucetToken} from "../src/tokens/FHERC20FaucetToken.sol";

// Test Utils
import {EasyPosm} from "./utils/EasyPosm.sol";
import {Fixtures} from "./utils/Fixtures.sol";

// FHE Imports
import {FHE, euint128, InEuint128} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {CoFheTest} from "@fhenixprotocol/cofhe-mock-contracts/CoFheTest.sol";

/// @title FheatherX FHERC20 Integration Tests
/// @notice Tests for depositEncrypted and withdrawEncrypted with FHERC20 tokens
contract FheatherXFHERC20Test is Test, Fixtures, CoFheTest {
    using EasyPosm for IPositionManager;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    address private user = makeAddr("user");
    address private user2 = makeAddr("user2");

    FheatherX hook;
    PoolId poolId;

    FHERC20FaucetToken fheToken0;
    FHERC20FaucetToken fheToken1;

    uint256 constant INITIAL_MINT = 10000 ether;

    function setUp() public {
        // Warp to reasonable timestamp for faucet tests
        vm.warp(1700000000);

        // Deploy FHERC20 tokens - we need to be the owner to mint
        // Deploy to deterministic addresses using CREATE2 pattern
        FHERC20FaucetToken tokenA = new FHERC20FaucetToken("FHE Token0", "fheTK0", 18);
        FHERC20FaucetToken tokenB = new FHERC20FaucetToken("FHE Token1", "fheTK1", 18);

        // Ensure token0 < token1 for Uniswap ordering
        if (address(tokenA) > address(tokenB)) {
            fheToken0 = tokenB;
            fheToken1 = tokenA;
        } else {
            fheToken0 = tokenA;
            fheToken1 = tokenB;
        }

        vm.label(user, "user");
        vm.label(user2, "user2");
        vm.label(address(this), "test");
        vm.label(address(fheToken0), "fheToken0");
        vm.label(address(fheToken1), "fheToken1");

        // Create the pool manager, utility routers
        deployFreshManagerAndRouters();

        // Mint encrypted tokens to users (this contract is the owner)
        fheToken0.mintEncrypted(user, INITIAL_MINT);
        fheToken1.mintEncrypted(user, INITIAL_MINT);
        fheToken0.mintEncrypted(user2, INITIAL_MINT);
        fheToken1.mintEncrypted(user2, INITIAL_MINT);

        // Give ETH to users for protocol fees
        vm.deal(user, 100 ether);
        vm.deal(user2, 100 ether);

        // Set currencies
        currency0 = Currency.wrap(address(fheToken0));
        currency1 = Currency.wrap(address(fheToken1));

        // Deploy POSM
        deployAndApprovePosm(manager, currency0, currency1);

        // Deploy the hook to an address with the correct flags
        address flags = address(
            uint160(
                Hooks.BEFORE_ADD_LIQUIDITY_FLAG |
                Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG |
                Hooks.BEFORE_SWAP_FLAG |
                Hooks.AFTER_SWAP_FLAG |
                Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
            ) ^ (0x5555 << 144) // Different namespace from main tests
        );

        bytes memory constructorArgs = abi.encode(
            manager,
            address(fheToken0),
            address(fheToken1),
            30 // 0.3% swap fee
        );
        deployCodeTo("FheatherX.sol:FheatherX", constructorArgs, flags);
        hook = FheatherX(payable(flags));

        vm.label(address(hook), "hook");

        // Create the pool
        key = PoolKey(currency0, currency1, 3000, 60, IHooks(hook));
        poolId = key.toId();
        manager.initialize(key, SQRT_PRICE_1_1);
    }

    // ============ depositEncrypted Tests ============

    function testDepositEncryptedToken0() public {
        uint128 depositAmount = 1000 ether;

        // User approves hook to spend encrypted tokens
        // When user calls token.approveEncrypted(), msg.sender in FHE.asEuint128 is "user"
        InEuint128 memory approvalInput = createInEuint128(depositAmount, user);
        vm.prank(user);
        fheToken0.approveEncrypted(address(hook), approvalInput);

        // User deposits encrypted tokens
        // When hook calls token.transferFromEncrypted(), msg.sender in FHE.asEuint128 is "hook"
        InEuint128 memory depositInput = createInEuint128(depositAmount, address(hook));
        vm.prank(user);
        hook.depositEncrypted(true, depositInput);

        // Verify user's balance in hook
        euint128 hookBalance = hook.getUserBalanceToken0(user);
        assertHashValue(hookBalance, depositAmount, "Hook balance should match deposit amount");
    }

    function testDepositEncryptedToken1() public {
        uint128 depositAmount = 500 ether;

        // User approves hook to spend encrypted tokens
        // When user calls token.approveEncrypted(), msg.sender in FHE.asEuint128 is "user"
        InEuint128 memory approvalInput = createInEuint128(depositAmount, user);
        vm.prank(user);
        fheToken1.approveEncrypted(address(hook), approvalInput);

        // User deposits encrypted tokens
        // When hook calls token.transferFromEncrypted(), msg.sender in FHE.asEuint128 is "hook"
        InEuint128 memory depositInput = createInEuint128(depositAmount, address(hook));
        vm.prank(user);
        hook.depositEncrypted(false, depositInput);

        // Verify user's balance in hook
        euint128 hookBalance = hook.getUserBalanceToken1(user);
        assertHashValue(hookBalance, depositAmount, "Hook balance should match deposit amount");
    }

    // ============ withdrawEncrypted Tests ============

    function testWithdrawEncryptedToken0() public {
        uint128 depositAmount = 1000 ether;
        uint128 withdrawAmount = 400 ether;

        // Setup: deposit first
        // For approveEncrypted, msg.sender in FHE.asEuint128 is "user" (direct call)
        InEuint128 memory approvalInput = createInEuint128(depositAmount, user);
        vm.prank(user);
        fheToken0.approveEncrypted(address(hook), approvalInput);

        // For transferFromEncrypted (called by hook), msg.sender in FHE.asEuint128 is "hook"
        InEuint128 memory depositInput = createInEuint128(depositAmount, address(hook));
        vm.prank(user);
        hook.depositEncrypted(true, depositInput);

        // Withdraw encrypted tokens
        // For withdrawEncrypted, hook calls FHE.asEuint128 via internal library call
        // msg.sender is preserved from the original tx, so it's "user"
        InEuint128 memory withdrawInput = createInEuint128(withdrawAmount, user);
        vm.prank(user);
        hook.withdrawEncrypted(true, withdrawInput);

        // Verify hook balance decreased
        euint128 hookBalance = hook.getUserBalanceToken0(user);
        assertHashValue(hookBalance, depositAmount - withdrawAmount, "Hook balance should decrease by withdraw amount");

        // Verify user's FHERC20 balance increased
        euint128 walletBalance = fheToken0.balanceOfEncrypted(user);
        // Initial mint - deposit + withdraw = INITIAL_MINT - depositAmount + withdrawAmount
        assertHashValue(walletBalance, uint128(INITIAL_MINT) - depositAmount + withdrawAmount, "Wallet balance should increase");
    }

    function testWithdrawEncryptedToken1() public {
        uint128 depositAmount = 800 ether;
        uint128 withdrawAmount = 300 ether;

        // Setup: deposit first
        InEuint128 memory approvalInput = createInEuint128(depositAmount, user);
        vm.prank(user);
        fheToken1.approveEncrypted(address(hook), approvalInput);

        InEuint128 memory depositInput = createInEuint128(depositAmount, address(hook));
        vm.prank(user);
        hook.depositEncrypted(false, depositInput);

        // Withdraw encrypted tokens - internal library call, msg.sender = user
        InEuint128 memory withdrawInput = createInEuint128(withdrawAmount, user);
        vm.prank(user);
        hook.withdrawEncrypted(false, withdrawInput);

        // Verify hook balance
        euint128 hookBalance = hook.getUserBalanceToken1(user);
        assertHashValue(hookBalance, depositAmount - withdrawAmount, "Hook balance should decrease by withdraw amount");
    }

    // ============ Equivalence Tests ============

    /// @notice Test that depositEncrypted results in same balance as unwrap + deposit
    function testDepositEquivalence() public {
        uint256 depositAmount = 500 ether;

        // User1 uses depositEncrypted (encrypted path)
        // For approveEncrypted, msg.sender in FHE.asEuint128 is "user"
        InEuint128 memory approvalInput = createInEuint128(uint128(depositAmount), user);
        vm.prank(user);
        fheToken0.approveEncrypted(address(hook), approvalInput);

        // For transferFromEncrypted, msg.sender in FHE.asEuint128 is "hook"
        InEuint128 memory depositInput = createInEuint128(uint128(depositAmount), address(hook));
        vm.prank(user);
        hook.depositEncrypted(true, depositInput);

        // User2 uses unwrap + deposit (plaintext path)
        vm.startPrank(user2);
        fheToken0.unwrap(depositAmount); // Convert encrypted to plaintext
        fheToken0.approve(address(hook), depositAmount);
        hook.deposit(true, depositAmount);
        vm.stopPrank();

        // Both users should have same balance in hook
        euint128 user1Balance = hook.getUserBalanceToken0(user);
        euint128 user2Balance = hook.getUserBalanceToken0(user2);

        assertHashValue(user1Balance, uint128(depositAmount), "User1 (encrypted path) balance");
        assertHashValue(user2Balance, uint128(depositAmount), "User2 (plaintext path) balance");
    }

    /// @notice Test that withdrawEncrypted results in same FHERC20 balance as withdraw + wrap
    /// @dev Note: withdrawEncrypted requires prior depositEncrypted (not plaintext deposit)
    ///      because the hook needs encrypted token balance to transfer
    function testWithdrawEquivalence() public {
        uint128 depositAmount = 1000 ether;
        uint128 withdrawAmount = 400 ether;

        // User1 deposits using encrypted path
        InEuint128 memory approval1 = createInEuint128(depositAmount, user);
        vm.prank(user);
        fheToken0.approveEncrypted(address(hook), approval1);

        InEuint128 memory deposit1 = createInEuint128(depositAmount, address(hook));
        vm.prank(user);
        hook.depositEncrypted(true, deposit1);

        // User2 deposits using plaintext path (for withdraw + wrap comparison)
        vm.startPrank(user2);
        fheToken0.unwrap(depositAmount);
        fheToken0.approve(address(hook), depositAmount);
        hook.deposit(true, depositAmount);
        vm.stopPrank();

        // User1 withdraws using withdrawEncrypted (encrypted path)
        // For withdrawEncrypted, internal library call, msg.sender = user
        InEuint128 memory withdrawInput = createInEuint128(withdrawAmount, user);
        vm.prank(user);
        hook.withdrawEncrypted(true, withdrawInput);

        // User2 withdraws using withdraw + wrap (plaintext path)
        vm.startPrank(user2);
        hook.withdraw(true, withdrawAmount);
        fheToken0.wrap(withdrawAmount);
        vm.stopPrank();

        // Both users should have same FHERC20 wallet balance
        euint128 user1WalletBalance = fheToken0.balanceOfEncrypted(user);
        euint128 user2WalletBalance = fheToken0.balanceOfEncrypted(user2);

        // User1: INITIAL_MINT - depositAmount + withdrawAmount
        // User2: INITIAL_MINT - depositAmount + withdrawAmount (unwrap removed, wrap added back)
        uint128 expectedBalance = uint128(INITIAL_MINT) - depositAmount + withdrawAmount;
        assertHashValue(user1WalletBalance, expectedBalance, "User1 (encrypted withdraw) wallet balance");
        assertHashValue(user2WalletBalance, expectedBalance, "User2 (plaintext withdraw) wallet balance");
    }

    // ============ Full Flow Test ============

    /// @notice Test complete encrypted flow: faucet -> deposit -> withdraw
    function testFullEncryptedFlow() public {
        // User gets tokens from faucet (mints to encrypted balance)
        vm.prank(user);
        fheToken0.faucet();

        uint128 faucetAmount = 100 ether; // FAUCET_AMOUNT * 10^18

        // Initial wallet balance = INITIAL_MINT + faucetAmount
        euint128 initialWalletBalance = fheToken0.balanceOfEncrypted(user);
        assertHashValue(initialWalletBalance, uint128(INITIAL_MINT) + faucetAmount, "Initial wallet balance after faucet");

        // Deposit half to hook
        uint128 depositAmount = 50 ether;
        // For approveEncrypted, msg.sender in FHE.asEuint128 is "user"
        InEuint128 memory approvalInput = createInEuint128(depositAmount, user);
        vm.prank(user);
        fheToken0.approveEncrypted(address(hook), approvalInput);

        // For transferFromEncrypted, msg.sender in FHE.asEuint128 is "hook"
        InEuint128 memory depositInput = createInEuint128(depositAmount, address(hook));
        vm.prank(user);
        hook.depositEncrypted(true, depositInput);

        // Verify hook balance
        euint128 hookBalance = hook.getUserBalanceToken0(user);
        assertHashValue(hookBalance, depositAmount, "Hook balance after deposit");

        // Withdraw back to wallet
        // For withdrawEncrypted, internal library call, msg.sender = user
        InEuint128 memory withdrawInput = createInEuint128(depositAmount, user);
        vm.prank(user);
        hook.withdrawEncrypted(true, withdrawInput);

        // Verify full round-trip: wallet should be back to initial
        euint128 finalWalletBalance = fheToken0.balanceOfEncrypted(user);
        assertHashValue(finalWalletBalance, uint128(INITIAL_MINT) + faucetAmount, "Final wallet balance should match initial");

        // Hook balance should be zero
        euint128 finalHookBalance = hook.getUserBalanceToken0(user);
        assertHashValue(finalHookBalance, 0, "Hook balance should be zero after full withdrawal");
    }

    // ============ Edge Cases ============

    function testDepositEncryptedMultipleTimes() public {
        uint128 amount1 = 100 ether;
        uint128 amount2 = 200 ether;

        // First deposit - approveEncrypted: sender is "user"
        InEuint128 memory approval1 = createInEuint128(amount1, user);
        vm.prank(user);
        fheToken0.approveEncrypted(address(hook), approval1);

        // transferFromEncrypted: sender is "hook"
        InEuint128 memory deposit1 = createInEuint128(amount1, address(hook));
        vm.prank(user);
        hook.depositEncrypted(true, deposit1);

        // Second deposit
        InEuint128 memory approval2 = createInEuint128(amount2, user);
        vm.prank(user);
        fheToken0.approveEncrypted(address(hook), approval2);

        InEuint128 memory deposit2 = createInEuint128(amount2, address(hook));
        vm.prank(user);
        hook.depositEncrypted(true, deposit2);

        // Balance should accumulate
        euint128 hookBalance = hook.getUserBalanceToken0(user);
        assertHashValue(hookBalance, amount1 + amount2, "Balances should accumulate");
    }

    function testWithdrawEncryptedAll() public {
        uint128 depositAmount = 1000 ether;

        // Deposit - approveEncrypted: sender is "user"
        InEuint128 memory approvalInput = createInEuint128(depositAmount, user);
        vm.prank(user);
        fheToken0.approveEncrypted(address(hook), approvalInput);

        // transferFromEncrypted: sender is "hook"
        InEuint128 memory depositInput = createInEuint128(depositAmount, address(hook));
        vm.prank(user);
        hook.depositEncrypted(true, depositInput);

        // Withdraw all - internal library call, msg.sender = user
        InEuint128 memory withdrawInput = createInEuint128(depositAmount, user);
        vm.prank(user);
        hook.withdrawEncrypted(true, withdrawInput);

        // Hook balance should be zero
        euint128 hookBalance = hook.getUserBalanceToken0(user);
        assertHashValue(hookBalance, 0, "Hook balance should be zero");
    }
}
