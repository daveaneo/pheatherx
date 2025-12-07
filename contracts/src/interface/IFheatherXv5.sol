// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {euint128, InEuint128, InEbool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title IFheatherXv5 - Interface for FheatherX v5 Hybrid Encrypted AMM
/// @notice Interface for the combined encrypted AMM + gas-optimized limit order hook
interface IFheatherXv5 {
    // ═══════════════════════════════════════════════════════════════════════
    //                              TYPES
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Indicates whether a bucket contains buy or sell orders
    enum BucketSide { BUY, SELL }

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event PoolInitialized(PoolId indexed poolId, address token0, address token1);
    event Swap(PoolId indexed poolId, address indexed user, bool indexed zeroForOne, uint256 amountIn, uint256 amountOut);
    event SwapEncrypted(PoolId indexed poolId, address indexed user);
    event BucketFilled(PoolId indexed poolId, int24 indexed tick, BucketSide side);
    event Deposit(PoolId indexed poolId, address indexed user, int24 indexed tick, BucketSide side, bytes32 amountHash);
    event Withdraw(PoolId indexed poolId, address indexed user, int24 indexed tick, BucketSide side, bytes32 amountHash);
    event Claim(PoolId indexed poolId, address indexed user, int24 indexed tick, BucketSide side, bytes32 amountHash);
    event LiquidityAdded(PoolId indexed poolId, address indexed user, uint256 amount0, uint256 amount1, uint256 lpAmount);
    event LiquidityRemoved(PoolId indexed poolId, address indexed user, uint256 amount0, uint256 amount1, uint256 lpAmount);
    event LiquidityAddedEncrypted(PoolId indexed poolId, address indexed user);
    event LiquidityRemovedEncrypted(PoolId indexed poolId, address indexed user);
    event ReserveSyncRequested(PoolId indexed poolId, uint256 blockNumber);
    event ReservesSynced(PoolId indexed poolId, uint256 reserve0, uint256 reserve1);
    event ProtocolFeeQueued(PoolId indexed poolId, uint256 newFeeBps, uint256 effectiveTimestamp);
    event ProtocolFeeApplied(PoolId indexed poolId, uint256 newFeeBps);
    event FeeCollectorUpdated(address newCollector);

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error InvalidTick();
    error PoolNotInitialized();
    error ZeroAmount();
    error InsufficientBalance();
    error InsufficientLiquidity();
    error DeadlineExpired();
    error PriceMoved();
    error SlippageExceeded();
    error FeeTooHigh();
    error FeeChangeNotReady();

    // ═══════════════════════════════════════════════════════════════════════
    //                         LIMIT ORDER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Deposit tokens into a limit order bucket
    /// @param poolId The pool ID
    /// @param tick The tick at which to place the order
    /// @param side Whether this is a BUY or SELL order
    /// @param encryptedAmount The encrypted amount to deposit
    /// @param deadline Transaction deadline timestamp
    /// @param maxTickDrift Maximum allowed tick drift from current price
    function deposit(
        PoolId poolId,
        int24 tick,
        BucketSide side,
        InEuint128 calldata encryptedAmount,
        uint256 deadline,
        int24 maxTickDrift
    ) external;

    /// @notice Withdraw unfilled tokens from a limit order bucket
    /// @param poolId The pool ID
    /// @param tick The tick of the order
    /// @param side The side of the order
    /// @param encryptedAmount The encrypted amount to withdraw
    function withdraw(
        PoolId poolId,
        int24 tick,
        BucketSide side,
        InEuint128 calldata encryptedAmount
    ) external;

    /// @notice Claim proceeds from filled orders
    /// @param poolId The pool ID
    /// @param tick The tick of the order
    /// @param side The side of the order
    function claim(
        PoolId poolId,
        int24 tick,
        BucketSide side
    ) external;

    /// @notice Exit entire position (withdraw unfilled + claim proceeds)
    /// @param poolId The pool ID
    /// @param tick The tick of the order
    /// @param side The side of the order
    function exit(
        PoolId poolId,
        int24 tick,
        BucketSide side
    ) external;

