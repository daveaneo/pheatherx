import { test, expect } from '../fixtures/wallet';

/**
 * Orders E2E Tests
 *
 * Tests the orders page functionality:
 * - New order form
 * - Order type selection
 * - Active orders list
 * - Order history
 *
 * Note: Order form is behind FheSessionGuard on Local Anvil.
 * When FHE session is not initialized, it shows "Privacy Session Required".
 * These tests check for either the form OR the session UI.
 */

test.describe('Orders - New Order Page', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to new order page
    await page.goto('/orders/new');

    // Wait for page to load
    await page.waitForLoadState('networkidle');
  });

  test('should auto-connect test wallet', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Verify wallet is connected
    const walletConnection = page.locator('[data-testid="wallet-connection"]');
    await expect(walletConnection).toContainText('0x');
  });

  test('should display page content or FHE session guard', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for content
    await page.waitForTimeout(2000);

    // The FheSessionGuard shows "Privacy Session Required" with an h2 when not ready
    // OR when ready, shows "New Order" in an h1
    const privacySessionTitle = page.locator('h2:has-text("Privacy Session Required")');
    const newOrderTitle = page.locator('h1:has-text("New Order")');

    const hasPrivacySession = await privacySessionTitle.isVisible().catch(() => false);
    const hasNewOrder = await newOrderTitle.isVisible().catch(() => false);

    // Either we see the privacy session prompt or the new order form
    expect(hasPrivacySession || hasNewOrder).toBe(true);
  });

  test('should display order form or privacy session prompt', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for content
    await page.waitForTimeout(2000);

    // Check for either:
    // - Place Order card (when session is ready)
    // - Initialize Privacy Session button (when session not ready)
    const formContent = page.locator('text=/Place Order|Initialize Privacy Session|Order Type|Privacy Session Required/i');
    await expect(formContent.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Orders - Active Orders Page', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to active orders page
    await page.goto('/orders/active');

    // Wait for page to load
    await page.waitForLoadState('networkidle');
  });

  test('should display active orders page', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for content
    await page.waitForTimeout(2000);

    // Should show active orders content or Privacy Session Required
    // Either a list of orders, "No active orders" message, or FHE session UI
    const content = page.locator('text=/Active Orders|No active orders|No orders|Privacy Session Required/i');
    await expect(content.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Orders - History Page', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to order history page
    await page.goto('/orders/history');

    // Wait for page to load
    await page.waitForLoadState('networkidle');
  });

  test('should display order history page', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for content
    await page.waitForTimeout(2000);

    // Should show order history content or Privacy Session Required
    // Either a list of orders, "No order history" message, or FHE session UI
    const content = page.locator('text=/Order History|No orders|No history|Privacy Session Required/i');
    await expect(content.first()).toBeVisible({ timeout: 10000 });
  });
});
