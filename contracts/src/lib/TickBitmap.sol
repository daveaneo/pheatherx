// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TickBitmap
/// @notice Efficiently tracks which ticks have limit orders using bitmaps
/// @dev Each uint256 word covers 256 ticks. Inspired by Uniswap v3's TickBitmap.
library TickBitmap {
    /// @notice Computes the word position and bit position for a given tick
    /// @param tick The tick to get the position for
    /// @return wordPos The word position (tick / 256)
    /// @return bitPos The bit position within the word (tick % 256)
    function position(int24 tick) internal pure returns (int16 wordPos, uint8 bitPos) {
        wordPos = int16(tick >> 8); // tick / 256
        bitPos = uint8(int8(tick % 256));
    }

    /// @notice Flips the bit for a given tick (toggles order existence)
    /// @param self The bitmap mapping
    /// @param tick The tick to flip
    function flipTick(mapping(int16 => uint256) storage self, int24 tick) internal {
        (int16 wordPos, uint8 bitPos) = position(tick);
        uint256 mask = 1 << bitPos;
        self[wordPos] ^= mask;
    }

    /// @notice Sets the bit for a given tick (mark as having orders)
    /// @param self The bitmap mapping
    /// @param tick The tick to set
    function setTick(mapping(int16 => uint256) storage self, int24 tick) internal {
        (int16 wordPos, uint8 bitPos) = position(tick);
        uint256 mask = 1 << bitPos;
        self[wordPos] |= mask;
    }

    /// @notice Clears the bit for a given tick (mark as having no orders)
    /// @param self The bitmap mapping
    /// @param tick The tick to clear
    function clearTick(mapping(int16 => uint256) storage self, int24 tick) internal {
        (int16 wordPos, uint8 bitPos) = position(tick);
        uint256 mask = 1 << bitPos;
        self[wordPos] &= ~mask;
    }

    /// @notice Checks if a tick has orders
    /// @param self The bitmap mapping
    /// @param tick The tick to check
    /// @return hasOrders True if the tick has orders
    function hasOrdersAtTick(mapping(int16 => uint256) storage self, int24 tick) internal view returns (bool hasOrders) {
        (int16 wordPos, uint8 bitPos) = position(tick);
        uint256 mask = 1 << bitPos;
        return (self[wordPos] & mask) != 0;
    }

    /// @notice Finds the next tick with orders within the range
    /// @param self The bitmap mapping
    /// @param tick The current tick (exclusive - search starts at tick+1 for searchingUp)
    /// @param maxTick The maximum tick to search to
    /// @param searchingUp True to search towards higher ticks, false for lower
    /// @return next The next tick with orders
    /// @return found True if a tick with orders was found
    function nextTickWithOrders(
        mapping(int16 => uint256) storage self,
        int24 tick,
        int24 maxTick,
        bool searchingUp
    ) internal view returns (int24 next, bool found) {
        if (searchingUp) {
            return _nextTickUp(self, tick, maxTick);
        } else {
            return _nextTickDown(self, tick, maxTick);
        }
    }

    /// @dev Searches for the next tick with orders going up (towards higher ticks)
    function _nextTickUp(
        mapping(int16 => uint256) storage self,
        int24 tick,
        int24 maxTick
    ) private view returns (int24 next, bool found) {
        // Start searching from tick + 1
        tick++;

        if (tick > maxTick) return (0, false);

        (int16 wordPos, uint8 bitPos) = position(tick);

        // Create mask for all bits at or above current position
        uint256 mask = ~((1 << bitPos) - 1);
        uint256 masked = self[wordPos] & mask;

        if (masked != 0) {
            // Found in current word
            uint8 nextBit = _leastSignificantBit(masked);
            next = int24(int16(wordPos) * 256 + int24(uint24(nextBit)));
            return (next, next <= maxTick);
        }

        // Search subsequent words
        int16 maxWordPos = int16(maxTick >> 8);
        wordPos++;

        while (wordPos <= maxWordPos) {
            uint256 word = self[wordPos];
            if (word != 0) {
                uint8 nextBit = _leastSignificantBit(word);
                next = int24(int16(wordPos) * 256 + int24(uint24(nextBit)));
                return (next, next <= maxTick);
            }
            wordPos++;
        }

        return (0, false);
    }

    /// @dev Searches for the next tick with orders going down (towards lower ticks)
    function _nextTickDown(
        mapping(int16 => uint256) storage self,
        int24 tick,
        int24 minTick
    ) private view returns (int24 next, bool found) {
        // Start searching from tick - 1
        tick--;

        if (tick < minTick) return (0, false);

        (int16 wordPos, uint8 bitPos) = position(tick);

        // Create mask for all bits at or below current position
        uint256 mask = (1 << (bitPos + 1)) - 1;
        uint256 masked = self[wordPos] & mask;

        if (masked != 0) {
            // Found in current word
            uint8 nextBit = _mostSignificantBit(masked);
            next = int24(int16(wordPos) * 256 + int24(uint24(nextBit)));
            return (next, next >= minTick);
        }

        // Search previous words
        int16 minWordPos = int16(minTick >> 8);
        wordPos--;

        while (wordPos >= minWordPos) {
            uint256 word = self[wordPos];
            if (word != 0) {
                uint8 nextBit = _mostSignificantBit(word);
                next = int24(int16(wordPos) * 256 + int24(uint24(nextBit)));
                return (next, next >= minTick);
            }
            wordPos--;
        }

        return (0, false);
    }

    /// @dev Returns the index of the least significant bit in the word
    function _leastSignificantBit(uint256 x) private pure returns (uint8) {
        require(x > 0, "TickBitmap: zero has no LSB");

        uint8 r = 0;

        if (x & 0xffffffffffffffffffffffffffffffff == 0) { r += 128; x >>= 128; }
        if (x & 0xffffffffffffffff == 0) { r += 64; x >>= 64; }
        if (x & 0xffffffff == 0) { r += 32; x >>= 32; }
        if (x & 0xffff == 0) { r += 16; x >>= 16; }
        if (x & 0xff == 0) { r += 8; x >>= 8; }
        if (x & 0xf == 0) { r += 4; x >>= 4; }
        if (x & 0x3 == 0) { r += 2; x >>= 2; }
        if (x & 0x1 == 0) { r += 1; }

        return r;
    }

    /// @dev Returns the index of the most significant bit in the word
    function _mostSignificantBit(uint256 x) private pure returns (uint8) {
        require(x > 0, "TickBitmap: zero has no MSB");

        uint8 r = 0;

        if (x >= 0x100000000000000000000000000000000) { r += 128; x >>= 128; }
        if (x >= 0x10000000000000000) { r += 64; x >>= 64; }
        if (x >= 0x100000000) { r += 32; x >>= 32; }
        if (x >= 0x10000) { r += 16; x >>= 16; }
        if (x >= 0x100) { r += 8; x >>= 8; }
        if (x >= 0x10) { r += 4; x >>= 4; }
        if (x >= 0x4) { r += 2; x >>= 2; }
        if (x >= 0x2) { r += 1; }

        return r;
    }
}
