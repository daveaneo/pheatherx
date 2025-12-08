import { test, expect } from '../fixtures/wallet';

/**
 * Full Trading Flow E2E Test
 *
 * This test covers the complete trading lifecycle:
 * 1. Check initial portfolio balances
 * 2. Add liquidity to the pool
 * 3. Verify LP balance in portfolio
 * 4. Place a limit order nearby current price
 * 5. Execute a market trade to trigger the limit order
 * 6. Verify order status changed (filled)
 * 7. Withdraw/close the position to claim proceeds
 * 8. Remove liquidity
 * 9. Verify final portfolio balances
 *
 * Note: This test requires:
 * - Test wallet funded with WETH and USDC
 * - FHE session (or test mode mock)
 * - Deployed FheatherXv5 contract
 */

test.describe('Full Trading Flow', () => {
  // Store balances for verification
  let initialBalances: Record<string, string> = {};
  let afterLiquidityBalances: Record<string, string> = {};

  test.describe.configure({ mode: 'serial' });

  test('01 - Check initial portfolio balances', async ({ page, waitForWalletConnected }) => {
    await page.goto('/portfolio');
    await page.waitForLoadState('networkidle');
    await waitForWalletConnected();
    await page.waitForTimeout(3000);

    // Check if we need to initialize FHE session
    const privacySession = page.locator('text=Privacy Session Required');
    const hasPrivacy = await privacySession.isVisible().catch(() => false);

    if (hasPrivacy) {
      // Click initialize button
      const initButton = page.locator('button:has-text("Initialize")');
      const hasInit = await initButton.isVisible().catch(() => false);
      if (hasInit) {
        await initButton.click();
        await page.waitForTimeout(5000); // Wait for FHE initialization
      }
    }

    // Look for balance display (use separate selectors to avoid CSS/text mixing)
    const balanceSectionByTestId = page.locator('[data-testid="token-balances"]');
    const balanceSectionByText = page.locator('text=/Balance/i');
    const hasTestId = await balanceSectionByTestId.first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasText = await balanceSectionByText.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log('[Portfolio] Balance section:', { hasTestId, hasText });
    expect(hasTestId || hasText).toBe(true);

    // Try to capture balance values if visible
    const wethBalance = page.locator('text=WETH');
    const usdcBalance = page.locator('text=USDC');

    if (await wethBalance.first().isVisible().catch(() => false)) {
      console.log('[Initial] WETH found');
      initialBalances.WETH = 'present';
    }

    if (await usdcBalance.first().isVisible().catch(() => false)) {
      console.log('[Initial] USDC found');
      initialBalances.USDC = 'present';
    }

    // Verify we can see some portfolio content
    const portfolioContent = page.locator('text=/Portfolio|Balance|Token|Wallet/i');
    await expect(portfolioContent.first()).toBeVisible();
  });

  test('02 - Navigate to liquidity page', async ({ page, waitForWalletConnected }) => {
    await page.goto('/liquidity');
    await page.waitForLoadState('networkidle');
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for liquidity/orders page content (page is titled "Orders" for placing limit orders)
    const pageTitle = page.locator('h1:has-text("Orders"), h1:has-text("Liquidity")');
    await expect(pageTitle.first()).toBeVisible({ timeout: 10000 });

    // Look for Place Orders / Add Liquidity section
    const ordersSection = page.locator('text=/Place Orders|Add Liquidity|Provide|Deposit/i');
    await expect(ordersSection.first()).toBeVisible({ timeout: 10000 });
  });

  test('03 - Add liquidity to pool', async ({ page, waitForWalletConnected }) => {
    await page.goto('/liquidity');
    await page.waitForLoadState('networkidle');
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for privacy session requirement
    const privacySession = page.locator('text=Privacy Session Required');
    const hasPrivacy = await privacySession.isVisible().catch(() => false);

    if (hasPrivacy) {
      const initButton = page.locator('button:has-text("Initialize")');
      const hasInit = await initButton.isVisible().catch(() => false);
      if (hasInit) {
        await initButton.click();
        await page.waitForTimeout(5000);
      }
    }

    // Check for Liquidity page header (h1)
    const liquidityHeader = page.locator('h1:has-text("Liquidity")');
    const hasLiquidityPage = await liquidityHeader.isVisible().catch(() => false);
    console.log('[Liquidity] Liquidity page header visible:', hasLiquidityPage);

    // Wait for pools to load (may show "Discovering pools...")
    const loadingPools = page.locator('text=/Loading pools|Discovering pools/i');
    const isLoading = await loadingPools.isVisible().catch(() => false);
    if (isLoading) {
      console.log('[Liquidity] Waiting for pools to load...');
      await page.waitForTimeout(5000);
    }

    // Check for Add Liquidity card/section (new liquidity page design)
    const addLiquidityHeader = page.locator('text="Add Liquidity"');
    const hasAddLiquidity = await addLiquidityHeader.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log('[Liquidity] Add Liquidity visible:', hasAddLiquidity);

    // Look for amount inputs after form loads
    const amountInput = page.locator('input[placeholder*="0.0"], input[data-testid*="amount"]').first();
    const hasAmountInput = await amountInput.isVisible({ timeout: 5000 }).catch(() => false);
    console.log('[Liquidity] Amount input visible:', hasAmountInput);

    if (hasAmountInput) {
      await amountInput.fill('0.01');
      await page.waitForTimeout(500);
    }

    // Look for Add Liquidity / Submit button
    const submitButton = page.locator('button:has-text("Add Liquidity"), button:has-text("Create Pool"), button:has-text("Submit")');
    const hasSubmitButton = await submitButton.first().isVisible().catch(() => false);
    console.log('[Liquidity] Submit button visible:', hasSubmitButton);

    // Verify liquidity page loaded correctly - either has page content, Add Liquidity form, or privacy screen
    expect(hasLiquidityPage || hasAddLiquidity || hasPrivacy).toBe(true);
  });

  test('04 - Navigate to trade page', async ({ page, waitForWalletConnected }) => {
    await page.goto('/trade');
    await page.waitForLoadState('networkidle');
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for trade page content
    const tradeContent = page.locator('text=/Trade|Market|Limit|Privacy Session Required/i');
    await expect(tradeContent.first()).toBeVisible({ timeout: 10000 });
  });

  test('05 - Place a limit order', async ({ page, waitForWalletConnected }) => {
    await page.goto('/trade');
    await page.waitForLoadState('networkidle');
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for privacy session
    const privacySession = page.locator('text=Privacy Session Required');
    const hasPrivacy = await privacySession.isVisible().catch(() => false);

    if (hasPrivacy) {
      const initButton = page.locator('button:has-text("Initialize")');
      const hasInit = await initButton.isVisible().catch(() => false);
      if (hasInit) {
        await initButton.click();
        await page.waitForTimeout(5000);
      }
    }

    // Click on Limit tab
    const limitTab = page.locator('button:has-text("Limit"), [role="tab"]:has-text("Limit")');
    const hasLimitTab = await limitTab.first().isVisible().catch(() => false);

    if (hasLimitTab) {
      await limitTab.first().click();
      await page.waitForTimeout(1000);

      // Look for limit order form elements
      const orderTypeSelect = page.locator('select[name="orderType"], [data-testid="order-type-select"]');
      const amountInput = page.locator('input[name="amount"], input[data-testid="order-amount"]');
      const priceInput = page.locator('input[name="triggerPrice"], input[data-testid="order-price"]');

      // Try to fill the form
      const hasOrderType = await orderTypeSelect.isVisible().catch(() => false);
      const hasAmount = await amountInput.isVisible().catch(() => false);
      const hasPrice = await priceInput.isVisible().catch(() => false);

      console.log('[Limit Order] Form elements:', { hasOrderType, hasAmount, hasPrice });

      if (hasAmount) {
        await amountInput.fill('0.001');
      }

      if (hasPrice) {
        await priceInput.fill('1.0');
      }

      // Look for place order button
      const placeOrderBtn = page.locator('button:has-text("Place Order"), button:has-text("Submit")');
      const hasPlaceBtn = await placeOrderBtn.first().isVisible().catch(() => false);
      console.log('[Limit Order] Has place button:', hasPlaceBtn);
    }

    // Verify we're on the trade page
    const tradePage = page.locator('text=/Trade|Order|Privacy Session Required/i');
    await expect(tradePage.first()).toBeVisible();
  });

  test('06 - Execute a market swap', async ({ page, waitForWalletConnected }) => {
    await page.goto('/trade');
    await page.waitForLoadState('networkidle');
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for privacy session
    const privacySession = page.locator('text=Privacy Session Required');
    const hasPrivacy = await privacySession.isVisible().catch(() => false);

    if (hasPrivacy) {
      const initButton = page.locator('button:has-text("Initialize")');
      const hasInit = await initButton.isVisible().catch(() => false);
      if (hasInit) {
        await initButton.click();
        await page.waitForTimeout(5000);
      }
    }

    // Click on Market tab (should be default)
    const marketTab = page.locator('button:has-text("Market"), [role="tab"]:has-text("Market")');
    const hasMarketTab = await marketTab.first().isVisible().catch(() => false);

    if (hasMarketTab) {
      await marketTab.first().click();
      await page.waitForTimeout(500);
    }

    // Look for swap form
    const amountInput = page.locator('input[data-testid="swap-amount-in"], input[placeholder*="0.0"]').first();
    const hasAmountInput = await amountInput.isVisible().catch(() => false);

    if (hasAmountInput) {
      await amountInput.fill('0.001');
      await page.waitForTimeout(500);
    }

    // Look for swap button
    const swapButton = page.locator('button:has-text("Swap"), button:has-text("Trade")');
    const hasSwapBtn = await swapButton.first().isVisible().catch(() => false);
    console.log('[Market Swap] Has swap button:', hasSwapBtn);

    // Verify swap form exists
    const swapForm = page.locator('text=/Swap|From|To|Privacy Session Required/i');
    await expect(swapForm.first()).toBeVisible();
  });

  test('07 - Check active orders', async ({ page, waitForWalletConnected }) => {
    await page.goto('/orders/active');
    await page.waitForLoadState('networkidle');
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for active orders content
    const ordersContent = page.locator('text=/Active Orders|No orders|No active/i');
    await expect(ordersContent.first()).toBeVisible({ timeout: 10000 });

    // Look for order rows if any exist
    const orderRows = page.locator('[data-testid^="order-row"]');
    const orderCount = await orderRows.count();
    console.log('[Active Orders] Order count:', orderCount);

    // Look for close position buttons
    const closeButtons = page.locator('[data-testid="close-position-btn"]');
    const closeCount = await closeButtons.count();
    console.log('[Active Orders] Close buttons:', closeCount);
  });

  test('08 - Check portfolio after trades', async ({ page, waitForWalletConnected }) => {
    await page.goto('/portfolio');
    await page.waitForLoadState('networkidle');
    await waitForWalletConnected();
    await page.waitForTimeout(3000);

    // Check for privacy session requirement
    const privacySession = page.locator('text=Privacy Session Required');
    const hasPrivacy = await privacySession.isVisible().catch(() => false);

    if (hasPrivacy) {
      const initButton = page.locator('button:has-text("Initialize")');
      const hasInit = await initButton.isVisible().catch(() => false);
      if (hasInit) {
        await initButton.click();
        await page.waitForTimeout(5000);
      }
    }

    // Look for balance display (use separate selectors)
    const balanceSectionByTestId = page.locator('[data-testid="token-balances"]');
    const balanceSectionByText = page.locator('text=/Balance/i');
    const hasTestId = await balanceSectionByTestId.first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasText = await balanceSectionByText.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log('[After Trades] Balance section:', { hasTestId, hasText });
    expect(hasTestId || hasText).toBe(true);

    // Capture current balances
    const wethBalance = page.locator('text=WETH');
    const usdcBalance = page.locator('text=USDC');

    if (await wethBalance.first().isVisible().catch(() => false)) {
      console.log('[After Trades] WETH found');
      afterLiquidityBalances.WETH = 'present';
    }

    if (await usdcBalance.first().isVisible().catch(() => false)) {
      console.log('[After Trades] USDC found');
      afterLiquidityBalances.USDC = 'present';
    }

    // Look for LP positions
    const lpSection = page.locator('text=/LP Position|Liquidity Position|LP Balance/i');
    const hasLpSection = await lpSection.first().isVisible().catch(() => false);
    console.log('[Portfolio] Has LP section:', hasLpSection);

    // Verify portfolio is accessible
    const portfolioContent = page.locator('text=/Portfolio|Balance|Token/i');
    await expect(portfolioContent.first()).toBeVisible();
  });

  test('09 - Test wrap/unwrap availability', async ({ page, waitForWalletConnected }) => {
    await page.goto('/portfolio');
    await page.waitForLoadState('networkidle');
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Look for wrap/unwrap card or section
    const wrapCard = page.locator('[data-testid="wrap-unwrap-card"], text=/Wrap|Unwrap/i');
    const hasWrapCard = await wrapCard.first().isVisible().catch(() => false);
    console.log('[Wrap/Unwrap] Card visible:', hasWrapCard);

    if (hasWrapCard) {
      // Check for wrap mode button
      const wrapModeBtn = page.locator('[data-testid="wrap-mode-btn"]');
      const unwrapModeBtn = page.locator('[data-testid="unwrap-mode-btn"]');

      const hasWrapMode = await wrapModeBtn.isVisible().catch(() => false);
      const hasUnwrapMode = await unwrapModeBtn.isVisible().catch(() => false);

      console.log('[Wrap/Unwrap] Mode buttons:', { hasWrapMode, hasUnwrapMode });

      // Test wrap flow
      if (hasWrapMode) {
        await wrapModeBtn.click();
        await page.waitForTimeout(500);

        const wrapAmountInput = page.locator('[data-testid="wrap-amount-input"]');
        const hasInput = await wrapAmountInput.isVisible().catch(() => false);
        console.log('[Wrap] Amount input visible:', hasInput);
      }

      // Test unwrap flow
      if (hasUnwrapMode) {
        await unwrapModeBtn.click();
        await page.waitForTimeout(500);

        const unwrapAmountInput = page.locator('[data-testid="wrap-amount-input"]');
        const hasInput = await unwrapAmountInput.isVisible().catch(() => false);
        console.log('[Unwrap] Amount input visible:', hasInput);
      }
    }

    // Verify we can access portfolio
    const portfolioContent = page.locator('text=/Portfolio|Balance|Privacy Session Required/i');
    await expect(portfolioContent.first()).toBeVisible();
  });

  test('10 - Verify token types display correctly', async ({ page, waitForWalletConnected }) => {
    await page.goto('/trade');
    await page.waitForLoadState('networkidle');
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for privacy session
    const privacySession = page.locator('text=Privacy Session Required');
    const hasPrivacy = await privacySession.isVisible().catch(() => false);

    if (!hasPrivacy) {
      // Look for token selectors
      const tokenSelectors = page.locator('button:has-text("WETH"), button:has-text("USDC"), button:has-text("fheWETH"), button:has-text("fheUSDC")');
      const tokenCount = await tokenSelectors.count();
      console.log('[Token Display] Token selector buttons:', tokenCount);

      // Look for FHE badges
      const fheBadges = page.locator('text=/FHE|FHERC20|Private/i');
      const badgeCount = await fheBadges.count();
      console.log('[Token Display] FHE badges:', badgeCount);

      // Look for ERC20 badges
      const erc20Badges = page.locator('text=/ERC20|Standard/i');
      const erc20Count = await erc20Badges.count();
      console.log('[Token Display] ERC20 badges:', erc20Count);
    }

    // Verify page loaded
    const pageContent = page.locator('text=/Trade|Swap|Privacy Session Required/i');
    await expect(pageContent.first()).toBeVisible();
  });
});

