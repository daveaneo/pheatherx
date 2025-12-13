// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint128, ebool, Common} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {TickBitmapLib} from "./TickBitmapLib.sol";
import {BucketLib} from "./BucketLib.sol";
import {FheatherMath} from "./FheatherMath.sol";

/// @title OrderMatchingLib - Momentum closure and virtual slicing
/// @notice Implements the 1x AMM invariant with momentum order activation
/// @dev Core algorithms from better-matching.md:
///      - Binary search for momentum closure (find final tick t*)
///      - Division-free predicates for encrypted comparisons
///      - Virtual slicing for fair allocation to activated buckets
library OrderMatchingLib {
    using TickBitmapLib for mapping(int16 => uint256);

    /// @notice Bucket side enum (must match main contract)
    enum BucketSide { BUY, SELL }

    /// @notice Maximum tick movement per swap (safety bound)
    int24 internal constant MAX_TICK_MOVE = 600; // 10 tick spacings at 60

    /// @notice Maximum binary search iterations
    uint8 internal constant MAX_BINARY_SEARCH_ITERATIONS = 12;

    /// @notice Maximum buckets to process per swap
    uint8 internal constant MAX_BUCKETS_PER_SWAP = 5;

    /// @notice Find the final tick after momentum closure via binary search
    /// @dev Uses plaintext tick estimation with encrypted amount validation
    /// @param momentumBitmaps Bitmap for momentum orders (same direction as swap)
    /// @param buckets Bucket storage for liquidity lookup
    /// @param startTick Starting tick before swap
    /// @param zeroForOne Swap direction
    /// @param userRemainderPlaintext Plaintext estimate of user's remaining input
    /// @param reserve0 Current reserve0 (plaintext cache)
    /// @param reserve1 Current reserve1 (plaintext cache)
    /// @param tickSpacing Tick spacing for the pool
    /// @return finalTick The tick after all momentum orders activate
    /// @return activatedCount Number of momentum buckets activated
    function findMomentumClosure(
        mapping(int16 => uint256) storage momentumBitmaps,
        mapping(int24 => mapping(BucketSide => BucketLib.Bucket)) storage buckets,
        int24 startTick,
        bool zeroForOne,
        uint256 userRemainderPlaintext,
        uint256 reserve0,
        uint256 reserve1,
        int24 tickSpacing
    ) internal view returns (int24 finalTick, uint8 activatedCount) {
        // Determine search bounds based on direction
        // BUY (zeroForOne=true): price decreases, search lower ticks
        // SELL (zeroForOne=false): price increases, search higher ticks
        int24 boundaryTick;
        if (zeroForOne) {
            boundaryTick = startTick - MAX_TICK_MOVE;
            if (boundaryTick < -887220) boundaryTick = -887220; // MIN_TICK approx
        } else {
            boundaryTick = startTick + MAX_TICK_MOVE;
            if (boundaryTick > 887220) boundaryTick = 887220; // MAX_TICK approx
        }

        // Which side has momentum orders (same direction as swap)
        BucketSide momentumSide = zeroForOne ? BucketSide.SELL : BucketSide.BUY;

        // Binary search for final tick
        int24 lo = zeroForOne ? boundaryTick : startTick;
        int24 hi = zeroForOne ? startTick : boundaryTick;

        finalTick = startTick;
        activatedCount = 0;

        for (uint8 i = 0; i < MAX_BINARY_SEARCH_ITERATIONS; i++) {
            if (lo >= hi) break;

            int24 mid = lo + (hi - lo) / 2;
            // Round to tick spacing
            mid = (mid / tickSpacing) * tickSpacing;

            // Count buckets and sum liquidity in range [startTick, mid] or [mid, startTick]
            (uint256 momentumSum, uint8 bucketCount) = _sumMomentumBucketsPlaintext(
                momentumBitmaps,
                buckets,
                startTick,
                mid,
                zeroForOne,
                momentumSide,
                tickSpacing
            );

            // Total input = user remainder + momentum sum
            uint256 totalInput = userRemainderPlaintext + momentumSum;

            // Check if total input pushes price beyond mid
            bool crossesMid = _predicateCrossesTickPlaintext(
                reserve0,
                reserve1,
                totalInput,
                mid,
                zeroForOne
            );

            if (crossesMid) {
                // Price moves beyond mid, search further
                if (zeroForOne) {
                    hi = mid;
                } else {
                    lo = mid + tickSpacing;
                }
                finalTick = mid;
                activatedCount = bucketCount;
            } else {
                // Price doesn't reach mid, search closer
                if (zeroForOne) {
                    lo = mid + tickSpacing;
                } else {
                    hi = mid;
                }
            }
        }

        // Cap activated buckets
        if (activatedCount > MAX_BUCKETS_PER_SWAP) {
            activatedCount = MAX_BUCKETS_PER_SWAP;
        }
    }

    /// @notice Sum momentum bucket liquidity in a tick range (plaintext estimate)
    /// @dev Used for binary search - returns plaintext estimates
    function _sumMomentumBucketsPlaintext(
        mapping(int16 => uint256) storage bitmap,
        mapping(int24 => mapping(BucketSide => BucketLib.Bucket)) storage buckets,
        int24 fromTick,
        int24 toTick,
        bool zeroForOne,
        BucketSide side,
        int24 tickSpacing
    ) internal view returns (uint256 totalLiquidity, uint8 bucketCount) {
        // Determine iteration direction
        bool searchLower = zeroForOne; // BUY searches lower ticks

        int24 current = fromTick;
        uint8 maxBuckets = MAX_BUCKETS_PER_SWAP;

        while (bucketCount < maxBuckets) {
            // Find next initialized tick
            (int24 nextTick, bool found) = TickBitmapLib.findNextInitializedTick(
                bitmap,
                current,
                tickSpacing,
                searchLower,
                2 // max words to search
            );

            if (!found) break;

            // Check if tick is within range
            if (zeroForOne) {
                if (nextTick < toTick) break;
            } else {
                if (nextTick > toTick) break;
            }

            // Add bucket liquidity (use initialized check as proxy for non-zero)
            BucketLib.Bucket storage bucket = buckets[nextTick][side];
            if (bucket.initialized) {
                // We can't decrypt liquidity here, so use a heuristic
                // In practice, this could be a stored plaintext estimate
                // For now, count as 1 unit per bucket for binary search
                totalLiquidity += 1e18; // Placeholder - actual impl needs plaintext cache
                bucketCount++;
            }

            // Move to next position
            current = zeroForOne ? nextTick - tickSpacing : nextTick + tickSpacing;
        }
    }

    /// @notice Sum momentum bucket liquidity (encrypted version)
    /// @dev Used after closure is found to get actual encrypted sum
    function sumMomentumBucketsEnc(
        mapping(int16 => uint256) storage bitmap,
        mapping(int24 => mapping(BucketSide => BucketLib.Bucket)) storage buckets,
        int24 fromTick,
        int24 toTick,
        bool zeroForOne,
        BucketSide side,
        int24 tickSpacing,
        euint128 encZero
    ) internal returns (euint128 totalLiquidity) {
        totalLiquidity = encZero;
        bool searchLower = zeroForOne;
        int24 current = fromTick;
        uint8 count = 0;

        while (count < MAX_BUCKETS_PER_SWAP) {
            (int24 nextTick, bool found) = TickBitmapLib.findNextInitializedTick(
                bitmap,
                current,
                tickSpacing,
                searchLower,
                2
            );

            if (!found) break;

            // Check if tick is within range
            if (zeroForOne) {
                if (nextTick < toTick) break;
            } else {
                if (nextTick > toTick) break;
            }

            BucketLib.Bucket storage bucket = buckets[nextTick][side];
            if (bucket.initialized && Common.isInitialized(bucket.liquidity)) {
                totalLiquidity = FHE.add(totalLiquidity, bucket.liquidity);
                FHE.allowThis(totalLiquidity);
                count++;
            }

            current = zeroForOne ? nextTick - tickSpacing : nextTick + tickSpacing;
        }
    }

    /// @notice Division-free predicate: does input push price beyond target tick?
    /// @dev For BUY (zeroForOne): check if (y0+dy)^2 >= k * p(tick)
    ///      For SELL (!zeroForOne): check if k <= p(tick) * (x0+dx)^2
    /// @param reserve0 Current reserve0
    /// @param reserve1 Current reserve1
    /// @param amountIn Total input amount
    /// @param targetTick Tick to check against
    /// @param zeroForOne Swap direction
    /// @return True if price crosses target tick
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
            // BUY: adding to reserve0, taking from reserve1
            // New price p1 = (reserve1 - out) / (reserve0 + in)
            // After swap: reserve0' = reserve0 + amountIn
            // k = reserve0' * reserve1', so reserve1' = k / reserve0'
            // p1 = reserve1' / reserve0' = k / (reserve0')^2

            // Check: k / (reserve0 + amountIn)^2 <= targetPrice
            // Rearranged: k <= targetPrice * (reserve0 + amountIn)^2

            uint256 newReserve0 = reserve0 + amountIn;
            uint256 newReserve0Sq = newReserve0 * newReserve0;

            // Scale targetPrice from 1e18 to match k scale
            // k is in token units^2, targetPrice is in 1e18 scale
            // We need: k * 1e18 <= targetPrice * newReserve0Sq
            return k * 1e18 <= targetPrice * newReserve0Sq;
        } else {
            // SELL: adding to reserve1, taking from reserve0
            // Check: k / (reserve1 + amountIn)^2 >= targetPrice (price goes up)
            // Rearranged: k >= targetPrice * (reserve1 + amountIn)^2

            uint256 newReserve1 = reserve1 + amountIn;
            uint256 newReserve1Sq = newReserve1 * newReserve1;

            return k * 1e18 >= targetPrice * newReserve1Sq;
        }
    }

    /// @notice Allocate AMM output fairly to activated momentum buckets
    /// @dev Uses pro-rata allocation based on input share
    /// @param buckets Bucket storage
    /// @param bitmap Momentum bitmap
    /// @param fromTick Starting tick
    /// @param toTick Ending tick (after closure)
    /// @param zeroForOne Swap direction
    /// @param side Bucket side for momentum orders
    /// @param tickSpacing Tick spacing
    /// @param totalMomentumInput Total momentum input (encrypted)
    /// @param totalOutput Total AMM output to distribute (encrypted)
    /// @param encZero Pre-computed zero
    /// @param encOne Pre-computed one
    /// @param encPrecision Pre-computed precision
    function allocateVirtualSlicing(
        mapping(int24 => mapping(BucketSide => BucketLib.Bucket)) storage buckets,
        mapping(int16 => uint256) storage bitmap,
        int24 fromTick,
        int24 toTick,
        bool zeroForOne,
        BucketSide side,
        int24 tickSpacing,
        euint128 totalMomentumInput,
        euint128 totalOutput,
        euint128 encZero,
        euint128 encOne,
        euint128 encPrecision
    ) internal {
        // Safe denominator for division
        ebool hasInput = FHE.gt(totalMomentumInput, encZero);
        euint128 safeDenom = FHE.select(hasInput, totalMomentumInput, encOne);
        FHE.allowThis(safeDenom);

        bool searchLower = zeroForOne;
        int24 current = fromTick;
        uint8 count = 0;

        while (count < MAX_BUCKETS_PER_SWAP) {
            (int24 nextTick, bool found) = TickBitmapLib.findNextInitializedTick(
                bitmap,
                current,
                tickSpacing,
                searchLower,
                2
            );

            if (!found) break;

            // Check if tick is within range
            if (zeroForOne) {
                if (nextTick < toTick) break;
            } else {
                if (nextTick > toTick) break;
            }

            BucketLib.Bucket storage bucket = buckets[nextTick][side];
            if (bucket.initialized && Common.isInitialized(bucket.liquidity)) {
                // Calculate bucket's share: (bucket.liquidity / totalMomentumInput) * totalOutput
                euint128 bucketOutput = FHE.div(
                    FHE.mul(bucket.liquidity, totalOutput),
                    safeDenom
                );
                FHE.allowThis(bucketOutput);

                // Update bucket accounting
                BucketLib.updateOnFill(
                    bucket,
                    bucket.liquidity, // All liquidity is consumed
                    bucketOutput,
                    encZero,
                    encOne,
                    encPrecision
                );

                // Clear bucket liquidity (fully consumed)
                bucket.liquidity = encZero;
                FHE.allowThis(bucket.liquidity);

                count++;
            }

            current = zeroForOne ? nextTick - tickSpacing : nextTick + tickSpacing;
        }
    }
}
