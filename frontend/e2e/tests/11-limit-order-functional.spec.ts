/**
 * Limit Order Functional E2E Tests
 *
 * Tests all 4 order types on the default pool:
 * - Order types: limit-buy, limit-sell, stop-loss, stop-buy
 *
 * Uses whatever pool is configured via env vars.
 *
 * Run with: npx playwright test e2e/tests/11-limit-order-functional.spec.ts --headed
 */

import { test, expect } from '../fixtures/dappwright';
import {
  connectWalletIfNeeded,
  initializeFheSessionIfNeeded,
  navigateAndWait,
} from '../helpers/liquidity-helpers';
import {
  clickLimitTab,
  placeLimitOrder,
  verifyLimitFormVisible,
  getCurrentPoolPair,
  waitForPoolsLoaded,
  type OrderType,
} from '../helpers/trade-helpers';

// Track placed orders
const placedOrders: { pool: string; orderType: OrderType; success: boolean }[] = [];

// Small amounts for testing
const TEST_AMOUNT = '0.0001';

test.describe('Limit Order Tests', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180000); // 3 minutes per test

  // ========================================
  // Setup: Connect and Initialize FHE
  // ========================================

  test('01 - Connect wallet and initialize FHE session', async ({ page, wallet }) => {
    console.log('\n========================================');
    console.log('  LIMIT ORDER TESTS');
    console.log('========================================\n');

    // Navigate and connect
    await navigateAndWait(page, '/trade');
    const connected = await connectWalletIfNeeded(page, wallet);
    expect(connected).toBe(true);
    console.log('[Test 01] Wallet connected');

    await page.waitForTimeout(3000);

    // Wait for pools to load
    const poolsLoaded = await waitForPoolsLoaded(page);
    console.log(`[Test 01] Pools loaded: ${poolsLoaded}`);

    // Wait for execution panel to be visible
    await expect(page.locator('[data-testid="execution-panel"]')).toBeVisible({ timeout: 10000 });
    console.log('[Test 01] Execution panel visible');

    // Click Limit tab with retry
    let tabSwitched = await clickLimitTab(page);
    if (!tabSwitched) {
      console.log('[Test 01] First tab click failed, waiting and retrying...');
      await page.waitForTimeout(2000);
      tabSwitched = await clickLimitTab(page);
    }
    console.log(`[Test 01] Limit tab switched: ${tabSwitched}`);

    const formVisible = await verifyLimitFormVisible(page);
    console.log(`[Test 01] Limit form visible: ${formVisible}`);
    expect(formVisible).toBe(true);

    // Initialize FHE session (required for limit orders)
    await initializeFheSessionIfNeeded(page, wallet);
    console.log('[Test 01] FHE session initialized\n');
  });

  // ========================================
  // All Order Types on Default Pool
  // ========================================

  test('02 - Place limit-buy order', async ({ page, wallet }) => {
    console.log('[Test 02] Place limit-buy order...');

    await navigateAndWait(page, '/trade');
    await connectWalletIfNeeded(page, wallet);
    await page.waitForTimeout(3000);

    // Wait for pools to load
    const poolsLoaded = await waitForPoolsLoaded(page);
    if (!poolsLoaded) {
      console.log('[Test 02] Warning: Pools may not have fully loaded');
    }

    // Switch to Limit tab and verify
    const tabSwitched = await clickLimitTab(page);
    if (!tabSwitched) {
      console.log('[Test 02] Failed to switch to Limit tab');
    }
    await verifyLimitFormVisible(page);

    // Initialize FHE session if needed
    await initializeFheSessionIfNeeded(page, wallet);

    // Get current pool for logging
    const currentPool = await getCurrentPoolPair(page);
    console.log(`[Test 02] Using pool: ${currentPool || 'default'}`);

    const result = await placeLimitOrder(page, wallet, 'limit-buy', TEST_AMOUNT);

    placedOrders.push({
      pool: currentPool || 'default',
      orderType: 'limit-buy',
      success: result.success,
    });

    console.log(`[Test 02] Order result: success=${result.success}\n`);
    expect(result.txConfirmed).toBe(true);
  });

  test('03 - Place limit-sell order', async ({ page, wallet }) => {
    console.log('[Test 03] Place limit-sell order...');

    await navigateAndWait(page, '/trade');
    await connectWalletIfNeeded(page, wallet);
    await page.waitForTimeout(3000);

    // Wait for pools to load
    const poolsLoaded = await waitForPoolsLoaded(page);
    if (!poolsLoaded) {
      console.log('[Test 03] Warning: Pools may not have fully loaded');
    }

    // Switch to Limit tab and verify
    const tabSwitched = await clickLimitTab(page);
    if (!tabSwitched) {
      console.log('[Test 03] Failed to switch to Limit tab');
    }
    await verifyLimitFormVisible(page);

    await initializeFheSessionIfNeeded(page, wallet);

    const currentPool = await getCurrentPoolPair(page);
    console.log(`[Test 03] Using pool: ${currentPool || 'default'}`);

    const result = await placeLimitOrder(page, wallet, 'limit-sell', TEST_AMOUNT);

    placedOrders.push({
      pool: currentPool || 'default',
      orderType: 'limit-sell',
      success: result.success,
    });

    console.log(`[Test 03] Order result: success=${result.success}\n`);
    expect(result.txConfirmed).toBe(true);
  });

  test('04 - Place stop-loss order', async ({ page, wallet }) => {
    console.log('[Test 04] Place stop-loss order...');

    await navigateAndWait(page, '/trade');
    await connectWalletIfNeeded(page, wallet);
    await page.waitForTimeout(3000);

    const poolsLoaded = await waitForPoolsLoaded(page);
    if (!poolsLoaded) {
      console.log('[Test 04] Warning: Pools may not have fully loaded');
    }

    // Switch to Limit tab and verify
    const tabSwitched = await clickLimitTab(page);
    if (!tabSwitched) {
      console.log('[Test 04] Failed to switch to Limit tab');
    }
    await verifyLimitFormVisible(page);

    await initializeFheSessionIfNeeded(page, wallet);

    const currentPool = await getCurrentPoolPair(page);
    console.log(`[Test 04] Using pool: ${currentPool || 'default'}`);

    const result = await placeLimitOrder(page, wallet, 'stop-loss', TEST_AMOUNT);

    placedOrders.push({
      pool: currentPool || 'default',
      orderType: 'stop-loss',
      success: result.success,
    });

    console.log(`[Test 04] Order result: success=${result.success}\n`);
    expect(result.txConfirmed).toBe(true);
  });

  test('05 - Place stop-buy order', async ({ page, wallet }) => {
    console.log('[Test 05] Place stop-buy order...');

    await navigateAndWait(page, '/trade');
    await connectWalletIfNeeded(page, wallet);
    await page.waitForTimeout(3000);

    const poolsLoaded = await waitForPoolsLoaded(page);
    if (!poolsLoaded) {
      console.log('[Test 05] Warning: Pools may not have fully loaded');
    }

    // Switch to Limit tab and verify
    const tabSwitched = await clickLimitTab(page);
    if (!tabSwitched) {
      console.log('[Test 05] Failed to switch to Limit tab');
    }
    await verifyLimitFormVisible(page);

    await initializeFheSessionIfNeeded(page, wallet);

    const currentPool = await getCurrentPoolPair(page);
    console.log(`[Test 05] Using pool: ${currentPool || 'default'}`);

    const result = await placeLimitOrder(page, wallet, 'stop-buy', TEST_AMOUNT);

    placedOrders.push({
      pool: currentPool || 'default',
      orderType: 'stop-buy',
      success: result.success,
    });

    console.log(`[Test 05] Order result: success=${result.success}\n`);
    expect(result.txConfirmed).toBe(true);
  });

  // ========================================
  // Summary
  // ========================================

  test('99 - Limit order summary', async ({ page }) => {
    console.log('\n========================================');
    console.log('  LIMIT ORDER TEST SUMMARY');
    console.log('========================================');

    console.log(`\nTotal orders attempted: ${placedOrders.length}`);
    console.log('----------------------------------------');

    placedOrders.forEach((order, i) => {
      const status = order.success ? 'PASS' : 'FAIL';
      console.log(`  ${i + 1}. [${status}] ${order.pool}: ${order.orderType}`);
    });

    const successCount = placedOrders.filter(o => o.success).length;
    console.log('----------------------------------------');
    console.log(`Success rate: ${successCount}/${placedOrders.length}`);
    console.log('========================================\n');

    await expect(page.locator('body')).toBeVisible();
  });
});
