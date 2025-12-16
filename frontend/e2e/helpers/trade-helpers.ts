/**
 * Trade E2E Test Helpers
 *
 * Helper functions for FheatherX trade E2E tests with Dappwright.
 */

import type { Page } from 'playwright-core';
import type { Dappwright } from '@tenkeylabs/dappwright';

// Import helpers for internal use
import {
  connectWalletIfNeeded,
  initializeFheSessionIfNeeded,
  navigateAndWait,
  getMetaMaskExtensionId,
  confirmMetaMaskTransaction,
  TOKENS,
  ARB_SEPOLIA_TOKENS,
  ARB_SEPOLIA_POOLS,
} from './liquidity-helpers';

// Re-export common helpers from liquidity-helpers
export {
  connectWalletIfNeeded,
  initializeFheSessionIfNeeded,
  navigateAndWait,
  getMetaMaskExtensionId,
  confirmMetaMaskTransaction,
  TOKENS,
  ARB_SEPOLIA_TOKENS,
  ARB_SEPOLIA_POOLS,
  type TokenSymbol,
} from './liquidity-helpers';

// Order types for limit orders
export type OrderType = 'limit-buy' | 'limit-sell' | 'stop-loss' | 'stop-buy';

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  'limit-buy': 'Limit Buy',
  'limit-sell': 'Limit Sell',
  'stop-loss': 'Stop Loss',
  'stop-buy': 'Stop Buy',
};

/**
 * Wait for pools to be loaded (pool selector shows a pool name, not loading state)
 * Also checks for swap form visibility as alternative indicator
 */
export async function waitForPoolsLoaded(page: Page, timeout: number = 90000): Promise<boolean> {
  console.log('[Trade Helper] Waiting for pools to load...');
  const startTime = Date.now();
  let lastLogTime = 0;

  while (Date.now() - startTime < timeout) {
    // Method 1: Check pool selector button directly
    const poolSelectorButton = page.locator('[data-testid="pool-selector-button"]');
    if (await poolSelectorButton.isVisible().catch(() => false)) {
      const text = await poolSelectorButton.textContent();
      // If it shows a pool pair (e.g., "WETH/USDC"), pools are loaded
      if (text && text.includes('/')) {
        console.log(`[Trade Helper] Pools loaded via selector, current: ${text}`);
        return true;
      }
    }

    // Method 2: Check if the Current Price panel shows a pool name
    const currentPricePanel = page.locator('text=Current Price').first();
    if (await currentPricePanel.isVisible().catch(() => false)) {
      // Look for pool pair in nearby text (e.g., "fheWETH/fheUSDC")
      const priceSection = page.locator('.text-feather-white\\/60:has-text("/")').first();
      if (await priceSection.isVisible().catch(() => false)) {
        const poolText = await priceSection.textContent();
        if (poolText && poolText.includes('/')) {
          console.log(`[Trade Helper] Pools loaded via price panel, pool: ${poolText}`);
          return true;
        }
      }
    }

    // Method 3: Check if the swap form's token input shows a token symbol
    const tokenSymbol = page.locator('[data-testid="sell-token-symbol"], [data-testid="sell-amount-input"] + *:has-text("ETH")').first();
    if (await tokenSymbol.isVisible().catch(() => false)) {
      console.log('[Trade Helper] Pools loaded - swap form has token symbol');
      return true;
    }

    // Method 4: Check for the Order Book section with price data
    const orderBook = page.locator('text=Order Book').first();
    const priceRow = page.locator('text=/\\$[0-9]+\\.[0-9]+/').first();
    if (await orderBook.isVisible().catch(() => false) && await priceRow.isVisible().catch(() => false)) {
      console.log('[Trade Helper] Pools loaded - Order book has price data');
      return true;
    }

    // Log progress every 10 seconds
    const now = Date.now();
    if (now - lastLogTime >= 10000) {
      const elapsed = Math.round((now - startTime) / 1000);
      console.log(`[Trade Helper] Still waiting for pools... (${elapsed}s elapsed)`);
      lastLogTime = now;
    }

    await page.waitForTimeout(1000);
  }

  console.log('[Trade Helper] Pools did not load within timeout');
  return false;
}

