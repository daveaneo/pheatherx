// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Foundry Imports
import "forge-std/Test.sol";

// Local Imports
import {FheatherXv3} from "../src/FheatherXv3.sol";
import {IFheatherXv3} from "../src/interface/IFheatherXv3.sol";
import {TickBitmap} from "../src/lib/TickBitmap.sol";
import {FHERC20FaucetToken} from "../src/tokens/FHERC20FaucetToken.sol";

// FHE Imports
import {FHE, euint128, ebool, InEuint128, InEbool, Common} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {CoFheTest} from "@fhenixprotocol/cofhe-mock-contracts/CoFheTest.sol";

// OpenZeppelin Imports
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract FheatherXv3Test is Test, CoFheTest {
    // Test addresses
    address private owner = makeAddr("owner");
    address private user1 = makeAddr("user1");
    address private user2 = makeAddr("user2");
    address private feeCollector = makeAddr("feeCollector");

    // Contract instances
    FheatherXv3 public fheatherX;
    FHERC20FaucetToken public token0;
    FHERC20FaucetToken public token1;

    // Common test amounts
    uint256 constant DEPOSIT_AMOUNT = 100e18;
    uint256 constant SWAP_AMOUNT = 50e18;
    int24 constant TEST_TICK = 60; // ~0.6% above price 1.0

    function setUp() public {
        // Deploy tokens at deterministic addresses to ensure token0 < token1
        address addr0 = address(0x1000);
        address addr1 = address(0x2000);

        // Deploy FHERC20 tokens
        vm.startPrank(owner);

        FHERC20FaucetToken tempToken0 = new FHERC20FaucetToken("Token0", "TK0", 18);
        FHERC20FaucetToken tempToken1 = new FHERC20FaucetToken("Token1", "TK1", 18);

        // Ensure token0 < token1
        if (address(tempToken0) > address(tempToken1)) {
            (tempToken0, tempToken1) = (tempToken1, tempToken0);
        }

        token0 = tempToken0;
        token1 = tempToken1;

        // Deploy FheatherXv3
        fheatherX = new FheatherXv3(
            address(token0),
            address(token1),
            owner
        );

        // Initialize reserves for price estimation
        fheatherX.initializeReserves(1000e18, 1000e18);

        // Set fee collector
        fheatherX.setFeeCollector(feeCollector);

        vm.stopPrank();

        // Label addresses for easier debugging
        vm.label(owner, "owner");
        vm.label(user1, "user1");
        vm.label(user2, "user2");
        vm.label(feeCollector, "feeCollector");
        vm.label(address(fheatherX), "fheatherX");
        vm.label(address(token0), "token0");
        vm.label(address(token1), "token1");

        // Give tokens to users
        _mintAndApprove(user1, DEPOSIT_AMOUNT * 10);
        _mintAndApprove(user2, DEPOSIT_AMOUNT * 10);

        // Initialize FheatherX contract with small token balances
        // This is needed because transferEncryptedDirect requires initialized balances
        vm.startPrank(owner);
        token0.mintEncrypted(address(fheatherX), 1);
        token1.mintEncrypted(address(fheatherX), 1);
        vm.stopPrank();
    }

    function _mintAndApprove(address user, uint256 amount) internal {
        vm.startPrank(owner);
        token0.mintEncrypted(user, amount);
        token1.mintEncrypted(user, amount);
        vm.stopPrank();

        vm.startPrank(user);
        // Approve FheatherX to spend tokens via encrypted allowance
        InEuint128 memory maxApproval = _createInEuint128(type(uint128).max, user);
        token0.approveEncrypted(address(fheatherX), maxApproval);
        token1.approveEncrypted(address(fheatherX), maxApproval);
        vm.stopPrank();
    }

    function _createInEuint128(uint128 value, address sender) internal returns (InEuint128 memory) {
        return createInEuint128(value, sender);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          CONSTRUCTOR TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testConstructor() public view {
        assertEq(address(fheatherX.token0()), address(token0));
        assertEq(address(fheatherX.token1()), address(token1));
        assertEq(fheatherX.owner(), owner);
        assertEq(fheatherX.maxBucketsPerSwap(), 5);
        assertEq(fheatherX.protocolFeeBps(), 5);
    }

    function testConstructorRevertsZeroAddress() public {
        vm.expectRevert("Zero address");
        new FheatherXv3(address(0), address(token1), owner);
    }

    function testConstructorRevertsWrongTokenOrder() public {
        vm.expectRevert("Token order");
        new FheatherXv3(address(token1), address(token0), owner);
    }

    function testTickPricesInitialized() public view {
        // Check tick 0 = 1e18
        assertEq(fheatherX.tickPrices(0), 1e18);

        // Check positive tick 60
        assertEq(fheatherX.tickPrices(60), 1006017120990792834);

        // Check negative tick -60
        assertEq(fheatherX.tickPrices(-60), 994017962903844986);

        // Check max tick 6000
        assertGt(fheatherX.tickPrices(6000), 0);

        // Check min tick -6000
        assertGt(fheatherX.tickPrices(-6000), 0);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          DEPOSIT TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testDepositSellSide() public {
        vm.startPrank(user1);

        InEuint128 memory amount = _createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        uint256 deadline = block.timestamp + 1 hours;
        int24 maxDrift = 100;

        euint128 shares = fheatherX.deposit(
            TEST_TICK,
            amount,
            FheatherXv3.BucketSide.SELL,
            deadline,
            maxDrift
        );

        // Verify shares returned
        assertHashValue(shares, uint128(DEPOSIT_AMOUNT));

        // Verify bucket state
        (euint128 totalShares, euint128 liquidity, , , bool initialized) =
            fheatherX.getBucket(TEST_TICK, FheatherXv3.BucketSide.SELL);

        assertTrue(initialized);
        assertHashValue(totalShares, uint128(DEPOSIT_AMOUNT));
        assertHashValue(liquidity, uint128(DEPOSIT_AMOUNT));

        vm.stopPrank();
    }

    function testDepositBuySide() public {
        vm.startPrank(user1);

        InEuint128 memory amount = _createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        uint256 deadline = block.timestamp + 1 hours;
        int24 maxDrift = 100;

        euint128 shares = fheatherX.deposit(
            TEST_TICK,
            amount,
            FheatherXv3.BucketSide.BUY,
            deadline,
            maxDrift
        );

        assertHashValue(shares, uint128(DEPOSIT_AMOUNT));

        vm.stopPrank();
    }

    function testDepositRevertsExpiredDeadline() public {
        vm.startPrank(user1);

        InEuint128 memory amount = _createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        uint256 deadline = block.timestamp - 1; // Expired
        int24 maxDrift = 100;

        vm.expectRevert("Expired");
        fheatherX.deposit(TEST_TICK, amount, FheatherXv3.BucketSide.SELL, deadline, maxDrift);

        vm.stopPrank();
    }

    function testDepositRevertsInvalidTickSpacing() public {
        vm.startPrank(user1);

        InEuint128 memory amount = _createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        uint256 deadline = block.timestamp + 1 hours;
        int24 maxDrift = 100;

        vm.expectRevert("Invalid tick spacing");
        fheatherX.deposit(61, amount, FheatherXv3.BucketSide.SELL, deadline, maxDrift); // 61 is not divisible by 60

        vm.stopPrank();
    }

    function testDepositRevertsTickOutOfRange() public {
        vm.startPrank(user1);

        InEuint128 memory amount = _createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        uint256 deadline = block.timestamp + 1 hours;
        int24 maxDrift = 10000; // High drift to not hit price moved

        vm.expectRevert("Tick out of range");
        fheatherX.deposit(6060, amount, FheatherXv3.BucketSide.SELL, deadline, maxDrift); // Beyond MAX_TICK

        vm.stopPrank();
    }

    function testMultipleDepositsAutoClaimProceeds() public {
        // User1 deposits
        vm.startPrank(user1);
        InEuint128 memory amount1 = _createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        fheatherX.deposit(TEST_TICK, amount1, FheatherXv3.BucketSide.SELL, block.timestamp + 1 hours, 100);
        vm.stopPrank();

        // User2 deposits to same bucket
        vm.startPrank(user2);
        InEuint128 memory amount2 = _createInEuint128(uint128(DEPOSIT_AMOUNT), user2);
        fheatherX.deposit(TEST_TICK, amount2, FheatherXv3.BucketSide.SELL, block.timestamp + 1 hours, 100);
        vm.stopPrank();

        // Verify total shares
        (euint128 totalShares, , , , ) = fheatherX.getBucket(TEST_TICK, FheatherXv3.BucketSide.SELL);
        assertHashValue(totalShares, uint128(DEPOSIT_AMOUNT * 2));
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          SWAP TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testSwapZeroForOne() public {
        // Initialize reserves for price estimation and to prevent underflow
        vm.startPrank(owner);
        fheatherX.initializeReserves(DEPOSIT_AMOUNT * 10, DEPOSIT_AMOUNT * 10);

        // Provide plaintext liquidity to fheatherX for swap outputs
        // The BUY bucket (being filled when selling token0) outputs token1
        token1.mintEncrypted(owner, DEPOSIT_AMOUNT * 2);
        vm.stopPrank();

        vm.startPrank(owner);
        token1.unwrap(DEPOSIT_AMOUNT * 2);
        IERC20(address(token1)).transfer(address(fheatherX), DEPOSIT_AMOUNT * 2);
        vm.stopPrank();

        // First deposit liquidity to BUY bucket (which will be filled by selling token0)
        vm.startPrank(user1);
        InEuint128 memory amount = _createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        fheatherX.deposit(TEST_TICK, amount, FheatherXv3.BucketSide.BUY, block.timestamp + 1 hours, 100);
        vm.stopPrank();

        // Give swapper some plaintext tokens
        vm.startPrank(owner);
        token0.mintEncrypted(user2, SWAP_AMOUNT);
        vm.stopPrank();

        // Unwrap tokens to plaintext for swap
        vm.startPrank(user2);
        token0.unwrap(SWAP_AMOUNT);
        IERC20(address(token0)).approve(address(fheatherX), SWAP_AMOUNT);

        uint256 amountOut = fheatherX.swap(
            true, // zeroForOne - selling token0
            SWAP_AMOUNT,
            0 // minAmountOut
        );

        // Verify some output was received
        assertGt(amountOut, 0);
        vm.stopPrank();
    }

    function testSwapRevertsZeroInput() public {
        vm.startPrank(user1);

        vm.expectRevert("Zero input");
        fheatherX.swap(true, 0, 0);

        vm.stopPrank();
    }

    function testSwapRevertsSlippageExceeded() public {
        // Initialize reserves for price estimation
        vm.startPrank(owner);
        fheatherX.initializeReserves(DEPOSIT_AMOUNT * 10, DEPOSIT_AMOUNT * 10);

        // Provide plaintext liquidity to fheatherX for swap outputs
        token1.mintEncrypted(owner, DEPOSIT_AMOUNT * 2);
        vm.stopPrank();

        vm.startPrank(owner);
        token1.unwrap(DEPOSIT_AMOUNT * 2);
        IERC20(address(token1)).transfer(address(fheatherX), DEPOSIT_AMOUNT * 2);
        vm.stopPrank();

        // First deposit liquidity
        vm.startPrank(user1);
        InEuint128 memory amount = _createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        fheatherX.deposit(TEST_TICK, amount, FheatherXv3.BucketSide.BUY, block.timestamp + 1 hours, 100);
        vm.stopPrank();

        // Give swapper tokens
        vm.startPrank(owner);
        token0.mintEncrypted(user2, SWAP_AMOUNT);
        vm.stopPrank();

        // Try to swap with unrealistic minAmountOut
        vm.startPrank(user2);
        token0.unwrap(SWAP_AMOUNT);
        IERC20(address(token0)).approve(address(fheatherX), SWAP_AMOUNT);

        vm.expectRevert("Slippage exceeded");
        fheatherX.swap(true, SWAP_AMOUNT, type(uint256).max);

        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          WITHDRAW TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testWithdraw() public {
        // First deposit
        vm.startPrank(user1);
        InEuint128 memory depositAmount = _createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        fheatherX.deposit(TEST_TICK, depositAmount, FheatherXv3.BucketSide.SELL, block.timestamp + 1 hours, 100);

        // Withdraw half
        InEuint128 memory withdrawAmount = _createInEuint128(uint128(DEPOSIT_AMOUNT / 2), user1);
        euint128 withdrawn = fheatherX.withdraw(TEST_TICK, FheatherXv3.BucketSide.SELL, withdrawAmount);

        assertHashValue(withdrawn, uint128(DEPOSIT_AMOUNT / 2));

        // Verify bucket liquidity decreased
        (, euint128 liquidity, , , ) = fheatherX.getBucket(TEST_TICK, FheatherXv3.BucketSide.SELL);
        assertHashValue(liquidity, uint128(DEPOSIT_AMOUNT / 2));

        vm.stopPrank();
    }

    function testWithdrawRevertsInvalidTick() public {
        vm.startPrank(user1);

        InEuint128 memory amount = _createInEuint128(uint128(DEPOSIT_AMOUNT), user1);

        vm.expectRevert("Invalid tick");
        fheatherX.withdraw(61, FheatherXv3.BucketSide.SELL, amount); // Invalid tick spacing

        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          EXIT TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testExit() public {
        // First deposit
        vm.startPrank(user1);
        InEuint128 memory depositAmount = _createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        fheatherX.deposit(TEST_TICK, depositAmount, FheatherXv3.BucketSide.SELL, block.timestamp + 1 hours, 100);

        // Exit entire position
        (euint128 unfilled, euint128 proceeds) = fheatherX.exit(TEST_TICK, FheatherXv3.BucketSide.SELL);

        // Should return all unfilled (no swaps happened)
        assertHashValue(unfilled, uint128(DEPOSIT_AMOUNT));
        // Proceeds should be zero (no fills)
        assertHashValue(proceeds, uint128(0));

        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          ADMIN TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testSetMaxBucketsPerSwap() public {
        vm.startPrank(owner);

        fheatherX.setMaxBucketsPerSwap(10);
        assertEq(fheatherX.maxBucketsPerSwap(), 10);

        vm.stopPrank();
    }

    function testSetMaxBucketsPerSwapRevertsInvalidRange() public {
        vm.startPrank(owner);

        vm.expectRevert("Invalid range");
        fheatherX.setMaxBucketsPerSwap(0);

        vm.expectRevert("Invalid range");
        fheatherX.setMaxBucketsPerSwap(21);

        vm.stopPrank();
    }

    function testQueueAndApplyProtocolFee() public {
        vm.startPrank(owner);

        // Queue new fee
        fheatherX.queueProtocolFee(10);
        assertEq(fheatherX.pendingFeeBps(), 10);
        assertGt(fheatherX.feeChangeTimestamp(), block.timestamp);

        // Try to apply before timelock
        vm.expectRevert("Too early");
        fheatherX.applyProtocolFee();

        // Warp time past timelock
        vm.warp(block.timestamp + 2 days + 1);

        // Apply fee
        fheatherX.applyProtocolFee();
        assertEq(fheatherX.protocolFeeBps(), 10);

        vm.stopPrank();
    }

    function testQueueProtocolFeeRevertsFeeTooHigh() public {
        vm.startPrank(owner);

        vm.expectRevert("Fee too high");
        fheatherX.queueProtocolFee(101); // > 1%

        vm.stopPrank();
    }

    function testSetFeeCollector() public {
        vm.startPrank(owner);

        address newCollector = makeAddr("newCollector");
        fheatherX.setFeeCollector(newCollector);
        assertEq(fheatherX.feeCollector(), newCollector);

        vm.stopPrank();
    }

    function testPauseUnpause() public {
        vm.startPrank(owner);

        fheatherX.pause();

        // Try to deposit while paused
        vm.stopPrank();
        vm.startPrank(user1);

        InEuint128 memory amount = _createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        vm.expectRevert(); // EnforcedPause
        fheatherX.deposit(TEST_TICK, amount, FheatherXv3.BucketSide.SELL, block.timestamp + 1 hours, 100);

        vm.stopPrank();
        vm.startPrank(owner);

        fheatherX.unpause();

        vm.stopPrank();
        vm.startPrank(user1);

        // Should work now
        fheatherX.deposit(TEST_TICK, amount, FheatherXv3.BucketSide.SELL, block.timestamp + 1 hours, 100);

        vm.stopPrank();
    }

    function testSeedBuckets() public {
        int24[] memory ticks = new int24[](3);
        ticks[0] = 0;
        ticks[1] = 60;
        ticks[2] = -60;

        vm.startPrank(owner);
        fheatherX.seedBuckets(ticks);
        vm.stopPrank();

        // Verify buckets are initialized
        (, , , , bool init0Buy) = fheatherX.getBucket(0, FheatherXv3.BucketSide.BUY);
        (, , , , bool init0Sell) = fheatherX.getBucket(0, FheatherXv3.BucketSide.SELL);
        (, , , , bool init60Buy) = fheatherX.getBucket(60, FheatherXv3.BucketSide.BUY);

        assertTrue(init0Buy);
        assertTrue(init0Sell);
        assertTrue(init60Buy);
    }

    function testSeedBucketsRevertsInvalidTick() public {
        int24[] memory ticks = new int24[](1);
        ticks[0] = 61; // Invalid spacing

        vm.startPrank(owner);
        vm.expectRevert("Invalid tick");
        fheatherX.seedBuckets(ticks);
        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          VIEW FUNCTION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function testGetPosition() public {
        // Deposit first
        vm.startPrank(user1);
        InEuint128 memory amount = _createInEuint128(uint128(DEPOSIT_AMOUNT), user1);
        fheatherX.deposit(TEST_TICK, amount, FheatherXv3.BucketSide.SELL, block.timestamp + 1 hours, 100);
        vm.stopPrank();

        // Get position
        (euint128 shares, euint128 proceedsSnapshot, euint128 filledSnapshot, euint128 realized) =
            fheatherX.getPosition(user1, TEST_TICK, FheatherXv3.BucketSide.SELL);

        assertHashValue(shares, uint128(DEPOSIT_AMOUNT));
    }

    function testGetTickPrices() public view {
        int24[] memory ticks = new int24[](3);
        ticks[0] = 0;
        ticks[1] = 60;
        ticks[2] = -60;

        uint256[] memory prices = fheatherX.getTickPrices(ticks);

        assertEq(prices[0], 1e18);
        assertEq(prices[1], 1006017120990792834);
        assertEq(prices[2], 994017962903844986);
    }

}
