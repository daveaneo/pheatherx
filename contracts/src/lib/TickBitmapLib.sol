// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TickBitmapLib - Word-level bitmap operations for tick tracking
/// @notice Extracted from FheatherX for contract size optimization
/// @dev Uses Uniswap-style compressed ticks and word-level bit manipulation
library TickBitmapLib {
    /// @notice Compress tick to bitmap coordinate
    /// @dev Solidity division rounds toward zero; we need floor division for negative ticks
    function compress(int24 tick, int24 tickSpacing) internal pure returns (int24 compressed) {
        compressed = tick / tickSpacing;
        // Floor division for negative ticks
        if (tick < 0 && tick % tickSpacing != 0) compressed--;
    }

    /// @notice Decompress bitmap coordinate to tick
    function decompress(int24 compressed, int24 tickSpacing) internal pure returns (int24) {
        return compressed * tickSpacing;
    }

    /// @notice Get word position and bit position for compressed tick
    function position(int24 compressed) internal pure returns (int16 wordPos, uint8 bitPos) {
        wordPos = int16(compressed >> 8);
        bitPos = uint8(uint24(compressed) & 0xFF);
    }

    /// @notice Find the least significant bit (rightmost set bit)
    /// @dev Uses de Bruijn multiplication
    function lsb(uint256 x) internal pure returns (uint8 r) {
        require(x > 0, "lsb: zero");
        assembly {
            // Isolate the least significant bit
            x := and(x, sub(0, x))
            // de Bruijn sequence for 256-bit
            r := byte(
                shr(251, mul(x, 0x818283848586878898a8b8c8d8e8f929395969799a9b9d9e9faaeb6bedeeff)),
                0x00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff
            )
        }
    }

    /// @notice Find the most significant bit (leftmost set bit)
    function msb(uint256 x) internal pure returns (uint8 r) {
        require(x > 0, "msb: zero");
        if (x >= 0x100000000000000000000000000000000) { x >>= 128; r += 128; }
        if (x >= 0x10000000000000000) { x >>= 64; r += 64; }
        if (x >= 0x100000000) { x >>= 32; r += 32; }
        if (x >= 0x10000) { x >>= 16; r += 16; }
        if (x >= 0x100) { x >>= 8; r += 8; }
        if (x >= 0x10) { x >>= 4; r += 4; }
        if (x >= 0x4) { x >>= 2; r += 2; }
        if (x >= 0x2) r += 1;
    }

    /// @notice Find next initialized tick within one word
    /// @param bitmap The bitmap word to search
    /// @param bitPos Starting bit position
    /// @param lte Search direction: true = search left (<=), false = search right (>)
    /// @return nextBitPos The next initialized bit position
    /// @return initialized Whether a bit was found
    function nextInitializedBitWithinWord(
        uint256 bitmap,
        uint8 bitPos,
        bool lte
    ) internal pure returns (uint8 nextBitPos, bool initialized) {
        if (lte) {
            // Search left (towards lower bits, which are lower ticks)
            uint256 mask = (1 << (uint256(bitPos) + 1)) - 1; // bits <= bitPos
            uint256 masked = bitmap & mask;
            initialized = masked != 0;
            if (initialized) {
                nextBitPos = msb(masked);
            }
        } else {
            // Search right (towards higher bits, which are higher ticks)
            uint256 mask = ~((1 << bitPos) - 1); // bits >= bitPos
            uint256 masked = bitmap & mask;
            initialized = masked != 0;
            if (initialized) {
                nextBitPos = lsb(masked);
            }
        }
    }

    /// @notice Set a bit in the bitmap
    function setBit(
        mapping(int16 => uint256) storage bitmap,
        int24 tick,
        int24 tickSpacing
    ) internal {
        int24 compressed = compress(tick, tickSpacing);
        (int16 wordPos, uint8 bitPos) = position(compressed);
        bitmap[wordPos] |= (1 << bitPos);
    }

    /// @notice Clear a bit in the bitmap
    function clearBit(
        mapping(int16 => uint256) storage bitmap,
        int24 tick,
        int24 tickSpacing
    ) internal {
        int24 compressed = compress(tick, tickSpacing);
        (int16 wordPos, uint8 bitPos) = position(compressed);
        bitmap[wordPos] &= ~(1 << bitPos);
    }

    /// @notice Check if a bit is set
    function isSet(
        mapping(int16 => uint256) storage bitmap,
        int24 tick,
        int24 tickSpacing
    ) internal view returns (bool) {
        int24 compressed = compress(tick, tickSpacing);
        (int16 wordPos, uint8 bitPos) = position(compressed);
        return (bitmap[wordPos] & (1 << bitPos)) != 0;
    }

    /// @notice Find next initialized tick, crossing word boundaries if needed
    /// @param bitmap The bitmap mapping to search
    /// @param tick Starting tick
    /// @param tickSpacing Tick spacing
    /// @param lte Search direction
    /// @param maxWords Maximum words to search
    /// @return nextTick The next initialized tick
    /// @return found Whether a tick was found
    function findNextInitializedTick(
        mapping(int16 => uint256) storage bitmap,
        int24 tick,
        int24 tickSpacing,
        bool lte,
        uint8 maxWords
    ) internal view returns (int24 nextTick, bool found) {
        int24 compressed = compress(tick, tickSpacing);

        for (uint8 w = 0; w < maxWords; w++) {
            (int16 wordPos, uint8 bitPos) = position(compressed);
            uint256 word = bitmap[wordPos];

            if (word != 0) {
                (uint8 nextBit, bool initialized) = nextInitializedBitWithinWord(word, bitPos, lte);
                if (initialized) {
                    int24 foundCompressed = (int24(wordPos) << 8) + int24(uint24(nextBit));
                    return (decompress(foundCompressed, tickSpacing), true);
                }
            }

            // Move to next word
            if (lte) {
                if (wordPos == type(int16).min) break;
                compressed = (int24(wordPos) << 8) - 1; // Last bit of previous word
            } else {
                if (wordPos == type(int16).max) break;
                compressed = (int24(wordPos) + 1) << 8; // First bit of next word
            }
        }

        return (0, false);
    }
}
