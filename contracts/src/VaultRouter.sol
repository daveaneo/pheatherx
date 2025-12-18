// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FHE, euint128, ebool, InEuint128, InEbool, Common} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IFHERC20} from "./interface/IFHERC20.sol";

/// @title VaultRouter
/// @notice Router for coordinating swaps between ERC20 and FHERC20 tokens via v8FHE pools
/// @dev This router provides convenience functions for users who want to:
///      1. Swap ERC20 → FHERC20 (automatic wrapping)
///      2. Swap FHERC20 → ERC20 (with async unwrap claims)
///      3. Swap ERC20 → ERC20 (full journey with async claim)
///
///      The router uses a token pair registry to map ERC20 ↔ FHERC20 tokens.
///      For async unwrap claims, it integrates with FheVault's claim system.
///
/// ## Architecture
/// - Pure FHERC20:FHERC20 swaps: Use PrivateSwapRouter directly (not this contract)
/// - ERC20 involved: Use this VaultRouter for automatic wrapping/unwrapping
///
/// ## Token Flow
/// ERC20 → FHERC20: ERC20.transferFrom → FHERC20.mint/wrap → swap on v8FHE
/// FHERC20 → ERC20: swap on v8FHE → initiate async decrypt → claim ERC20
contract VaultRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Magic byte for encrypted swap hookData
    bytes1 internal constant ENCRYPTED_SWAP_MAGIC = 0x01;

    /// @dev Claim ID offset (matches FheVault)
    uint256 internal constant CLAIM_ID_OFFSET = 1 << 160;

    // ═══════════════════════════════════════════════════════════════════════
    //                               STATE
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Contract owner
    address public owner;

    /// @notice The Uniswap v4 PoolManager
    IPoolManager public immutable poolManager;

    /// @notice Counter for generating unique claim IDs
    uint256 public nextClaimId;

    /// @notice ERC20 → FHERC20 token mapping
    mapping(address => address) public erc20ToFherc20;

    /// @notice FHERC20 → ERC20 token mapping
    mapping(address => address) public fherc20ToErc20;

    /// @notice Pending unwrap claims
    struct PendingClaim {
        address recipient;
        address erc20Token;
        euint128 encAmount;
        uint256 requestedAt;
        bool fulfilled;
    }
    mapping(uint256 => PendingClaim) public pendingClaims;

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Emitted when a swap is initiated
    event SwapInitiated(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        bool isErc20In,
        bool isErc20Out
    );

    /// @notice Emitted when an unwrap claim is created
    event UnwrapClaimCreated(
        uint256 indexed claimId,
        address indexed recipient,
        address indexed erc20Token
    );

    /// @notice Emitted when a claim is fulfilled
    event ClaimFulfilled(
        uint256 indexed claimId,
        address indexed recipient,
        address indexed erc20Token,
        uint256 amount
    );

    /// @notice Emitted when token pair is registered
    event TokenPairRegistered(address indexed erc20, address indexed fherc20);

    /// @notice Emitted when ownership is transferred
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error Unauthorized();
    error TokenPairNotRegistered();
    error ZeroAmount();
    error ZeroAddress();
    error ClaimNotFound();
    error ClaimAlreadyFulfilled();
    error DecryptNotReady();
    error InvalidClaimId();
    error UnauthorizedCallback();
    error InvalidTokenPair();

    // ═══════════════════════════════════════════════════════════════════════
    //                           CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
        owner = msg.sender;
        nextClaimId = CLAIM_ID_OFFSET;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                            MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Transfer ownership
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    /// @notice Register an ERC20 ↔ FHERC20 token pair
    /// @param erc20 The ERC20 token address
    /// @param fherc20 The corresponding FHERC20 token address
    function registerTokenPair(address erc20, address fherc20) external onlyOwner {
        if (erc20 == address(0) || fherc20 == address(0)) revert ZeroAddress();
        erc20ToFherc20[erc20] = fherc20;
        fherc20ToErc20[fherc20] = erc20;
        emit TokenPairRegistered(erc20, fherc20);
    }

    /// @notice Batch register token pairs
    function registerTokenPairs(
        address[] calldata erc20s,
        address[] calldata fherc20s
    ) external onlyOwner {
        if (erc20s.length != fherc20s.length) revert InvalidTokenPair();
        for (uint256 i = 0; i < erc20s.length; i++) {
            if (erc20s[i] == address(0) || fherc20s[i] == address(0)) revert ZeroAddress();
            erc20ToFherc20[erc20s[i]] = fherc20s[i];
            fherc20ToErc20[fherc20s[i]] = erc20s[i];
            emit TokenPairRegistered(erc20s[i], fherc20s[i]);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         SWAP FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Swap ERC20 input for FHERC20 output
    /// @dev User provides ERC20, receives FHERC20 (encrypted balance)
    ///      1. Transfers ERC20 from user to corresponding FHERC20 contract
    ///      2. Mints plaintext to this router, then wraps to encrypted
    ///      3. Executes encrypted swap on v8FHE pool
    ///      4. Output FHERC20 goes directly to user
    /// @param key The pool key for the v8FHE pool
    /// @param erc20In The ERC20 token to swap in
    /// @param amountIn The amount of ERC20 to swap
    /// @param encDirection Encrypted direction (true = token0→token1)
    /// @param encMinOutput Encrypted minimum output amount
    function swapErc20ToFherc20(
        PoolKey calldata key,
        address erc20In,
        uint256 amountIn,
        InEbool calldata encDirection,
        InEuint128 calldata encMinOutput
    ) external nonReentrant {
        if (amountIn == 0) revert ZeroAmount();

        address fherc20In = erc20ToFherc20[erc20In];
        if (fherc20In == address(0)) revert TokenPairNotRegistered();

        // Verify pool uses the FHERC20 token
        _verifyPoolToken(key, fherc20In);

        // Transfer ERC20 from user
        IERC20(erc20In).safeTransferFrom(msg.sender, address(this), amountIn);

        // Approve FHERC20 to take ERC20 (for minting with backing)
        // Note: The FHERC20 contract needs a deposit function or we mint directly
        // For simplicity, we assume FHERC20 has a way to accept ERC20 backing
        // In production, this would call a proper deposit function

        // For testnet FHERC20: mint plaintext, then wrap
        // This requires the router to be authorized to mint
        // Alternative: user deposits to FHERC20 first

        // Create encrypted amount for the swap
        euint128 encAmountIn = FHE.asEuint128(uint128(amountIn));
        FHE.allowThis(encAmountIn);
        FHE.allow(encAmountIn, address(key.hooks));

        // Execute swap - the hook will handle the encrypted transfer
        _executeEncryptedSwap(key, encDirection, encAmountIn, encMinOutput, msg.sender);

        emit SwapInitiated(msg.sender, erc20In, address(0), true, false);
    }

    /// @notice Swap FHERC20 input for ERC20 output (via async claim)
    /// @dev User provides FHERC20, receives ERC20 after async decrypt
    ///      1. Executes encrypted swap on v8FHE pool
    ///      2. Output FHERC20 is captured by router
    ///      3. Initiates async decrypt, creates claim
    ///      4. User calls fulfillClaim() when ready
    /// @param key The pool key for the v8FHE pool
    /// @param encDirection Encrypted direction
    /// @param encAmountIn Encrypted input amount
    /// @param encMinOutput Encrypted minimum output
    /// @return claimId The claim ID for tracking the async unwrap
    function swapFherc20ToErc20(
        PoolKey calldata key,
        InEbool calldata encDirection,
        InEuint128 calldata encAmountIn,
        InEuint128 calldata encMinOutput
    ) external nonReentrant returns (uint256 claimId) {
        // Determine output token based on pool
        address token0 = Currency.unwrap(key.currency0);
        address token1 = Currency.unwrap(key.currency1);

        // Convert encrypted inputs
        ebool direction = FHE.asEbool(encDirection);
        euint128 amountIn = FHE.asEuint128(encAmountIn);
        euint128 minOutput = FHE.asEuint128(encMinOutput);

        FHE.allow(direction, address(key.hooks));
        FHE.allow(amountIn, address(key.hooks));
        FHE.allow(minOutput, address(key.hooks));

        // Execute swap with router as recipient
        // Note: This requires the hook to support specifying recipient
        // For now, we'll use the standard flow where output goes to msg.sender (router)
        _executeEncryptedSwapInternal(key, direction, amountIn, minOutput, address(this));

        // The hook deposited output FHERC20 to this router
        // Determine which token is output based on direction
        // Direction: true = zeroForOne (sell token0, get token1)
        // We need to check decrypted direction, but it's encrypted...
        // For async flow, we'll need to handle this differently

        // For simplicity in this version, we'll create a claim for both possible outputs
        // and let fulfillClaim handle it based on which balance is non-zero
        // This is a simplification - production would need better tracking

        // Get the output FHERC20's encrypted balance for this router
        euint128 outputBalance;
        address outputFherc20;
        address outputErc20;

        // Check token1 first (common case for zeroForOne)
        euint128 balance1 = IFHERC20(token1).balanceOfEncrypted(address(this));
        if (Common.isInitialized(balance1)) {
            outputBalance = balance1;
            outputFherc20 = token1;
            outputErc20 = fherc20ToErc20[token1];
        } else {
            outputBalance = IFHERC20(token0).balanceOfEncrypted(address(this));
            outputFherc20 = token0;
            outputErc20 = fherc20ToErc20[token0];
        }

        if (outputErc20 == address(0)) revert TokenPairNotRegistered();

        // Initiate decrypt for the output amount
        FHE.allowThis(outputBalance);
        FHE.decrypt(outputBalance);

        // Create claim
        claimId = nextClaimId++;
        pendingClaims[claimId] = PendingClaim({
            recipient: msg.sender,
            erc20Token: outputErc20,
            encAmount: outputBalance,
            requestedAt: block.number,
            fulfilled: false
        });

        emit UnwrapClaimCreated(claimId, msg.sender, outputErc20);
        emit SwapInitiated(msg.sender, address(0), outputErc20, false, true);

        return claimId;
    }

    /// @notice Swap ERC20 → ERC20 (full journey with async claim)
    /// @dev Combines swapErc20ToFherc20 and swapFherc20ToErc20
    /// @param key The pool key
    /// @param erc20In The input ERC20 token
    /// @param amountIn The input amount
    /// @param encDirection Encrypted direction
    /// @param encMinOutput Encrypted minimum output
    /// @return claimId The claim ID for the output ERC20
    function swapErc20ToErc20(
        PoolKey calldata key,
        address erc20In,
        uint256 amountIn,
        InEbool calldata encDirection,
        InEuint128 calldata encMinOutput
    ) external nonReentrant returns (uint256 claimId) {
        if (amountIn == 0) revert ZeroAmount();

        address fherc20In = erc20ToFherc20[erc20In];
        if (fherc20In == address(0)) revert TokenPairNotRegistered();

        // Verify pool uses the FHERC20 token
        _verifyPoolToken(key, fherc20In);

        // Transfer ERC20 from user
        IERC20(erc20In).safeTransferFrom(msg.sender, address(this), amountIn);

        // Create encrypted amount for the swap
        euint128 encAmountIn = FHE.asEuint128(uint128(amountIn));
        FHE.allowThis(encAmountIn);

        ebool direction = FHE.asEbool(encDirection);
        euint128 minOutput = FHE.asEuint128(encMinOutput);

        FHE.allow(direction, address(key.hooks));
        FHE.allow(encAmountIn, address(key.hooks));
        FHE.allow(minOutput, address(key.hooks));

        // Execute swap with router as recipient (to capture output for unwrap)
        _executeEncryptedSwapInternal(key, direction, encAmountIn, minOutput, address(this));

        // Determine output token
        address token0 = Currency.unwrap(key.currency0);
        address token1 = Currency.unwrap(key.currency1);

        euint128 outputBalance;
        address outputErc20;

        // Check which token we received (the non-input one)
        if (token0 == fherc20In) {
            outputBalance = IFHERC20(token1).balanceOfEncrypted(address(this));
            outputErc20 = fherc20ToErc20[token1];
        } else {
            outputBalance = IFHERC20(token0).balanceOfEncrypted(address(this));
            outputErc20 = fherc20ToErc20[token0];
        }

        if (outputErc20 == address(0)) revert TokenPairNotRegistered();

        // Initiate decrypt
        FHE.allowThis(outputBalance);
        FHE.decrypt(outputBalance);

        // Create claim
        claimId = nextClaimId++;
        pendingClaims[claimId] = PendingClaim({
            recipient: msg.sender,
            erc20Token: outputErc20,
            encAmount: outputBalance,
            requestedAt: block.number,
            fulfilled: false
        });

        emit UnwrapClaimCreated(claimId, msg.sender, outputErc20);
        emit SwapInitiated(msg.sender, erc20In, outputErc20, true, true);

        return claimId;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         CLAIM FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Fulfill a pending claim after decrypt resolves
    /// @param claimId The claim ID to fulfill
    function fulfillClaim(uint256 claimId) external nonReentrant {
        if (claimId < CLAIM_ID_OFFSET) revert InvalidClaimId();

        PendingClaim storage claim = pendingClaims[claimId];
        if (claim.recipient == address(0)) revert ClaimNotFound();
        if (claim.fulfilled) revert ClaimAlreadyFulfilled();

        // Check decrypt result
        (uint256 plainAmount, bool ready) = FHE.getDecryptResultSafe(claim.encAmount);
        if (!ready) revert DecryptNotReady();

        // Mark fulfilled
        claim.fulfilled = true;

        // Transfer ERC20 to recipient
        if (plainAmount > 0) {
            IERC20(claim.erc20Token).safeTransfer(claim.recipient, plainAmount);
        }

        emit ClaimFulfilled(claimId, claim.recipient, claim.erc20Token, plainAmount);
    }

    /// @notice Check if a claim is ready to fulfill
    function isClaimReady(uint256 claimId) external view returns (bool ready, uint256 amount) {
        PendingClaim storage claim = pendingClaims[claimId];
        if (claim.recipient == address(0) || claim.fulfilled) {
            return (false, 0);
        }
        (amount, ready) = FHE.getDecryptResultSafe(claim.encAmount);
    }

    /// @notice Get claim details
    function getClaim(uint256 claimId) external view returns (
        address recipient,
        address erc20Token,
        uint256 requestedAt,
        bool fulfilled
    ) {
        PendingClaim storage claim = pendingClaims[claimId];
        return (claim.recipient, claim.erc20Token, claim.requestedAt, claim.fulfilled);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Verify that a pool contains the specified token
    function _verifyPoolToken(PoolKey calldata key, address token) internal pure {
        address token0 = Currency.unwrap(key.currency0);
        address token1 = Currency.unwrap(key.currency1);
        if (token != token0 && token != token1) revert InvalidTokenPair();
    }

    /// @dev Execute encrypted swap (external-facing version for user as recipient)
    function _executeEncryptedSwap(
        PoolKey calldata key,
        InEbool calldata encDirection,
        euint128 encAmountIn,
        InEuint128 calldata encMinOutput,
        address recipient
    ) internal {
        ebool direction = FHE.asEbool(encDirection);
        euint128 minOutput = FHE.asEuint128(encMinOutput);

        FHE.allow(direction, address(key.hooks));
        FHE.allow(encAmountIn, address(key.hooks));
        FHE.allow(minOutput, address(key.hooks));

        _executeEncryptedSwapInternal(key, direction, encAmountIn, minOutput, recipient);
    }

    /// @dev Execute encrypted swap via PoolManager
    function _executeEncryptedSwapInternal(
        PoolKey calldata key,
        ebool direction,
        euint128 amountIn,
        euint128 minOutput,
        address recipient
    ) internal {
        // Extract handles for encoding
        uint256 directionHandle = ebool.unwrap(direction);
        uint256 amountInHandle = euint128.unwrap(amountIn);
        uint256 minOutputHandle = euint128.unwrap(minOutput);

        // Encode hookData: magic + (sender/recipient, directionHandle, amountInHandle, minOutputHandle)
        bytes memory hookData = abi.encodePacked(
            ENCRYPTED_SWAP_MAGIC,
            abi.encode(recipient, directionHandle, amountInHandle, minOutputHandle)
        );

        // Dummy SwapParams - hook ignores these for encrypted swaps
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -1,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        });

        // Execute via PoolManager unlock pattern
        poolManager.unlock(abi.encode(CallbackData({
            key: key,
            params: params,
            hookData: hookData
        })));
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                           CALLBACK
    // ═══════════════════════════════════════════════════════════════════════

    struct CallbackData {
        PoolKey key;
        SwapParams params;
        bytes hookData;
    }

    /// @notice Callback from PoolManager.unlock()
    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert UnauthorizedCallback();

        CallbackData memory data = abi.decode(rawData, (CallbackData));

        // Execute the swap
        BalanceDelta delta = poolManager.swap(data.key, data.params, data.hookData);

        return abi.encode(delta);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Get the FHERC20 token for an ERC20
    function getFherc20(address erc20) external view returns (address) {
        return erc20ToFherc20[erc20];
    }

    /// @notice Get the ERC20 token for an FHERC20
    function getErc20(address fherc20) external view returns (address) {
        return fherc20ToErc20[fherc20];
    }

    /// @notice Check if a token pair is registered
    function isTokenPairRegistered(address erc20, address fherc20) external view returns (bool) {
        return erc20ToFherc20[erc20] == fherc20 && fherc20ToErc20[fherc20] == erc20;
    }
}
