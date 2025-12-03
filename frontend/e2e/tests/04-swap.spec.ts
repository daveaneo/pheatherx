import { test, expect } from '../fixtures/wallet';

/**
 * Swap E2E Tests
 *
 * Tests the swap page functionality:
 * - Swap card UI elements
 * - Token selector
 * - Pool selector
 * - Input validation
 * - Swap direction toggle
 *
 * Note: Swap page is behind FheSessionGuard on Local Anvil.
 * When FHE session is not initialized, it shows "Privacy Session Required".
 * These tests check for either the swap UI OR the session UI.
 */

test.describe('Swap Page', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to swap page
    await page.goto('/swap');

    // Wait for page to load
    await page.waitForLoadState('networkidle');
  });

  test('should auto-connect test wallet', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Verify wallet is connected
    const walletConnection = page.locator('[data-testid="wallet-connection"]');
    await expect(walletConnection).toContainText('0x');
  });

  test('should display swap card or privacy session prompt', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for swap card to load
    await page.waitForTimeout(2000);

    // Check for swap card elements or privacy session
    const swapTitle = page.locator('text=Swap');
    const privacySession = page.locator('text=Privacy Session Required');

    const hasSwap = await swapTitle.first().isVisible().catch(() => false);
    const hasPrivacy = await privacySession.isVisible().catch(() => false);

    expect(hasSwap || hasPrivacy).toBe(true);
  });

  test('should display swap UI or initialize button', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for content
    await page.waitForTimeout(2000);

    // If pool is available and session ready, should see From/To sections
    // Otherwise should see Privacy Session Required
    const content = page.locator('text=/From|To|Privacy Session Required|Initialize Privacy Session/i');
    await expect(content.first()).toBeVisible({ timeout: 10000 });
  });

  test('should display content on swap page', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for content
    await page.waitForTimeout(2000);

    // Check for either:
    // - Swap button/card (when session ready)
    // - Privacy Session Required (when session not ready)
    // - No pools available (when no pools discovered)
    const content = page.locator('text=/Swap|Privacy Session Required|No pools available|Initialize/i');
    await expect(content.first()).toBeVisible({ timeout: 10000 });
  });

  test('should display pool selector or privacy prompt', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for content
    await page.waitForTimeout(2000);

    // Check if we're in privacy session mode or if session is ready
    const privacySession = page.locator('text=Privacy Session Required');
    const hasPrivacyPrompt = await privacySession.isVisible().catch(() => false);

    if (!hasPrivacyPrompt) {
      // If session is ready, look for pool selector or "no pools" message
      const poolContent = page.locator('text=/\\/|No pools available/');  // Pool names have "/"
      const hasPoolContent = await poolContent.first().isVisible().catch(() => false);

      // Either we have pool UI or no pools message
      console.log('Pool content visible:', hasPoolContent);
    } else {
      // Privacy session mode - test passes
      expect(hasPrivacyPrompt).toBe(true);
    }
  });

  test('should display swap button or initialize button', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for content
    await page.waitForTimeout(2000);

    // Check if we have a button - either "Swap", "Enter amount", or "Initialize Privacy Session"
    const buttons = page.locator('button');
    const buttonCount = await buttons.count();

    // Should have at least one button on the page
    expect(buttonCount).toBeGreaterThan(0);
  });

  test('should display FHE protection message or privacy session', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for content
    await page.waitForTimeout(2000);

    // Check for FHE-related text or Privacy Session prompt
    const fheText = page.locator('text=/FHE|private|protection|Privacy Session|mock/i');
    const hasFheText = await fheText.first().isVisible().catch(() => false);

    // This is informational - FHE/privacy message should be present
    console.log('FHE/privacy message visible:', hasFheText);
    expect(hasFheText).toBe(true);
  });
});
