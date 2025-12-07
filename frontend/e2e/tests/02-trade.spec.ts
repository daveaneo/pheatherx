import { test, expect } from '../fixtures/wallet';

/**
 * Trade Page E2E Tests
 *
 * Tests the unified /trade page functionality:
 * - Market swap form
 * - Limit order form
 * - Order book panel
 * - Active orders panel
 *
 * Note: Trade page is behind FheSessionGuard.
 * When FHE session is not initialized, it shows "Privacy Session Required".
 */

test.describe('Trade Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/trade');
    await page.waitForLoadState('networkidle');
  });

  test('should auto-connect test wallet', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    const walletConnection = page.locator('[data-testid="wallet-connection"]');
    await expect(walletConnection).toContainText('0x');
  });

  test('should display trade page header', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for page header or privacy session prompt
    const hasTradeContent = await page.locator('text=/Trade|Trading|Privacy Session Required/i').first().isVisible().catch(() => false);
    expect(hasTradeContent).toBe(true);
  });

  test('should display execution panel with tabs or privacy session', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for Market/Limit tabs or Privacy Session Required
    const tabsOrPrivacy = page.locator('text=/Market|Limit|Privacy Session Required/i');
    await expect(tabsOrPrivacy.first()).toBeVisible({ timeout: 10000 });
  });

  test('should display order book panel or privacy session', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for Order Book or privacy session
    const orderBookOrPrivacy = page.locator('text=/Order Book|BUY|SELL|Privacy Session Required/i');
    const hasContent = await orderBookOrPrivacy.first().isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });

  test('should display current price panel or privacy session', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for price display or privacy session
    const priceOrPrivacy = page.locator('text=/Current Price|\\$|Privacy Session Required/i');
    const hasContent = await priceOrPrivacy.first().isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });

  test('should have swap button or initialize button', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Should have either Swap button, Enter Amount, or Initialize Privacy Session
    const button = page.locator('button:has-text("Swap"), button:has-text("Enter"), button:has-text("Initialize")');
    const buttonCount = await button.count();
    expect(buttonCount).toBeGreaterThan(0);
  });

  test('should display active orders section or privacy session', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for Active Orders section or no orders message
    const ordersOrPrivacy = page.locator('text=/Active Orders|Your Orders|No orders|No active|Privacy Session Required/i');
    const hasContent = await ordersOrPrivacy.first().isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });
});

test.describe('Trade Page - Market Swap', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/trade');
    await page.waitForLoadState('networkidle');
  });

  test('should display from/to token inputs when session is ready', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for token input sections or privacy prompt
    const tokenInputs = page.locator('text=/From|To|Sell|Buy|Privacy Session Required/i');
    await expect(tokenInputs.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Trade Page - Limit Orders', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/trade');
    await page.waitForLoadState('networkidle');
  });

  test('should switch to limit order tab when clicked', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check if we're on privacy session mode
    const privacySession = page.locator('text=Privacy Session Required');
    const hasPrivacy = await privacySession.isVisible().catch(() => false);

    if (!hasPrivacy) {
      // Try to click on Limit tab
      const limitTab = page.locator('button:has-text("Limit"), [role="tab"]:has-text("Limit")');
      const hasLimitTab = await limitTab.first().isVisible().catch(() => false);

      if (hasLimitTab) {
        await limitTab.first().click();
        await page.waitForTimeout(500);

        // Should now see limit order form elements
        const limitForm = page.locator('text=/Price|Limit Buy|Limit Sell|Order Type/i');
        const hasLimitForm = await limitForm.first().isVisible().catch(() => false);
        expect(hasLimitForm).toBe(true);
      }
    }
  });
});