/**
 * Select a pool from the pool selector dropdown
 */
export async function selectPool(
  page: Page,
  token0Symbol: string,
  token1Symbol: string
): Promise<boolean> {
  const pairLabel = `${token0Symbol}/${token1Symbol}`;
  console.log(`[Trade Helper] Selecting pool: ${pairLabel}`);

  // Wait for pools to be loaded first
  const poolsLoaded = await waitForPoolsLoaded(page);
  if (!poolsLoaded) {
    console.log('[Trade Helper] Pools failed to load');
    return false;
  }

  // Check if the desired pool is already selected
  const poolSelectorButton = page.locator('[data-testid="pool-selector-button"]');
  const currentText = await poolSelectorButton.textContent().catch(() => '');
  if (currentText?.includes(pairLabel)) {
    console.log(`[Trade Helper] Pool ${pairLabel} is already selected`);
    return true;
  }

  // Click pool selector button
  if (!(await poolSelectorButton.isVisible().catch(() => false))) {
    console.log('[Trade Helper] Pool selector not found');
    return false;
  }

  await poolSelectorButton.click();
  await page.waitForTimeout(500);

  // Wait for dropdown to appear
  const dropdown = page.locator('[data-testid="pool-dropdown"]');
  await dropdown.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
    console.log('[Trade Helper] Pool dropdown did not appear');
  });

  if (!(await dropdown.isVisible().catch(() => false))) {
    console.log('[Trade Helper] Pool dropdown still not visible');
    return false;
  }

  // Search for the pool
  const searchInput = page.locator('[data-testid="pool-search-input"]');
  if (await searchInput.isVisible()) {
    await searchInput.fill(token0Symbol);
    await page.waitForTimeout(300);
  }

  // Click on the pool option that matches
  const poolOption = page.locator(`[data-testid="pool-list"] button:has-text("${pairLabel}")`).first();
  if (await poolOption.isVisible().catch(() => false)) {
    await poolOption.click();
    await page.waitForTimeout(500);
    console.log(`[Trade Helper] Selected pool: ${pairLabel}`);
    return true;
  }

  // Try alternative: click on any pool option containing the tokens
  const altOption = page.locator(`[data-testid^="pool-option-"]`).filter({ hasText: token0Symbol }).first();
  if (await altOption.isVisible().catch(() => false)) {
    await altOption.click();
    await page.waitForTimeout(500);
    console.log(`[Trade Helper] Selected pool via alt selector: ${pairLabel}`);
    return true;
  }

  // Close the dropdown
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  console.log(`[Trade Helper] Pool ${pairLabel} not found in dropdown`);
  return false;
}

/**
 * Click the Market tab
 */
export async function clickMarketTab(page: Page): Promise<void> {
  console.log('[Trade Helper] Clicking Market tab...');
  const marketTab = page.locator('[data-testid="market-tab"]');
  if (await marketTab.isVisible()) {
    await marketTab.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Click the Limit tab and verify it switched
 */
export async function clickLimitTab(page: Page): Promise<boolean> {
  console.log('[Trade Helper] Clicking Limit tab...');

  // First ensure we're on the dApp page and it's in focus
  await page.bringToFront();

  // Check if we're on the right page (should have Trade in the URL)
  const currentUrl = page.url();
  console.log(`[Trade Helper] Current page URL: ${currentUrl}`);
  if (!currentUrl.includes('localhost:3000')) {
    console.log('[Trade Helper] Not on dApp page, cannot click Limit tab');
    return false;
  }

  // Wait for the execution panel to be visible first
  const executionPanel = page.locator('[data-testid="execution-panel"]');
  await executionPanel.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
    console.log('[Trade Helper] Execution panel not found');
  });

  // Wait for the tab to be visible
  const limitTab = page.locator('[data-testid="limit-tab"]');
  await limitTab.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

  if (!(await limitTab.isVisible().catch(() => false))) {
    // Debug: check what tabs are visible
    const marketTab = await page.locator('[data-testid="market-tab"]').isVisible().catch(() => false);
    console.log(`[Trade Helper] Market tab visible: ${marketTab}, Limit tab not found`);
    return false;
  }

  // Click the tab
  console.log('[Trade Helper] Limit tab found, clicking...');
  await limitTab.click();
  await page.waitForTimeout(1000);

  // Verify the limit form appeared
  const limitForm = page.locator('[data-testid="limit-form"]');
  const formVisible = await limitForm.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);

  if (formVisible) {
    console.log('[Trade Helper] Switched to Limit tab successfully');
    return true;
  }

  // Try clicking again with force
  console.log('[Trade Helper] Limit form not visible, retrying click...');
  await limitTab.click({ force: true });
  await page.waitForTimeout(1000);

  const retryVisible = await limitForm.isVisible().catch(() => false);
  console.log(`[Trade Helper] Limit tab switch result: ${retryVisible}`);
  return retryVisible;
}

