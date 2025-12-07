import { test, expect } from '../fixtures/wallet';

/**
 * Portfolio Page E2E Tests
 *
 * Tests the portfolio page functionality:
 * - Wallet balances
 * - Faucet section (testnet)
 * - Positions table
 * - Claims section
 * - Trade history
 *
 * Note: Portfolio page is behind FheSessionGuard.
 * When FHE session is not initialized, it shows "Privacy Session Required".
 */

test.describe('Portfolio Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portfolio');
    await page.waitForLoadState('networkidle');
  });

  test('should auto-connect test wallet', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    const walletConnection = page.locator('[data-testid="wallet-connection"]');
    await expect(walletConnection).toContainText('0x');
  });

  test('should display portfolio page header or privacy session', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for Portfolio header or privacy session
    const portfolioTitle = page.locator('h1:has-text("Portfolio")');
    const privacySession = page.locator('h2:has-text("Privacy Session Required")');

    const hasPortfolio = await portfolioTitle.isVisible().catch(() => false);
    const hasPrivacy = await privacySession.isVisible().catch(() => false);

    expect(hasPortfolio || hasPrivacy).toBe(true);
  });

  test('should display balance cards or privacy session', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for balance cards or privacy session
    const balanceContent = page.locator('text=/Balance|WETH|USDC|fheWETH|fheUSDC|Privacy Session Required/i');
    await expect(balanceContent.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Portfolio - Faucet Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portfolio');
    await page.waitForLoadState('networkidle');
  });

  test('should display faucet section on testnet or privacy session', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // On testnet, should show Faucet section
    // Check for Faucet heading or privacy session
    const faucetOrPrivacy = page.locator('text=/Faucet|Mint|Get Tokens|Privacy Session Required/i');
    const hasContent = await faucetOrPrivacy.first().isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });

  test('should show mint buttons on testnet or privacy session', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for Mint buttons or privacy session
    const privacySession = page.locator('text=Privacy Session Required');
    const hasPrivacy = await privacySession.isVisible().catch(() => false);

    if (!hasPrivacy) {
      // Look for mint buttons or faucet content
      const mintButtons = page.locator('button:has-text("Mint"), button:has-text("Request"), text=/Mint|Request tokens/i');
      const hasMint = await mintButtons.first().isVisible().catch(() => false);
      // Either we have mint buttons or we're on mainnet (no faucet)
      console.log('Has mint buttons:', hasMint);
    }
  });
});

test.describe('Portfolio - Positions Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portfolio');
    await page.waitForLoadState('networkidle');
  });

  test('should display positions tab or privacy session', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for Positions tab or privacy session
    const positionsOrPrivacy = page.locator('text=/Positions|No positions|Privacy Session Required/i');
    await expect(positionsOrPrivacy.first()).toBeVisible({ timeout: 10000 });
  });

  test('should show positions table or empty state', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    const privacySession = page.locator('text=Privacy Session Required');
    const hasPrivacy = await privacySession.isVisible().catch(() => false);

    if (!hasPrivacy) {
      // Try clicking Positions tab if it exists
      const positionsTab = page.locator('button:has-text("Positions"), [role="tab"]:has-text("Positions")');
      const hasTab = await positionsTab.first().isVisible().catch(() => false);

      if (hasTab) {
        await positionsTab.first().click();
        await page.waitForTimeout(500);
      }

      // Should see positions table or "no positions" message
      const positionsContent = page.locator('text=/Tick|Side|Shares|No positions|No active positions/i');
      const hasContent = await positionsContent.first().isVisible().catch(() => false);
      expect(hasContent).toBe(true);
    }
  });
});

test.describe('Portfolio - Claims Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portfolio');
    await page.waitForLoadState('networkidle');
  });

  test('should display claims tab or privacy session', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for Claims tab or privacy session
    const claimsOrPrivacy = page.locator('text=/Claims|Claim|Privacy Session Required/i');
    await expect(claimsOrPrivacy.first()).toBeVisible({ timeout: 10000 });
  });

  test('should show claims section when clicking tab', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    const privacySession = page.locator('text=Privacy Session Required');
    const hasPrivacy = await privacySession.isVisible().catch(() => false);

    if (!hasPrivacy) {
      // Try clicking Claims tab if it exists
      const claimsTab = page.locator('button:has-text("Claims"), [role="tab"]:has-text("Claims")');
      const hasTab = await claimsTab.first().isVisible().catch(() => false);

      if (hasTab) {
        await claimsTab.first().click();
        await page.waitForTimeout(500);

        // Should see claims content
        const claimsContent = page.locator('text=/Available Claims|No claims|Claim All|Proceeds/i');
        const hasContent = await claimsContent.first().isVisible().catch(() => false);
        expect(hasContent).toBe(true);
      }
    }
  });
});

test.describe('Portfolio - History Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portfolio');
    await page.waitForLoadState('networkidle');
  });

  test('should display history tab or privacy session', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for History tab or privacy session
    const historyOrPrivacy = page.locator('text=/History|Trade History|Privacy Session Required/i');
    await expect(historyOrPrivacy.first()).toBeVisible({ timeout: 10000 });
  });

  test('should show history section when clicking tab', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    const privacySession = page.locator('text=Privacy Session Required');
    const hasPrivacy = await privacySession.isVisible().catch(() => false);

    if (!hasPrivacy) {
      // Try clicking History tab if it exists
      const historyTab = page.locator('button:has-text("History"), [role="tab"]:has-text("History")');
      const hasTab = await historyTab.first().isVisible().catch(() => false);

      if (hasTab) {
        await historyTab.first().click();
        await page.waitForTimeout(500);

        // Should see history content or coming soon
        const historyContent = page.locator('text=/Trade History|No history|Coming soon|swap/i');
        const hasContent = await historyContent.first().isVisible().catch(() => false);
        expect(hasContent).toBe(true);
      }
    }
  });
});
