// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {euint128, InEuint128} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title IPheatherXv3
/// @notice Interface for PheatherX v3 - Private Bucketed Limit Order DEX
interface IPheatherXv3 {
    // ═══════════════════════════════════════════════════════════════════════
    //                               TYPES
    // ═══════════════════════════════════════════════════════════════════════

    enum BucketSide { BUY, SELL }

    // ═══════════════════════════════════════════════════════════════════════
    //                               EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event Deposit(address indexed user, int24 indexed tick, BucketSide indexed side, bytes32 amountHash);
    event Withdraw(address indexed user, int24 indexed tick, BucketSide indexed side, bytes32 amountHash);
    event Claim(address indexed user, int24 indexed tick, BucketSide indexed side, bytes32 amountHash);
    event Swap(address indexed user, bool indexed zeroForOne, uint256 amountIn, uint256 amountOut);
    event BucketFilled(int24 indexed tick, BucketSide indexed side);
    event BucketSeeded(int24 indexed tick, BucketSide indexed side);
    event MaxBucketsPerSwapUpdated(uint256 newMax);
    event ProtocolFeeQueued(uint256 newFeeBps, uint256 effectiveTimestamp);
    event ProtocolFeeApplied(uint256 newFeeBps);
    event FeeCollectorUpdated(address newCollector);

    // ═══════════════════════════════════════════════════════════════════════
    //                          CORE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Deposit tokens into a price bucket
    /// @param tick Price tick (must be multiple of 60, in range [-6000, 6000])
    /// @param amount Encrypted amount to deposit
    /// @param side BucketSide.SELL to sell token0, BucketSide.BUY to buy token0
    /// @param deadline Transaction deadline
    /// @param maxTickDrift Maximum acceptable tick drift
    /// @return shares Shares received (1:1 with deposit)
    function deposit(
        int24 tick,
        InEuint128 calldata amount,
        BucketSide side,
        uint256 deadline,
        int24 maxTickDrift
    ) external returns (euint128 shares);

    /// @notice Execute swap
    /// @param zeroForOne True = sell token0 for token1
    /// @param amountIn Input amount
    /// @param minAmountOut Minimum output (AFTER fees)
    /// @return amountOut Output amount after fees
    function swap(
        bool zeroForOne,
        uint256 amountIn,
        uint256 minAmountOut
    ) external returns (uint256 amountOut);

    /// @notice Claim proceeds from filled orders
    /// @param tick The tick to claim from
    /// @param side The bucket side (BUY or SELL)
    /// @return proceeds The encrypted proceeds claimed
    function claim(int24 tick, BucketSide side) external returns (euint128 proceeds);

    /// @notice Withdraw unfilled liquidity
    /// @param tick The tick to withdraw from
    /// @param side The bucket side (BUY or SELL)
    /// @param amount The encrypted amount to withdraw
    /// @return withdrawn The actual encrypted amount withdrawn
    function withdraw(
        int24 tick,
        BucketSide side,
        InEuint128 calldata amount
    ) external returns (euint128 withdrawn);

    /// @notice Exit entire position (withdraw unfilled + claim proceeds)
    /// @param tick The tick to exit from
    /// @param side The bucket side (BUY or SELL)
    /// @return unfilled The unfilled liquidity returned
    /// @return proceeds The proceeds claimed
    function exit(int24 tick, BucketSide side) external returns (euint128 unfilled, euint128 proceeds);

    // ═══════════════════════════════════════════════════════════════════════
    //                          ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Set maximum buckets processed per swap
    function setMaxBucketsPerSwap(uint256 _max) external;

    /// @notice Queue a protocol fee change (2-day timelock)
    function queueProtocolFee(uint256 _feeBps) external;

    /// @notice Apply a previously queued protocol fee
    function applyProtocolFee() external;

    /// @notice Set the fee collector address
    function setFeeCollector(address _collector) external;

    /// @notice Pause the contract
    function pause() external;

    /// @notice Unpause the contract
    function unpause() external;

    /// @notice Pre-initialize buckets at specific ticks
    function seedBuckets(int24[] calldata ticks) external;

    /// @notice Initialize reserves for price estimation
    function initializeReserves(uint256 _reserve0, uint256 _reserve1) external;

    // ═══════════════════════════════════════════════════════════════════════
    //                          VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Get claimable proceeds for a user's position
    function getClaimable(address user, int24 tick, BucketSide side) external returns (euint128);

    /// @notice Get withdrawable (unfilled) amount for a user's position
    function getWithdrawable(address user, int24 tick, BucketSide side) external returns (euint128);

    /// @notice Get a user's position details
    function getPosition(address user, int24 tick, BucketSide side) external view returns (
        euint128 shares,
        euint128 proceedsSnapshot,
        euint128 filledSnapshot,
        euint128 realized
    );

    /// @notice Get bucket details
    function getBucket(int24 tick, BucketSide side) external view returns (
        euint128 totalShares,
        euint128 liquidity,
        euint128 proceedsPerShare,
        euint128 filledPerShare,
        bool initialized
    );

    /// @notice Get tick prices for multiple ticks
    function getTickPrices(int24[] calldata ticks) external view returns (uint256[] memory prices);

    // ═══════════════════════════════════════════════════════════════════════
    //                          STATE GETTERS
    // ═══════════════════════════════════════════════════════════════════════

    function token0() external view returns (address);
    function token1() external view returns (address);
    function maxBucketsPerSwap() external view returns (uint256);
    function protocolFeeBps() external view returns (uint256);
    function feeCollector() external view returns (address);
    function pendingFeeBps() external view returns (uint256);
    function feeChangeTimestamp() external view returns (uint256);
    function reserve0() external view returns (uint256);
    function reserve1() external view returns (uint256);
    function tickPrices(int24 tick) external view returns (uint256);

    // Constants
    function PRECISION() external view returns (uint256);
    function TICK_SPACING() external view returns (int24);
    function MIN_TICK() external view returns (int24);
    function MAX_TICK() external view returns (int24);
    function FEE_CHANGE_DELAY() external view returns (uint256);
}
