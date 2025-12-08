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
