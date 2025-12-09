/**
 * Market Swap Functional E2E Tests
 *
 * Tests market swaps on the default pool in both directions.
 * Uses whatever pool is loaded (configured via env vars).
 *
 * Run with: npx playwright test e2e/tests/10-swap-functional.spec.ts --headed
 */

import { test, expect } from '../fixtures/dappwright';
import {
  connectWalletIfNeeded,
  navigateAndWait,
} from '../helpers/liquidity-helpers';
import {
  clickMarketTab,
  flipSwapDirection,
  executeSwap,
  verifySwapFormVisible,
  getCurrentPoolPair,
  waitForPoolsLoaded,
} from '../helpers/trade-helpers';

// Track executed swaps
const executedSwaps: { pair: string; direction: string; success: boolean }[] = [];

test.describe('Market Swap Tests', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180000); // 3 minutes per test

  test('01 - Connect wallet and navigate to trade', async ({ page, wallet }) => {
    console.log('\n========================================');
    console.log('  MARKET SWAP TESTS');
    console.log('========================================\n');

    // Navigate directly to trade page (dApp page, not landing page)
    await navigateAndWait(page, '/trade');

    // Connect wallet
    const connected = await connectWalletIfNeeded(page, wallet);
    expect(connected).toBe(true);
    console.log('[Test 01] Wallet connected');

    await page.waitForTimeout(3000); // Give time for components to render

    // Verify trade page loaded - wait for execution panel
    await expect(page.locator('[data-testid="execution-panel"]')).toBeVisible({ timeout: 20000 });
    console.log('[Test 01] Trade page loaded');

    // Wait for pools to load
    const poolsLoaded = await waitForPoolsLoaded(page);
    console.log(`[Test 01] Pools loaded: ${poolsLoaded}`);

    // Click Market tab
    await clickMarketTab(page);
    const formVisible = await verifySwapFormVisible(page);
    expect(formVisible).toBe(true);
    console.log('[Test 01] Market swap form visible\n');
  });

  test('02 - Swap forward (token0 → token1)', async ({ page, wallet }) => {
    console.log('[Test 02] Swap forward direction...');

    // Navigate directly to trade page and connect
    await navigateAndWait(page, '/trade');
    await connectWalletIfNeeded(page, wallet);
    await page.waitForTimeout(2000);

    // Wait for pools to load - this is critical
    const poolsLoaded = await waitForPoolsLoaded(page);
    if (!poolsLoaded) {
      console.log('[Test 02] Warning: Pools may not have fully loaded');
    }

    // Ensure Market tab is selected
    await clickMarketTab(page);
    await page.waitForTimeout(1000);

    // Get current pool pair for logging
    const currentPool = await getCurrentPoolPair(page);
    console.log(`[Test 02] Using pool: ${currentPool || 'default'}`);

    // Execute swap with small amount (use whatever pool is loaded)
    const result = await executeSwap(page, wallet, '0.0001');

    executedSwaps.push({
      pair: currentPool || 'default',
      direction: 'forward',
      success: result.success,
    });

    console.log(`[Test 02] Swap result: success=${result.success}\n`);
    expect(result.txConfirmed).toBe(true);
  });

  test('03 - Swap reverse (token1 → token0)', async ({ page, wallet }) => {
    console.log('[Test 03] Swap reverse direction...');

    // Navigate directly to trade page and connect
    await navigateAndWait(page, '/trade');
    await connectWalletIfNeeded(page, wallet);
    await page.waitForTimeout(2000);

    // Wait for pools to load
    const poolsLoaded = await waitForPoolsLoaded(page);
    if (!poolsLoaded) {
      console.log('[Test 03] Warning: Pools may not have fully loaded');
    }

    await clickMarketTab(page);
    await page.waitForTimeout(1000);

    // Get current pool pair for logging
    const currentPool = await getCurrentPoolPair(page);
    console.log(`[Test 03] Using pool: ${currentPool || 'default'}`);

    // Flip direction to reverse swap
    await flipSwapDirection(page);
    await page.waitForTimeout(500);

    // Execute swap with small amount
    const result = await executeSwap(page, wallet, '0.1');

    executedSwaps.push({
      pair: currentPool || 'default',
      direction: 'reverse',
      success: result.success,
    });

    console.log(`[Test 03] Swap result: success=${result.success}\n`);
    expect(result.txConfirmed).toBe(true);
  });

  test('99 - Swap summary', async ({ page }) => {
    console.log('\n========================================');
    console.log('  MARKET SWAP TEST SUMMARY');
    console.log('========================================');

    console.log(`\nTotal swaps attempted: ${executedSwaps.length}`);
    console.log('----------------------------------------');

    executedSwaps.forEach((swap, i) => {
      const status = swap.success ? 'PASS' : 'FAIL';
      console.log(`  ${i + 1}. [${status}] ${swap.pair}: ${swap.direction}`);
    });

    const successCount = executedSwaps.filter(s => s.success).length;
    console.log('----------------------------------------');
    console.log(`Success rate: ${successCount}/${executedSwaps.length}`);
    console.log('========================================\n');

    await expect(page.locator('body')).toBeVisible();
  });
});
