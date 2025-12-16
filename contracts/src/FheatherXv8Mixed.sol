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
import {FHE, euint128, ebool, InEuint128, Common} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
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

/// @title FheatherX v8 Mixed - FHE:ERC and ERC:FHE Pools
/// @notice Uniswap v4 Hook for mixed token pair pools
/// @dev Optimized for pools where exactly one token is FHERC20
///      Key features:
///      1. Momentum closure with binary search
///      2. Virtual slicing for fair allocation
///      3. 1x AMM update per swap
///      4. Plaintext LP functions (since one token is ERC20)
contract FheatherXv8Mixed is BaseHook, Pausable, Ownable {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using TickBitmapLib for mapping(int16 => uint256);

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    uint256 public constant PRECISION = 1e18;
    int24 public constant TICK_SPACING = 60;
    int24 public constant MIN_TICK = TickMath.MIN_TICK;
    int24 public constant MAX_TICK = TickMath.MAX_TICK;
    int24 internal constant MAX_TICK_MOVE = 600;
    uint8 internal constant MAX_MOMENTUM_BUCKETS = 5;
    uint8 internal constant BINARY_SEARCH_ITERATIONS = 12;

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error ZeroAmount();
    error PoolNotInitialized();
    error SlippageExceeded();
    error InsufficientLiquidity();
    error InvalidTick();
    error DeadlineExpired();
    error PriceMoved();
    error FeeTooHigh();
    error NotMixedPair();
    error InputTokenMustBeFherc20();
    error NoPendingClaim();
    error ClaimNotReady();

    // ═══════════════════════════════════════════════════════════════════════
    //                               TYPES
    // ═══════════════════════════════════════════════════════════════════════

    enum BucketSide { BUY, SELL }

    struct PoolState {
        address token0;
        address token1;
        bool token0IsFherc20;
        bool token1IsFherc20;
        bool initialized;
        uint256 protocolFeeBps;
    }

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

    struct PendingDecrypt {
        euint128 reserve0;
        euint128 reserve1;
        uint256 blockNumber;
    }

    struct PendingErc20Claim {
        euint128 encryptedAmount;
        address token;
        uint256 requestedAt;
        bool pending;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                               STATE
    // ═══════════════════════════════════════════════════════════════════════

    euint128 internal immutable ENC_ZERO;
    euint128 internal immutable ENC_PRECISION;
    euint128 internal immutable ENC_ONE;
    euint128 internal immutable ENC_SWAP_FEE_BPS;
    euint128 internal immutable ENC_TEN_THOUSAND;

    mapping(PoolId => PoolState) public poolStates;
    mapping(PoolId => PoolReserves) public poolReserves;
    mapping(PoolId => mapping(uint256 => PendingDecrypt)) public pendingDecrypts;
    mapping(PoolId => mapping(address => uint256)) public lpBalances;
    mapping(PoolId => mapping(int24 => mapping(BucketSide => BucketLib.Bucket))) public buckets;
    mapping(PoolId => mapping(address => mapping(int24 => mapping(BucketSide => BucketLib.UserPosition)))) public positions;
    mapping(PoolId => mapping(int16 => uint256)) internal buyBitmaps;
    mapping(PoolId => mapping(int16 => uint256)) internal sellBitmaps;
    mapping(PoolId => int24) public lastProcessedTick;
    mapping(PoolId => mapping(address => mapping(int24 => mapping(BucketSide => PendingErc20Claim)))) public pendingErc20Claims;

    address public feeCollector;
    uint256 public swapFeeBps;

    // ═══════════════════════════════════════════════════════════════════════
    //                               EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event PoolInitialized(PoolId indexed poolId, address token0, address token1, bool token0IsFherc20, bool token1IsFherc20);
    event SwapExecuted(PoolId indexed poolId, address indexed user, bool zeroForOne, uint256 amountIn, uint256 amountOut);
    event MomentumActivated(PoolId indexed poolId, int24 fromTick, int24 toTick, uint8 bucketsActivated);
    event Deposit(PoolId indexed poolId, address indexed user, int24 tick, BucketSide side);
    event Withdraw(PoolId indexed poolId, address indexed user, int24 tick, BucketSide side);
    event Claim(PoolId indexed poolId, address indexed user, int24 tick, BucketSide side);
    event Erc20ClaimQueued(PoolId indexed poolId, address indexed user, int24 tick, BucketSide side, address token);
    event Erc20ClaimCompleted(PoolId indexed poolId, address indexed user, int24 tick, BucketSide side, uint256 amount);
    event LiquidityAdded(PoolId indexed poolId, address indexed user, uint256 amount0, uint256 amount1, uint256 lpAmount);
    event LiquidityRemoved(PoolId indexed poolId, address indexed user, uint256 amount0, uint256 amount1, uint256 lpAmount);
    event ReserveSyncRequested(PoolId indexed poolId, uint256 indexed requestId, uint256 blockNumber);
    event ReservesSynced(PoolId indexed poolId, uint256 reserve0, uint256 reserve1, uint256 indexed requestId);

    // ═══════════════════════════════════════════════════════════════════════
    //                           CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

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
        bytes calldata
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        PoolId poolId = key.toId();
        if (!poolStates[poolId].initialized) {
            return (this.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        }

        SwapLockTransient.enforceOnce(poolId);

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

    function _findMomentumClosure(
        PoolId poolId,
        bool zeroForOne,
        uint256 userRemainderPlaintext,
        int24 startTick
    ) internal view returns (int24 finalTick, uint8 activatedCount) {
        PoolReserves storage reserves = poolReserves[poolId];
        BucketSide momentumSide = zeroForOne ? BucketSide.SELL : BucketSide.BUY;
        mapping(int16 => uint256) storage bitmap = momentumSide == BucketSide.SELL
            ? sellBitmaps[poolId] : buyBitmaps[poolId];

        int24 boundaryTick = zeroForOne ? startTick - MAX_TICK_MOVE : startTick + MAX_TICK_MOVE;
        int24 lo = zeroForOne ? boundaryTick : startTick;
        int24 hi = zeroForOne ? startTick : boundaryTick;

        finalTick = startTick;
        activatedCount = 0;

        for (uint8 i = 0; i < BINARY_SEARCH_ITERATIONS; i++) {
            if (lo >= hi) break;
            int24 mid = lo + (hi - lo) / 2;
            mid = (mid / TICK_SPACING) * TICK_SPACING;

            uint8 bucketCount = _countMomentumBuckets(bitmap, startTick, mid, zeroForOne);
            uint256 momentumEstimate = uint256(bucketCount) * 1e18;
            uint256 totalInput = userRemainderPlaintext + momentumEstimate;

            bool crossesMid = _predicateCrossesTickPlaintext(
                reserves.reserve0, reserves.reserve1, totalInput, mid, zeroForOne
            );

            if (crossesMid) {
                if (zeroForOne) hi = mid; else lo = mid + TICK_SPACING;
                finalTick = mid;
                activatedCount = bucketCount;
            } else {
                if (zeroForOne) lo = mid + TICK_SPACING; else hi = mid;
            }
        }

        if (activatedCount > MAX_MOMENTUM_BUCKETS) activatedCount = MAX_MOMENTUM_BUCKETS;
    }

    function _countMomentumBuckets(
        mapping(int16 => uint256) storage bitmap,
        int24 fromTick,
        int24 toTick,
        bool zeroForOne
    ) internal view returns (uint8 count) {
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

    function _predicateCrossesTickPlaintext(
        uint256 reserve0,
        uint256 reserve1,
        uint256 amountIn,
        int24 targetTick,
        bool zeroForOne
    ) internal pure returns (bool) {
        if (reserve0 == 0 || reserve1 == 0) return false;
        uint256 k = reserve0 * reserve1;
        uint256 targetPrice = FheatherMath.calculateTickPrice(targetTick);

        if (zeroForOne) {
            uint256 newReserve0 = reserve0 + amountIn;
            return k * 1e18 <= targetPrice * newReserve0 * newReserve0;
        } else {
            uint256 newReserve1 = reserve1 + amountIn;
            return k * 1e18 >= targetPrice * newReserve1 * newReserve1;
        }
    }

    function _sumMomentumBucketsEnc(
        PoolId poolId,
        bool zeroForOne,
        int24 fromTick,
        int24 toTick
    ) internal returns (euint128 totalLiquidity) {
        BucketSide side = zeroForOne ? BucketSide.SELL : BucketSide.BUY;
        mapping(int16 => uint256) storage bitmap = side == BucketSide.SELL
            ? sellBitmaps[poolId] : buyBitmaps[poolId];

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
                totalLiquidity = FHE.add(totalLiquidity, bucket.liquidity);
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
    //                    LIMIT ORDER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

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

    /// @notice Complete an ERC20 claim after decrypt has resolved
    /// @dev Call this after claim() when proceeds are ERC20 (not FHERC20)
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

    function getReserves(PoolId poolId) external view returns (uint256, uint256) {
        PoolReserves storage r = poolReserves[poolId];
        return (r.reserve0, r.reserve1);
    }

    function getCurrentTick(PoolId poolId) external view returns (int24) {
        PoolReserves storage r = poolReserves[poolId];
        return FheatherMath.getCurrentTick(r.reserve0, r.reserve1, TICK_SPACING);
    }

    function getQuote(PoolId poolId, bool zeroForOne, uint256 amountIn) external view returns (uint256) {
        PoolReserves storage r = poolReserves[poolId];
        uint256 reserveIn = zeroForOne ? r.reserve0 : r.reserve1;
        uint256 reserveOut = zeroForOne ? r.reserve1 : r.reserve0;
        return FheatherMath.estimateOutput(reserveIn, reserveOut, amountIn, swapFeeBps);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        feeCollector = _feeCollector;
    }

    function setProtocolFee(PoolId poolId, uint256 _feeBps) external onlyOwner {
        if (_feeBps > 100) revert FeeTooHigh();
        poolStates[poolId].protocolFeeBps = _feeBps;
    }

    function _isFherc20(address token) internal view returns (bool) {
        (bool success, ) = token.staticcall(
            abi.encodeWithSelector(bytes4(keccak256("balanceOfEncrypted(address)")), address(0))
        );
        return success;
    }
}
