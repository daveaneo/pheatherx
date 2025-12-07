// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title FheatherXFactory
/// @notice Factory contract for managing and discovering FheatherX hook pools
/// @dev This factory registers and tracks FheatherX hook deployments for frontend discovery
contract FheatherXFactory is Ownable {
    // ============ Structs ============

    struct PoolInfo {
        address token0;
        address token1;
        address hook;
        uint256 createdAt;
        bool active;
    }

    // ============ State Variables ============

    /// @notice Array of all registered pools
    PoolInfo[] public pools;

    /// @notice Mapping from sorted token pair to hook address
    /// @dev key = keccak256(abi.encodePacked(token0, token1)) where token0 < token1
    mapping(bytes32 => address) public pairToHook;

    /// @notice Mapping from hook address to pool index (1-indexed, 0 = not found)
    mapping(address => uint256) public hookToPoolIndex;

    // ============ Events ============

    event PoolCreated(
        address indexed token0,
        address indexed token1,
        address indexed hook,
        uint256 poolIndex
    );

    event PoolDeactivated(
        address indexed token0,
        address indexed token1,
        address indexed hook
    );

    event PoolReactivated(
        address indexed token0,
        address indexed token1,
        address indexed hook
    );

    // ============ Errors ============

    error PoolAlreadyExists();
    error PoolNotFound();
    error InvalidTokens();
    error InvalidHook();

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Admin Functions ============

    /// @notice Register an existing FheatherX hook as a pool
    /// @param tokenA First token address
    /// @param tokenB Second token address
    /// @param hook The deployed FheatherX hook address
    /// @return poolIndex The index of the registered pool
    function registerPool(
        address tokenA,
        address tokenB,
        address hook
    ) external onlyOwner returns (uint256 poolIndex) {
        if (tokenA == address(0) || tokenB == address(0)) revert InvalidTokens();
        if (tokenA == tokenB) revert InvalidTokens();
        if (hook == address(0)) revert InvalidHook();

        // Sort tokens
        (address token0, address token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);

        bytes32 pairKey = _getPairKey(token0, token1);

        if (pairToHook[pairKey] != address(0)) revert PoolAlreadyExists();

        poolIndex = pools.length;

        pools.push(PoolInfo({
            token0: token0,
            token1: token1,
            hook: hook,
            createdAt: block.timestamp,
            active: true
        }));

        pairToHook[pairKey] = hook;
        hookToPoolIndex[hook] = poolIndex + 1; // 1-indexed

        emit PoolCreated(token0, token1, hook, poolIndex);
    }

    /// @notice Deactivate a pool (does not remove, just marks inactive)
    /// @param tokenA First token address
    /// @param tokenB Second token address
    function deactivatePool(address tokenA, address tokenB) external onlyOwner {
        (address token0, address token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);

        bytes32 pairKey = _getPairKey(token0, token1);
        address hook = pairToHook[pairKey];

        if (hook == address(0)) revert PoolNotFound();

        uint256 index = hookToPoolIndex[hook] - 1;
        pools[index].active = false;

        emit PoolDeactivated(token0, token1, hook);
    }

    /// @notice Reactivate a deactivated pool
    /// @param tokenA First token address
    /// @param tokenB Second token address
    function reactivatePool(address tokenA, address tokenB) external onlyOwner {
        (address token0, address token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);

        bytes32 pairKey = _getPairKey(token0, token1);
        address hook = pairToHook[pairKey];

        if (hook == address(0)) revert PoolNotFound();

        uint256 index = hookToPoolIndex[hook] - 1;
        pools[index].active = true;

        emit PoolReactivated(token0, token1, hook);
    }

    // ============ View Functions ============

    /// @notice Get the hook address for a token pair
    /// @param tokenA First token address
    /// @param tokenB Second token address
    /// @return The hook address (address(0) if not found)
    function getPool(address tokenA, address tokenB) external view returns (address) {
        (address token0, address token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);
        return pairToHook[_getPairKey(token0, token1)];
    }

    /// @notice Get full pool info for a token pair
    /// @param tokenA First token address
    /// @param tokenB Second token address
    /// @return Pool information
    function getPoolInfo(address tokenA, address tokenB) external view returns (PoolInfo memory) {
        (address token0, address token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);

        address hook = pairToHook[_getPairKey(token0, token1)];
        if (hook == address(0)) revert PoolNotFound();

        uint256 index = hookToPoolIndex[hook] - 1;
        return pools[index];
    }

    /// @notice Get pool info by hook address
    /// @param hook The hook address
    /// @return Pool information
    function getPoolByHook(address hook) external view returns (PoolInfo memory) {
        uint256 indexPlusOne = hookToPoolIndex[hook];
        if (indexPlusOne == 0) revert PoolNotFound();
        return pools[indexPlusOne - 1];
    }

    /// @notice Get all registered pools
    /// @return Array of all pool information
    function getAllPools() external view returns (PoolInfo[] memory) {
        return pools;
    }

    /// @notice Get only active pools
    /// @return Array of active pool information
    function getActivePools() external view returns (PoolInfo[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < pools.length; i++) {
            if (pools[i].active) activeCount++;
        }

        PoolInfo[] memory activePools = new PoolInfo[](activeCount);
        uint256 j = 0;
        for (uint256 i = 0; i < pools.length; i++) {
            if (pools[i].active) {
                activePools[j++] = pools[i];
            }
        }
        return activePools;
    }

    /// @notice Get the number of registered pools
    /// @return The total number of pools
    function poolCount() external view returns (uint256) {
        return pools.length;
    }

    /// @notice Check if a pool exists for a token pair
    /// @param tokenA First token address
    /// @param tokenB Second token address
    /// @return True if pool exists
    function poolExists(address tokenA, address tokenB) external view returns (bool) {
        (address token0, address token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);
        return pairToHook[_getPairKey(token0, token1)] != address(0);
    }

    // ============ Stub for Interface Compatibility ============

    /// @notice Create a new pool (stub - actual FheatherX deployment requires CREATE2 mining)
    /// @dev This function reverts because FheatherX hooks require special CREATE2 deployment
    ///      with hook address mining. Use registerPool() to register pre-deployed hooks.
    /// @param tokenA First token address
    /// @param tokenB Second token address
    /// @return hook The hook address (always reverts)
    function createPool(address tokenA, address tokenB) external view returns (address hook) {
        // Suppress unused variable warnings
        tokenA; tokenB;
        revert("Use registerPool() - FheatherX hooks require CREATE2 mining");
    }

    // ============ Internal Functions ============

    function _getPairKey(address token0, address token1) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(token0, token1));
    }
}
