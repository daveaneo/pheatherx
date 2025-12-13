// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @title FheatherMath - Pure math operations for FheatherX
/// @notice Extracted from FheatherX for contract size optimization
/// @dev All functions are pure/internal to minimize gas overhead
library FheatherMath {
    /// @notice Fixed-point precision for share calculations (18 decimals)
    uint256 internal constant PRECISION = 1e18;

    /// @notice 256-bit square root using Newton's method
    /// @param x The value to compute the square root of
    /// @return y The square root of x
    function sqrt256(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    /// @notice Convert tick to price using Uniswap's TickMath library
    /// @dev Converts sqrtPriceX96 (Q64.96) to our price format (1e18 scale)
    /// @param tick The tick value
    /// @return price The price scaled by PRECISION (1e18)
    function calculateTickPrice(int24 tick) internal pure returns (uint256) {
        // Get sqrtPriceX96 from Uniswap's TickMath (Q64.96 format)
        uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(tick);

        // Convert sqrtPriceX96 to price:
        // sqrtPriceX96 = sqrt(price) * 2^96
        // price = (sqrtPriceX96 / 2^96)^2 = sqrtPriceX96^2 / 2^192
        //
        // To get price in 1e18 scale:
        // price_1e18 = sqrtPriceX96^2 * 1e18 / 2^192
        //
        // Safe approach: divide sqrtPrice by 2^48 first, then square, then adjust
        // (sqrtPrice >> 48)^2 gives us price * 2^96
        // Then multiply by 1e18 and divide by 2^96

        uint256 sqrtPriceReduced = uint256(sqrtPriceX96) >> 48;
        uint256 priceX96 = sqrtPriceReduced * sqrtPriceReduced;

        return (priceX96 * PRECISION) >> 96;
    }

    /// @notice Estimate swap output using x*y=k formula
    /// @param reserveIn Input reserve
    /// @param reserveOut Output reserve
    /// @param amountIn Input amount
    /// @param feeBps Fee in basis points
    /// @return Output amount after fee
    function estimateOutput(
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 amountIn,
        uint256 feeBps
    ) internal pure returns (uint256) {
        if (reserveIn == 0 || reserveOut == 0) return 0;

        uint256 amountInWithFee = amountIn * (10000 - feeBps);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 10000) + amountInWithFee;

        return numerator / denominator;
    }

    /// @notice Absolute value for int24
    /// @param x The value
    /// @return The absolute value
    function abs(int24 x) internal pure returns (int24) {
        return x >= 0 ? x : -x;
    }

    /// @notice Calculate current tick from reserve ratio
    /// @dev Converts price to sqrtPriceX96, then uses getTickAtSqrtPrice
    /// @param reserve0 Reserve of token0
    /// @param reserve1 Reserve of token1
    /// @param tickSpacing Tick spacing for rounding
    /// @return tick The current tick (rounded to tick spacing)
    function getCurrentTick(
        uint256 reserve0,
        uint256 reserve1,
        int24 tickSpacing
    ) internal pure returns (int24 tick) {
        if (reserve0 == 0 || reserve1 == 0) return 0;

        // price = reserve1 / reserve0
        // sqrtPriceX96 = sqrt(price) * 2^96

        uint256 ratio;
        if (reserve1 >= reserve0) {
            ratio = (reserve1 << 96) / reserve0;
        } else {
            ratio = (reserve0 << 96) / reserve1;
        }

        // Compute sqrt using Newton's method
        uint160 sqrtPriceX96 = uint160(sqrt256(ratio));

        // Clamp to valid range
        if (sqrtPriceX96 < TickMath.MIN_SQRT_PRICE) {
            sqrtPriceX96 = TickMath.MIN_SQRT_PRICE;
        } else if (sqrtPriceX96 > TickMath.MAX_SQRT_PRICE) {
            sqrtPriceX96 = TickMath.MAX_SQRT_PRICE;
        }

        // Get tick from sqrt price
        tick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);

        // Round to nearest valid tick (divisible by tickSpacing)
        tick = (tick / tickSpacing) * tickSpacing;
    }
}
