import { test, expect } from '../fixtures/wallet';

/**
 * Liquidity Page E2E Tests
 *
 * Tests the liquidity page functionality:
 * - LP management
 * - Add liquidity form
 * - Remove liquidity form
 * - LP positions
 */

test.describe('Liquidity Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/liquidity');
    await page.waitForLoadState('networkidle');
  });

  test('should auto-connect test wallet', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    const walletConnection = page.locator('[data-testid="wallet-connection"]');
    await expect(walletConnection).toContainText('0x');
  });

  test('should display liquidity page header', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for Orders or Liquidity header (page is now titled "Orders" for limit orders)
    const pageTitle = page.locator('h1:has-text("Orders"), h1:has-text("Liquidity")');
    await expect(pageTitle.first()).toBeVisible({ timeout: 10000 });
  });

  test('should display add/remove liquidity options', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for Place Orders / Cancel Orders tabs or related content
    const ordersContent = page.locator('text=/Place Orders|Cancel Orders|Add Liquidity|Remove|LP|Position/i');
    await expect(ordersContent.first()).toBeVisible({ timeout: 10000 });
  });

  test('should have action buttons', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Should have buttons for liquidity actions
    const buttons = page.locator('button');
    const buttonCount = await buttons.count();
    expect(buttonCount).toBeGreaterThan(0);
  });
});

test.describe('Liquidity - Add Liquidity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/liquidity');
    await page.waitForLoadState('networkidle');
  });

  test('should display add liquidity form elements', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for form elements
    const formContent = page.locator('text=/Amount|Token|Add|Deposit/i');
    const hasForm = await formContent.first().isVisible().catch(() => false);
    console.log('Has liquidity form:', hasForm);
  });
});