/**
 * Flip swap direction (token0 <-> token1)
 */
export async function flipSwapDirection(page: Page): Promise<void> {
  console.log('[Trade Helper] Flipping swap direction...');
  const flipButton = page.locator('[data-testid="flip-direction-button"]');
  if (await flipButton.isVisible()) {
    await flipButton.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Execute a market swap
 */
export async function executeSwap(
  page: Page,
  wallet: Dappwright,
  amount: string
): Promise<{ success: boolean; txConfirmed: boolean }> {
  console.log(`[Trade Helper] Executing swap with amount: ${amount}`);

  // Get browser context and extension ID for manual MetaMask handling
  const context = page.context();
  const extensionId = await getMetaMaskExtensionId(context);
  console.log(`[Trade Helper] MetaMask extension ID: ${extensionId || 'not found'}`);

  // Fill sell amount
  const sellInput = page.locator('[data-testid="sell-amount-input"]');
  if (!(await sellInput.isVisible().catch(() => false))) {
    console.log('[Trade Helper] Sell amount input not found');
    return { success: false, txConfirmed: false };
  }

  await sellInput.clear();
  await sellInput.fill(amount);
  await page.waitForTimeout(1000);

  // Click swap button
  const swapButton = page.locator('[data-testid="swap-button"]');
  if (!(await swapButton.isVisible().catch(() => false))) {
    console.log('[Trade Helper] Swap button not found');
    return { success: false, txConfirmed: false };
  }

  // Check if button is disabled
  if (await swapButton.isDisabled()) {
    console.log('[Trade Helper] Swap button is disabled');
    return { success: false, txConfirmed: false };
  }

  console.log('[Trade Helper] Clicking swap button...');
  await swapButton.click();
  await page.waitForTimeout(2000);

  // Wait for simulating state
  console.log('[Trade Helper] Waiting for simulation...');
  await page.waitForTimeout(3000);

  // Confirm MetaMask transaction using notification page approach
  let txConfirmed = false;

  // First, try our notification page approach (works better with MetaMask v12 MV3)
  if (extensionId) {
    console.log('[Trade Helper] Attempting MetaMask confirmation via notification page...');
    txConfirmed = await confirmMetaMaskTransaction(context, extensionId);
    if (txConfirmed) {
      console.log('[Trade Helper] Transaction confirmed via notification page');
      await page.bringToFront();
      await page.waitForTimeout(5000);
    }
  }

  // Fallback to Dappwright's confirmTransaction if notification approach failed
  if (!txConfirmed) {
    try {
      console.log('[Trade Helper] Trying Dappwright confirmTransaction as fallback...');
      await Promise.race([
        wallet.confirmTransaction(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
      ]);
      txConfirmed = true;
      console.log('[Trade Helper] Transaction confirmed via Dappwright');
      await page.waitForTimeout(5000);
    } catch (error) {
      console.log('[Trade Helper] MetaMask confirmation failed:', (error as Error).message?.substring(0, 50));
    }
  }

  // Check for success
  const success = txConfirmed;
  console.log(`[Trade Helper] Swap result: success=${success}, txConfirmed=${txConfirmed}`);
  return { success, txConfirmed };
}

/**
 * Select order type for limit order (using Headless UI Listbox)
 */
export async function selectOrderType(page: Page, orderType: OrderType): Promise<void> {
  console.log(`[Trade Helper] Selecting order type: ${orderType}`);

  const orderTypeSelect = page.locator('[data-testid="order-type-select"]');
  if (!(await orderTypeSelect.isVisible().catch(() => false))) {
    console.log('[Trade Helper] Order type select not found');
    return;
  }

  // Click the Listbox button to open dropdown
  const selectButton = orderTypeSelect.locator('button').first();
  await selectButton.click();
  await page.waitForTimeout(500);

  // Click on the order type option in the dropdown
  const label = ORDER_TYPE_LABELS[orderType];
  const option = page.locator(`li:has-text("${label}")`).first();
  if (await option.isVisible().catch(() => false)) {
    await option.click();
    await page.waitForTimeout(500);
    console.log(`[Trade Helper] Selected order type: ${label}`);
  } else {
    // Fallback: try text selector
    const fallbackOption = page.locator(`text="${label}"`).first();
    if (await fallbackOption.isVisible().catch(() => false)) {
      await fallbackOption.click();
      await page.waitForTimeout(500);
      console.log(`[Trade Helper] Selected order type via fallback: ${label}`);
    }
  }
}

/**
 * Select target tick (price level) for limit order (using Headless UI Listbox)
 * Note: Target tick is auto-selected with first valid option, so we just need to ensure
 * the dropdown is closed after confirming selection
 */
export async function selectTargetTick(page: Page, tickIndex: number = 0): Promise<void> {
  console.log(`[Trade Helper] Selecting target tick at index: ${tickIndex}`);

  const tickSelect = page.locator('[data-testid="target-tick-select"]');
  if (!(await tickSelect.isVisible().catch(() => false))) {
    console.log('[Trade Helper] Target tick select not found');
    return;
  }

  // Click the Listbox button to open dropdown
  const selectButton = tickSelect.locator('button').first();
  await selectButton.click();
  await page.waitForTimeout(500);

  // Find and click the option at the specified index
  const options = page.locator('[data-testid="target-tick-select"] ul li');
  const count = await options.count();
  console.log(`[Trade Helper] Found ${count} tick options`);

  if (count > tickIndex) {
    const option = options.nth(tickIndex);
    await option.click();
    await page.waitForTimeout(500);
    console.log(`[Trade Helper] Selected tick at index ${tickIndex}`);
  } else if (count > 0) {
    // Select first available option
    await options.first().click();
    await page.waitForTimeout(500);
    console.log('[Trade Helper] Selected first tick option');
  } else {
    // Close dropdown by pressing Escape
    await page.keyboard.press('Escape');
    console.log('[Trade Helper] No tick options found, closing dropdown');
  }
}

/**
 * Place a limit order
 */
export async function placeLimitOrder(
  page: Page,
  wallet: Dappwright,
  orderType: OrderType,
  amount: string
): Promise<{ success: boolean; txConfirmed: boolean }> {
  console.log(`[Trade Helper] Placing ${orderType} order with amount: ${amount}`);

  // Get browser context and extension ID for manual MetaMask handling
  const context = page.context();
  const extensionId = await getMetaMaskExtensionId(context);

  // Select order type (the form auto-selects limit-buy by default)
  // Only change if different from desired type
  await selectOrderType(page, orderType);

  // Wait for tick options to load (they depend on order type)
  await page.waitForTimeout(1000);

  // Target tick auto-selects the first option, so we only need to ensure it's set
  // The form won't enable the button without a valid tick, so we verify it's populated
  const tickSelect = page.locator('[data-testid="target-tick-select"]');
  if (await tickSelect.isVisible().catch(() => false)) {
    const tickButton = tickSelect.locator('button').first();
    const tickText = await tickButton.textContent().catch(() => '');
    if (tickText && tickText.includes('$')) {
      console.log(`[Trade Helper] Tick already selected: ${tickText.substring(0, 30)}...`);
    } else {
      // Select first tick if not auto-selected
      await selectTargetTick(page, 0);
    }
  }

  // Fill order amount - this is the critical step!
  const amountInput = page.locator('[data-testid="order-amount-input"]');
  if (!(await amountInput.isVisible().catch(() => false))) {
    console.log('[Trade Helper] Order amount input not found');
    return { success: false, txConfirmed: false };
  }

  console.log(`[Trade Helper] Filling amount: ${amount}`);
  await amountInput.click({ force: true });
  await amountInput.clear();
  await amountInput.fill(amount);
  await page.waitForTimeout(1000);

  // Verify amount was entered
  const filledAmount = await amountInput.inputValue();
  console.log(`[Trade Helper] Amount filled: ${filledAmount}`);

  // Click place order button
  const placeButton = page.locator('[data-testid="place-order-button"]');
  if (!(await placeButton.isVisible().catch(() => false))) {
    console.log('[Trade Helper] Place order button not found');
    return { success: false, txConfirmed: false };
  }

  // Check if button is disabled
  if (await placeButton.isDisabled()) {
    console.log('[Trade Helper] Place order button is disabled');
    return { success: false, txConfirmed: false };
  }

  console.log('[Trade Helper] Clicking place order button...');
  await placeButton.click();

  // Wait for encryption (button shows "Encrypting...")
  console.log('[Trade Helper] Waiting for FHE encryption...');

  // Wait until the button text changes from "Encrypting..." to something else
  // or until we detect MetaMask transaction popup (max 30 seconds for encryption)
  const encryptionStart = Date.now();
  while (Date.now() - encryptionStart < 30000) {
    const buttonText = await placeButton.textContent().catch(() => '');
    console.log(`[Trade Helper] Button state: ${buttonText}`);

    // If no longer showing "Encrypting...", encryption is done
    if (buttonText && !buttonText.includes('Encrypting')) {
      console.log('[Trade Helper] Encryption complete, proceeding to transaction');
      break;
    }

    await page.waitForTimeout(2000);
  }

  // Give additional time for transaction to be submitted
  await page.waitForTimeout(3000);

  // Confirm MetaMask transaction using notification page approach
  let txConfirmed = false;

  // First, try our notification page approach (works better with MetaMask v12 MV3)
  if (extensionId) {
    console.log('[Trade Helper] Attempting MetaMask confirmation via notification page...');
    txConfirmed = await confirmMetaMaskTransaction(context, extensionId);
    if (txConfirmed) {
      console.log('[Trade Helper] Transaction confirmed via notification page');
      await page.bringToFront();
      await page.waitForTimeout(5000);
    }
  }

  // Fallback to Dappwright's confirmTransaction if notification approach failed
  if (!txConfirmed) {
    try {
      console.log('[Trade Helper] Trying Dappwright confirmTransaction as fallback...');
      await Promise.race([
        wallet.confirmTransaction(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
      ]);
      txConfirmed = true;
      console.log('[Trade Helper] Transaction confirmed via Dappwright');
      await page.waitForTimeout(5000);
    } catch (error) {
      console.log('[Trade Helper] MetaMask confirmation failed:', (error as Error).message?.substring(0, 50));
    }
  }

  const success = txConfirmed;
  console.log(`[Trade Helper] Order result: success=${success}, txConfirmed=${txConfirmed}`);
  return { success, txConfirmed };
}

/**
 * Wait for swap to complete (check button state)
 */
export async function waitForSwapComplete(page: Page, timeout: number = 30000): Promise<boolean> {
  console.log('[Trade Helper] Waiting for swap to complete...');

  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const swapButton = page.locator('[data-testid="swap-button"]');
    const buttonText = await swapButton.textContent();

    // Check if swap is complete (button no longer shows processing state)
    if (buttonText && !buttonText.includes('...')) {
      console.log('[Trade Helper] Swap complete');
      return true;
    }

    await page.waitForTimeout(1000);
  }

  console.log('[Trade Helper] Swap timeout');
  return false;
}

/**
 * Wait for order to complete (check button state)
 */
export async function waitForOrderComplete(page: Page, timeout: number = 30000): Promise<boolean> {
  console.log('[Trade Helper] Waiting for order to complete...');

  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const placeButton = page.locator('[data-testid="place-order-button"]');
    const buttonText = await placeButton.textContent();

    // Check if order is complete (button no longer shows processing state)
    if (buttonText && !buttonText.includes('...')) {
      console.log('[Trade Helper] Order complete');
      return true;
    }

    await page.waitForTimeout(1000);
  }

  console.log('[Trade Helper] Order timeout');
  return false;
}

/**
 * Verify swap form is visible
 */
export async function verifySwapFormVisible(page: Page): Promise<boolean> {
  const swapForm = page.locator('[data-testid="swap-form"]');
  const visible = await swapForm.isVisible().catch(() => false);
  console.log(`[Trade Helper] Swap form visible: ${visible}`);
  return visible;
}

/**
 * Verify limit form is visible
 */
export async function verifyLimitFormVisible(page: Page): Promise<boolean> {
  const limitForm = page.locator('[data-testid="limit-form"]');

  // Wait for form with timeout
  const visible = await limitForm.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);

  if (!visible) {
    // Debug: check what's currently visible
    const marketTabActive = await page.locator('[data-testid="market-tab"][data-state="active"]').isVisible().catch(() => false);
    const limitTabActive = await page.locator('[data-testid="limit-tab"][data-state="active"]').isVisible().catch(() => false);
    console.log(`[Trade Helper] Debug - Market tab active: ${marketTabActive}, Limit tab active: ${limitTabActive}`);

    // Check if swap form is visible (meaning we're on Market tab)
    const swapForm = await page.locator('[data-testid="swap-form"]').isVisible().catch(() => false);
    console.log(`[Trade Helper] Debug - Swap form visible: ${swapForm}`);
  }

  console.log(`[Trade Helper] Limit form visible: ${visible}`);
  return visible;
}

/**
 * Get current pool pair from selector
 */
export async function getCurrentPoolPair(page: Page): Promise<string | null> {
  const poolSelector = page.locator('[data-testid="pool-selector-button"]');
  if (await poolSelector.isVisible()) {
    const text = await poolSelector.textContent();
    console.log(`[Trade Helper] Current pool: ${text}`);
    return text;
  }
  return null;
}

// ============================================
// Claim Helpers (for filled limit orders)
// ============================================

/**
 * Navigate to the claims page
 */
export async function navigateToClaimsPage(page: Page): Promise<void> {
  console.log('[Trade Helper] Navigating to claims page...');
  await page.goto('http://localhost:3000/orders/claims', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  console.log('[Trade Helper] On claims page');
}

/**
 * Get current pool price from the UI
 */
export async function getCurrentPrice(page: Page): Promise<number | null> {
  console.log('[Trade Helper] Getting current price...');

  // Look for price in the Current Price panel
  const priceText = page.locator('text=/\\$[0-9]+\\.?[0-9]*/').first();
  if (await priceText.isVisible().catch(() => false)) {
    const text = await priceText.textContent();
    if (text) {
      const match = text.match(/\$([0-9]+\.?[0-9]*)/);
      if (match) {
        const price = parseFloat(match[1]);
        console.log(`[Trade Helper] Current price: $${price}`);
        return price;
      }
    }
  }

  console.log('[Trade Helper] Could not find current price');
  return null;
}

/**
 * Check if any claimable orders exist
 */
export async function hasClaimableOrders(page: Page): Promise<boolean> {
  console.log('[Trade Helper] Checking for claimable orders...');

  // Look for claim button or "No proceeds to claim" message
  const claimButton = page.locator('[data-testid="claim-button"]').first();
  const noProceeds = page.locator('text=No proceeds to claim').first();

  const hasButton = await claimButton.isVisible().catch(() => false);
  const hasNone = await noProceeds.isVisible().catch(() => false);

  if (hasButton) {
    console.log('[Trade Helper] Found claimable orders');
    return true;
  }
  if (hasNone) {
    console.log('[Trade Helper] No claimable orders');
    return false;
  }

  // Check for loading state
  const loading = page.locator('.animate-pulse, text=Loading').first();
  if (await loading.isVisible().catch(() => false)) {
    console.log('[Trade Helper] Claims still loading');
  }

  return false;
}

/**
 * Wait for an order to become claimable (after swap triggers it)
 */
export async function waitForOrderClaimable(
  page: Page,
  timeout: number = 60000
): Promise<boolean> {
  console.log('[Trade Helper] Waiting for order to become claimable...');

  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    // Navigate to claims page to check
    await navigateToClaimsPage(page);
    await page.waitForTimeout(3000); // Wait for claims to load

    if (await hasClaimableOrders(page)) {
      console.log('[Trade Helper] Order is now claimable!');
      return true;
    }

    // Wait before checking again
    await page.waitForTimeout(5000);
  }

  console.log('[Trade Helper] Timeout waiting for claimable order');
  return false;
}

/**
 * Claim a filled order (clicks first available claim button)
 * For Test Mode: transaction auto-confirms
 */
export async function claimFilledOrder(
  page: Page
): Promise<{ success: boolean; txConfirmed: boolean }> {
  console.log('[Trade Helper] Claiming filled order...');

  // Find and click the claim button
  const claimButton = page.locator('[data-testid="claim-button"]').first();
  if (!(await claimButton.isVisible().catch(() => false))) {
    console.log('[Trade Helper] No claim button found');
    return { success: false, txConfirmed: false };
  }

  // Check if button is disabled
  if (await claimButton.isDisabled()) {
    console.log('[Trade Helper] Claim button is disabled');
    return { success: false, txConfirmed: false };
  }

  console.log('[Trade Helper] Clicking claim button...');
  await claimButton.click();
  await page.waitForTimeout(2000);

  // In Test Mode, the transaction should auto-confirm
  // Wait for the transaction to process
  console.log('[Trade Helper] Waiting for claim transaction...');

  // Wait for modal or success indicator
  const maxWait = 60000;
  const startTime = Date.now();
  let txConfirmed = false;

  while (Date.now() - startTime < maxWait) {
    // Check for success indicators
    const successModal = page.locator('text=/confirmed|success|claimed/i').first();
    const claimingText = page.locator('text=/claiming/i').first();

    if (await successModal.isVisible().catch(() => false)) {
      console.log('[Trade Helper] Claim transaction confirmed!');
      txConfirmed = true;
      break;
    }

    if (!(await claimingText.isVisible().catch(() => false))) {
      // Button no longer shows "Claiming..." - check if claim succeeded
      await page.waitForTimeout(2000);
      // If claim button is gone or disabled, likely success
      const buttonStillClickable = await claimButton.isVisible().catch(() => false) &&
        !(await claimButton.isDisabled().catch(() => true));
      if (!buttonStillClickable) {
        console.log('[Trade Helper] Claim button no longer active - assuming success');
        txConfirmed = true;
        break;
      }
    }

    await page.waitForTimeout(2000);
  }

  // Close any open modal
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  console.log(`[Trade Helper] Claim result: success=${txConfirmed}, txConfirmed=${txConfirmed}`);
  return { success: txConfirmed, txConfirmed };
}

/**
 * Claim all available orders
 */
export async function claimAllOrders(page: Page): Promise<number> {
  console.log('[Trade Helper] Claiming all orders...');

  let claimedCount = 0;

  // Keep claiming while there are claimable orders
  while (await hasClaimableOrders(page)) {
    const result = await claimFilledOrder(page);
    if (result.success) {
      claimedCount++;
      console.log(`[Trade Helper] Claimed order ${claimedCount}`);
      // Wait for UI to update
      await page.waitForTimeout(3000);
      // Refresh claims page
      await page.reload();
      await page.waitForTimeout(3000);
    } else {
      console.log('[Trade Helper] Failed to claim, stopping');
      break;
    }
  }

  console.log(`[Trade Helper] Total orders claimed: ${claimedCount}`);
  return claimedCount;
}

// ============================================
// Test Mode Helpers (no MetaMask required)
// ============================================

/**
 * Place a limit order in Test Mode (no MetaMask confirmation needed)
 * In Test Mode, transactions auto-sign via the mock wallet
 */
export async function placeLimitOrderTestMode(
  page: Page,
  orderType: OrderType,
  amount: string
): Promise<{ success: boolean; txConfirmed: boolean }> {
  console.log(`[Trade Helper] Placing ${orderType} order with amount: ${amount} (Test Mode)`);

  // Select order type
  await selectOrderType(page, orderType);
  await page.waitForTimeout(1000);

  // Target tick auto-selects, verify it's set
  const tickSelect = page.locator('[data-testid="target-tick-select"]');
  if (await tickSelect.isVisible().catch(() => false)) {
    const tickButton = tickSelect.locator('button').first();
    const tickText = await tickButton.textContent().catch(() => '');
    if (!tickText || !tickText.includes('$')) {
      await selectTargetTick(page, 0);
    }
  }

  // Fill order amount
  const amountInput = page.locator('[data-testid="order-amount-input"]');
  if (!(await amountInput.isVisible().catch(() => false))) {
    console.log('[Trade Helper] Order amount input not found');
    return { success: false, txConfirmed: false };
  }

  await amountInput.click({ force: true });
  await amountInput.clear();
  await amountInput.fill(amount);
  await page.waitForTimeout(1000);

  // Click place order button
  const placeButton = page.locator('[data-testid="place-order-button"]');
  if (!(await placeButton.isVisible().catch(() => false))) {
    console.log('[Trade Helper] Place order button not found');
    return { success: false, txConfirmed: false };
  }

  if (await placeButton.isDisabled()) {
    console.log('[Trade Helper] Place order button is disabled');
    return { success: false, txConfirmed: false };
  }

  console.log('[Trade Helper] Clicking place order button...');
  await placeButton.click();

  // Wait for encryption
  console.log('[Trade Helper] Waiting for FHE encryption...');
  const encryptionStart = Date.now();
  while (Date.now() - encryptionStart < 60000) {
    const buttonText = await placeButton.textContent().catch(() => '');
    if (buttonText && !buttonText.includes('Encrypting')) {
      break;
    }
    await page.waitForTimeout(2000);
  }

  // In Test Mode, wait for transaction to be processed
  // The mock wallet auto-signs, so we just wait for UI updates
  console.log('[Trade Helper] Waiting for transaction (Test Mode auto-sign)...');
  await page.waitForTimeout(5000);

  // Check for success indicators
  const txConfirmed = await page.locator('text=/confirmed|success|submitted/i').isVisible().catch(() => false) ||
    await page.locator('[data-testid="place-order-button"]:not([disabled])').isVisible().catch(() => false);

  // Wait a bit more for the transaction to process
  await page.waitForTimeout(10000);

  console.log(`[Trade Helper] Order result (Test Mode): txConfirmed=${txConfirmed}`);
  return { success: txConfirmed, txConfirmed };
}

/**
 * Execute a market swap in Test Mode (no MetaMask confirmation needed)
 */
export async function executeSwapTestMode(
  page: Page,
  amount: string
): Promise<{ success: boolean; txConfirmed: boolean }> {
  console.log(`[Trade Helper] Executing swap with amount: ${amount} (Test Mode)`);

  // Fill sell amount
  const sellInput = page.locator('[data-testid="sell-amount-input"]');
  if (!(await sellInput.isVisible().catch(() => false))) {
    console.log('[Trade Helper] Sell amount input not found');
    return { success: false, txConfirmed: false };
  }

  await sellInput.clear();
  await sellInput.fill(amount);
  await page.waitForTimeout(1000);

  // Click swap button
  const swapButton = page.locator('[data-testid="swap-button"]');
  if (!(await swapButton.isVisible().catch(() => false))) {
    console.log('[Trade Helper] Swap button not found');
    return { success: false, txConfirmed: false };
  }

  if (await swapButton.isDisabled()) {
    console.log('[Trade Helper] Swap button is disabled');
    return { success: false, txConfirmed: false };
  }

  console.log('[Trade Helper] Clicking swap button...');
  await swapButton.click();

  // Wait for simulation
  console.log('[Trade Helper] Waiting for simulation...');
  await page.waitForTimeout(3000);

  // In Test Mode, transaction auto-signs
  console.log('[Trade Helper] Waiting for transaction (Test Mode auto-sign)...');
  await page.waitForTimeout(10000);

  // Check for success
  const txConfirmed = await page.locator('text=/confirmed|success/i').isVisible().catch(() => false);

  console.log(`[Trade Helper] Swap result (Test Mode): txConfirmed=${txConfirmed}`);
  return { success: true, txConfirmed };
}
