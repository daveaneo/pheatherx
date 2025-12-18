// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {VaultRouter} from "../src/VaultRouter.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {CoFheTest} from "@fhenixprotocol/cofhe-mock-contracts/CoFheTest.sol";
import {FHE, euint128, ebool, InEuint128, InEbool, Common} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @dev Simple mock ERC20 for testing
contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(string memory name, string memory symbol, uint8 dec) ERC20(name, symbol) {
        _decimals = dec;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Mock FHERC20 for testing
contract MockFHERC20 is ERC20 {
    mapping(address => euint128) internal _encBalances;

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function mintEncrypted(address to, uint256 amount) external {
        euint128 encAmount = FHE.asEuint128(uint128(amount));
        if (Common.isInitialized(_encBalances[to])) {
            _encBalances[to] = FHE.add(_encBalances[to], encAmount);
        } else {
            _encBalances[to] = encAmount;
        }
        FHE.allowThis(_encBalances[to]);
        FHE.allow(_encBalances[to], to);
    }

    function balanceOfEncrypted(address account) external view returns (euint128) {
        return _encBalances[account];
    }

    function hasEncryptedBalance(address account) external view returns (bool) {
        return Common.isInitialized(_encBalances[account]);
    }
}

/// @dev Mock PoolManager for testing
contract MockPoolManager {
    // Just returns empty data for unlock
    function unlock(bytes calldata) external pure returns (bytes memory) {
        return "";
    }
}

contract VaultRouterTest is Test, CoFheTest {
    VaultRouter public router;
    MockPoolManager public poolManager;
    MockERC20 public weth;
    MockERC20 public usdc;
    MockFHERC20 public fheWeth;
    MockFHERC20 public fheUsdc;

    address public owner;
    address public user1;
    address public user2;

    uint256 internal constant CLAIM_ID_OFFSET = 1 << 160;

    function setUp() public {
        owner = address(this);
        user1 = address(0x1001);
        user2 = address(0x1002);

        // Deploy mock pool manager
        poolManager = new MockPoolManager();

        // Deploy router
        router = new VaultRouter(IPoolManager(address(poolManager)));

        // Deploy mock tokens
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        fheWeth = new MockFHERC20("FHE WETH", "fheWETH");
        fheUsdc = new MockFHERC20("FHE USDC", "fheUSDC");

        // Mint tokens to users
        weth.mint(user1, 100 ether);
        usdc.mint(user1, 100_000 * 1e6);
        weth.mint(user2, 100 ether);
        usdc.mint(user2, 100_000 * 1e6);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ADMIN TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_constructor() public view {
        assertEq(router.owner(), owner);
        assertEq(address(router.poolManager()), address(poolManager));
        assertEq(router.nextClaimId(), CLAIM_ID_OFFSET);
    }

    function test_transferOwnership_TwoStep_Success() public {
        // Step 1: Initiate transfer
        router.transferOwnership(user1);

        // Owner should still be the original
        assertEq(router.owner(), address(this));
        assertEq(router.pendingOwner(), user1);

        // Step 2: Accept ownership as new owner
        vm.prank(user1);
        router.acceptOwnership();

        assertEq(router.owner(), user1);
        assertEq(router.pendingOwner(), address(0));
    }

    function test_acceptOwnership_Unauthorized_Reverts() public {
        router.transferOwnership(user1);

        // Try to accept as wrong user
        vm.prank(user2);
        vm.expectRevert(VaultRouter.Unauthorized.selector);
        router.acceptOwnership();
    }

    function test_transferOwnership_ZeroAddress_Reverts() public {
        vm.expectRevert(VaultRouter.ZeroAddress.selector);
        router.transferOwnership(address(0));
    }

    function test_transferOwnership_Unauthorized_Reverts() public {
        vm.prank(user1);
        vm.expectRevert(VaultRouter.Unauthorized.selector);
        router.transferOwnership(user2);
    }

    function test_cancelOwnershipTransfer() public {
        router.transferOwnership(user1);
        assertEq(router.pendingOwner(), user1);

        router.cancelOwnershipTransfer();
        assertEq(router.pendingOwner(), address(0));
    }

    function test_registerTokenPair_Success() public {
        router.registerTokenPair(address(weth), address(fheWeth));

        assertEq(router.erc20ToFherc20(address(weth)), address(fheWeth));
        assertEq(router.fherc20ToErc20(address(fheWeth)), address(weth));
        assertTrue(router.isTokenPairRegistered(address(weth), address(fheWeth)));
    }

    function test_registerTokenPair_ZeroAddress_Reverts() public {
        vm.expectRevert(VaultRouter.ZeroAddress.selector);
        router.registerTokenPair(address(0), address(fheWeth));

        vm.expectRevert(VaultRouter.ZeroAddress.selector);
        router.registerTokenPair(address(weth), address(0));
    }

    function test_registerTokenPair_Unauthorized_Reverts() public {
        vm.prank(user1);
        vm.expectRevert(VaultRouter.Unauthorized.selector);
        router.registerTokenPair(address(weth), address(fheWeth));
    }

    function test_registerTokenPairs_Batch() public {
        address[] memory erc20s = new address[](2);
        address[] memory fherc20s = new address[](2);

        erc20s[0] = address(weth);
        erc20s[1] = address(usdc);
        fherc20s[0] = address(fheWeth);
        fherc20s[1] = address(fheUsdc);

        router.registerTokenPairs(erc20s, fherc20s);

        assertTrue(router.isTokenPairRegistered(address(weth), address(fheWeth)));
        assertTrue(router.isTokenPairRegistered(address(usdc), address(fheUsdc)));
    }

    function test_registerTokenPairs_MismatchedArrays_Reverts() public {
        address[] memory erc20s = new address[](2);
        address[] memory fherc20s = new address[](1);

        erc20s[0] = address(weth);
        erc20s[1] = address(usdc);
        fherc20s[0] = address(fheWeth);

        vm.expectRevert(VaultRouter.InvalidTokenPair.selector);
        router.registerTokenPairs(erc20s, fherc20s);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         VIEW FUNCTION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_getFherc20() public {
        router.registerTokenPair(address(weth), address(fheWeth));
        assertEq(router.getFherc20(address(weth)), address(fheWeth));
        assertEq(router.getFherc20(address(usdc)), address(0)); // Not registered
    }

    function test_getErc20() public {
        router.registerTokenPair(address(weth), address(fheWeth));
        assertEq(router.getErc20(address(fheWeth)), address(weth));
        assertEq(router.getErc20(address(fheUsdc)), address(0)); // Not registered
    }

    function test_isTokenPairRegistered_False() public view {
        assertFalse(router.isTokenPairRegistered(address(weth), address(fheWeth)));
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         CLAIM TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_getClaim_NotFound() public view {
        (address recipient, address erc20Token, uint256 requestedAt, bool fulfilled) =
            router.getClaim(CLAIM_ID_OFFSET);

        assertEq(recipient, address(0));
        assertEq(erc20Token, address(0));
        assertEq(requestedAt, 0);
        assertFalse(fulfilled);
    }

    function test_isClaimReady_NotFound() public view {
        (bool ready, uint256 amount) = router.isClaimReady(CLAIM_ID_OFFSET);
        assertFalse(ready);
        assertEq(amount, 0);
    }

    function test_fulfillClaim_InvalidClaimId_Reverts() public {
        // Claim ID below offset
        vm.expectRevert(VaultRouter.InvalidClaimId.selector);
        router.fulfillClaim(0);

        vm.expectRevert(VaultRouter.InvalidClaimId.selector);
        router.fulfillClaim(CLAIM_ID_OFFSET - 1);
    }

    function test_fulfillClaim_NotFound_Reverts() public {
        vm.expectRevert(VaultRouter.ClaimNotFound.selector);
        router.fulfillClaim(CLAIM_ID_OFFSET);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         INPUT VALIDATION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_swapErc20ToFherc20_ZeroAmount_Reverts() public {
        router.registerTokenPair(address(weth), address(fheWeth));

        PoolKey memory key = _createPoolKey(address(fheWeth), address(fheUsdc));
        InEbool memory encDirection = _createInEbool(true);
        InEuint128 memory encMinOutput = _createInEuint128(0);

        vm.prank(user1);
        vm.expectRevert(VaultRouter.ZeroAmount.selector);
        router.swapErc20ToFherc20(key, address(weth), 0, encDirection, encMinOutput);
    }

    function test_swapErc20ToFherc20_TokenNotRegistered_Reverts() public {
        // Don't register token pair

        PoolKey memory key = _createPoolKey(address(fheWeth), address(fheUsdc));
        InEbool memory encDirection = _createInEbool(true);
        InEuint128 memory encMinOutput = _createInEuint128(0);

        vm.prank(user1);
        vm.expectRevert(VaultRouter.TokenPairNotRegistered.selector);
        router.swapErc20ToFherc20(key, address(weth), 1 ether, encDirection, encMinOutput);
    }

    function test_swapErc20ToFherc20_InvalidPoolToken_Reverts() public {
        router.registerTokenPair(address(weth), address(fheWeth));
        router.registerTokenPair(address(usdc), address(fheUsdc));

        // Pool doesn't contain fheWeth
        PoolKey memory key = _createPoolKey(address(fheUsdc), address(fheUsdc));
        InEbool memory encDirection = _createInEbool(true);
        InEuint128 memory encMinOutput = _createInEuint128(0);

        vm.prank(user1);
        weth.approve(address(router), 1 ether);

        vm.prank(user1);
        vm.expectRevert(VaultRouter.InvalidTokenPair.selector);
        router.swapErc20ToFherc20(key, address(weth), 1 ether, encDirection, encMinOutput);
    }

    function test_swapErc20ToErc20_ZeroAmount_Reverts() public {
        router.registerTokenPair(address(weth), address(fheWeth));

        PoolKey memory key = _createPoolKey(address(fheWeth), address(fheUsdc));
        InEbool memory encDirection = _createInEbool(true);
        InEuint128 memory encMinOutput = _createInEuint128(0);

        vm.prank(user1);
        vm.expectRevert(VaultRouter.ZeroAmount.selector);
        router.swapErc20ToErc20(key, address(weth), 0, encDirection, encMinOutput);
    }

    function test_swapErc20ToErc20_TokenNotRegistered_Reverts() public {
        PoolKey memory key = _createPoolKey(address(fheWeth), address(fheUsdc));
        InEbool memory encDirection = _createInEbool(true);
        InEuint128 memory encMinOutput = _createInEuint128(0);

        vm.prank(user1);
        vm.expectRevert(VaultRouter.TokenPairNotRegistered.selector);
        router.swapErc20ToErc20(key, address(weth), 1 ether, encDirection, encMinOutput);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function _createPoolKey(address token0, address token1) internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
    }

    function _createInEuint128(uint128 value) internal pure returns (InEuint128 memory) {
        return InEuint128({
            ctHash: uint256(value),
            securityZone: 0,
            utype: 7, // euint128 type
            signature: ""
        });
    }

    function _createInEbool(bool value) internal pure returns (InEbool memory) {
        return InEbool({
            ctHash: value ? 1 : 0,
            securityZone: 0,
            utype: 0, // ebool type
            signature: ""
        });
    }
}
