// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {FHE, euint128, ebool, InEuint128, Common} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IERC6909Claims} from "@uniswap/v4-core/src/interfaces/external/IERC6909Claims.sol";

/// @title FheVault
/// @notice ERC-6909 vault for wrapping ERC20 tokens to encrypted balances and managing async unwrap claims
/// @dev This vault serves as the bridge between plaintext ERC20 and the FHE ecosystem.
///      - Wrap: ERC20 → encrypted balance in vault (instant)
///      - Unwrap: encrypted balance → claim token → async decrypt → ERC20 (async)
///
///      Token IDs are derived from ERC20 addresses: tokenId = uint256(uint160(erc20Address))
///      Claim IDs are unique per unwrap request for tracking async decrypts.
///
/// ## Accounting Model
/// This vault uses 1:1 accounting (deposit X tokens → get X encrypted balance).
/// This is simpler and more gas efficient than share-based accounting.
///
/// ## IMPORTANT: Supported Token Types
/// ONLY standard ERC20 tokens are supported:
/// ✓ WETH, USDC, USDT, DAI, etc.
///
/// NOT SUPPORTED (will cause accounting errors):
/// ✗ Rebasing tokens (stETH, aTokens) - balance changes over time
/// ✗ Reflection tokens (SafeMoon-style) - fees redistributed to holders
/// ✗ Fee-on-transfer tokens - detected and rejected during wrap
contract FheVault is IERC6909Claims, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Claim token IDs start at this offset to avoid collision with token IDs
    uint256 internal constant CLAIM_ID_OFFSET = 1 << 160;

    // ═══════════════════════════════════════════════════════════════════════
    //                               STORAGE
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Contract owner
    address public owner;

    /// @notice Pending owner for two-step transfer
    address public pendingOwner;

    /// @notice Counter for generating unique claim IDs
    uint256 public nextClaimId;

    /// @notice Encrypted balances: tokenId => user => encrypted balance
    mapping(uint256 => mapping(address => euint128)) public encryptedBalances;

    /// @notice ERC-6909 claim token balances: user => claimId => balance (0 or 1)
    mapping(address => mapping(uint256 => uint256)) public balanceOf;

    /// @notice ERC-6909 allowances: owner => spender => id => amount
    mapping(address => mapping(address => mapping(uint256 => uint256))) public allowance;

    /// @notice ERC-6909 operator approvals: owner => operator => approved
    mapping(address => mapping(address => bool)) public isOperator;

    /// @notice Pending unwrap claims awaiting decrypt
    struct PendingClaim {
        address recipient;
        address erc20Token;
        euint128 encAmount;
        uint256 requestedAt;
        bool fulfilled;
    }
    mapping(uint256 => PendingClaim) public pendingClaims;

    /// @notice Supported ERC20 tokens (must be registered before wrapping)
    mapping(address => bool) public supportedTokens;

    /// @notice Pre-computed encrypted zero for comparisons
    euint128 internal ENC_ZERO;

    // ═══════════════════════════════════════════════════════════════════════
    //                               EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Emitted when ERC20 is wrapped to encrypted balance
    event Wrapped(address indexed user, address indexed token, uint256 amount);

    /// @notice Emitted when unwrap is requested (claim issued)
    event UnwrapRequested(address indexed user, address indexed token, uint256 indexed claimId);

    /// @notice Emitted when claim is fulfilled (ERC20 transferred)
    event ClaimFulfilled(uint256 indexed claimId, address indexed recipient, address indexed token, uint256 amount);

    /// @notice Emitted when a token is added/removed from supported list
    event TokenSupportUpdated(address indexed token, bool supported);

    /// @notice Emitted when ownership is transferred
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /// @notice Emitted when wrapEncrypted has excess tokens (user paid more than encrypted amount)
    event WrapExcess(address indexed user, address indexed token, uint256 maxProvided, uint256 actualWrapped);

    /// @notice Emitted when pending ownership transfer is initiated
    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner);

    // ERC-6909 events inherited from IERC6909Claims

    // ═══════════════════════════════════════════════════════════════════════
    //                               ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error Unauthorized();
    error TokenNotSupported();
    error ZeroAmount();
    error ClaimNotFound();
    error ClaimAlreadyFulfilled();
    error DecryptNotReady();
    error InsufficientBalance();
    error InvalidClaimId();
    error ZeroAddress();
    error AmountTooLarge();
    error FeeOnTransferToken();
    error InsufficientVaultBalance();

    // ═══════════════════════════════════════════════════════════════════════
    //                            CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor() {
        owner = msg.sender;
        nextClaimId = CLAIM_ID_OFFSET; // Start claim IDs above token ID space

        // Initialize encrypted zero
        ENC_ZERO = FHE.asEuint128(0);
        FHE.allowThis(ENC_ZERO);
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

    /// @notice Initiate ownership transfer (two-step pattern)
    /// @dev New owner must call acceptOwnership() to complete transfer
    /// @param newOwner The new owner address
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Accept pending ownership transfer
    /// @dev Only the pending owner can call this
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, msg.sender);
    }

    /// @notice Cancel pending ownership transfer
    function cancelOwnershipTransfer() external onlyOwner {
        pendingOwner = address(0);
    }

    /// @notice Add or remove a token from the supported list
    /// @param token The ERC20 token address
    /// @param supported Whether the token should be supported
    function setTokenSupport(address token, bool supported) external onlyOwner {
        supportedTokens[token] = supported;
        emit TokenSupportUpdated(token, supported);
    }

    /// @notice Batch add tokens to supported list
    /// @param tokens Array of ERC20 token addresses
    function addSupportedTokens(address[] calldata tokens) external onlyOwner {
        for (uint256 i = 0; i < tokens.length; i++) {
            supportedTokens[tokens[i]] = true;
            emit TokenSupportUpdated(tokens[i], true);
        }
    }

    /// @notice Pause the contract
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the contract
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Rescue stuck ERC20 tokens (admin only)
    /// @dev For recovering tokens sent to contract by accident, NOT user balances.
    ///      This should only be used to recover unsupported tokens or excess from rebasing.
    /// @param token The ERC20 token to rescue
    /// @param to The recipient address
    /// @param amount The amount to transfer
    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         WRAP FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Wrap ERC20 tokens to encrypted balance
    /// @dev Transfers ERC20 from caller to vault, credits encrypted balance.
    ///      Rejects fee-on-transfer tokens by checking received amount.
    /// @param token The ERC20 token to wrap
    /// @param amount The plaintext amount to wrap
    function wrap(address token, uint256 amount) external nonReentrant whenNotPaused {
        if (!supportedTokens[token]) revert TokenNotSupported();
        if (amount == 0) revert ZeroAmount();
        if (amount > type(uint128).max) revert AmountTooLarge();

        // Get balance before transfer to detect fee-on-transfer tokens
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));

        // Transfer ERC20 to vault
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Check actual amount received (fee-on-transfer protection)
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));
        uint256 actualReceived = balanceAfter - balanceBefore;
        if (actualReceived != amount) revert FeeOnTransferToken();

        // Credit encrypted balance
        uint256 tokenId = _tokenIdFromAddress(token);
        euint128 encAmount = FHE.asEuint128(uint128(amount));
        FHE.allowThis(encAmount);

        euint128 currentBalance = encryptedBalances[tokenId][msg.sender];
        if (Common.isInitialized(currentBalance)) {
            encryptedBalances[tokenId][msg.sender] = FHE.add(currentBalance, encAmount);
        } else {
            encryptedBalances[tokenId][msg.sender] = encAmount;
        }
        FHE.allowThis(encryptedBalances[tokenId][msg.sender]);
        FHE.allow(encryptedBalances[tokenId][msg.sender], msg.sender);

        emit Wrapped(msg.sender, token, amount);
    }

    /// @notice Wrap ERC20 tokens with encrypted amount input
    /// @dev For cases where the amount should remain private from the start.
    ///      IMPORTANT: User must set maxPlaintext equal to the actual encrypted amount.
    ///      Any excess (maxPlaintext - encryptedAmount) will remain in the vault as protocol surplus.
    ///      Use wrap() with plaintext amount for simpler UX.
    ///      Emits WrapExcess event to indicate encrypted wrap occurred (actual amount is private).
    /// @param token The ERC20 token to wrap
    /// @param encryptedAmount The encrypted amount to wrap
    /// @param maxPlaintext Maximum plaintext amount (should equal encrypted amount for no loss)
    function wrapEncrypted(
        address token,
        InEuint128 calldata encryptedAmount,
        uint256 maxPlaintext
    ) external nonReentrant whenNotPaused {
        if (!supportedTokens[token]) revert TokenNotSupported();
        if (maxPlaintext == 0) revert ZeroAmount();
        if (maxPlaintext > type(uint128).max) revert AmountTooLarge();

        // Get balance before transfer to detect fee-on-transfer tokens
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));

        // Transfer max ERC20 to vault (user sets upper bound)
        IERC20(token).safeTransferFrom(msg.sender, address(this), maxPlaintext);

        // Check actual amount received (fee-on-transfer protection)
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));
        uint256 actualReceived = balanceAfter - balanceBefore;
        if (actualReceived != maxPlaintext) revert FeeOnTransferToken();

        // Convert encrypted amount
        euint128 encAmount = FHE.asEuint128(encryptedAmount);
        FHE.allowThis(encAmount);

        // Cap at maxPlaintext
        euint128 encMax = FHE.asEuint128(uint128(maxPlaintext));
        ebool exceedsMax = FHE.gt(encAmount, encMax);
        euint128 actualAmount = FHE.select(exceedsMax, encMax, encAmount);
        FHE.allowThis(actualAmount);

        // Credit encrypted balance
        uint256 tokenId = _tokenIdFromAddress(token);
        euint128 currentBalance = encryptedBalances[tokenId][msg.sender];
        if (Common.isInitialized(currentBalance)) {
            encryptedBalances[tokenId][msg.sender] = FHE.add(currentBalance, actualAmount);
        } else {
            encryptedBalances[tokenId][msg.sender] = actualAmount;
        }
        FHE.allowThis(encryptedBalances[tokenId][msg.sender]);
        FHE.allow(encryptedBalances[tokenId][msg.sender], msg.sender);

        // Emit WrapExcess to indicate encrypted wrap (actual amount is private, 0 is placeholder)
        // Note: We cannot reveal actual wrapped amount without breaking privacy
        emit WrapExcess(msg.sender, token, maxPlaintext, 0);
        emit Wrapped(msg.sender, token, maxPlaintext);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         UNWRAP FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Request unwrap of encrypted balance to ERC20
    /// @dev Deducts encrypted balance, issues claim token, initiates decrypt
    /// @param token The ERC20 token to unwrap to
    /// @param encAmount The encrypted amount to unwrap
    /// @return claimId The claim token ID for tracking
    function unwrap(
        address token,
        euint128 encAmount
    ) external nonReentrant whenNotPaused returns (uint256 claimId) {
        return _unwrap(token, encAmount, msg.sender);
    }

    /// @notice Request unwrap with encrypted amount input
    /// @param token The ERC20 token to unwrap to
    /// @param encryptedAmount The encrypted amount input from user
    /// @return claimId The claim token ID
    function unwrapEncrypted(
        address token,
        InEuint128 calldata encryptedAmount
    ) external nonReentrant whenNotPaused returns (uint256 claimId) {
        euint128 encAmount = FHE.asEuint128(encryptedAmount);
        FHE.allowThis(encAmount);
        return _unwrap(token, encAmount, msg.sender);
    }

    /// @dev Internal unwrap logic
    function _unwrap(
        address token,
        euint128 encAmount,
        address user
    ) internal returns (uint256 claimId) {
        if (!supportedTokens[token]) revert TokenNotSupported();

        uint256 tokenId = _tokenIdFromAddress(token);
        euint128 currentBalance = encryptedBalances[tokenId][user];

        // Ensure user has balance
        if (!Common.isInitialized(currentBalance)) revert InsufficientBalance();

        // Deduct from encrypted balance (FHE.sub handles underflow check)
        // Cap withdrawal at available balance
        ebool hasEnough = FHE.gte(currentBalance, encAmount);
        euint128 actualWithdraw = FHE.select(hasEnough, encAmount, currentBalance);
        FHE.allowThis(actualWithdraw);

        encryptedBalances[tokenId][user] = FHE.sub(currentBalance, actualWithdraw);
        FHE.allowThis(encryptedBalances[tokenId][user]);
        FHE.allow(encryptedBalances[tokenId][user], user);

        // Request decrypt
        FHE.allowThis(actualWithdraw);
        FHE.decrypt(actualWithdraw);

        // Issue claim
        claimId = nextClaimId++;
        pendingClaims[claimId] = PendingClaim({
            recipient: user,
            erc20Token: token,
            encAmount: actualWithdraw,
            requestedAt: block.number,
            fulfilled: false
        });

        // Mint claim token (ERC-6909)
        balanceOf[user][claimId] = 1;
        emit Transfer(user, address(0), user, claimId, 1);

        emit UnwrapRequested(user, token, claimId);
    }

    /// @notice Fulfill a pending claim after decrypt resolves
    /// @dev Anyone can call this to trigger the transfer (gas subsidy pattern).
    ///      Reverts if vault has insufficient balance to fulfill the claim.
    /// @param claimId The claim ID to fulfill
    function fulfillClaim(uint256 claimId) external nonReentrant {
        if (claimId < CLAIM_ID_OFFSET) revert InvalidClaimId();

        PendingClaim storage claim = pendingClaims[claimId];
        if (claim.recipient == address(0)) revert ClaimNotFound();
        if (claim.fulfilled) revert ClaimAlreadyFulfilled();

        // Check decrypt result
        (uint256 plainAmount, bool ready) = FHE.getDecryptResultSafe(claim.encAmount);
        if (!ready) revert DecryptNotReady();

        // Check vault has sufficient balance before marking fulfilled
        if (plainAmount > 0) {
            uint256 vaultBalance = IERC20(claim.erc20Token).balanceOf(address(this));
            if (vaultBalance < plainAmount) revert InsufficientVaultBalance();
        }

        // Mark fulfilled
        claim.fulfilled = true;

        // Burn claim token from holder (may have been transferred)
        address claimHolder = _findClaimHolder(claimId);
        if (claimHolder != address(0)) {
            balanceOf[claimHolder][claimId] = 0;
            emit Transfer(msg.sender, claimHolder, address(0), claimId, 1);
        }

        // Transfer ERC20 to original recipient (not claim holder - claim is for tracking, not ownership)
        if (plainAmount > 0) {
            IERC20(claim.erc20Token).safeTransfer(claim.recipient, plainAmount);
        }

        emit ClaimFulfilled(claimId, claim.recipient, claim.erc20Token, plainAmount);
    }

    /// @notice Check if a claim is ready to fulfill
    /// @param claimId The claim ID to check
    /// @return ready Whether the decrypt has resolved
    /// @return amount The decrypted amount (0 if not ready)
    function isClaimReady(uint256 claimId) external view returns (bool ready, uint256 amount) {
        PendingClaim storage claim = pendingClaims[claimId];
        if (claim.recipient == address(0) || claim.fulfilled) {
            return (false, 0);
        }
        (amount, ready) = FHE.getDecryptResultSafe(claim.encAmount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                      ENCRYPTED BALANCE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Transfer encrypted balance to another user
    /// @param token The token to transfer
    /// @param to The recipient
    /// @param amount The encrypted amount
    function transferEncrypted(
        address token,
        address to,
        euint128 amount
    ) external nonReentrant whenNotPaused {
        if (!supportedTokens[token]) revert TokenNotSupported();
        if (to == address(0)) revert ZeroAddress();

        uint256 tokenId = _tokenIdFromAddress(token);

        euint128 senderBalance = encryptedBalances[tokenId][msg.sender];
        if (!Common.isInitialized(senderBalance)) revert InsufficientBalance();

        // Deduct from sender
        encryptedBalances[tokenId][msg.sender] = FHE.sub(senderBalance, amount);
        FHE.allowThis(encryptedBalances[tokenId][msg.sender]);
        FHE.allow(encryptedBalances[tokenId][msg.sender], msg.sender);

        // Add to recipient
        euint128 recipientBalance = encryptedBalances[tokenId][to];
        if (Common.isInitialized(recipientBalance)) {
            encryptedBalances[tokenId][to] = FHE.add(recipientBalance, amount);
        } else {
            encryptedBalances[tokenId][to] = amount;
        }
        FHE.allowThis(encryptedBalances[tokenId][to]);
        FHE.allow(encryptedBalances[tokenId][to], to);
    }

    /// @notice Get encrypted balance for a user
    /// @param token The ERC20 token
    /// @param user The user address
    /// @return The encrypted balance handle
    function getEncryptedBalance(address token, address user) external view returns (euint128) {
        uint256 tokenId = _tokenIdFromAddress(token);
        return encryptedBalances[tokenId][user];
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ERC-6909 IMPLEMENTATION
    // ═══════════════════════════════════════════════════════════════════════

    /// @inheritdoc IERC6909Claims
    function transfer(address receiver, uint256 id, uint256 amount) external returns (bool) {
        balanceOf[msg.sender][id] -= amount;
        balanceOf[receiver][id] += amount;
        emit Transfer(msg.sender, msg.sender, receiver, id, amount);
        return true;
    }

    /// @inheritdoc IERC6909Claims
    function transferFrom(
        address sender,
        address receiver,
        uint256 id,
        uint256 amount
    ) external returns (bool) {
        if (msg.sender != sender && !isOperator[sender][msg.sender]) {
            uint256 allowed = allowance[sender][msg.sender][id];
            if (allowed != type(uint256).max) {
                allowance[sender][msg.sender][id] = allowed - amount;
            }
        }
        balanceOf[sender][id] -= amount;
        balanceOf[receiver][id] += amount;
        emit Transfer(msg.sender, sender, receiver, id, amount);
        return true;
    }

    /// @inheritdoc IERC6909Claims
    function approve(address spender, uint256 id, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender][id] = amount;
        emit Approval(msg.sender, spender, id, amount);
        return true;
    }

    /// @inheritdoc IERC6909Claims
    function setOperator(address operator, bool approved) external returns (bool) {
        isOperator[msg.sender][operator] = approved;
        emit OperatorSet(msg.sender, operator, approved);
        return true;
    }

    /// @notice ERC-165 interface support
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC165
            || interfaceId == 0x0f632fb3; // ERC6909
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Convert ERC20 address to token ID
    function _tokenIdFromAddress(address token) internal pure returns (uint256) {
        return uint256(uint160(token));
    }

    /// @dev Convert token ID back to ERC20 address
    function _addressFromTokenId(uint256 id) internal pure returns (address) {
        return address(uint160(id));
    }

    /// @dev Find who holds a claim token (simple linear search, could optimize with events)
    /// @dev In practice, claims are usually held by original recipient
    function _findClaimHolder(uint256 claimId) internal view returns (address) {
        // Check original recipient first (most common case)
        address recipient = pendingClaims[claimId].recipient;
        if (balanceOf[recipient][claimId] > 0) {
            return recipient;
        }
        // Claim may have been transferred - return zero (claim token tracking is optional)
        return address(0);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Get token ID for an ERC20 address
    function getTokenId(address token) external pure returns (uint256) {
        return _tokenIdFromAddress(token);
    }

    /// @notice Check if a token is supported
    function isTokenSupported(address token) external view returns (bool) {
        return supportedTokens[token];
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
}