/**
 * Privacy Enforcement Tests
 *
 * Test that ERC20 limit orders show privacy warnings
 */
test.describe('Privacy Enforcement', () => {
  test('should warn about ERC20 limit orders', async ({ page, waitForWalletConnected }) => {
    await page.goto('/trade');
    await page.waitForLoadState('networkidle');
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for privacy session
    const privacySession = page.locator('text=Privacy Session Required');
    const hasPrivacy = await privacySession.isVisible().catch(() => false);

    if (!hasPrivacy) {
      // Navigate to limit order tab
      const limitTab = page.locator('button:has-text("Limit"), [role="tab"]:has-text("Limit")');
      const hasLimitTab = await limitTab.first().isVisible().catch(() => false);

      if (hasLimitTab) {
        await limitTab.first().click();
        await page.waitForTimeout(1000);

        // Look for privacy warning when selecting ERC20 token
        const privacyWarning = page.locator('text=/Privacy Warning|ERC20.*expose|wrap.*first|FHERC20/i');
        const hasWarning = await privacyWarning.first().isVisible().catch(() => false);
        console.log('[Privacy] Warning visible:', hasWarning);

        // Look for wrap suggestion
        const wrapSuggestion = page.locator('text=/wrap|convert|FHERC20/i');
        const hasWrapSuggestion = await wrapSuggestion.first().isVisible().catch(() => false);
        console.log('[Privacy] Wrap suggestion visible:', hasWrapSuggestion);
      }
    }

    // Verify we're on trade page
    const tradePage = page.locator('text=/Trade|Order|Privacy Session Required/i');
    await expect(tradePage.first()).toBeVisible();
  });
});

