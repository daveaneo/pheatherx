import { test, expect } from '../fixtures/wallet';

/**
 * Route Redirect E2E Tests
 *
 * Tests that deprecated routes redirect correctly:
 * - /swap → /trade
 * - /faucet → /portfolio
 * - /orders/new → /trade
 * - /orders/active → /trade
 * - /orders/history → /trade
 * - /analytics → /
 */

test.describe('Route Redirects', () => {
  test('/swap should redirect to /trade', async ({ page }) => {
    await page.goto('/swap');
    await page.waitForURL('**/trade');
    expect(page.url()).toContain('/trade');
  });

  test('/faucet should redirect to /portfolio', async ({ page }) => {
    await page.goto('/faucet');
    await page.waitForURL('**/portfolio');
    expect(page.url()).toContain('/portfolio');
  });

  test('/orders/new should redirect to /trade', async ({ page }) => {
    await page.goto('/orders/new');
    await page.waitForURL('**/trade');
    expect(page.url()).toContain('/trade');
  });

  test('/orders/active should redirect to /trade', async ({ page }) => {
    await page.goto('/orders/active');
    await page.waitForURL('**/trade');
    expect(page.url()).toContain('/trade');
  });

  test('/orders/history should redirect to /trade', async ({ page }) => {
    await page.goto('/orders/history');
    await page.waitForURL('**/trade');
    expect(page.url()).toContain('/trade');
  });

  test('/analytics should redirect to homepage', async ({ page }) => {
    await page.goto('/analytics');
    // Should redirect to homepage (/)
    await page.waitForURL((url) => url.pathname === '/' || url.pathname === '');
    const pathname = new URL(page.url()).pathname;
    expect(pathname === '/' || pathname === '').toBe(true);
  });
});
