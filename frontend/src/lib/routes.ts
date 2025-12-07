/**
 * Route detection utilities for distinguishing homepage from dApp pages
 */

// Routes that are part of the dApp experience (require full navbar with wallet connect)
export const DAPP_ROUTES = [
  '/trade',      // Unified trading page (swaps + orders)
  '/swap',       // Legacy - redirects to /trade
  '/liquidity',
  '/orders',     // Legacy - redirects to /trade
  '/portfolio',
  '/auctions',
  '/launchpad',
  '/faucet',     // Legacy - redirects to /portfolio
  '/analytics',  // Legacy - redirects to /
];

/**
 * Check if the current pathname is a dApp route
 * dApp routes get the full navbar with wallet connect and navigation
 * Non-dApp routes (homepage) get the minimal navbar
 */
export function isDAppRoute(pathname: string): boolean {
  return DAPP_ROUTES.some(route =>
    pathname === route || pathname.startsWith(`${route}/`)
  );
}