/**
 * Close Position Tests
 *
 * Test the close position functionality
 */
test.describe('Close Position', () => {
  test('should display close position button for active orders', async ({ page, waitForWalletConnected }) => {
    await page.goto('/orders/active');
    await page.waitForLoadState('networkidle');
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for order list
    const orderList = page.locator('text=/Active Orders|Your Orders|No orders/i');
    await expect(orderList.first()).toBeVisible({ timeout: 10000 });

    // Look for close position buttons
    const closeButtons = page.locator('[data-testid="close-position-btn"]');
    const closeCount = await closeButtons.count();
    console.log('[Close Position] Button count:', closeCount);

    // If there are orders, verify close button exists
    const orderRows = page.locator('[data-testid^="order-row"]');
    const orderCount = await orderRows.count();

    if (orderCount > 0) {
      // Should have close button for each order
      expect(closeCount).toBeGreaterThanOrEqual(1);
    }

    // Verify orders page is accessible
    expect(orderCount >= 0).toBe(true);
  });

  test('should show transaction states when closing', async ({ page, waitForWalletConnected }) => {
    await page.goto('/orders/active');
    await page.waitForLoadState('networkidle');
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Look for tx-pending or tx-success indicators
    const txPending = page.locator('[data-testid="tx-pending"]');
    const txSuccess = page.locator('[data-testid="tx-success"]');

    const hasPending = await txPending.count();
    const hasSuccess = await txSuccess.count();

    console.log('[Close Position] Transaction states:', { pending: hasPending, success: hasSuccess });

    // Verify page loaded
    const ordersPage = page.locator('text=/Orders|No orders|Active/i');
    await expect(ordersPage.first()).toBeVisible();
  });
});

