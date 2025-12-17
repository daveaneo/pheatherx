// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FHE, euint128, ebool, InEuint128, InEbool, Common} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IFHERC20} from "./interface/IFHERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SwapLockTransient} from "./lib/SwapLockTransient.sol";
import {TickBitmapLib} from "./lib/TickBitmapLib.sol";
import {FheatherMath} from "./lib/FheatherMath.sol";
import {BucketLib} from "./lib/BucketLib.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

/// @title FheatherX v8 Mixed - FHERC20:ERC20 and ERC20:FHERC20 Pools
/// @author FheatherX Team
/// @notice Uniswap v4 Hook implementing encrypted AMM with momentum-triggered limit orders for mixed token pairs
/// @dev This contract handles pools where exactly ONE token is FHERC20 (mixed pairs).
///      For pools where both tokens are FHERC20, use FheatherXv8FHE instead.
///
/// ## Architecture Overview
/// Similar to v8FHE but optimized for mixed token pairs:
/// - **Encrypted AMM**: Constant product (x*y=k) with FHE arithmetic on encrypted reserves
/// - **Momentum Orders**: Limit orders that auto-execute when price moves through their tick
/// - **Plaintext LP**: Since one token is ERC20, LP operations use plaintext amounts
/// - **Two-Step ERC20 Claims**: When proceeds are ERC20, requires async decrypt then transfer
///
/// ## Key Design Decisions
///
/// ### 1. Pro-Rata Allocation (vs Priority Slicing)
/// When multiple momentum orders trigger simultaneously, all participants receive the
/// same average execution price (pro-rata). This differs from priority-based systems
/// where earlier triggers get better prices.
///
/// **Rationale**: Pro-rata is simpler, more gas-efficient, and avoids complex FHE
/// prefix-sum operations. It also provides fair treatment to all participants in
/// the same price band.
///
/// ### 2. Tick Price Execution (vs AMM Spot Price)
/// Limit orders execute at their bucket's designated tick price, not the dynamic
/// AMM spot price at execution time.
///
/// **Rationale**: Tick price provides predictable execution for makers. The tick
/// represents the price at which they agreed to trade. Using AMM spot price could
/// result in execution at prices worse than the limit, which violates user expectations.
///
/// ### 3. Iterative Momentum Closure (vs Binary Search)
/// The momentum closure algorithm uses iterative expansion rather than binary search.
/// This avoids the "phantom fixed point" problem where binary search can find
/// mathematically valid but physically unreachable price states on step functions.
///
/// ### 4. Reserve-Based Slippage Cap (~50% max)
/// Momentum buckets with liquidity exceeding the output reserve are skipped.
/// This caps slippage at ~50% (when bucket = 100% of reserve, AMM math yields ~50% output).
///
/// ### 5. FHERC20-Only Deposits
/// Only the FHERC20 side of the pair can be deposited as limit orders.
/// This is because limit order amounts must be encrypted to maintain privacy.
///
/// ### 6. Two-Step ERC20 Claims
/// When claiming proceeds that are ERC20 (not FHERC20):
/// 1. `claim()` queues an async decrypt of the encrypted proceeds amount
/// 2. `claimErc20()` completes the transfer after decrypt resolves
/// This is necessary because ERC20 transfers require plaintext amounts.
///
/// ## Swap Pipeline
/// 1. Match opposing limit orders (direct peer-to-peer, no AMM)
/// 2. Find momentum closure (which same-side orders trigger)
/// 3. Sum activated momentum buckets (with liquidity cap)
/// 4. Execute single AMM swap with total input
/// 5. Allocate output to momentum buckets via virtual slicing
/// 6. Transfer output to user
///
/// ## Privacy Model
/// - FHERC20 balances and order amounts are encrypted (euint128)
/// - ERC20 balances are plaintext (standard ERC20 visibility)
/// - Reserve values are periodically synced to plaintext cache for gas optimization
/// - Tick bitmap is public (reveals which price levels have orders, not amounts)
///
contract FheatherXv8Mixed is BaseHook, Pausable, Ownable {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using TickBitmapLib for mapping(int16 => uint256);

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Precision multiplier for fixed-point arithmetic (18 decimals)
    uint256 public constant PRECISION = 1e18;

    /// @notice Tick spacing for price buckets (each tick = ~0.6% price change)
    int24 public constant TICK_SPACING = 60;

    /// @notice Minimum allowed tick value
    int24 public constant MIN_TICK = TickMath.MIN_TICK;

    /// @notice Maximum allowed tick value
    int24 public constant MAX_TICK = TickMath.MAX_TICK;

    /// @dev Maximum tick movement per swap (limits price impact)
    int24 internal constant MAX_TICK_MOVE = 600;

    /// @dev Maximum momentum buckets that can activate in a single swap
    uint8 internal constant MAX_MOMENTUM_BUCKETS = 5;

    /// @dev Iterations for binary search in reserve sync harvesting
    uint8 internal constant BINARY_SEARCH_ITERATIONS = 12;

    /// @dev Magic byte prefix for encrypted swap hookData
    /// @notice When hookData starts with this byte, the swap params are encrypted
    bytes1 internal constant ENCRYPTED_SWAP_MAGIC = 0x01;

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Thrown when amount parameter is zero
    error ZeroAmount();

    /// @notice Thrown when operating on a pool that hasn't been initialized
    error PoolNotInitialized();

    /// @notice Thrown when swap output is less than minimum expected
    error SlippageExceeded();

    /// @notice Thrown when trying to remove more liquidity than available
    error InsufficientLiquidity();

    /// @notice Thrown when tick is out of range or not aligned to TICK_SPACING
    error InvalidTick();

    /// @notice Thrown when transaction deadline has passed
    error DeadlineExpired();

    /// @notice Thrown when current price has moved beyond maxTickDrift from order tick
    error PriceMoved();

    /// @notice Thrown when protocol fee exceeds maximum (100 bps = 1%)
    error FeeTooHigh();

    /// @notice Thrown when pool tokens are not exactly one FHERC20 and one ERC20
    error NotMixedPair();

    /// @notice Thrown when trying to deposit ERC20 side (only FHERC20 deposits allowed)
    error InputTokenMustBeFherc20();

    /// @notice Thrown when calling claimErc20() with no pending claim
    error NoPendingClaim();

    /// @notice Thrown when calling claimErc20() before decrypt has resolved
    error ClaimNotReady();

    // ═══════════════════════════════════════════════════════════════════════
    //                               TYPES
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Side of a limit order bucket
    /// @dev BUY orders want to buy token0 (sell token1), SELL orders want to sell token0 (buy token1)
    enum BucketSide { BUY, SELL }

    /// @notice Core pool configuration and state for mixed pairs
    /// @param token0 Address of the first token
    /// @param token1 Address of the second token
    /// @param token0IsFherc20 True if token0 is FHERC20
    /// @param token1IsFherc20 True if token1 is FHERC20
    /// @param initialized Whether the pool has been initialized
    /// @param protocolFeeBps Protocol fee in basis points (max 100 = 1%)
    struct PoolState {
        address token0;
        address token1;
        bool token0IsFherc20;
        bool token1IsFherc20;
        bool initialized;
        uint256 protocolFeeBps;
    }

    /// @notice Pool reserves and LP tracking
    /// @dev Maintains both encrypted reserves and plaintext LP supply
    /// @param encReserve0 Encrypted reserve of token0
    /// @param encReserve1 Encrypted reserve of token1
    /// @param encTotalLpSupply Encrypted total LP supply (not used in mixed, kept for compatibility)
    /// @param reserve0 Plaintext reserve of token0
    /// @param reserve1 Plaintext reserve of token1
    /// @param totalLpSupply Plaintext total LP token supply
    /// @param reserveBlockNumber Block when reserves were last synced
    /// @param nextRequestId Next decrypt request ID to use
    /// @param lastResolvedId Most recent successfully resolved decrypt request
    struct PoolReserves {
        euint128 encReserve0;
        euint128 encReserve1;
        euint128 encTotalLpSupply;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalLpSupply;
        uint256 reserveBlockNumber;
        uint256 nextRequestId;
        uint256 lastResolvedId;
    }

    /// @notice Pending async decrypt request for reserve sync
    /// @param reserve0 Encrypted reserve0 at time of request
    /// @param reserve1 Encrypted reserve1 at time of request
    /// @param blockNumber Block when request was made
    struct PendingDecrypt {
        euint128 reserve0;
        euint128 reserve1;
        uint256 blockNumber;
    }

    /// @notice Pending ERC20 claim awaiting decrypt resolution
    /// @dev Used for two-step claim process when proceeds are ERC20
    /// @param encryptedAmount The encrypted amount awaiting decrypt
    /// @param token The ERC20 token to transfer
    /// @param requestedAt Block number when claim was initiated
    /// @param pending Whether there is a pending claim
    struct PendingErc20Claim {
        euint128 encryptedAmount;
        address token;
        uint256 requestedAt;
        bool pending;
    }

    /// @notice Pending swap output awaiting decrypt for ERC20 transfer
    /// @dev Used when encrypted swap outputs ERC20 (requires plaintext for transfer)
    /// @param recipient The address to receive the output
    /// @param token The ERC20 token to transfer
    /// @param amount The encrypted amount (for verification)
    /// @param fulfilled Whether the decrypt has been fulfilled
    struct PendingSwapOutput {
        address recipient;
        address token;
        euint128 amount;
        bool fulfilled;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                               STATE
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Encrypted constant: 0
    euint128 internal immutable ENC_ZERO;
    /// @dev Encrypted constant: 1e18 (PRECISION)
    euint128 internal immutable ENC_PRECISION;
    /// @dev Encrypted constant: 1
    euint128 internal immutable ENC_ONE;
    /// @dev Encrypted swap fee in basis points
    euint128 internal immutable ENC_SWAP_FEE_BPS;
    /// @dev Encrypted constant: 10000 (for basis point calculations)
    euint128 internal immutable ENC_TEN_THOUSAND;

    /// @notice Pool configuration by pool ID
    mapping(PoolId => PoolState) public poolStates;

    /// @notice Pool reserves and LP data by pool ID
    mapping(PoolId => PoolReserves) public poolReserves;

    /// @notice Pending decrypt requests by pool ID and request ID
    mapping(PoolId => mapping(uint256 => PendingDecrypt)) public pendingDecrypts;

    /// @notice Plaintext LP token balances by pool and user (mixed pairs use plaintext LP)
    mapping(PoolId => mapping(address => uint256)) public lpBalances;

    /// @notice Limit order buckets by pool, tick, and side
    mapping(PoolId => mapping(int24 => mapping(BucketSide => BucketLib.Bucket))) public buckets;

    /// @notice User positions in limit order buckets
    mapping(PoolId => mapping(address => mapping(int24 => mapping(BucketSide => BucketLib.UserPosition)))) public positions;

    /// @dev Bitmap tracking which ticks have BUY orders
    mapping(PoolId => mapping(int16 => uint256)) internal buyBitmaps;

    /// @dev Bitmap tracking which ticks have SELL orders
    mapping(PoolId => mapping(int16 => uint256)) internal sellBitmaps;

    /// @notice Last processed tick per pool (used for momentum calculations)
    mapping(PoolId => int24) public lastProcessedTick;

    /// @notice Pending ERC20 claims awaiting decrypt resolution
    mapping(PoolId => mapping(address => mapping(int24 => mapping(BucketSide => PendingErc20Claim)))) public pendingErc20Claims;

    /// @notice Pending swap outputs awaiting decrypt for ERC20 transfer
    mapping(uint256 => PendingSwapOutput) public pendingSwapOutputs;

    /// @notice Address that receives protocol fees
    address public feeCollector;

    /// @notice Swap fee in basis points (e.g., 30 = 0.3%)
    uint256 public swapFeeBps;

    // ═══════════════════════════════════════════════════════════════════════
    //                               EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Emitted when a new mixed pool is initialized
    /// @param poolId The unique identifier of the pool
    /// @param token0 Address of token0
    /// @param token1 Address of token1
    /// @param token0IsFherc20 True if token0 is FHERC20
    /// @param token1IsFherc20 True if token1 is FHERC20
    event PoolInitialized(PoolId indexed poolId, address token0, address token1, bool token0IsFherc20, bool token1IsFherc20);

    /// @notice Emitted when a swap is executed
    /// @param poolId The pool where the swap occurred
    /// @param user The address that initiated the swap
    /// @param zeroForOne True if swapping token0 for token1
    /// @param amountIn Amount of input tokens
    /// @param amountOut Amount of output tokens
    event SwapExecuted(PoolId indexed poolId, address indexed user, bool zeroForOne, uint256 amountIn, uint256 amountOut);

    /// @notice Emitted when an encrypted swap is executed (partial privacy - ERC20 amounts visible)
    /// @param poolId The pool where the swap occurred
    /// @param user The address that initiated the swap
    event EncryptedSwapExecuted(PoolId indexed poolId, address indexed user);

    /// @notice Emitted when an encrypted swap output needs async decrypt for ERC20 transfer
    /// @param poolId The pool where the swap occurred
    /// @param recipient The address that will receive the output
    /// @param requestId The CoFHE decrypt request ID
    event SwapOutputDecryptRequested(PoolId indexed poolId, address indexed recipient, uint256 requestId);

    /// @notice Emitted when swap output decrypt is fulfilled and ERC20 transferred
    /// @param requestId The fulfilled request ID
    /// @param recipient The address that received tokens
    /// @param amount The plaintext amount transferred
    event SwapOutputFulfilled(uint256 indexed requestId, address indexed recipient, uint256 amount);

    /// @notice Emitted when momentum orders are activated during a swap
    /// @param poolId The pool where momentum was activated
    /// @param fromTick Starting tick before momentum
    /// @param toTick Final tick after momentum cascade
    /// @param bucketsActivated Number of buckets that were activated
    event MomentumActivated(PoolId indexed poolId, int24 fromTick, int24 toTick, uint8 bucketsActivated);

    /// @notice Emitted when a user deposits into a limit order bucket
    /// @param poolId The pool ID
    /// @param user The depositor's address
    /// @param tick The price tick of the order
    /// @param side BUY or SELL
    event Deposit(PoolId indexed poolId, address indexed user, int24 tick, BucketSide side);

    /// @notice Emitted when a user withdraws unfilled liquidity from a bucket
    /// @param poolId The pool ID
    /// @param user The withdrawer's address
    /// @param tick The price tick of the order
    /// @param side BUY or SELL
    event Withdraw(PoolId indexed poolId, address indexed user, int24 tick, BucketSide side);

    /// @notice Emitted when FHERC20 proceeds are claimed directly
    /// @param poolId The pool ID
    /// @param user The claimer's address
    /// @param tick The price tick of the order
    /// @param side BUY or SELL
    event Claim(PoolId indexed poolId, address indexed user, int24 tick, BucketSide side);

    /// @notice Emitted when ERC20 claim is queued (step 1 of two-step process)
    /// @param poolId The pool ID
    /// @param user The claimer's address
    /// @param tick The price tick of the order
    /// @param side BUY or SELL
    /// @param token The ERC20 token to be claimed
    event Erc20ClaimQueued(PoolId indexed poolId, address indexed user, int24 tick, BucketSide side, address token);

    /// @notice Emitted when ERC20 claim is completed (step 2 of two-step process)
    /// @param poolId The pool ID
    /// @param user The claimer's address
    /// @param tick The price tick of the order
    /// @param side BUY or SELL
    /// @param amount The plaintext amount transferred
    event Erc20ClaimCompleted(PoolId indexed poolId, address indexed user, int24 tick, BucketSide side, uint256 amount);

    /// @notice Emitted when liquidity is added to the AMM
    /// @param poolId The pool ID
    /// @param user The liquidity provider's address
    /// @param amount0 Amount of token0 deposited
    /// @param amount1 Amount of token1 deposited
    /// @param lpAmount LP tokens minted
    event LiquidityAdded(PoolId indexed poolId, address indexed user, uint256 amount0, uint256 amount1, uint256 lpAmount);

    /// @notice Emitted when liquidity is removed from the AMM
    /// @param poolId The pool ID
    /// @param user The liquidity provider's address
    /// @param amount0 Amount of token0 returned
    /// @param amount1 Amount of token1 returned
    /// @param lpAmount LP tokens burned
    event LiquidityRemoved(PoolId indexed poolId, address indexed user, uint256 amount0, uint256 amount1, uint256 lpAmount);

    /// @notice Emitted when an async decrypt is requested for reserve sync
    /// @param poolId The pool ID
    /// @param requestId The unique request identifier
    /// @param blockNumber Block when request was made
    event ReserveSyncRequested(PoolId indexed poolId, uint256 indexed requestId, uint256 blockNumber);

    /// @notice Emitted when reserves are synced from a resolved decrypt
    /// @param poolId The pool ID
    /// @param reserve0 New plaintext reserve0 value
    /// @param reserve1 New plaintext reserve1 value
    /// @param requestId The request ID that was resolved
    event ReservesSynced(PoolId indexed poolId, uint256 reserve0, uint256 reserve1, uint256 indexed requestId);

    // ═══════════════════════════════════════════════════════════════════════
    //                           CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Initialize the FheatherX v8 Mixed hook
    /// @param _poolManager The Uniswap v4 PoolManager contract
    /// @param _owner Address that will own this contract (can pause, set fees)
    /// @param _swapFeeBps Swap fee in basis points (e.g., 30 = 0.3%)
    constructor(
        IPoolManager _poolManager,
        address _owner,
        uint256 _swapFeeBps
    ) BaseHook(_poolManager) Ownable(_owner) {
        ENC_ZERO = FHE.asEuint128(0);
        ENC_PRECISION = FHE.asEuint128(uint128(PRECISION));
        ENC_ONE = FHE.asEuint128(1);
        ENC_SWAP_FEE_BPS = FHE.asEuint128(uint128(_swapFeeBps));
        ENC_TEN_THOUSAND = FHE.asEuint128(10000);

        swapFeeBps = _swapFeeBps;

        FHE.allowThis(ENC_ZERO);
        FHE.allowThis(ENC_PRECISION);
        FHE.allowThis(ENC_ONE);
        FHE.allowThis(ENC_SWAP_FEE_BPS);
        FHE.allowThis(ENC_TEN_THOUSAND);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         HOOK PERMISSIONS
    // ═══════════════════════════════════════════════════════════════════════

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          HOOK CALLBACKS
    // ═══════════════════════════════════════════════════════════════════════

    function _afterInitialize(
        address,
        PoolKey calldata key,
        uint160,
        int24 tick
    ) internal override returns (bytes4) {
        PoolId poolId = key.toId();
        lastProcessedTick[poolId] = tick;

        address token0Addr = Currency.unwrap(key.currency0);
        address token1Addr = Currency.unwrap(key.currency1);

        bool t0IsFhe = _isFherc20(token0Addr);
        bool t1IsFhe = _isFherc20(token1Addr);

        // Must be exactly one FHE token (mixed pair)
        if (t0IsFhe == t1IsFhe) revert NotMixedPair();

        poolStates[poolId] = PoolState({
            token0: token0Addr,
            token1: token1Addr,
            token0IsFherc20: t0IsFhe,
            token1IsFherc20: t1IsFhe,
            initialized: true,
            protocolFeeBps: 5
        });

        PoolReserves storage reserves = poolReserves[poolId];
        reserves.encReserve0 = ENC_ZERO;
        reserves.encReserve1 = ENC_ZERO;
        reserves.encTotalLpSupply = ENC_ZERO;

        FHE.allowThis(reserves.encReserve0);
        FHE.allowThis(reserves.encReserve1);
        FHE.allowThis(reserves.encTotalLpSupply);

        IERC20(token0Addr).approve(address(poolManager), type(uint256).max);
        IERC20(token1Addr).approve(address(poolManager), type(uint256).max);

        emit PoolInitialized(poolId, token0Addr, token1Addr, t0IsFhe, t1IsFhe);
        return this.afterInitialize.selector;
    }

    function _beforeSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata hookData
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        PoolId poolId = key.toId();
        if (!poolStates[poolId].initialized) {
            return (this.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        }

        SwapLockTransient.enforceOnce(poolId);

        // Check for encrypted swap via hookData
        if (hookData.length > 0 && hookData[0] == ENCRYPTED_SWAP_MAGIC) {
            // Encrypted swap path - params are in hookData, not in SwapParams
            // Note: Mixed pools have partial privacy (ERC20 amounts visible)
            _executeEncryptedSwap(poolId, hookData);
            // Return NoOp delta - we handled everything via direct transfers
            return (this.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        }

        // Normal plaintext swap path
        if (params.amountSpecified >= 0) {
            return (this.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        }

        uint256 amountIn = uint256(-params.amountSpecified);
        if (amountIn == 0) {
            return (this.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        }

        uint256 amountOut = _executeSwapWithMomentum(poolId, key, params.zeroForOne, amountIn, sender);

        return (
            this.beforeSwap.selector,
            toBeforeSwapDelta(
                int128(-params.amountSpecified),
                -int128(int256(amountOut))
            ),
            0
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    SWAP WITH MOMENTUM
    // ═══════════════════════════════════════════════════════════════════════

    function _executeSwapWithMomentum(
        PoolId poolId,
        PoolKey calldata key,
        bool zeroForOne,
        uint256 amountIn,
        address sender
    ) internal returns (uint256 amountOut) {
        // CRITICAL: Harvest resolved decrypts FIRST to get fresh reserves
        _harvestResolvedDecrypts(poolId);

        PoolReserves storage reserves = poolReserves[poolId];

        // Take input from PoolManager
        Currency inputCurrency = zeroForOne ? key.currency0 : key.currency1;
        poolManager.take(inputCurrency, address(this), amountIn);

        int24 startTick = lastProcessedTick[poolId];

        // Encrypt input for FHE operations
        euint128 userInputEnc = FHE.asEuint128(uint128(amountIn));
        FHE.allowThis(userInputEnc);

        // Step 1: Match opposing limits
        (euint128 remainderEnc, ) = _matchOpposingLimits(poolId, zeroForOne, userInputEnc, startTick);
        FHE.allowThis(remainderEnc);

        // Step 2: Find momentum closure
        (int24 finalTick, uint8 activatedCount) = _findMomentumClosure(poolId, zeroForOne, amountIn, startTick);

        // Step 3: Sum momentum buckets
        euint128 momentumSumEnc = ENC_ZERO;
        if (activatedCount > 0) {
            momentumSumEnc = _sumMomentumBucketsEnc(poolId, zeroForOne, startTick, finalTick);
            FHE.allowThis(momentumSumEnc);
        }

        // Step 4: Execute AMM once
        euint128 totalInputEnc = FHE.add(remainderEnc, momentumSumEnc);
        FHE.allowThis(totalInputEnc);

        ebool direction = FHE.asEbool(zeroForOne);
        euint128 totalAmmOutputEnc = _executeSwapMath(poolId, direction, totalInputEnc);
        FHE.allowThis(totalAmmOutputEnc);

        // Step 5: Allocate to momentum buckets
        if (activatedCount > 0) {
            _allocateVirtualSlicing(poolId, zeroForOne, startTick, finalTick, momentumSumEnc, totalAmmOutputEnc);
            emit MomentumActivated(poolId, startTick, finalTick, activatedCount);
        }

        // Step 6: Calculate output (plaintext)
        amountOut = FheatherMath.estimateOutput(
            zeroForOne ? reserves.reserve0 : reserves.reserve1,
            zeroForOne ? reserves.reserve1 : reserves.reserve0,
            amountIn,
            swapFeeBps
        );

        uint256 fee = (amountOut * poolStates[poolId].protocolFeeBps) / 10000;
        amountOut -= fee;

        // Settle output
        Currency outputCurrency = zeroForOne ? key.currency1 : key.currency0;
        poolManager.sync(outputCurrency);
        IERC20(Currency.unwrap(outputCurrency)).transfer(address(poolManager), amountOut);
        poolManager.settle();

        if (fee > 0 && feeCollector != address(0)) {
            IERC20(Currency.unwrap(outputCurrency)).safeTransfer(feeCollector, fee);
        }

        // Update plaintext cache
        if (zeroForOne) {
            reserves.reserve0 += amountIn;
            reserves.reserve1 = reserves.reserve1 > amountOut + fee ? reserves.reserve1 - amountOut - fee : 0;
        } else {
            reserves.reserve1 += amountIn;
            reserves.reserve0 = reserves.reserve0 > amountOut + fee ? reserves.reserve0 - amountOut - fee : 0;
        }

        lastProcessedTick[poolId] = finalTick;
        _requestReserveSync(poolId);

        emit SwapExecuted(poolId, sender, zeroForOne, amountIn, amountOut);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    ORDER MATCHING (Same as v8FHE)
    // ═══════════════════════════════════════════════════════════════════════

    function _matchOpposingLimits(
        PoolId poolId,
        bool zeroForOne,
        euint128 userInputEnc,
        int24 startTick
    ) internal returns (euint128 remainderEnc, euint128 userOutputEnc) {
        BucketSide opposingSide = zeroForOne ? BucketSide.BUY : BucketSide.SELL;
        mapping(int16 => uint256) storage bitmap = opposingSide == BucketSide.BUY
            ? buyBitmaps[poolId] : sellBitmaps[poolId];

        remainderEnc = userInputEnc;
        userOutputEnc = ENC_ZERO;

        int24 current = startTick;
        for (uint8 i = 0; i < MAX_MOMENTUM_BUCKETS; i++) {
            (int24 nextTick, bool found) = TickBitmapLib.findNextInitializedTick(
                bitmap, current, TICK_SPACING, zeroForOne, 2
            );
            if (!found) break;

            (euint128 newRemainder, euint128 bucketOutput) = _fillOpposingBucket(
                poolId, nextTick, opposingSide, remainderEnc, zeroForOne
            );

            remainderEnc = newRemainder;
            userOutputEnc = FHE.add(userOutputEnc, bucketOutput);
            FHE.allowThis(remainderEnc);
            FHE.allowThis(userOutputEnc);

            current = zeroForOne ? nextTick - TICK_SPACING : nextTick + TICK_SPACING;
        }
    }

    function _fillOpposingBucket(
        PoolId poolId,
        int24 tick,
        BucketSide side,
        euint128 userInputEnc,
        bool zeroForOne
    ) internal returns (euint128 remainingInput, euint128 outputToUser) {
        BucketLib.Bucket storage bucket = buckets[poolId][tick][side];
        if (!bucket.initialized || !Common.isInitialized(bucket.liquidity)) {
            return (userInputEnc, ENC_ZERO);
        }

        euint128 encTickPrice = FHE.asEuint128(uint128(FheatherMath.calculateTickPrice(tick)));
        FHE.allowThis(encTickPrice);

        euint128 capacity = zeroForOne
            ? FHE.div(FHE.mul(bucket.liquidity, ENC_PRECISION), encTickPrice)
            : FHE.div(FHE.mul(bucket.liquidity, encTickPrice), ENC_PRECISION);
        FHE.allowThis(capacity);

        euint128 fill = FHE.select(FHE.gt(userInputEnc, capacity), capacity, userInputEnc);
        FHE.allowThis(fill);

        outputToUser = zeroForOne
            ? FHE.div(FHE.mul(fill, encTickPrice), ENC_PRECISION)
            : FHE.div(FHE.mul(fill, ENC_PRECISION), encTickPrice);
        FHE.allowThis(outputToUser);

        BucketLib.updateOnFill(bucket, outputToUser, fill, ENC_ZERO, ENC_ONE, ENC_PRECISION);
        bucket.liquidity = FHE.sub(bucket.liquidity, outputToUser);
        FHE.allowThis(bucket.liquidity);

        remainingInput = FHE.sub(userInputEnc, fill);
        FHE.allowThis(remainingInput);
    }

    /// @notice Find momentum closure using iterative expansion
    /// @dev Replaces binary search to avoid phantom fixed point problem.
    ///      Uses fixed estimate (1e18 per bucket) for PREDICTION, but execution
    ///      uses actual encrypted sums. This preserves privacy while avoiding
    ///      the phantom fixed point issue where binary search finds unreachable states.
    function _findMomentumClosure(
        PoolId poolId,
        bool zeroForOne,
        uint256 userRemainderPlaintext,
        int24 startTick
    ) internal view returns (int24 finalTick, uint8 activatedCount) {
        PoolReserves storage reserves = poolReserves[poolId];

        finalTick = startTick;

        // Iterative expansion - follow the actual cascade path
        for (uint8 i = 0; i < MAX_MOMENTUM_BUCKETS + 2; i++) {
            int24 nextTick = _iterateOnce(poolId, zeroForOne, userRemainderPlaintext, startTick, finalTick, reserves);

            // Check convergence (fixed point reached when tick stops moving)
            if (zeroForOne ? nextTick >= finalTick : nextTick <= finalTick) break;

            finalTick = nextTick;
        }

        // Final count of activated buckets
        activatedCount = _countMomentumBuckets(poolId, startTick, finalTick, zeroForOne);
    }

    /// @notice Single iteration of momentum closure calculation
    function _iterateOnce(
        PoolId poolId,
        bool zeroForOne,
        uint256 userInput,
        int24 startTick,
        int24 currentTick,
        PoolReserves storage reserves
    ) internal view returns (int24 nextTick) {
        uint8 bucketCount = _countMomentumBuckets(poolId, startTick, currentTick, zeroForOne);
        uint256 totalInput = userInput + uint256(bucketCount) * 1e18;

        nextTick = _tickAfterSwapPlaintext(reserves.reserve0, reserves.reserve1, totalInput, zeroForOne);

        // Enforce MAX_TICK_MOVE limit
        if (zeroForOne) {
            if (startTick - nextTick > MAX_TICK_MOVE) nextTick = startTick - MAX_TICK_MOVE;
        } else {
            if (nextTick - startTick > MAX_TICK_MOVE) nextTick = startTick + MAX_TICK_MOVE;
        }
    }

    /// @notice Count momentum buckets between two ticks
    function _countMomentumBuckets(
        PoolId poolId,
        int24 fromTick,
        int24 toTick,
        bool zeroForOne
    ) internal view returns (uint8 count) {
        BucketSide side = zeroForOne ? BucketSide.SELL : BucketSide.BUY;
        mapping(int16 => uint256) storage bitmap = side == BucketSide.SELL
            ? sellBitmaps[poolId] : buyBitmaps[poolId];

        int24 current = fromTick;
        while (count < MAX_MOMENTUM_BUCKETS) {
            (int24 nextTick, bool found) = TickBitmapLib.findNextInitializedTick(
                bitmap, current, TICK_SPACING, zeroForOne, 2
            );
            if (!found) break;
            if (zeroForOne && nextTick < toTick) break;
            if (!zeroForOne && nextTick > toTick) break;
            count++;
            current = zeroForOne ? nextTick - TICK_SPACING : nextTick + TICK_SPACING;
        }
    }

    /// @notice Calculate the resulting tick after a swap with given input
    function _tickAfterSwapPlaintext(
        uint256 reserve0,
        uint256 reserve1,
        uint256 amountIn,
        bool zeroForOne
    ) internal pure returns (int24) {
        if (reserve0 == 0 || reserve1 == 0) return 0;

        if (zeroForOne) {
            uint256 newR0 = reserve0 + amountIn;
            return FheatherMath.getCurrentTick(newR0, (reserve0 * reserve1) / newR0, TICK_SPACING);
        } else {
            uint256 newR1 = reserve1 + amountIn;
            return FheatherMath.getCurrentTick((reserve0 * reserve1) / newR1, newR1, TICK_SPACING);
        }
    }

    /// @notice Sum momentum bucket liquidity with reserve cap (~50% max slippage)
    /// @dev Buckets larger than the output reserve are zeroed to cap slippage at ~50%
    function _sumMomentumBucketsEnc(
        PoolId poolId,
        bool zeroForOne,
        int24 fromTick,
        int24 toTick
    ) internal returns (euint128 totalLiquidity) {
        PoolReserves storage reserves = poolReserves[poolId];
        BucketSide side = zeroForOne ? BucketSide.SELL : BucketSide.BUY;
        mapping(int16 => uint256) storage bitmap = side == BucketSide.SELL
            ? sellBitmaps[poolId] : buyBitmaps[poolId];

        // Reserve cap: bucket input shouldn't exceed output reserve (caps slippage at ~50%)
        euint128 encReserveLimit = zeroForOne ? reserves.encReserve1 : reserves.encReserve0;

        totalLiquidity = ENC_ZERO;
        int24 current = fromTick;
        uint8 count = 0;

        while (count < MAX_MOMENTUM_BUCKETS) {
            (int24 nextTick, bool found) = TickBitmapLib.findNextInitializedTick(
                bitmap, current, TICK_SPACING, zeroForOne, 2
            );
            if (!found) break;
            if (zeroForOne && nextTick < toTick) break;
            if (!zeroForOne && nextTick > toTick) break;

            BucketLib.Bucket storage bucket = buckets[poolId][nextTick][side];
            if (bucket.initialized && Common.isInitialized(bucket.liquidity)) {
                // Cap oversized buckets: if liquidity > reserve, use 0 instead
                // This prevents griefing attacks where huge orders cause extreme slippage
                ebool isOversized = FHE.gt(bucket.liquidity, encReserveLimit);
                euint128 cappedLiquidity = FHE.select(isOversized, ENC_ZERO, bucket.liquidity);
                FHE.allowThis(cappedLiquidity);

                totalLiquidity = FHE.add(totalLiquidity, cappedLiquidity);
                FHE.allowThis(totalLiquidity);
                count++;
            }
            current = zeroForOne ? nextTick - TICK_SPACING : nextTick + TICK_SPACING;
        }
    }

    function _allocateVirtualSlicing(
        PoolId poolId,
        bool zeroForOne,
        int24 fromTick,
        int24 toTick,
        euint128 totalMomentumInput,
        euint128 totalOutput
    ) internal {
        BucketSide side = zeroForOne ? BucketSide.SELL : BucketSide.BUY;
        mapping(int16 => uint256) storage bitmap = side == BucketSide.SELL
            ? sellBitmaps[poolId] : buyBitmaps[poolId];

        ebool hasInput = FHE.gt(totalMomentumInput, ENC_ZERO);
        euint128 safeDenom = FHE.select(hasInput, totalMomentumInput, ENC_ONE);
        FHE.allowThis(safeDenom);

        int24 current = fromTick;
        uint8 count = 0;

        while (count < MAX_MOMENTUM_BUCKETS) {
            (int24 nextTick, bool found) = TickBitmapLib.findNextInitializedTick(
                bitmap, current, TICK_SPACING, zeroForOne, 2
            );
            if (!found) break;
            if (zeroForOne && nextTick < toTick) break;
            if (!zeroForOne && nextTick > toTick) break;

            BucketLib.Bucket storage bucket = buckets[poolId][nextTick][side];
            if (bucket.initialized && Common.isInitialized(bucket.liquidity)) {
                euint128 bucketOutput = FHE.div(FHE.mul(bucket.liquidity, totalOutput), safeDenom);
                FHE.allowThis(bucketOutput);
                BucketLib.updateOnFill(bucket, bucket.liquidity, bucketOutput, ENC_ZERO, ENC_ONE, ENC_PRECISION);
                bucket.liquidity = ENC_ZERO;
                FHE.allowThis(bucket.liquidity);
                count++;
            }
            current = zeroForOne ? nextTick - TICK_SPACING : nextTick + TICK_SPACING;
        }
    }

    function _executeSwapMath(
        PoolId poolId,
        ebool direction,
        euint128 amountIn
    ) internal returns (euint128 amountOut) {
        PoolReserves storage r = poolReserves[poolId];

        euint128 feeAmount = FHE.div(FHE.mul(amountIn, ENC_SWAP_FEE_BPS), ENC_TEN_THOUSAND);
        euint128 amountInAfterFee = FHE.sub(amountIn, feeAmount);
        FHE.allowThis(amountInAfterFee);

        euint128 reserveIn = FHE.select(direction, r.encReserve0, r.encReserve1);
        euint128 reserveOut = FHE.select(direction, r.encReserve1, r.encReserve0);

        euint128 numerator = FHE.mul(amountInAfterFee, reserveOut);
        euint128 denominator = FHE.add(reserveIn, amountInAfterFee);

        euint128 safeDenominator = FHE.select(FHE.gt(denominator, ENC_ZERO), denominator, ENC_ONE);
        FHE.allowThis(safeDenominator);

        amountOut = FHE.div(numerator, safeDenominator);
        FHE.allowThis(amountOut);

        euint128 newReserveIn = FHE.add(reserveIn, amountIn);
        euint128 newReserveOut = FHE.sub(reserveOut, amountOut);

        r.encReserve0 = FHE.select(direction, newReserveIn, newReserveOut);
        r.encReserve1 = FHE.select(direction, newReserveOut, newReserveIn);
        FHE.allowThis(r.encReserve0);
        FHE.allowThis(r.encReserve1);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    ENCRYPTED SWAP (Partial Privacy)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Execute an encrypted swap via hookData (partial privacy for mixed pools)
    /// @dev For mixed pools, direction is plaintext (partial privacy tradeoff).
    ///      Amounts remain encrypted for FHERC20 tokens.
    ///      hookData format: magic byte (0x01) + abi.encode(sender, zeroForOne, amountInHandle, minOutputHandle)
    ///      The PrivateSwapRouter has already converted InEuint128 → euint128 handles and granted ACL.
    ///      - FHERC20 input: transfer encrypted amount from sender
    ///      - ERC20 input: reverts (use standard swap with plaintext amount)
    ///      - FHERC20 output: transfer encrypted amount to sender
    ///      - ERC20 output: request async decrypt, then fulfill via fulfillSwapOutput()
    /// @param poolId The pool to swap in
    /// @param hookData Encoded encrypted swap parameters (handles, not InEuint128)
    function _executeEncryptedSwap(PoolId poolId, bytes calldata hookData) internal {
        PoolState storage state = poolStates[poolId];

        // Decode hookData: skip magic byte (1), then decode params
        // For mixed pools, direction is plaintext (partial privacy)
        // Router has already converted InEuint128 → euint128 handles and granted ACL permission
        (
            address sender,
            bool zeroForOne,
            uint256 amountInHandle,
            uint256 minOutputHandle
        ) = abi.decode(hookData[1:], (address, bool, uint256, uint256));

        // Wrap handles back to FHE types (no signature verification needed - router already did it)
        euint128 amountIn = euint128.wrap(amountInHandle);
        euint128 minOutput = euint128.wrap(minOutputHandle);
        FHE.allowThis(amountIn);
        FHE.allowThis(minOutput);

        address token0 = state.token0;
        address token1 = state.token1;
        bool token0IsFherc20 = state.token0IsFherc20;
        bool token1IsFherc20 = state.token1IsFherc20;

        // zeroForOne = true: sell token0 for token1
        // zeroForOne = false: sell token1 for token0
        address inputToken = zeroForOne ? token0 : token1;
        address outputToken = zeroForOne ? token1 : token0;
        bool inputIsFherc20 = zeroForOne ? token0IsFherc20 : token1IsFherc20;
        bool outputIsFherc20 = zeroForOne ? token1IsFherc20 : token0IsFherc20;

        // Transfer input from sender
        if (inputIsFherc20) {
            FHE.allow(amountIn, inputToken);
            IFHERC20(inputToken)._transferFromEncrypted(sender, address(this), amountIn);
        } else {
            // ERC20 input - requires async decrypt to get plaintext amount
            // For now, this path requires a separate flow with plaintext input
            revert("ERC20 input requires plaintext amount - use standard swap");
        }

        // Execute AMM math with encrypted values
        ebool direction = FHE.asEbool(zeroForOne);
        FHE.allowThis(direction);
        euint128 amountOut = _executeSwapMath(poolId, direction, amountIn);
        FHE.allowThis(amountOut);

        // Check slippage
        ebool slippageOk = FHE.gte(amountOut, minOutput);
        euint128 finalOutput = FHE.select(slippageOk, amountOut, ENC_ZERO);
        FHE.allowThis(finalOutput);

        // Transfer output to sender
        if (outputIsFherc20) {
            FHE.allow(finalOutput, outputToken);
            IFHERC20(outputToken)._transferEncrypted(sender, finalOutput);
        } else {
            // ERC20 output - requires async decrypt
            // Request decrypt of finalOutput, then transfer in callback
            _requestOutputDecrypt(poolId, sender, outputToken, finalOutput);
        }

        emit EncryptedSwapExecuted(poolId, sender);
    }

    /// @notice Request async decrypt for ERC20 output transfer
    /// @dev Uses the euint128 handle as the request ID for storage lookup
    function _requestOutputDecrypt(
        PoolId poolId,
        address recipient,
        address token,
        euint128 amount
    ) internal {
        FHE.allowThis(amount);
        FHE.decrypt(amount);

        // Use the handle as requestId for lookup
        uint256 requestId = euint128.unwrap(amount);

        pendingSwapOutputs[requestId] = PendingSwapOutput({
            recipient: recipient,
            token: token,
            amount: amount,
            fulfilled: false
        });

        emit SwapOutputDecryptRequested(poolId, recipient, requestId);
    }

    /// @notice Fulfill a pending swap output after decrypt resolves
    /// @dev Anyone can call this to trigger the ERC20 transfer
    /// @param requestId The request ID (euint128 handle) to fulfill
    function fulfillSwapOutput(uint256 requestId) external {
        PendingSwapOutput storage pending = pendingSwapOutputs[requestId];
        require(pending.recipient != address(0), "Unknown request");
        require(!pending.fulfilled, "Already fulfilled");

        // Check if decrypt is ready
        (uint256 plainAmount, bool ready) = FHE.getDecryptResultSafe(pending.amount);
        require(ready, "Decrypt not ready");

        pending.fulfilled = true;

        // Transfer ERC20 to recipient
        if (plainAmount > 0) {
            IERC20(pending.token).transfer(pending.recipient, plainAmount);
        }

        emit SwapOutputFulfilled(requestId, pending.recipient, plainAmount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    LIMIT ORDER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Deposit tokens into a limit order bucket
    /// @dev Only the FHERC20 side of the pair can be deposited.
    ///      For SELL orders (selling token0), token0 must be FHERC20.
    ///      For BUY orders (selling token1), token1 must be FHERC20.
    ///      The order executes at the bucket's tick price, not the AMM spot price.
    /// @param poolId The pool to place the order in
    /// @param tick The price tick for the order (must be aligned to TICK_SPACING)
    /// @param side BUY or SELL
    /// @param encryptedAmount Encrypted amount of FHERC20 tokens to deposit
    /// @param deadline Transaction deadline (reverts if block.timestamp > deadline)
    /// @param maxTickDrift Maximum allowed difference between current tick and order tick
    function deposit(
        PoolId poolId,
        int24 tick,
        BucketSide side,
        InEuint128 calldata encryptedAmount,
        uint256 deadline,
        int24 maxTickDrift
    ) external whenNotPaused {
        if (block.timestamp > deadline) revert DeadlineExpired();

        PoolState storage state = poolStates[poolId];
        if (!state.initialized) revert PoolNotInitialized();
        if (tick < MIN_TICK || tick > MAX_TICK || tick % TICK_SPACING != 0) revert InvalidTick();

        // Validate deposit token is FHERC20
        bool inputIsFherc20 = side == BucketSide.SELL ? state.token0IsFherc20 : state.token1IsFherc20;
        if (!inputIsFherc20) revert InputTokenMustBeFherc20();

        PoolReserves storage reserves = poolReserves[poolId];
        int24 currentTick = FheatherMath.getCurrentTick(reserves.reserve0, reserves.reserve1, TICK_SPACING);
        if (FheatherMath.abs(currentTick - tick) > maxTickDrift) revert PriceMoved();

        euint128 amount = FHE.asEuint128(encryptedAmount);
        FHE.allowThis(amount);

        BucketLib.Bucket storage bucket = buckets[poolId][tick][side];
        if (!bucket.initialized) {
            BucketLib.initialize(bucket, ENC_ZERO);
        }

        BucketLib.UserPosition storage position = positions[poolId][msg.sender][tick][side];

        if (Common.isInitialized(position.shares)) {
            BucketLib.autoClaim(position, bucket, ENC_PRECISION);
        }

        bucket.totalShares = FHE.add(bucket.totalShares, amount);
        bucket.liquidity = FHE.add(bucket.liquidity, amount);
        FHE.allowThis(bucket.totalShares);
        FHE.allowThis(bucket.liquidity);

        if (Common.isInitialized(position.shares)) {
            position.shares = FHE.add(position.shares, amount);
        } else {
            position.shares = amount;
        }
        position.proceedsPerShareSnapshot = bucket.proceedsPerShare;
        position.filledPerShareSnapshot = bucket.filledPerShare;

        FHE.allowThis(position.shares);
        FHE.allow(position.shares, msg.sender);
        FHE.allowThis(position.proceedsPerShareSnapshot);
        FHE.allowThis(position.filledPerShareSnapshot);

        mapping(int16 => uint256) storage bitmap = side == BucketSide.BUY
            ? buyBitmaps[poolId] : sellBitmaps[poolId];
        TickBitmapLib.setBit(bitmap, tick, TICK_SPACING);

        address depositToken = side == BucketSide.SELL ? state.token0 : state.token1;
        FHE.allow(amount, depositToken);
        IFHERC20(depositToken)._transferFromEncrypted(msg.sender, address(this), amount);

        emit Deposit(poolId, msg.sender, tick, side);
    }

    /// @notice Withdraw unfilled liquidity from a limit order bucket
    /// @dev Only unfilled portions can be withdrawn. The withdrawal token is FHERC20.
    ///      Actual withdrawal amount is min(requested, unfilled).
    /// @param poolId The pool to withdraw from
    /// @param tick The price tick of the order
    /// @param side BUY or SELL
    /// @param encryptedAmount Encrypted amount to withdraw (capped at unfilled amount)
    function withdraw(
        PoolId poolId,
        int24 tick,
        BucketSide side,
        InEuint128 calldata encryptedAmount
    ) external whenNotPaused {
        PoolState storage state = poolStates[poolId];
        if (!state.initialized) revert PoolNotInitialized();

        euint128 amount = FHE.asEuint128(encryptedAmount);
        BucketLib.Bucket storage bucket = buckets[poolId][tick][side];
        BucketLib.UserPosition storage position = positions[poolId][msg.sender][tick][side];

        euint128 unfilledShares = BucketLib.calculateUnfilled(position, bucket, ENC_ZERO, ENC_PRECISION);
        euint128 withdrawAmount = FHE.select(FHE.lt(amount, unfilledShares), amount, unfilledShares);
        FHE.allowThis(withdrawAmount);

        bucket.totalShares = FHE.sub(bucket.totalShares, withdrawAmount);
        bucket.liquidity = FHE.sub(bucket.liquidity, withdrawAmount);
        FHE.allowThis(bucket.totalShares);
        FHE.allowThis(bucket.liquidity);

        position.shares = FHE.sub(position.shares, withdrawAmount);
        FHE.allowThis(position.shares);
        FHE.allow(position.shares, msg.sender);

        address withdrawToken = side == BucketSide.SELL ? state.token0 : state.token1;
        FHE.allow(withdrawAmount, withdrawToken);
        IFHERC20(withdrawToken)._transferEncrypted(msg.sender, withdrawAmount);

        emit Withdraw(poolId, msg.sender, tick, side);
    }

    /// @notice Claim proceeds from filled limit orders
    /// @dev If proceeds are FHERC20, transfer happens immediately.
    ///      If proceeds are ERC20, this queues an async decrypt and user must call claimErc20() after.
    ///      For SELL orders, proceeds are token1. For BUY orders, proceeds are token0.
    /// @param poolId The pool to claim from
    /// @param tick The price tick of the order
    /// @param side BUY or SELL
    function claim(PoolId poolId, int24 tick, BucketSide side) external whenNotPaused {
        PoolState storage state = poolStates[poolId];
        if (!state.initialized) revert PoolNotInitialized();

        BucketLib.Bucket storage bucket = buckets[poolId][tick][side];
        BucketLib.UserPosition storage position = positions[poolId][msg.sender][tick][side];

        euint128 currentProceeds = BucketLib.calculateProceeds(position, bucket, ENC_ZERO, ENC_PRECISION);
        euint128 totalProceeds = Common.isInitialized(position.realizedProceeds)
            ? FHE.add(currentProceeds, position.realizedProceeds)
            : currentProceeds;
        FHE.allowThis(totalProceeds);

        position.proceedsPerShareSnapshot = bucket.proceedsPerShare;
        position.realizedProceeds = ENC_ZERO;
        FHE.allowThis(position.realizedProceeds);
        FHE.allowThis(position.proceedsPerShareSnapshot);

        // Proceeds token is the other token (what was received)
        address proceedsToken = side == BucketSide.SELL ? state.token1 : state.token0;
        bool proceedsIsFherc20 = side == BucketSide.SELL ? state.token1IsFherc20 : state.token0IsFherc20;

        if (proceedsIsFherc20) {
            // FHERC20 proceeds - direct encrypted transfer
            FHE.allow(totalProceeds, proceedsToken);
            IFHERC20(proceedsToken)._transferEncrypted(msg.sender, totalProceeds);
            emit Claim(poolId, msg.sender, tick, side);
        } else {
            // ERC20 proceeds - queue async decrypt, user calls claimErc20() after
            FHE.decrypt(totalProceeds);
            pendingErc20Claims[poolId][msg.sender][tick][side] = PendingErc20Claim({
                encryptedAmount: totalProceeds,
                token: proceedsToken,
                requestedAt: block.number,
                pending: true
            });
            emit Erc20ClaimQueued(poolId, msg.sender, tick, side, proceedsToken);
        }
    }

    /// @notice Complete an ERC20 claim after async decrypt has resolved
    /// @dev This is step 2 of the two-step ERC20 claim process:
    ///      1. User calls claim() which queues the decrypt
    ///      2. After decrypt resolves (typically 1-2 blocks), user calls this function
    ///      Reverts if no pending claim or if decrypt hasn't resolved yet.
    /// @param poolId The pool to complete the claim for
    /// @param tick The price tick of the order
    /// @param side BUY or SELL
    function claimErc20(PoolId poolId, int24 tick, BucketSide side) external whenNotPaused {
        PendingErc20Claim storage pending = pendingErc20Claims[poolId][msg.sender][tick][side];
        if (!pending.pending) revert NoPendingClaim();

        (uint256 amount, bool ready) = FHE.getDecryptResultSafe(pending.encryptedAmount);
        if (!ready) revert ClaimNotReady();

        address token = pending.token;
        delete pendingErc20Claims[poolId][msg.sender][tick][side];

        if (amount > 0) {
            IERC20(token).safeTransfer(msg.sender, amount);
        }

        emit Erc20ClaimCompleted(poolId, msg.sender, tick, side, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    LP FUNCTIONS (Plaintext - Mixed Pair)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Add liquidity to the AMM using plaintext amounts
    /// @dev Since one token is ERC20, LP operations use plaintext amounts.
    ///      First deposit uses geometric mean, subsequent deposits use proportional calculation.
    ///      Both tokens are transferred using standard ERC20 transferFrom.
    /// @param poolId The pool to add liquidity to
    /// @param amount0 Amount of token0 to deposit
    /// @param amount1 Amount of token1 to deposit
    /// @return lpAmount LP tokens minted to the caller
    function addLiquidity(
        PoolId poolId,
        uint256 amount0,
        uint256 amount1
    ) external whenNotPaused returns (uint256 lpAmount) {
        if (amount0 == 0 || amount1 == 0) revert ZeroAmount();

        PoolState storage state = poolStates[poolId];
        if (!state.initialized) revert PoolNotInitialized();

        // Transfer tokens
        IERC20(state.token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(state.token1).safeTransferFrom(msg.sender, address(this), amount1);

        // Update encrypted reserves
        euint128 encAmt0 = FHE.asEuint128(uint128(amount0));
        euint128 encAmt1 = FHE.asEuint128(uint128(amount1));
        FHE.allowThis(encAmt0);
        FHE.allowThis(encAmt1);

        PoolReserves storage reserves = poolReserves[poolId];

        // Calculate LP amount (plaintext)
        if (reserves.totalLpSupply == 0) {
            lpAmount = FheatherMath.sqrt256(amount0 * amount1);
        } else {
            uint256 lpAmount0 = (amount0 * reserves.totalLpSupply) / reserves.reserve0;
            uint256 lpAmount1 = (amount1 * reserves.totalLpSupply) / reserves.reserve1;
            lpAmount = lpAmount0 < lpAmount1 ? lpAmount0 : lpAmount1;
        }

        bool isFirstLiquidity = reserves.totalLpSupply == 0;

        // Update plaintext tracking
        lpBalances[poolId][msg.sender] += lpAmount;
        reserves.totalLpSupply += lpAmount;
        reserves.reserve0 += amount0;
        reserves.reserve1 += amount1;

        // Update encrypted reserves
        reserves.encReserve0 = FHE.add(reserves.encReserve0, encAmt0);
        reserves.encReserve1 = FHE.add(reserves.encReserve1, encAmt1);
        FHE.allowThis(reserves.encReserve0);
        FHE.allowThis(reserves.encReserve1);

        if (isFirstLiquidity) {
            lastProcessedTick[poolId] = FheatherMath.getCurrentTick(reserves.reserve0, reserves.reserve1, TICK_SPACING);
        }

        emit LiquidityAdded(poolId, msg.sender, amount0, amount1, lpAmount);
    }

    /// @notice Remove liquidity from the AMM
    /// @dev Burns LP tokens and returns proportional share of both tokens.
    ///      Both tokens are transferred using standard ERC20 transfer.
    /// @param poolId The pool to remove liquidity from
    /// @param lpAmount LP tokens to burn
    /// @return amount0 Amount of token0 returned
    /// @return amount1 Amount of token1 returned
    function removeLiquidity(
        PoolId poolId,
        uint256 lpAmount
    ) external returns (uint256 amount0, uint256 amount1) {
        if (lpAmount == 0) revert ZeroAmount();
        if (lpBalances[poolId][msg.sender] < lpAmount) revert InsufficientLiquidity();

        PoolState storage state = poolStates[poolId];
        PoolReserves storage reserves = poolReserves[poolId];

        // Calculate amounts
        amount0 = (lpAmount * reserves.reserve0) / reserves.totalLpSupply;
        amount1 = (lpAmount * reserves.reserve1) / reserves.totalLpSupply;

        // Update plaintext tracking
        lpBalances[poolId][msg.sender] -= lpAmount;
        reserves.totalLpSupply -= lpAmount;
        reserves.reserve0 -= amount0;
        reserves.reserve1 -= amount1;

        // Update encrypted reserves
        euint128 encAmt0 = FHE.asEuint128(uint128(amount0));
        euint128 encAmt1 = FHE.asEuint128(uint128(amount1));
        reserves.encReserve0 = FHE.sub(reserves.encReserve0, encAmt0);
        reserves.encReserve1 = FHE.sub(reserves.encReserve1, encAmt1);
        FHE.allowThis(reserves.encReserve0);
        FHE.allowThis(reserves.encReserve1);

        // Transfer tokens
        IERC20(state.token0).safeTransfer(msg.sender, amount0);
        IERC20(state.token1).safeTransfer(msg.sender, amount1);

        emit LiquidityRemoved(poolId, msg.sender, amount0, amount1, lpAmount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                      RESERVE SYNC (Binary Search)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Request a new reserve sync with binary search to harvest resolved requests
    function _requestReserveSync(PoolId poolId) internal {
        _harvestResolvedDecrypts(poolId);

        PoolReserves storage r = poolReserves[poolId];
        uint256 newId = r.nextRequestId;
        r.nextRequestId = newId + 1;
        pendingDecrypts[poolId][newId] = PendingDecrypt({
            reserve0: r.encReserve0,
            reserve1: r.encReserve1,
            blockNumber: block.number
        });
        FHE.decrypt(r.encReserve0);
        FHE.decrypt(r.encReserve1);

        emit ReserveSyncRequested(poolId, newId, block.number);
    }

    /// @notice Attempt to sync plaintext reserves from resolved decrypts
    /// @dev Can be called by anyone to update the plaintext reserve cache.
    ///      Useful when reserves are stale and no swaps are occurring.
    /// @param poolId The pool to sync
    function trySyncReserves(PoolId poolId) external {
        _harvestResolvedDecrypts(poolId);
    }

    /// @notice Binary search to find newest resolved pending decrypt
    function _findNewestResolvedDecrypt(PoolId poolId) internal view returns (
        uint256 newestId,
        uint256 val0,
        uint256 val1
    ) {
        PoolReserves storage r = poolReserves[poolId];
        uint256 lo = r.lastResolvedId;
        uint256 hi = r.nextRequestId > 0 ? r.nextRequestId - 1 : 0;
        val0 = r.reserve0;
        val1 = r.reserve1;
        newestId = lo;

        if (lo > hi) return (newestId, val0, val1);

        while (lo <= hi) {
            uint256 mid = lo + (hi - lo + 1) / 2;
            PendingDecrypt storage p = pendingDecrypts[poolId][mid];

            if (!Common.isInitialized(p.reserve0)) {
                if (mid == 0) break;
                hi = mid - 1;
                continue;
            }

            (uint256 v0, bool ready0) = FHE.getDecryptResultSafe(p.reserve0);
            (uint256 v1, bool ready1) = FHE.getDecryptResultSafe(p.reserve1);

            if (ready0 && ready1) {
                val0 = v0;
                val1 = v1;
                newestId = mid;
                if (mid == hi) break;
                lo = mid + 1;
            } else {
                if (mid == 0) break;
                hi = mid - 1;
            }
        }
    }

    /// @notice Apply newest resolved decrypt to storage
    function _harvestResolvedDecrypts(PoolId poolId) internal {
        (uint256 newestId, uint256 val0, uint256 val1) = _findNewestResolvedDecrypt(poolId);
        PoolReserves storage r = poolReserves[poolId];

        if (newestId > r.lastResolvedId) {
            r.reserve0 = val0;
            r.reserve1 = val1;
            r.reserveBlockNumber = pendingDecrypts[poolId][newestId].blockNumber;
            r.lastResolvedId = newestId;
            emit ReservesSynced(poolId, val0, val1, newestId);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Get the current plaintext reserves for a pool
    /// @dev Automatically checks for resolved async decrypts via binary search
    /// @param poolId The pool to query
    /// @return reserve0 Current reserve of token0 (includes resolved pending decrypts)
    /// @return reserve1 Current reserve of token1 (includes resolved pending decrypts)
    function getReserves(PoolId poolId) external view returns (uint256, uint256) {
        (, uint256 val0, uint256 val1) = _findNewestResolvedDecrypt(poolId);
        return (val0, val1);
    }

    /// @notice Get the current price tick based on reserves
    /// @dev Automatically checks for resolved async decrypts
    /// @param poolId The pool to query
    /// @return The current tick (price = 1.006^tick)
    function getCurrentTick(PoolId poolId) external view returns (int24) {
        (, uint256 val0, uint256 val1) = _findNewestResolvedDecrypt(poolId);
        return FheatherMath.getCurrentTick(val0, val1, TICK_SPACING);
    }

    /// @notice Get a quote for a swap (estimated output based on current reserves)
    /// @dev Automatically checks for resolved async decrypts
    /// @param poolId The pool to query
    /// @param zeroForOne True if swapping token0 for token1
    /// @param amountIn Amount of input tokens
    /// @return Estimated output amount (actual may differ due to price movement)
    function getQuote(PoolId poolId, bool zeroForOne, uint256 amountIn) external view returns (uint256) {
        (, uint256 val0, uint256 val1) = _findNewestResolvedDecrypt(poolId);
        uint256 reserveIn = zeroForOne ? val0 : val1;
        uint256 reserveOut = zeroForOne ? val1 : val0;
        return FheatherMath.estimateOutput(reserveIn, reserveOut, amountIn, swapFeeBps);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Pause all user-facing operations (emergency only)
    function pause() external onlyOwner { _pause(); }

    /// @notice Unpause the contract
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Set the address that receives protocol fees
    /// @param _feeCollector New fee collector address
    function setFeeCollector(address _feeCollector) external onlyOwner {
        feeCollector = _feeCollector;
    }

    /// @notice Set the protocol fee for a specific pool
    /// @param poolId The pool to configure
    /// @param _feeBps Fee in basis points (max 100 = 1%)
    function setProtocolFee(PoolId poolId, uint256 _feeBps) external onlyOwner {
        if (_feeBps > 100) revert FeeTooHigh();
        poolStates[poolId].protocolFeeBps = _feeBps;
    }

    /// @dev Check if a token implements FHERC20 interface
    /// @param token Address to check
    /// @return True if token has balanceOfEncrypted function
    function _isFherc20(address token) internal view returns (bool) {
        (bool success, ) = token.staticcall(
            abi.encodeWithSelector(bytes4(keccak256("balanceOfEncrypted(address)")), address(0))
        );
        return success;
    }
}
