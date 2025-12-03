import { test, expect } from '../fixtures/wallet';

/**
 * Deposit E2E Tests
 *
 * Tests the liquidity deposit flow:
 * - Wallet auto-connects in test mode
 * - Navigate to liquidity page
 * - Enter deposit amounts
 * - Complete approve + deposit flow
 * - Verify position updates
 */

test.describe('Deposit Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to liquidity page
    await page.goto('/liquidity');

    // Wait for page to load
    await page.waitForLoadState('networkidle');
  });

  test('should auto-connect test wallet on liquidity page', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Verify the wallet connection shows an address
    const walletConnection = page.locator('[data-testid="wallet-connection"]');
    await expect(walletConnection).toContainText('0x');
  });

  test('should display Add Liquidity form', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for the Add Liquidity tab content to load
    await page.waitForSelector('text=Add Liquidity');

    // Verify the form elements are present
    await expect(page.locator('[data-testid="deposit-amount-0"]')).toBeVisible();
    await expect(page.locator('[data-testid="deposit-amount-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="deposit-submit"]')).toBeVisible();
  });

  test('should display Your Position card', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for the position card to load
    await page.waitForSelector('[data-testid="liquidity-position"]');

    // Verify the position card is visible
    await expect(page.locator('[data-testid="liquidity-position"]')).toBeVisible();
    await expect(page.locator('text=Your Position')).toBeVisible();
  });

  test('should deposit tWETH tokens', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for the form to be ready
    await page.waitForSelector('[data-testid="deposit-amount-0"]');

    // Enter amount for token0 (tWETH) - small amount to preserve test tokens
    const amount0Input = page.locator('[data-testid="deposit-amount-0"]');
    await amount0Input.fill('1');

    // Click submit button
    const submitButton = page.locator('[data-testid="deposit-submit"]');
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // Wait for the button to show loading state (transaction in progress)
    // The button text will change through states: Checking -> Approving -> Depositing
    await expect(submitButton).toContainText(/Checking|Approving|Depositing/i, { timeout: 10000 });

    // Wait for transaction to complete - success message should appear
    // This can take 30-60 seconds on Sepolia
    await expect(page.locator('[data-testid="deposit-success"]')).toBeVisible({ timeout: 120000 });

    // Verify button shows "Done"
    await expect(submitButton).toContainText('Done');
  });

  test('should deposit tUSDC tokens', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for the form to be ready
    await page.waitForSelector('[data-testid="deposit-amount-1"]');

    // Enter amount for token1 (tUSDC) - small amount to preserve test tokens
    const amount1Input = page.locator('[data-testid="deposit-amount-1"]');
    await amount1Input.fill('1');

    // Click submit button
    const submitButton = page.locator('[data-testid="deposit-submit"]');
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // Wait for the button to show loading state
    await expect(submitButton).toContainText(/Checking|Approving|Depositing/i, { timeout: 10000 });

    // Wait for transaction to complete
    await expect(page.locator('[data-testid="deposit-success"]')).toBeVisible({ timeout: 120000 });

    // Verify button shows "Done"
    await expect(submitButton).toContainText('Done');
  });

  test('should deposit both tokens at once', async ({ page, waitForWalletConnected }) => {
    await waitForWalletConnected();

    // Wait for the form to be ready
    await page.waitForSelector('[data-testid="deposit-amount-0"]');

    // Enter amounts for both tokens
    await page.locator('[data-testid="deposit-amount-0"]').fill('0.5');
    await page.locator('[data-testid="deposit-amount-1"]').fill('0.5');

    // Click submit button
    const submitButton = page.locator('[data-testid="deposit-submit"]');
    await submitButton.click();

    // Wait for transaction to complete - this will involve multiple transactions
    // (approve + deposit for token0, then approve + deposit for token1)
    await expect(page.locator('[data-testid="deposit-success"]')).toBeVisible({ timeout: 180000 });
  });
});
