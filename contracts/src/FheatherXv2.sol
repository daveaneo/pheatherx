// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Uniswap Imports
import {BaseHook} from "v4-periphery/src/utils/BaseHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

// Fhenix Imports
import {
    FHE,
    InEuint128,
    euint128,
    InEbool,
    ebool
} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

// OpenZeppelin Imports
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Local Imports
import {TickBitmap} from "./lib/TickBitmap.sol";
import {DirectionLock} from "./lib/DirectionLock.sol";
import {IFheatherXv2} from "./interface/IFheatherXv2.sol";
import {IFHERC20} from "./interface/IFHERC20.sol";

/// @title FheatherXv2
/// @notice Private AMM with FHE - Single-transaction swaps with MEV protection
/// @dev Two entry paths: plaintext (router-compatible) and encrypted (full privacy)
///
/// Key Features:
/// - Single-transaction swaps (no deposit→action→withdraw)
/// - Two swap paths: plaintext ERC20 and encrypted FHERC20
/// - 4 limit order types: Buy Limit, Buy Stop, Sell Limit, Sell Stop
/// - All order parameters encrypted (direction, amount, trigger conditions)
/// - Probe attack prevention via constant-time execution
/// - Ecosystem compatibility with existing DEX routers
contract FheatherXv2 is BaseHook, ReentrancyGuard, IFheatherXv2 {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    using SafeERC20 for IERC20;
    using TickBitmap for mapping(int16 => uint256);

    // ============ Constants ============

    uint256 public constant PROTOCOL_FEE = 0.001 ether; // Fee for placing limit orders
    uint256 public constant SYNC_COOLDOWN_BLOCKS = 5;   // Min blocks between reserve syncs
    uint256 public constant EXECUTOR_REWARD_BPS = 100;  // 1% executor reward

    // ============ Immutables ============

    IERC20 public immutable token0;
    IERC20 public immutable token1;
    IFHERC20 public immutable fheToken0;
    IFHERC20 public immutable fheToken1;
    uint256 public immutable swapFeeBps;
    address public immutable owner;

    // Cached encrypted constants (set in constructor for gas efficiency)
    euint128 public immutable ENC_ZERO;
    euint128 public immutable ENC_ONE;
    euint128 public immutable ENC_HUNDRED;
    euint128 public immutable ENC_TEN_THOUSAND;
    euint128 public immutable ENC_SWAP_FEE_BPS;

    // ============ State Variables ============

    // Encrypted reserves (source of truth)
    euint128 internal encReserve0;
    euint128 internal encReserve1;

    // Public reserves (display cache, eventually consistent)
    uint256 public reserve0;
    uint256 public reserve1;

    // Reserve sync state
    uint256 public lastSyncBlock;
    euint128 internal pendingReserve0;
    euint128 internal pendingReserve1;

    // Tick tracking for order fills
    int24 public lastTickLower;

    // Limit orders (with 4 order types via isSell × triggerAbove)
    mapping(uint256 => Order) public orders;
    mapping(int24 => uint256[]) public ordersByTick;
    mapping(address => uint256[]) public userOrders;
    uint256 public nextOrderId = 1;

    // Tick bitmap for efficient order lookup
    mapping(int16 => uint256) public orderBitmap;

    // LP token tracking (simple proportional LP)
    mapping(address => uint256) public lpBalances;
    uint256 public totalLpSupply;

    // ============ Constructor ============

    constructor(
        IPoolManager _poolManager,
        address _token0,
        address _token1,
        uint256 _swapFeeBps
    ) BaseHook(_poolManager) {
        require(_token0 < _token1, "Tokens must be sorted");

        token0 = IERC20(_token0);
        token1 = IERC20(_token1);
        fheToken0 = IFHERC20(_token0);
        fheToken1 = IFHERC20(_token1);
        swapFeeBps = _swapFeeBps;
        owner = msg.sender;

        // Cache encrypted constants
        ENC_ZERO = FHE.asEuint128(0);
        ENC_ONE = FHE.asEuint128(1);
        ENC_HUNDRED = FHE.asEuint128(100);
        ENC_TEN_THOUSAND = FHE.asEuint128(10000);
        ENC_SWAP_FEE_BPS = FHE.asEuint128(_swapFeeBps);

        // Initialize encrypted reserves
        encReserve0 = ENC_ZERO;
        encReserve1 = ENC_ZERO;

        // Allow FHE operations on cached values
        FHE.allowThis(ENC_ZERO);
        FHE.allowThis(ENC_ONE);
        FHE.allowThis(ENC_HUNDRED);
        FHE.allowThis(ENC_TEN_THOUSAND);
        FHE.allowThis(ENC_SWAP_FEE_BPS);
    }

    // ============ Hook Permissions ============

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: true,
            beforeRemoveLiquidity: true,
            afterAddLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ============ Swap Functions (Public API) ============

    /// @inheritdoc IFheatherXv2
    function swap(
        bool zeroForOne,
        uint256 amountIn,
        uint256 minAmountOut
    ) external nonReentrant returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroAmount();

        // 1. Take input tokens from user
        IERC20 tokenIn = zeroForOne ? token0 : token1;
        tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);

        // 2. Encrypt and execute swap math
        euint128 encAmountIn = FHE.asEuint128(uint128(amountIn));
        ebool encDirection = FHE.asEbool(zeroForOne);
        _executeSwapMath(encDirection, encAmountIn);

        // 3. Estimate output from public reserves
        amountOut = _estimateOutput(zeroForOne, amountIn);
        if (amountOut < minAmountOut) revert SlippageExceeded();

        // 4. Send output tokens to user
        IERC20 tokenOut = zeroForOne ? token1 : token0;
        tokenOut.safeTransfer(msg.sender, amountOut);

        // 5. Update public reserve cache (known amounts)
        if (zeroForOne) {
            reserve0 += amountIn;
            reserve1 -= amountOut;
        } else {
            reserve1 += amountIn;
            reserve0 -= amountOut;
        }

        // 6. Request async reserve sync for accuracy
        _requestReserveSync();

        // 7. Process any triggered limit orders
        _checkAndProcessOrders();

        emit Swap(msg.sender, zeroForOne, amountIn, amountOut);
    }

    /// @inheritdoc IFheatherXv2
    function swapEncrypted(
        InEbool calldata direction,
        InEuint128 calldata amountIn,
        InEuint128 calldata minOutput
    ) external nonReentrant returns (euint128 amountOut) {
        ebool dir = FHE.asEbool(direction);
        euint128 amt = FHE.asEuint128(amountIn);

        // 1. Take input (execute both transfers - one will be zero)
        euint128 token0Amt = FHE.select(dir, amt, ENC_ZERO);
        euint128 token1Amt = FHE.select(dir, ENC_ZERO, amt);

        // Allow this contract to receive the tokens
        FHE.allow(token0Amt, address(fheToken0));
        FHE.allow(token1Amt, address(fheToken1));

        fheToken0._transferFromEncrypted(msg.sender, address(this), token0Amt);
        fheToken1._transferFromEncrypted(msg.sender, address(this), token1Amt);

        // 2. Execute encrypted swap math
        amountOut = _executeSwapMath(dir, amt);

        // 3. Slippage check (encrypted)
        euint128 encMinOut = FHE.asEuint128(minOutput);
        ebool slippageOk = FHE.gte(amountOut, encMinOut);
        // If slippage fails, output becomes zero (preserves privacy)
        amountOut = FHE.select(slippageOk, amountOut, ENC_ZERO);

        // 4. Send output (opposite token)
        euint128 out0 = FHE.select(dir, ENC_ZERO, amountOut);
        euint128 out1 = FHE.select(dir, amountOut, ENC_ZERO);

        FHE.allow(out0, address(fheToken0));
        FHE.allow(out1, address(fheToken1));

        fheToken0._transferEncrypted(msg.sender, out0);
        fheToken1._transferEncrypted(msg.sender, out1);

        // 5. Request async reserve sync
        _requestReserveSync();

        // 6. Process any triggered limit orders
        _checkAndProcessOrders();

        emit SwapEncrypted(msg.sender);
    }

    // ============ Limit Order Functions ============

    /// @inheritdoc IFheatherXv2
    function placeOrder(
        int24 triggerTick,
        InEbool calldata isSell,
        InEbool calldata triggerAbove,
        InEuint128 calldata amount,
        InEuint128 calldata minOutput
    ) external payable nonReentrant returns (uint256 orderId) {
        if (msg.value < PROTOCOL_FEE) revert InsufficientFee();

        ebool sell = FHE.asEbool(isSell);
        euint128 amt = FHE.asEuint128(amount);

        // Lock the INPUT token based on order type:
        // - If selling (isSell=true), lock token0
        // - If buying (isSell=false), lock token1 (paying with token1)
        euint128 token0Lock = FHE.select(sell, amt, ENC_ZERO);
        euint128 token1Lock = FHE.select(sell, ENC_ZERO, amt);

        // Allow transfers
        FHE.allow(token0Lock, address(fheToken0));
        FHE.allow(token1Lock, address(fheToken1));

        // Transfer tokens from user to this contract
        fheToken0._transferFromEncrypted(msg.sender, address(this), token0Lock);
        fheToken1._transferFromEncrypted(msg.sender, address(this), token1Lock);

        // Create order
        orderId = nextOrderId++;

        orders[orderId] = Order({
            owner: msg.sender,
            triggerTick: triggerTick,
            isSell: sell,
            triggerAbove: FHE.asEbool(triggerAbove),
            amount: amt,
            minOutput: FHE.asEuint128(minOutput),
            active: true
        });

        // Update tick bitmap if first order at this tick
        if (ordersByTick[triggerTick].length == 0) {
            orderBitmap.setTick(triggerTick);
        }
        ordersByTick[triggerTick].push(orderId);
        userOrders[msg.sender].push(orderId);

        // Set permissions for order data
        FHE.allowThis(orders[orderId].isSell);
        FHE.allowThis(orders[orderId].triggerAbove);
        FHE.allowThis(orders[orderId].amount);
        FHE.allowThis(orders[orderId].minOutput);

        emit OrderPlaced(orderId, msg.sender, triggerTick);
    }

    /// @inheritdoc IFheatherXv2
    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage order = orders[orderId];

        if (order.owner == address(0)) revert OrderNotFound();
        if (order.owner != msg.sender) revert NotOrderOwner();
        if (!order.active) revert OrderNotActive();

        order.active = false;

        // Return locked tokens to user
        euint128 token0Return = FHE.select(order.isSell, order.amount, ENC_ZERO);
        euint128 token1Return = FHE.select(order.isSell, ENC_ZERO, order.amount);

        FHE.allow(token0Return, address(fheToken0));
        FHE.allow(token1Return, address(fheToken1));

        fheToken0._transferEncrypted(msg.sender, token0Return);
        fheToken1._transferEncrypted(msg.sender, token1Return);

        // Clean up tick array
        _removeOrderFromTick(order.triggerTick, orderId);

        // Clear bitmap if no more orders at this tick
        if (ordersByTick[order.triggerTick].length == 0) {
            orderBitmap.clearTick(order.triggerTick);
        }

        emit OrderCancelled(orderId, msg.sender);
    }

    // ============ Liquidity Functions ============

    /// @inheritdoc IFheatherXv2
    function addLiquidity(
        uint256 amount0,
        uint256 amount1
    ) external nonReentrant returns (uint256 lpAmount) {
        if (amount0 == 0 || amount1 == 0) revert ZeroAmount();

        // Transfer tokens from user
        token0.safeTransferFrom(msg.sender, address(this), amount0);
        token1.safeTransferFrom(msg.sender, address(this), amount1);

        // Calculate LP tokens to mint
        if (totalLpSupply == 0) {
            // First liquidity provider
            lpAmount = _sqrt(amount0 * amount1);
        } else {
            // Proportional to existing liquidity
            uint256 lpAmount0 = (amount0 * totalLpSupply) / reserve0;
            uint256 lpAmount1 = (amount1 * totalLpSupply) / reserve1;
            lpAmount = lpAmount0 < lpAmount1 ? lpAmount0 : lpAmount1;
        }

        // Update state
        lpBalances[msg.sender] += lpAmount;
        totalLpSupply += lpAmount;
        reserve0 += amount0;
        reserve1 += amount1;

        // Update encrypted reserves
        euint128 encAmount0 = FHE.asEuint128(uint128(amount0));
        euint128 encAmount1 = FHE.asEuint128(uint128(amount1));
        encReserve0 = FHE.add(encReserve0, encAmount0);
        encReserve1 = FHE.add(encReserve1, encAmount1);
        FHE.allowThis(encReserve0);
        FHE.allowThis(encReserve1);

        emit LiquidityAdded(msg.sender, amount0, amount1, lpAmount);
    }

    /// @inheritdoc IFheatherXv2
    function removeLiquidity(
        uint256 lpAmount
    ) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        if (lpAmount == 0) revert ZeroAmount();
        if (lpBalances[msg.sender] < lpAmount) revert InsufficientLiquidity();

        // Calculate tokens to return
        amount0 = (lpAmount * reserve0) / totalLpSupply;
        amount1 = (lpAmount * reserve1) / totalLpSupply;

        // Update state
        lpBalances[msg.sender] -= lpAmount;
        totalLpSupply -= lpAmount;
        reserve0 -= amount0;
        reserve1 -= amount1;

        // Update encrypted reserves
        euint128 encAmount0 = FHE.asEuint128(uint128(amount0));
        euint128 encAmount1 = FHE.asEuint128(uint128(amount1));
        encReserve0 = FHE.sub(encReserve0, encAmount0);
        encReserve1 = FHE.sub(encReserve1, encAmount1);
        FHE.allowThis(encReserve0);
        FHE.allowThis(encReserve1);

        // Transfer tokens to user
        token0.safeTransfer(msg.sender, amount0);
        token1.safeTransfer(msg.sender, amount1);

        emit LiquidityRemoved(msg.sender, amount0, amount1, lpAmount);
    }

    /// @inheritdoc IFheatherXv2
    function addLiquidityEncrypted(
        InEuint128 calldata amount0,
        InEuint128 calldata amount1
    ) external nonReentrant returns (euint128 lpAmount) {
        euint128 amt0 = FHE.asEuint128(amount0);
        euint128 amt1 = FHE.asEuint128(amount1);

        // Transfer encrypted tokens from user
        FHE.allow(amt0, address(fheToken0));
        FHE.allow(amt1, address(fheToken1));

        fheToken0._transferFromEncrypted(msg.sender, address(this), amt0);
        fheToken1._transferFromEncrypted(msg.sender, address(this), amt1);

        // Update encrypted reserves
        encReserve0 = FHE.add(encReserve0, amt0);
        encReserve1 = FHE.add(encReserve1, amt1);
        FHE.allowThis(encReserve0);
        FHE.allowThis(encReserve1);

        // For encrypted liquidity, we return a simple sum as LP (simplified)
        // In production, this would need proper encrypted LP math
        lpAmount = FHE.add(amt0, amt1);
        FHE.allow(lpAmount, msg.sender);

        // Request reserve sync to update public cache
        _requestReserveSync();
    }

    /// @inheritdoc IFheatherXv2
    function removeLiquidityEncrypted(
        InEuint128 calldata lpAmount
    ) external nonReentrant returns (euint128 amount0, euint128 amount1) {
        euint128 lp = FHE.asEuint128(lpAmount);

        // Simplified: return half of LP as each token
        // In production, this would use proper ratio from encrypted reserves
        amount0 = FHE.div(lp, FHE.asEuint128(2));
        amount1 = FHE.div(lp, FHE.asEuint128(2));

        // Update encrypted reserves
        encReserve0 = FHE.sub(encReserve0, amount0);
        encReserve1 = FHE.sub(encReserve1, amount1);
        FHE.allowThis(encReserve0);
        FHE.allowThis(encReserve1);

        // Transfer tokens to user
        FHE.allow(amount0, address(fheToken0));
        FHE.allow(amount1, address(fheToken1));

        fheToken0._transferEncrypted(msg.sender, amount0);
        fheToken1._transferEncrypted(msg.sender, amount1);

        // Request reserve sync
        _requestReserveSync();
    }

    // ============ Hook Callbacks ============

    function _beforeSwap(
        address /* sender */,
        PoolKey calldata /* key */,
        SwapParams calldata /* params */,
        bytes calldata /* hookData */
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        // We don't use hook swaps - all swaps go through our swap() function
        // Return ZERO_DELTA to allow normal Uniswap pool operation
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function _afterSwap(
        address /* sender */,
        PoolKey calldata /* key */,
        SwapParams calldata /* params */,
        BalanceDelta /* delta */,
        bytes calldata /* hookData */
    ) internal override returns (bytes4, int128) {
        // Check for triggered limit orders after any pool swap
        _checkAndProcessOrders();
        return (BaseHook.afterSwap.selector, 0);
    }

    function _beforeAddLiquidity(
        address /* sender */,
        PoolKey calldata /* key */,
        ModifyLiquidityParams calldata /* params */,
        bytes calldata /* hookData */
    ) internal override returns (bytes4) {
        return BaseHook.beforeAddLiquidity.selector;
    }

    function _beforeRemoveLiquidity(
        address /* sender */,
        PoolKey calldata /* key */,
        ModifyLiquidityParams calldata /* params */,
        bytes calldata /* hookData */
    ) internal override returns (bytes4) {
        return BaseHook.beforeRemoveLiquidity.selector;
    }

    // ============ View Functions ============

    /// @inheritdoc IFheatherXv2
    function getReserves() external returns (uint256, uint256) {
        _trySyncReserves();
        return (reserve0, reserve1);
    }

    /// @inheritdoc IFheatherXv2
    function getActiveOrders(address user) external view returns (uint256[] memory) {
        uint256[] storage allOrders = userOrders[user];

        uint256 activeCount = 0;
        for (uint256 i = 0; i < allOrders.length; i++) {
            if (orders[allOrders[i]].active) {
                activeCount++;
            }
        }

        uint256[] memory result = new uint256[](activeCount);
        uint256 j = 0;
        for (uint256 i = 0; i < allOrders.length; i++) {
            if (orders[allOrders[i]].active) {
                result[j++] = allOrders[i];
            }
        }

        return result;
    }

    /// @inheritdoc IFheatherXv2
    function getOrderCount(address user) external view returns (uint256) {
        uint256 count = 0;
        uint256[] storage allOrders = userOrders[user];
        for (uint256 i = 0; i < allOrders.length; i++) {
            if (orders[allOrders[i]].active) {
                count++;
            }
        }
        return count;
    }

    /// @inheritdoc IFheatherXv2
    function hasOrdersAtTick(int24 tick) external view returns (bool) {
        return orderBitmap.hasOrdersAtTick(tick);
    }

    /// @inheritdoc IFheatherXv2
    function forceSyncReserves() external {
        pendingReserve0 = encReserve0;
        pendingReserve1 = encReserve1;
        FHE.decrypt(pendingReserve0);
        FHE.decrypt(pendingReserve1);
        lastSyncBlock = block.number;

        emit ReserveSyncRequested(block.number);
    }

    /// @inheritdoc IFheatherXv2
    function estimateOutput(
        bool zeroForOne,
        uint256 amountIn
    ) external view returns (uint256 amountOut) {
        return _estimateOutput(zeroForOne, amountIn);
    }

    // ============ Admin Functions ============

    /// @notice Withdraw accumulated protocol fees (ETH)
    function withdrawProtocolFees(address payable to) external {
        require(msg.sender == owner, "Only owner");
        require(to != address(0), "Invalid recipient");

        uint256 balance = address(this).balance;
        require(balance > 0, "No fees to withdraw");

        (bool success, ) = to.call{value: balance}("");
        require(success, "Transfer failed");
    }

    // ============ Internal Functions ============

    /// @notice Estimate output from public reserves using x*y=k
    function _estimateOutput(
        bool zeroForOne,
        uint256 amountIn
    ) internal view returns (uint256 amountOut) {
        if (reserve0 == 0 || reserve1 == 0) revert InsufficientLiquidity();

        uint256 reserveIn = zeroForOne ? reserve0 : reserve1;
        uint256 reserveOut = zeroForOne ? reserve1 : reserve0;

        // Apply fee
        uint256 amountInWithFee = amountIn * (10000 - swapFeeBps);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 10000) + amountInWithFee;

        amountOut = numerator / denominator;
    }

    /// @notice Execute encrypted swap math (x*y=k with FHE)
    function _executeSwapMath(
        ebool direction,
        euint128 amountIn
    ) internal returns (euint128 amountOut) {
        // Apply fee
        euint128 feeAmount = FHE.div(FHE.mul(amountIn, ENC_SWAP_FEE_BPS), ENC_TEN_THOUSAND);
        euint128 amountInAfterFee = FHE.sub(amountIn, feeAmount);

        // x * y = k formula, all encrypted
        euint128 reserveIn = FHE.select(direction, encReserve0, encReserve1);
        euint128 reserveOut = FHE.select(direction, encReserve1, encReserve0);

        // amountOut = (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee)
        euint128 numerator = FHE.mul(amountInAfterFee, reserveOut);
        euint128 denominator = FHE.add(reserveIn, amountInAfterFee);

        // Protect against division by zero
        euint128 safeDenominator = FHE.select(FHE.gt(denominator, ENC_ZERO), denominator, ENC_ONE);
        amountOut = FHE.div(numerator, safeDenominator);

        // Update encrypted reserves
        euint128 newReserveIn = FHE.add(reserveIn, amountIn); // Full amount (includes fee)
        euint128 newReserveOut = FHE.sub(reserveOut, amountOut);

        encReserve0 = FHE.select(direction, newReserveIn, newReserveOut);
        FHE.allowThis(encReserve0);
        encReserve1 = FHE.select(direction, newReserveOut, newReserveIn);
        FHE.allowThis(encReserve1);

        return amountOut;
    }

    /// @notice Execute swap math conditionally (for constant-time order execution)
    function _executeSwapMathConditional(
        ebool direction,
        euint128 amountIn,
        ebool shouldExecute
    ) internal returns (euint128 amountOut) {
        // Conditionally zero the input if not executing
        euint128 effectiveInput = FHE.select(shouldExecute, amountIn, ENC_ZERO);

        // Apply fee
        euint128 feeAmount = FHE.div(FHE.mul(effectiveInput, ENC_SWAP_FEE_BPS), ENC_TEN_THOUSAND);
        euint128 amountInAfterFee = FHE.sub(effectiveInput, feeAmount);

        // x * y = k formula
        euint128 reserveIn = FHE.select(direction, encReserve0, encReserve1);
        euint128 reserveOut = FHE.select(direction, encReserve1, encReserve0);

        euint128 numerator = FHE.mul(amountInAfterFee, reserveOut);
        euint128 denominator = FHE.add(reserveIn, amountInAfterFee);

        euint128 safeDenominator = FHE.select(FHE.gt(denominator, ENC_ZERO), denominator, ENC_ONE);
        amountOut = FHE.div(numerator, safeDenominator);

        // Update encrypted reserves (will be 0 change if not executing)
        euint128 newReserveIn = FHE.add(reserveIn, effectiveInput);
        euint128 newReserveOut = FHE.sub(reserveOut, amountOut);

        encReserve0 = FHE.select(direction, newReserveIn, newReserveOut);
        FHE.allowThis(encReserve0);
        encReserve1 = FHE.select(direction, newReserveOut, newReserveIn);
        FHE.allowThis(encReserve1);

        return amountOut;
    }

    /// @notice Check and process any triggered limit orders
    function _checkAndProcessOrders() internal {
        int24 currentTick = _getCurrentTick();
        int24 prevTick = lastTickLower;

        // Update tick tracker
        lastTickLower = currentTick;

        // Only process if tick has actually moved
        if (currentTick != prevTick) {
            _processOrdersInRange(prevTick, currentTick, msg.sender);
        }
    }

    /// @notice Process all orders triggered by tick movement
    function _processOrdersInRange(
        int24 startTick,
        int24 endTick,
        address executor
    ) internal {
        bool movingUp = endTick > startTick;

        int24 minTick = movingUp ? startTick : endTick;
        int24 maxTick = movingUp ? endTick : startTick;

        // Use bitmap to efficiently find ticks with orders
        int24 tick = minTick;
        while (tick <= maxTick) {
            if (orderBitmap.hasOrdersAtTick(tick)) {
                _processOrdersAtTick(tick, startTick, endTick, executor);
            }
            tick++;
        }
    }

    /// @notice Process all orders at a specific tick
    function _processOrdersAtTick(
        int24 tick,
        int24 prevTick,
        int24 currentTick,
        address executor
    ) internal {
        uint256[] storage orderIds = ordersByTick[tick];

        // Determine crossing direction
        bool crossedUp = prevTick < tick && currentTick >= tick;
        bool crossedDown = prevTick > tick && currentTick <= tick;

        ebool encCrossedUp = FHE.asEbool(crossedUp);
        ebool encCrossedDown = FHE.asEbool(crossedDown);

        for (uint256 i = 0; i < orderIds.length; i++) {
            uint256 orderId = orderIds[i];
            Order storage order = orders[orderId];

            if (!order.active) continue;

            // Determine if order should trigger based on triggerAbove
            // triggerAbove=true → trigger on crossedUp
            // triggerAbove=false → trigger on crossedDown
            ebool shouldTrigger = FHE.select(order.triggerAbove, encCrossedUp, encCrossedDown);

            _fillOrderConditional(orderId, order, executor, shouldTrigger);
        }
    }

    /// @notice Fill a limit order conditionally
    function _fillOrderConditional(
        uint256 orderId,
        Order storage order,
        address executor,
        ebool shouldTrigger
    ) internal {
        // Convert isSell to direction for swap math
        // isSell=true means selling token0 → zeroForOne=true
        ebool direction = order.isSell;

        // Execute swap math (always computed for constant-time)
        euint128 output = _executeSwapMathConditional(direction, order.amount, shouldTrigger);

        // Slippage check
        ebool slippageOk = FHE.gte(output, order.minOutput);
        ebool actuallyFill = FHE.and(shouldTrigger, slippageOk);

        // Final output (0 if not filling or slippage failed)
        euint128 finalOutput = FHE.select(actuallyFill, output, ENC_ZERO);

        // Send OUTPUT token (opposite of input):
        // - If selling token0 (isSell=true), output is token1
        // - If buying token0 (isSell=false), output is token0
        euint128 token0Out = FHE.select(order.isSell, ENC_ZERO, finalOutput);
        euint128 token1Out = FHE.select(order.isSell, finalOutput, ENC_ZERO);

        FHE.allow(token0Out, address(fheToken0));
        FHE.allow(token1Out, address(fheToken1));

        fheToken0._transferEncrypted(order.owner, token0Out);
        fheToken1._transferEncrypted(order.owner, token1Out);

        // If slippage failed, return input
        ebool slippageFailed = FHE.and(shouldTrigger, FHE.not(slippageOk));
        euint128 refund = FHE.select(slippageFailed, order.amount, ENC_ZERO);

        euint128 token0Refund = FHE.select(order.isSell, refund, ENC_ZERO);
        euint128 token1Refund = FHE.select(order.isSell, ENC_ZERO, refund);

        FHE.allow(token0Refund, address(fheToken0));
        FHE.allow(token1Refund, address(fheToken1));

        fheToken0._transferEncrypted(order.owner, token0Refund);
        fheToken1._transferEncrypted(order.owner, token1Refund);

        // Calculate and send executor reward (1% of output)
        euint128 executorReward = FHE.div(finalOutput, ENC_HUNDRED);
        euint128 reward0 = FHE.select(order.isSell, ENC_ZERO, executorReward);
        euint128 reward1 = FHE.select(order.isSell, executorReward, ENC_ZERO);

        FHE.allow(reward0, address(fheToken0));
        FHE.allow(reward1, address(fheToken1));

        fheToken0._transferEncrypted(executor, reward0);
        fheToken1._transferEncrypted(executor, reward1);

        // Mark order as inactive
        order.active = false;

        // Clean up
        _removeOrderFromTick(order.triggerTick, orderId);
        if (ordersByTick[order.triggerTick].length == 0) {
            orderBitmap.clearTick(order.triggerTick);
        }

        emit OrderFilled(orderId, order.owner, executor);
    }

    /// @notice Request async reserve sync
    function _requestReserveSync() internal {
        if (block.number < lastSyncBlock + SYNC_COOLDOWN_BLOCKS) {
            return; // Too soon
        }

        pendingReserve0 = encReserve0;
        pendingReserve1 = encReserve1;
        FHE.decrypt(pendingReserve0);
        FHE.decrypt(pendingReserve1);

        lastSyncBlock = block.number;
        emit ReserveSyncRequested(block.number);
    }

    /// @notice Try to sync reserves from decrypted values
    function _trySyncReserves() internal {
        (uint256 val0, bool ready0) = FHE.getDecryptResultSafe(pendingReserve0);
        (uint256 val1, bool ready1) = FHE.getDecryptResultSafe(pendingReserve1);

        if (ready0 && ready1) {
            reserve0 = val0;
            reserve1 = val1;
            emit ReservesSynced(val0, val1);
        }
    }

    /// @notice Calculate current tick from public reserves
    function _getCurrentTick() internal view returns (int24) {
        if (reserve0 == 0 || reserve1 == 0) return 0;

        // Price = reserve1 / reserve0
        // sqrtPriceX96 = sqrt(price) * 2^96
        uint256 ratioX192 = (reserve1 << 192) / reserve0;
        uint160 sqrtPriceX96 = uint160(_sqrt(ratioX192));

        // Clamp to valid range
        if (sqrtPriceX96 < TickMath.MIN_SQRT_PRICE) {
            sqrtPriceX96 = TickMath.MIN_SQRT_PRICE;
        } else if (sqrtPriceX96 > TickMath.MAX_SQRT_PRICE) {
            sqrtPriceX96 = TickMath.MAX_SQRT_PRICE;
        }

        return TickMath.getTickAtSqrtPrice(sqrtPriceX96);
    }

    /// @notice Calculate square root using Babylonian method
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;

        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    /// @notice Remove an order from the tick array
    function _removeOrderFromTick(int24 tick, uint256 orderId) internal {
        uint256[] storage orderIds = ordersByTick[tick];
        for (uint256 i = 0; i < orderIds.length; i++) {
            if (orderIds[i] == orderId) {
                orderIds[i] = orderIds[orderIds.length - 1];
                orderIds.pop();
                break;
            }
        }
    }

    // ============ Receive ETH ============

    receive() external payable {}
}
