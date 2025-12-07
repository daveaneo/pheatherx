/**
 * FheatherX v3 Hooks
 *
 * These hooks provide React-friendly wrappers for interacting with the
 * FheatherXv3 contract. They handle FHE encryption, transaction state,
 * and store updates.
 */

// Core transaction hooks
export { useV3Deposit, type DepositStep, type DepositParams } from './useV3Deposit';
export { useV3Swap, type SwapStep, type SwapParams, type SwapResult } from './useV3Swap';
export { useV3Claim, type ClaimStep, type ClaimParams } from './useV3Claim';
export { useV3Withdraw, type WithdrawStep, type WithdrawParams } from './useV3Withdraw';
export { useV3Exit, type ExitStep, type ExitParams } from './useV3Exit';

// Read hooks
export { useV3Position } from './useV3Position';
export { useCurrentPrice, useTickPrices } from './useCurrentPrice';