    // ═══════════════════════════════════════════════════════════════════════
    //                         LP FUNCTIONS (Plaintext)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Add liquidity to encrypted AMM (plaintext path)
    /// @param poolId The pool ID
    /// @param amount0 Amount of token0 to add
    /// @param amount1 Amount of token1 to add
    /// @return lpAmount LP tokens minted
    function addLiquidity(
        PoolId poolId,
        uint256 amount0,
        uint256 amount1
    ) external returns (uint256 lpAmount);

    /// @notice Remove liquidity from encrypted AMM
    /// @param poolId The pool ID
    /// @param lpAmount LP tokens to burn
    /// @return amount0 Token0 received
    /// @return amount1 Token1 received
    function removeLiquidity(
        PoolId poolId,
        uint256 lpAmount
    ) external returns (uint256 amount0, uint256 amount1);

    // ═══════════════════════════════════════════════════════════════════════
    //                         LP FUNCTIONS (Encrypted)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Add liquidity with encrypted amounts
    /// @param poolId The pool ID
    /// @param amount0 Encrypted amount of token0
    /// @param amount1 Encrypted amount of token1
    /// @return lpAmount Encrypted LP tokens minted
    function addLiquidityEncrypted(
        PoolId poolId,
        InEuint128 calldata amount0,
        InEuint128 calldata amount1
    ) external returns (euint128 lpAmount);

    /// @notice Remove liquidity with encrypted LP amount
    /// @param poolId The pool ID
    /// @param lpAmount Encrypted LP tokens to burn
    /// @return amount0 Encrypted token0 received
    /// @return amount1 Encrypted token1 received
    function removeLiquidityEncrypted(
        PoolId poolId,
        InEuint128 calldata lpAmount
    ) external returns (euint128 amount0, euint128 amount1);

    // ═══════════════════════════════════════════════════════════════════════
    //                         SWAP FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Fully encrypted swap - direction and amount hidden
    /// @param poolId The pool ID
    /// @param direction Encrypted swap direction (true = zeroForOne)
    /// @param amountIn Encrypted input amount
    /// @param minOutput Encrypted minimum output (slippage protection)
    /// @return amountOut Encrypted output amount
    function swapEncrypted(
        PoolId poolId,
        InEbool calldata direction,
        InEuint128 calldata amountIn,
        InEuint128 calldata minOutput
    ) external returns (euint128 amountOut);

    // ═══════════════════════════════════════════════════════════════════════
    //                         RESERVE SYNC
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Try to sync public reserves from decrypted values
    /// @param poolId The pool ID
    function trySyncReserves(PoolId poolId) external;

    // ═══════════════════════════════════════════════════════════════════════
    //                         VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Get pool state
    function getPoolState(PoolId poolId) external view returns (
        address token0,
        address token1,
        bool initialized,
        uint256 maxBucketsPerSwap,
        uint256 protocolFeeBps
    );

    /// @notice Get pool reserves and LP supply
    function getPoolReserves(PoolId poolId) external view returns (
        uint256 reserve0,
        uint256 reserve1,
        uint256 lpSupply
    );

    /// @notice Get tick price
    function getTickPrice(int24 tick) external view returns (uint256);

    /// @notice Check if a tick has active orders
    function hasActiveOrders(PoolId poolId, int24 tick, BucketSide side) external view returns (bool);

    /// @notice Get LP balance for an address
    function lpBalances(PoolId poolId, address user) external view returns (uint256);

    /// @notice Get total LP supply for a pool
    function totalLpSupply(PoolId poolId) external view returns (uint256);

    /// @notice Get swap fee in basis points
    function swapFeeBps() external view returns (uint256);

    /// @notice Get fee collector address
    function feeCollector() external view returns (address);

    // ═══════════════════════════════════════════════════════════════════════
    //                         ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Pause the contract
    function pause() external;

    /// @notice Unpause the contract
    function unpause() external;

    /// @notice Set fee collector address
    function setFeeCollector(address _feeCollector) external;

    /// @notice Set max buckets per swap for a pool
    function setMaxBucketsPerSwap(PoolId poolId, uint256 _maxBuckets) external;

    /// @notice Queue a protocol fee change
    function queueProtocolFee(PoolId poolId, uint256 _feeBps) external;

    /// @notice Apply a queued protocol fee change
    function applyProtocolFee(PoolId poolId) external;
}
