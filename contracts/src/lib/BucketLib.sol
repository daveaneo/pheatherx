// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint128, ebool, Common} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title BucketLib - Limit order bucket operations
/// @notice Extracted from FheatherX for contract size optimization
/// @dev Handles bucket initialization, fills, and user position calculations
library BucketLib {
    /// @notice Fixed-point precision for share calculations (18 decimals)
    uint256 internal constant PRECISION = 1e18;

    /// @notice Represents a price bucket containing aggregated liquidity at a specific tick
    struct Bucket {
        euint128 totalShares;
        euint128 liquidity;
        euint128 proceedsPerShare;
        euint128 filledPerShare;
        bool initialized;
    }

    /// @notice Represents a user's position in a specific bucket
    struct UserPosition {
        euint128 shares;
        euint128 proceedsPerShareSnapshot;
        euint128 filledPerShareSnapshot;
        euint128 realizedProceeds;
    }

    /// @notice Initialize a new bucket with zero values
    /// @param bucket The bucket to initialize
    /// @param encZero Pre-computed encrypted zero constant
    function initialize(
        Bucket storage bucket,
        euint128 encZero
    ) internal {
        bucket.totalShares = encZero;
        bucket.liquidity = encZero;
        bucket.proceedsPerShare = encZero;
        bucket.filledPerShare = encZero;
        bucket.initialized = true;

        FHE.allowThis(bucket.totalShares);
        FHE.allowThis(bucket.liquidity);
        FHE.allowThis(bucket.proceedsPerShare);
        FHE.allowThis(bucket.filledPerShare);
    }

    /// @notice Update bucket accumulators when a fill occurs
    /// @param bucket The bucket being filled
    /// @param fillAmount Amount being filled from bucket liquidity
    /// @param proceedsAmount Proceeds going to bucket depositors
    /// @param encZero Pre-computed encrypted zero
    /// @param encOne Pre-computed encrypted one
    /// @param encPrecision Pre-computed encrypted precision
    function updateOnFill(
        Bucket storage bucket,
        euint128 fillAmount,
        euint128 proceedsAmount,
        euint128 encZero,
        euint128 encOne,
        euint128 encPrecision
    ) internal {
        ebool hasShares = FHE.gt(bucket.totalShares, encZero);
        euint128 safeDenom = FHE.select(hasShares, bucket.totalShares, encOne);
        FHE.allowThis(safeDenom);

        // Update proceeds per share
        euint128 proceedsInc = FHE.div(FHE.mul(proceedsAmount, encPrecision), safeDenom);
        proceedsInc = FHE.select(hasShares, proceedsInc, encZero);
        FHE.allowThis(proceedsInc);
        bucket.proceedsPerShare = FHE.add(bucket.proceedsPerShare, proceedsInc);

        // Update filled per share
        euint128 filledInc = FHE.div(FHE.mul(fillAmount, encPrecision), safeDenom);
        filledInc = FHE.select(hasShares, filledInc, encZero);
        FHE.allowThis(filledInc);
        bucket.filledPerShare = FHE.add(bucket.filledPerShare, filledInc);

        FHE.allowThis(bucket.proceedsPerShare);
        FHE.allowThis(bucket.filledPerShare);
    }

    /// @notice Conditionally update bucket accumulators when a fill occurs
    /// @dev Used for encrypted direction swaps where both sides are evaluated but only one applies
    /// @param bucket The bucket being filled
    /// @param fillAmount Amount being filled from bucket liquidity
    /// @param proceedsAmount Proceeds going to bucket depositors
    /// @param encZero Pre-computed encrypted zero
    /// @param encOne Pre-computed encrypted one
    /// @param encPrecision Pre-computed encrypted precision
    /// @param shouldApply Encrypted boolean - only apply if true
    function updateOnFillConditional(
        Bucket storage bucket,
        euint128 fillAmount,
        euint128 proceedsAmount,
        euint128 encZero,
        euint128 encOne,
        euint128 encPrecision,
        ebool shouldApply
    ) internal {
        ebool hasShares = FHE.gt(bucket.totalShares, encZero);
        euint128 safeDenom = FHE.select(hasShares, bucket.totalShares, encOne);
        FHE.allowThis(safeDenom);

        // Calculate proceeds increment (but conditionally apply)
        euint128 proceedsInc = FHE.div(FHE.mul(proceedsAmount, encPrecision), safeDenom);
        proceedsInc = FHE.select(hasShares, proceedsInc, encZero);
        // Only apply if shouldApply is true
        proceedsInc = FHE.select(shouldApply, proceedsInc, encZero);
        FHE.allowThis(proceedsInc);
        bucket.proceedsPerShare = FHE.add(bucket.proceedsPerShare, proceedsInc);

        // Calculate filled increment (but conditionally apply)
        euint128 filledInc = FHE.div(FHE.mul(fillAmount, encPrecision), safeDenom);
        filledInc = FHE.select(hasShares, filledInc, encZero);
        // Only apply if shouldApply is true
        filledInc = FHE.select(shouldApply, filledInc, encZero);
        FHE.allowThis(filledInc);
        bucket.filledPerShare = FHE.add(bucket.filledPerShare, filledInc);

        FHE.allowThis(bucket.proceedsPerShare);
        FHE.allowThis(bucket.filledPerShare);
    }

    /// @notice Calculate pending proceeds for a user position
    /// @param pos User's position
    /// @param bucket The bucket the position is in
    /// @param encZero Pre-computed encrypted zero
    /// @param encPrecision Pre-computed encrypted precision
    /// @return Pending proceeds amount (encrypted)
    function calculateProceeds(
        UserPosition storage pos,
        Bucket storage bucket,
        euint128 encZero,
        euint128 encPrecision
    ) internal returns (euint128) {
        if (!Common.isInitialized(pos.shares)) {
            return encZero;
        }
        euint128 delta = FHE.sub(bucket.proceedsPerShare, pos.proceedsPerShareSnapshot);
        return FHE.div(FHE.mul(pos.shares, delta), encPrecision);
    }

    /// @notice Calculate unfilled shares for a user position
    /// @param pos User's position
    /// @param bucket The bucket the position is in
    /// @param encZero Pre-computed encrypted zero
    /// @param encPrecision Pre-computed encrypted precision
    /// @return Unfilled shares amount (encrypted)
    function calculateUnfilled(
        UserPosition storage pos,
        Bucket storage bucket,
        euint128 encZero,
        euint128 encPrecision
    ) internal returns (euint128) {
        if (!Common.isInitialized(pos.shares)) {
            return encZero;
        }
        euint128 delta = FHE.sub(bucket.filledPerShare, pos.filledPerShareSnapshot);
        euint128 filled = FHE.div(FHE.mul(pos.shares, delta), encPrecision);
        ebool hasUnfilled = FHE.gte(pos.shares, filled);
        return FHE.select(hasUnfilled, FHE.sub(pos.shares, filled), encZero);
    }

    /// @notice Auto-claim pending proceeds into realized proceeds
    /// @param pos User's position
    /// @param bucket The bucket the position is in
    /// @param encPrecision Pre-computed encrypted precision
    function autoClaim(
        UserPosition storage pos,
        Bucket storage bucket,
        euint128 encPrecision
    ) internal {
        euint128 proceedsDelta = FHE.sub(bucket.proceedsPerShare, pos.proceedsPerShareSnapshot);
        euint128 pendingProceeds = FHE.div(FHE.mul(pos.shares, proceedsDelta), encPrecision);
        if (Common.isInitialized(pos.realizedProceeds)) {
            pos.realizedProceeds = FHE.add(pos.realizedProceeds, pendingProceeds);
        } else {
            pos.realizedProceeds = pendingProceeds;
        }
        FHE.allowThis(pos.realizedProceeds);
    }
}
