/**
 * Privacy validation rules for FheatherX
 *
 * These rules enforce the privacy model described in token-pair-support.md:
 * - Limit orders with ERC20 input tokens expose order amounts on-chain (unsafe)
 * - Only FHERC20 input tokens provide privacy for limit orders
 */

import type { Token, TokenType } from '@/lib/tokens';

/**
 * Privacy Matrix for Limit Orders:
 * | Input Token | Output Token | Action | Reason |
 * |-------------|--------------|--------|--------|
 * | FHERC20     | FHERC20      | ALLOW  | Full privacy - both amounts encrypted |
 * | FHERC20     | ERC20        | ALLOW  | Input hidden, output visible (acceptable) |
 * | ERC20       | FHERC20      | BLOCK  | Input amount visible on-chain |
 * | ERC20       | ERC20        | BLOCK  | Both amounts visible on-chain |
 */

export interface PrivacyValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

/**
 * Check if a token is an FHERC20 (FHE-encrypted) token
 */
export function isFHERC20(token: Token | undefined): boolean {
  if (!token) return false;
  return token.type === 'fherc20';
}

/**
 * Check if a token is a standard ERC20 token
 */
export function isERC20(token: Token | undefined): boolean {
  if (!token) return false;
  return token.type === 'erc20' || token.type === undefined;
}

/**
 * Validate if a limit order preserves privacy
 *
 * @param inputToken - The token being used as input (deposited to the order)
 * @param outputToken - The token expected as output (received when filled)
 * @returns Validation result with error message if invalid
 */
export function validateLimitOrderPrivacy(
  inputToken: Token | undefined,
  outputToken?: Token | undefined
): PrivacyValidationResult {
  // If no input token selected, can't validate yet
  if (!inputToken) {
    return { valid: true };
  }

  // Check if input token is ERC20 (not encrypted)
  if (isERC20(inputToken)) {
    return {
      valid: false,
      error: `Privacy Warning: Limit orders with ${inputToken.symbol || 'ERC20'} tokens expose your order amount on-chain. Wrap your tokens to ${inputToken.wrappedToken ? 'the FHERC20 version' : 'FHERC20'} first for privacy.`,
    };
  }

  // FHERC20 input is allowed
  if (isFHERC20(inputToken)) {
    // Optionally warn about output token visibility (not a blocker)
    if (outputToken && isERC20(outputToken)) {
      return {
        valid: true,
        warning: `Note: Your input amount is encrypted, but output amount (${outputToken.symbol}) will be visible when the order fills.`,
      };
    }
    return { valid: true };
  }

  // Unknown token type - allow but warn
  return {
    valid: true,
    warning: 'Unable to determine token privacy type. Proceed with caution.',
  };
}

/**
 * Get the FHERC20 wrapper address for an ERC20 token
 */
export function getWrapperToken(token: Token | undefined): `0x${string}` | undefined {
  if (!token) return undefined;
  return token.wrappedToken;
}

/**
 * Get the underlying ERC20 address for an FHERC20 token
 */
export function getUnderlyingToken(token: Token | undefined): `0x${string}` | undefined {
  if (!token) return undefined;
  return token.unwrappedToken;
}

/**
 * Privacy info for display
 */
export const PRIVACY_INFO = {
  fherc20: {
    icon: '🛡️',
    label: 'Private',
    description: 'FHE-encrypted token - amounts are hidden on-chain',
  },
  erc20: {
    icon: '👁️',
    label: 'Public',
    description: 'Standard ERC20 - amounts are visible on-chain',
  },
} as const;

/**
 * Limit order availability for a token pair
 * Based on FheatherX privacy requirements:
 * - Input (deposit) token must be FHERC20 for privacy
 * - Buy orders deposit token1, Sell orders deposit token0
 */
export interface LimitOrderAvailability {
  /** Can place buy orders (limit-buy) */
  buyEnabled: boolean;
  /** Can place sell orders (limit-sell, stop-loss, take-profit) */
  sellEnabled: boolean;
  /** Reason why buy is disabled */
  buyDisabledReason?: string;
  /** Reason why sell is disabled */
  sellDisabledReason?: string;
  /** Overall summary message */
  message?: string;
}

/**
 * Check limit order availability for a token pair
 *
 * Privacy Matrix:
 * | Token0 | Token1 | Buy (deposits token1) | Sell (deposits token0) |
 * |--------|--------|----------------------|------------------------|
 * | FHERC20| FHERC20| Yes                  | Yes                    |
 * | FHERC20| ERC20  | No (token1 public)   | Yes                    |
 * | ERC20  | FHERC20| Yes                  | No (token0 public)     |
 * | ERC20  | ERC20  | No                   | No                     |
 *
 * @param token0 - First token in the pair (what you buy/sell)
 * @param token1 - Second token in the pair (quote token)
 * @returns Availability object with enabled states and reasons
 */
export function getLimitOrderAvailability(
  token0: Token | undefined,
  token1: Token | undefined
): LimitOrderAvailability {
  // If tokens not loaded yet, disable everything
  if (!token0 || !token1) {
    return {
      buyEnabled: false,
      sellEnabled: false,
      message: 'Select a trading pair to see limit order options',
    };
  }

  const token0IsFhe = isFHERC20(token0);
  const token1IsFhe = isFHERC20(token1);

  // Buy orders deposit token1 → needs token1 to be FHERC20
  const buyEnabled = token1IsFhe;
  // Sell orders deposit token0 → needs token0 to be FHERC20
  const sellEnabled = token0IsFhe;

  const result: LimitOrderAvailability = {
    buyEnabled,
    sellEnabled,
  };

  // Set disabled reasons
  if (!buyEnabled) {
    result.buyDisabledReason = `Buy orders require ${token1.symbol} to be encrypted (FHERC20)`;
  }
  if (!sellEnabled) {
    result.sellDisabledReason = `Sell orders require ${token0.symbol} to be encrypted (FHERC20)`;
  }

  // Set overall message
  if (!buyEnabled && !sellEnabled) {
    // ERC20/ERC20 pair - no limit orders possible (neither token provides privacy)
    result.message = `Limit orders unavailable - at least one token must be FHERC20 for privacy. ${token0.symbol}/${token1.symbol} are both standard ERC20 tokens.`;
  } else if (!buyEnabled) {
    result.message = `Only sell orders available (${token0.symbol} is encrypted)`;
  } else if (!sellEnabled) {
    result.message = `Only buy orders available (${token1.symbol} is encrypted)`;
  }

  return result;
}

/**
 * Hook-friendly function to check if limit orders are fully available
 */
export function areLimitOrdersFullyAvailable(
  token0: Token | undefined,
  token1: Token | undefined
): boolean {
  const availability = getLimitOrderAvailability(token0, token1);
  return availability.buyEnabled && availability.sellEnabled;
}
