// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MockPheatherX
/// @notice A mock version of PheatherX for local testing WITHOUT FHE
/// @dev This contract simulates the PheatherX interface but stores balances in plain uint256
///      instead of encrypted euint128. Use this only for local UI testing.
contract MockPheatherX is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Events ============
    event Deposit(address indexed user, address indexed token, uint256 amount);
    event Withdraw(address indexed user, address indexed token, uint256 amount);
    event OrderPlaced(uint256 indexed orderId, address indexed owner, int24 triggerTick);
    event OrderCancelled(uint256 indexed orderId, address indexed owner);
    event OrderFilled(uint256 indexed orderId, address indexed owner, address indexed executor);
    event ReserveSyncRequested(uint256 blockNumber);
    event ReservesSynced(uint256 reserve0, uint256 reserve1);

    // ============ Constants ============
    uint256 public constant PROTOCOL_FEE = 0.001 ether;

    // ============ State ============
    IERC20 public immutable token0;
    IERC20 public immutable token1;
    address public immutable owner;

    // Mock "encrypted" balances (stored as plain uint256 for testing)
    mapping(address => uint256) public userBalanceToken0;
    mapping(address => uint256) public userBalanceToken1;

    // Public reserves
    uint256 public reserve0;
    uint256 public reserve1;

    // Orders
    struct Order {
        address owner;
        int24 triggerTick;
        bool isBuy;
        uint256 amount;
        uint256 minOutput;
        bool active;
    }

    mapping(uint256 => Order) public orders;
    mapping(address => uint256[]) public userOrders;
    uint256 public nextOrderId = 1;

    constructor(address _token0, address _token1) {
        require(_token0 < _token1, "Token0 must be less than Token1");
        token0 = IERC20(_token0);
        token1 = IERC20(_token1);
        owner = msg.sender;
    }

    // ============ View Functions ============

    function getReserves() external view returns (uint256, uint256) {
        return (reserve0, reserve1);
    }

    function getUserBalanceToken0(address user) external view returns (uint256) {
        // Returns mock "encrypted" balance (just the plain value for testing)
        return userBalanceToken0[user];
    }

    function getUserBalanceToken1(address user) external view returns (uint256) {
        return userBalanceToken1[user];
    }

    function getActiveOrders(address user) external view returns (uint256[] memory) {
        uint256[] memory userOrderIds = userOrders[user];
        uint256 activeCount = 0;

        for (uint256 i = 0; i < userOrderIds.length; i++) {
            if (orders[userOrderIds[i]].active) {
                activeCount++;
            }
        }

        uint256[] memory activeOrders = new uint256[](activeCount);
        uint256 index = 0;

        for (uint256 i = 0; i < userOrderIds.length; i++) {
            if (orders[userOrderIds[i]].active) {
                activeOrders[index] = userOrderIds[i];
                index++;
            }
        }

        return activeOrders;
    }

    function getOrderCount(address user) external view returns (uint256) {
        return userOrders[user].length;
    }

    function hasOrdersAtTick(int24 tick) external view returns (bool) {
        // Simple implementation for testing
        for (uint256 i = 1; i < nextOrderId; i++) {
            if (orders[i].active && orders[i].triggerTick == tick) {
                return true;
            }
        }
        return false;
    }

    // ============ User Functions ============

    /// @notice Deposit tokens into the hook
    /// @param isToken0 True if depositing token0, false for token1
    /// @param amount Amount to deposit
    function deposit(bool isToken0, uint256 amount) external payable nonReentrant {
        require(amount > 0, "Amount must be > 0");

        if (isToken0) {
            token0.safeTransferFrom(msg.sender, address(this), amount);
            userBalanceToken0[msg.sender] += amount;
            reserve0 += amount;
            emit Deposit(msg.sender, address(token0), amount);
        } else {
            token1.safeTransferFrom(msg.sender, address(this), amount);
            userBalanceToken1[msg.sender] += amount;
            reserve1 += amount;
            emit Deposit(msg.sender, address(token1), amount);
        }
    }

    /// @notice Withdraw tokens from the hook
    /// @param isToken0 True if withdrawing token0, false for token1
    /// @param amount Amount to withdraw
    function withdraw(bool isToken0, uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");

        if (isToken0) {
            require(userBalanceToken0[msg.sender] >= amount, "Insufficient balance");
            userBalanceToken0[msg.sender] -= amount;
            reserve0 -= amount;
            token0.safeTransfer(msg.sender, amount);
            emit Withdraw(msg.sender, address(token0), amount);
        } else {
            require(userBalanceToken1[msg.sender] >= amount, "Insufficient balance");
            userBalanceToken1[msg.sender] -= amount;
            reserve1 -= amount;
            token1.safeTransfer(msg.sender, amount);
            emit Withdraw(msg.sender, address(token1), amount);
        }
    }

    /// @notice Place a limit order (mock version - accepts bytes for FHE compatibility)
    /// @param triggerTick The tick at which the order triggers
    /// @param direction Encrypted direction (mock: first byte = 1 for buy, 0 for sell)
    /// @param amount Encrypted amount (mock: uint128 encoded in bytes)
    /// @param minOutput Encrypted minimum output (mock: uint128 encoded in bytes)
    function placeOrder(
        int24 triggerTick,
        bytes calldata direction,
        bytes calldata amount,
        bytes calldata minOutput
    ) external payable nonReentrant returns (uint256 orderId) {
        require(msg.value >= PROTOCOL_FEE, "Insufficient protocol fee");

        // Decode mock "encrypted" values
        bool isBuy = direction.length > 0 && direction[0] != 0;
        uint256 orderAmount = _bytesToUint256(amount);
        uint256 orderMinOutput = _bytesToUint256(minOutput);

        require(orderAmount > 0, "Amount must be > 0");

        // Check user has sufficient balance
        if (isBuy) {
            require(userBalanceToken1[msg.sender] >= orderAmount, "Insufficient token1 balance");
        } else {
            require(userBalanceToken0[msg.sender] >= orderAmount, "Insufficient token0 balance");
        }

        orderId = nextOrderId++;

        orders[orderId] = Order({
            owner: msg.sender,
            triggerTick: triggerTick,
            isBuy: isBuy,
            amount: orderAmount,
            minOutput: orderMinOutput,
            active: true
        });

        userOrders[msg.sender].push(orderId);

        emit OrderPlaced(orderId, msg.sender, triggerTick);
    }

    /// @notice Cancel an active order
    /// @param orderId The order to cancel
    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        require(order.owner == msg.sender, "Not order owner");
        require(order.active, "Order not active");

        order.active = false;
        emit OrderCancelled(orderId, msg.sender);
    }

    /// @notice Force sync reserves (mock - just emits event)
    function forceSyncReserves() external {
        emit ReserveSyncRequested(block.number);
        emit ReservesSynced(reserve0, reserve1);
    }

    // ============ Internal Functions ============

    function _bytesToUint256(bytes calldata data) internal pure returns (uint256) {
        if (data.length == 0) return 0;
        if (data.length >= 32) {
            return abi.decode(data, (uint256));
        }
        // For smaller byte arrays, pad and decode
        bytes memory padded = new bytes(32);
        for (uint256 i = 0; i < data.length; i++) {
            padded[32 - data.length + i] = data[i];
        }
        return abi.decode(padded, (uint256));
    }

    // ============ Owner Functions ============

    /// @notice Withdraw protocol fees
    function withdrawFees() external {
        require(msg.sender == owner, "Not owner");
        payable(owner).transfer(address(this).balance);
    }

    receive() external payable {}
}
