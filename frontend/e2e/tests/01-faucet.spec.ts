import { test, expect } from '../fixtures/wallet';

/**
 * Faucet E2E Tests
 *
 * Tests the faucet page functionality:
 * - Wallet auto-connects in test mode
 * - Displays ETH balance
 * - Shows network indicator (Local Anvil for tests)
 *
 * Note: On Local Anvil, the test wallet is pre-funded with tokens,
 * and the faucet shows tokens from discovered pools.
 */

test.describe('Faucet Page', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to faucet page
    await page.goto('/faucet');

    // Wait for page to load
    await page.waitForLoadState('networkidle');
  });

  test('should auto-connect test wallet in test mode', async ({ page, waitForWalletConnected }) => {
    // In test mode, wallet should auto-connect
    await waitForWalletConnected();

    // Verify the wallet connection area shows an address
    const walletConnection = page.locator('[data-testid="wallet-connection"]');
    await expect(walletConnection).toContainText('0x');
  });

  test('should display faucet page header', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for content to load
    await page.waitForTimeout(2000);

    // Check page title is visible
    await expect(page.locator('h1')).toContainText('Testnet Faucet');

    // Check description is visible
    const description = page.locator('text=/test tokens|PheatherX ecosystem/i');
    await expect(description.first()).toBeVisible({ timeout: 10000 });
  });

  test('should show Local Anvil network indicator', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for content to load
    await page.waitForTimeout(2000);

    // Should show Local Anvil network indicator badge on the faucet page
    const networkBadge = page.locator('[data-testid="faucet-network-badge"]');
    await expect(networkBadge).toBeVisible({ timeout: 10000 });
    await expect(networkBadge).toContainText('Local Anvil');
  });

  test('should display ETH balance section', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for content to load
    await page.waitForTimeout(2000);

    // Wait for ETH Balance card title (CardTitle component)
    const ethBalanceTitle = page.locator('text=ETH Balance');
    await expect(ethBalanceTitle.first()).toBeVisible({ timeout: 10000 });

    // On Local Anvil, should see "Auto-funded" badge
    const autoFundedBadge = page.locator('text=Auto-funded');
    await expect(autoFundedBadge).toBeVisible({ timeout: 10000 });
  });

  test('should display How to use instructions', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for content to load
    await page.waitForTimeout(2000);

    // Check instructions section
    const howToUse = page.locator('text=How to use');
    await expect(howToUse).toBeVisible({ timeout: 10000 });

    // Check for request instruction
    const requestInstruction = page.locator('text=/Request|1,000 tokens/i');
    await expect(requestInstruction.first()).toBeVisible({ timeout: 10000 });
  });

  test('should display ecosystem tokens when pools are available', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for token list to potentially load
    await page.waitForTimeout(3000);

    // Either we see "Ecosystem Tokens" header, or we see "No tokens available"
    const ecosystemTokensHeader = page.locator('text=Ecosystem Tokens');
    const noTokensMessage = page.locator('text=/No tokens available|No pools/i');

    // One of these should be visible
    const hasEcosystemTokens = await ecosystemTokensHeader.isVisible().catch(() => false);
    const hasNoTokensMessage = await noTokensMessage.first().isVisible().catch(() => false);

    // Either tokens are shown or a "no tokens" message
    expect(hasEcosystemTokens || hasNoTokensMessage).toBe(true);

    // If tokens are available (from pool discovery), verify Request buttons exist
    if (hasEcosystemTokens) {
      const requestButtons = page.locator('button:has-text("Request")');
      const buttonCount = await requestButtons.count();
      if (buttonCount > 0) {
        await expect(requestButtons.first()).toBeVisible();
      }
    }
  });
});
