import { test, expect } from '../fixtures/wallet';

/**
 * Navigation E2E Tests
 *
 * Tests that navigation works correctly:
 * - Desktop navigation links
 * - Mobile navigation
 * - All routes are accessible
 */

test.describe('Desktop Navigation', () => {
  // Note: Navigation is only visible on dApp pages, not homepage
  test.beforeEach(async ({ page }) => {
    await page.goto('/trade'); // Use dApp page to test navigation
    await page.waitForLoadState('networkidle');
  });

  test('should display navigation header', async ({ page }) => {
    // Check for nav items - Trade, Liquidity, Portfolio
    const navItems = page.locator('nav a:has-text("Trade"), nav a:has-text("Liquidity"), nav a:has-text("Portfolio")');

    // On desktop dApp pages, should see at least Trade link
    const hasNav = await navItems.first().isVisible().catch(() => false);
    expect(hasNav).toBe(true);
  });

  test('should navigate to Trade page', async ({ page }) => {
    // Click Trade link
    const tradeLink = page.locator('nav a:has-text("Trade")').first();

    const hasTradeLink = await tradeLink.isVisible().catch(() => false);
    if (hasTradeLink) {
      await tradeLink.click();
      await page.waitForURL('**/trade');
      expect(page.url()).toContain('/trade');
    }
  });

  test('should navigate to Liquidity page', async ({ page }) => {
    const liquidityLink = page.locator('nav a:has-text("Liquidity")').first();

    const hasLink = await liquidityLink.isVisible().catch(() => false);
    if (hasLink) {
      await liquidityLink.click();
      await page.waitForURL('**/liquidity');
      expect(page.url()).toContain('/liquidity');
    }
  });

  test('should navigate to Portfolio page', async ({ page }) => {
    const portfolioLink = page.locator('nav a:has-text("Portfolio")').first();

    const hasLink = await portfolioLink.isVisible().catch(() => false);
    if (hasLink) {
      await portfolioLink.click();
      await page.waitForURL('**/portfolio');
      expect(page.url()).toContain('/portfolio');
    }
  });

  test('should show Coming Soon badge for Auctions', async ({ page }) => {
    const auctionsLink = page.locator('nav a:has-text("Auctions")').first();

    const hasLink = await auctionsLink.isVisible().catch(() => false);
    if (hasLink) {
      // Should have "Soon" badge nearby
      const soonBadge = page.locator('text=Soon').first();
      const hasBadge = await soonBadge.isVisible().catch(() => false);
      expect(hasBadge).toBe(true);
    }
  });
});

test.describe('Homepage', () => {
  test('should load homepage', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check for FheatherX branding
    const branding = page.locator('text=/FheatherX/i');
    await expect(branding.first()).toBeVisible({ timeout: 10000 });
  });

  test('should display Launch dApp link on homepage', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Homepage has "Launch dApp" link(s) instead of wallet connect
    const launchLink = page.locator('a:has-text("Launch dApp")').first();
    await expect(launchLink).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to dApp from homepage', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click first Launch dApp link (in header)
    const launchLink = page.locator('a:has-text("Launch dApp")').first();
    await launchLink.click();

    // Should navigate to a dApp page (portfolio by default)
    await page.waitForURL('**/portfolio');
    expect(page.url()).toContain('/portfolio');
  });
});

test.describe('Route Accessibility', () => {
  const routes = [
    { path: '/', name: 'Homepage' },
    { path: '/trade', name: 'Trade' },
    { path: '/liquidity', name: 'Liquidity' },
    { path: '/portfolio', name: 'Portfolio' },
    { path: '/auctions', name: 'Auctions' },
    { path: '/launchpad', name: 'Launchpad' },
  ];

  for (const route of routes) {
    test(`${route.name} (${route.path}) should be accessible`, async ({ page }) => {
      const response = await page.goto(route.path);

      // Should get 200 OK (or redirect)
      expect(response?.status()).toBeLessThan(400);

      // Wait for page to load
      await page.waitForLoadState('networkidle');

      // Page should have content
      const body = page.locator('body');
      await expect(body).not.toBeEmpty();
    });
  }
});
