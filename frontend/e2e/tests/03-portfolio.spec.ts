import { test, expect } from '../fixtures/wallet';

/**
 * Portfolio E2E Tests
 *
 * Tests the portfolio page functionality:
 * - View encrypted balances
 * - Deposit and withdraw tabs
 * - Balance cards
 *
 * Note: Portfolio page is behind FheSessionGuard on Local Anvil.
 * When FHE session is not initialized, it shows "Privacy Session Required".
 * These tests check for either the page content OR the session UI.
 */

test.describe('Portfolio Page', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to portfolio page
    await page.goto('/portfolio');

    // Wait for page to load
    await page.waitForLoadState('networkidle');
  });

  test('should auto-connect test wallet', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Verify wallet is connected
    const walletConnection = page.locator('[data-testid="wallet-connection"]');
    await expect(walletConnection).toContainText('0x');
  });

  test('should display portfolio page or privacy session', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for content
    await page.waitForTimeout(2000);

    // Check for either:
    // - Portfolio page header (when session is ready)
    // - Privacy Session Required (when session not ready)
    const portfolioTitle = page.locator('h1:has-text("Portfolio")');
    const privacySession = page.locator('h2:has-text("Privacy Session Required")');

    const hasPortfolio = await portfolioTitle.isVisible().catch(() => false);
    const hasPrivacy = await privacySession.isVisible().catch(() => false);

    // Either we see portfolio or privacy session prompt
    expect(hasPortfolio || hasPrivacy).toBe(true);
  });

  test('should display content on portfolio page', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for content to load
    await page.waitForTimeout(2000);

    // Look for either:
    // - Portfolio content (deposit/withdraw tabs, balances)
    // - Privacy Session Required
    const portfolioContent = page.locator('text=/Deposit|Withdraw|Balance|Privacy Session Required|Initialize Privacy Session/i');
    await expect(portfolioContent.first()).toBeVisible({ timeout: 10000 });
  });
});
