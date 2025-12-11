// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FHE, euint128, Common} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title FheatherXv7Lens - View-only contract for FheatherXv7
/// @author FheatherX Team
/// @notice Provides view functions for frontend to read pool state
/// @dev Separated from core contract for size optimization
contract FheatherXv7Lens {
    /// @notice Fixed-point precision for share calculations (18 decimals)
    uint256 public constant PRECISION = 1e18;

    /// @notice Tick spacing for limit orders
    int24 public constant TICK_SPACING = 60;

    /// @notice Reference to the hook contract
    IFheatherXv7 public immutable hook;

    constructor(address _hook) {
        hook = IFheatherXv7(payable(_hook));
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          POOL STATE VIEWS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Get pool state information
    function getPoolState(PoolId poolId) external view returns (
        address token0,
        address token1,
        bool token0IsFherc20,
        bool token1IsFherc20,
        bool initialized,
        uint256 maxBucketsPerSwap,
        uint256 protocolFeeBps
    ) {
        (token0, token1, token0IsFherc20, token1IsFherc20, initialized, maxBucketsPerSwap, protocolFeeBps) = hook.poolStates(poolId);
    }

    /// @notice Get pool reserves, checking for fresher values from pending decrypts
    /// @dev Uses binary search to find newest resolved pending request
    function getPoolReserves(PoolId poolId) external view returns (
        uint256 _reserve0,
        uint256 _reserve1,
        uint256 lpSupply
    ) {
        (,,,uint256 storedReserve0, uint256 storedReserve1,, uint256 nextRequestId, uint256 lastResolvedId) = hook.poolReserves(poolId);

        // Binary search to find newest resolved pending request
        uint256 lo = lastResolvedId;
        uint256 hi = nextRequestId;
        uint256 bestVal0 = storedReserve0;
        uint256 bestVal1 = storedReserve1;

        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            (euint128 reserve0Handle, euint128 reserve1Handle,) = hook.pendingDecrypts(poolId, mid);

            if (!Common.isInitialized(reserve0Handle)) {
                hi = mid - 1;
                continue;
            }

            (uint256 val0, bool ready0) = FHE.getDecryptResultSafe(reserve0Handle);
            (uint256 val1, bool ready1) = FHE.getDecryptResultSafe(reserve1Handle);

            if (ready0 && ready1) {
                bestVal0 = val0;
                bestVal1 = val1;
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }

        return (bestVal0, bestVal1, hook.totalLpSupply(poolId));
    }

    /// @notice Get cached reserves (no binary search, faster)
    function getReserves(PoolId poolId) external view returns (uint256, uint256) {
        (,,,uint256 _reserve0, uint256 _reserve1,,,) = hook.poolReserves(poolId);
        return (_reserve0, _reserve1);
    }

    /// @notice Get reserve0 for default pool
    function reserve0() external view returns (uint256) {
        PoolId poolId = hook.defaultPoolId();
        (,,,uint256 _reserve0,,,,) = hook.poolReserves(poolId);
        return _reserve0;
    }

    /// @notice Get reserve1 for default pool
    function reserve1() external view returns (uint256) {
        PoolId poolId = hook.defaultPoolId();
        (,,,,uint256 _reserve1,,,) = hook.poolReserves(poolId);
        return _reserve1;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          TICK/PRICE VIEWS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Get current tick for default pool
    function getCurrentTick() external view returns (int24) {
        return getCurrentTickForPool(hook.defaultPoolId());
    }

    /// @notice Get current tick for a specific pool
    function getCurrentTickForPool(PoolId poolId) public view returns (int24) {
        (,,,uint256 _reserve0, uint256 _reserve1,,,) = hook.poolReserves(poolId);
        if (_reserve0 == 0 || _reserve1 == 0) return 0;

        uint256 ratio;
        if (_reserve1 >= _reserve0) {
            ratio = (_reserve1 << 96) / _reserve0;
        } else {
            ratio = (_reserve0 << 96) / _reserve1;
        }

        uint160 sqrtPriceX96 = uint160(_sqrt256(ratio));

        if (sqrtPriceX96 < TickMath.MIN_SQRT_PRICE) {
            sqrtPriceX96 = TickMath.MIN_SQRT_PRICE;
        } else if (sqrtPriceX96 > TickMath.MAX_SQRT_PRICE) {
            sqrtPriceX96 = TickMath.MAX_SQRT_PRICE;
        }

        int24 tick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        tick = (tick / TICK_SPACING) * TICK_SPACING;

        return tick;
    }

    /// @notice Get tick price
    function getTickPrice(int24 tick) external pure returns (uint256) {
        uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(tick);
        uint256 sqrtPrice = uint256(sqrtPriceX96);
        uint256 sqrtPriceReduced = sqrtPrice >> 48;
        uint256 priceX96 = sqrtPriceReduced * sqrtPriceReduced;
        return (priceX96 * PRECISION) >> 96;
    }

    /// @notice Get quote for default pool
    function getQuote(bool zeroForOne, uint256 amountIn) external view returns (uint256) {
        return getQuoteForPool(hook.defaultPoolId(), zeroForOne, amountIn);
    }

    /// @notice Get quote for a specific pool
    function getQuoteForPool(PoolId poolId, bool zeroForOne, uint256 amountIn) public view returns (uint256) {
        (,,,uint256 _reserve0, uint256 _reserve1,,,) = hook.poolReserves(poolId);
        if (_reserve0 == 0 || _reserve1 == 0) return 0;

        uint256 reserveIn = zeroForOne ? _reserve0 : _reserve1;
        uint256 reserveOut = zeroForOne ? _reserve1 : _reserve0;

        uint256 swapFeeBps = hook.swapFeeBps();
        uint256 amountInWithFee = amountIn * (10000 - swapFeeBps);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 10000) + amountInWithFee;

        return numerator / denominator;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          ORDER VIEWS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Check if there are active orders at a tick
    function hasActiveOrders(PoolId poolId, int24 tick, IFheatherXv7.BucketSide side) external view returns (bool) {
        int16 wordPos = int16(tick >> 8);
        uint8 bitPos = uint8(uint24(tick) % 256);

        if (side == IFheatherXv7.BucketSide.BUY) {
            return (hook.buyBitmaps(poolId, wordPos) & (1 << bitPos)) != 0;
        } else {
            return (hook.sellBitmaps(poolId, wordPos) & (1 << bitPos)) != 0;
        }
    }

    /// @notice Alias for hasActiveOrders (compatibility)
    function hasOrdersAtTick(PoolId poolId, int24 tick, IFheatherXv7.BucketSide side) external view returns (bool) {
        int16 wordPos = int16(tick >> 8);
        uint8 bitPos = uint8(uint24(tick) % 256);

        if (side == IFheatherXv7.BucketSide.BUY) {
            return (hook.buyBitmaps(poolId, wordPos) & (1 << bitPos)) != 0;
        } else {
            return (hook.sellBitmaps(poolId, wordPos) & (1 << bitPos)) != 0;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice 256-bit square root using Newton's method
    function _sqrt256(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}

/// @notice Interface for reading FheatherXv7 state
interface IFheatherXv7 {
    enum BucketSide { BUY, SELL }

    function defaultPoolId() external view returns (PoolId);
    function swapFeeBps() external view returns (uint256);
    function totalLpSupply(PoolId poolId) external view returns (uint256);
    function buyBitmaps(PoolId poolId, int16 wordPos) external view returns (uint256);
    function sellBitmaps(PoolId poolId, int16 wordPos) external view returns (uint256);

    function poolStates(PoolId poolId) external view returns (
        address token0,
        address token1,
        bool token0IsFherc20,
        bool token1IsFherc20,
        bool initialized,
        uint256 maxBucketsPerSwap,
        uint256 protocolFeeBps
    );

    function poolReserves(PoolId poolId) external view returns (
        euint128 encReserve0,
        euint128 encReserve1,
        euint128 encTotalLpSupply,
        uint256 reserve0,
        uint256 reserve1,
        uint256 reserveBlockNumber,
        uint256 nextRequestId,
        uint256 lastResolvedId
    );

    function pendingDecrypts(PoolId poolId, uint256 requestId) external view returns (
        euint128 reserve0,
        euint128 reserve1,
        uint256 blockNumber
    );
}
