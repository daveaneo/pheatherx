/**
 * FheatherX v5 Hooks
 *
 * These hooks provide React-friendly wrappers for interacting with the
 * FheatherXv5 Uniswap v4 Hook contract. They handle FHE encryption,
 * transaction state, and store updates.
 */

// Core transaction hooks
export { useSwap } from './useSwap';
export { useDeposit } from './useDeposit';
export { usePlaceOrder } from './usePlaceOrder';
export { useCancelOrder } from './useCancelOrder';
export { useClosePosition } from './useClosePosition';

// Wrap/Unwrap hooks
export { useWrap } from './useWrap';
export { useUnwrap } from './useUnwrap';

// Read hooks
export { useCurrentPrice, useTickPrices } from './useCurrentPrice';
export { useActiveOrders } from './useActiveOrders';

// Pool hooks
export { usePoolDiscovery } from './usePoolDiscovery';

// Balance hooks
export { useBalanceReveal } from './useBalanceReveal';
export { useAggregatedBalanceReveal } from './useAggregatedBalanceReveal';