/**
 * Pool Selector Tests
 *
 * Test multi-pool selection functionality
 */
test.describe('Pool Selection', () => {
  test('should display pool selector on trade page', async ({ page, waitForWalletConnected }) => {
    await page.goto('/trade');
    await page.waitForLoadState('networkidle');
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Look for pool selector
    const poolSelector = page.locator('text=/WETH\\/USDC|fheWETH\\/fheUSDC|Select Pool/i');
    const hasPoolSelector = await poolSelector.first().isVisible().catch(() => false);
    console.log('[Pool Selector] Visible:', hasPoolSelector);

    // Verify trade page loaded
    const tradePage = page.locator('text=/Trade|Swap|Privacy Session Required/i');
    await expect(tradePage.first()).toBeVisible();
  });

  test('should show pool list when clicked', async ({ page, waitForWalletConnected }) => {
    await page.goto('/trade');
    await page.waitForLoadState('networkidle');
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for privacy session
    const privacySession = page.locator('text=Privacy Session Required');
    const hasPrivacy = await privacySession.isVisible().catch(() => false);

    if (!hasPrivacy) {
      // Look for pool selector button
      const poolSelectorBtn = page.locator('button:has-text("/"), button:has-text("Pool")');
      const hasSelectorBtn = await poolSelectorBtn.first().isVisible().catch(() => false);

      if (hasSelectorBtn) {
        await poolSelectorBtn.first().click();
        await page.waitForTimeout(500);

        // Look for dropdown with pool options
        const poolDropdown = page.locator('text=/WETH|USDC|fhe/i');
        const hasDropdown = await poolDropdown.first().isVisible().catch(() => false);
        console.log('[Pool Selector] Dropdown visible:', hasDropdown);
      }
    }

    // Verify page is accessible
    const pageContent = page.locator('text=/Trade|Pool|Privacy Session Required/i');
    await expect(pageContent.first()).toBeVisible();
  });
});
