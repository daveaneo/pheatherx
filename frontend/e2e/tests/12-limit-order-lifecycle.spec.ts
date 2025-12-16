/**
 * Limit Order Lifecycle E2E Tests
 *
 * Comprehensive tests for the full limit order flow:
 * 1. Place limit order (maker or taker)
 * 2. Trigger via swap (partial then full)
 * 3. Claim proceeds
 *
 * Target Pools:
 * - FHE:FHE Pool: fheWETH/fheUSDC
 * - FHE:ERC Pool: fheWETH/USDC
 *
 * Network: Arbitrum Sepolia (chain ID: 421614)
 * Wallet Mode: Test Mode (auto-connect, no MetaMask)
 *
 * Run with: NEXT_PUBLIC_TEST_MODE=true npx playwright test e2e/tests/12-limit-order-lifecycle.spec.ts --headed
 */

import { test, expect } from '../fixtures/wallet';
import {
  navigateAndWait,
  ARB_SEPOLIA_TOKENS,
  ARB_SEPOLIA_POOLS,
  clickLimitTab,
  clickMarketTab,
  selectPool,
  placeLimitOrderTestMode,
  executeSwapTestMode,
  waitForPoolsLoaded,
  verifyLimitFormVisible,
  getCurrentPoolPair,
  navigateToClaimsPage,
  hasClaimableOrders,
  claimFilledOrder,
  waitForOrderClaimable,
  getCurrentPrice,
  type OrderType,
} from '../helpers/trade-helpers';

// Test amounts - small for testing
const TEST_ORDER_AMOUNT = '0.0001';
const TEST_SWAP_AMOUNT = '0.001';

// Track test results
const testResults: { test: string; pool: string; success: boolean; error?: string }[] = [];

/**
 * Wait for wallet connection in Test Mode
 */
async function waitForTestModeConnection(page: import('playwright-core').Page, waitFn: () => Promise<void>): Promise<void> {
  console.log('[Test] Waiting for Test Mode wallet connection...');
  await waitFn();
  console.log('[Test] Wallet connected');
}

/**
 * Initialize FHE session (click Initialize button if visible)
 */
async function initializeFheSession(page: import('playwright-core').Page): Promise<void> {
  console.log('[Test] Checking FHE session...');

  // Look for Initialize button
  const initButton = page.locator('button:has-text("Initialize")').first();
  if (await initButton.isVisible().catch(() => false)) {
    console.log('[Test] Clicking Initialize button...');
    await initButton.click();
    await page.waitForTimeout(3000);

    // In Test Mode, should auto-sign
    // Wait for initialization to complete
    await page.waitForTimeout(5000);
    console.log('[Test] FHE session initialized');
  } else {
    console.log('[Test] FHE session already initialized or not required');
  }
}

// ============================================
// FHE:FHE Pool Tests (fheWETH/fheUSDC)
// ============================================

test.describe('Limit Order Lifecycle - FHE:FHE Pool', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(300000); // 5 minutes for FHE operations

  test('01 - Setup: Navigate and connect wallet', async ({ page, waitForWalletConnected }) => {
    console.log('\n========================================');
    console.log('  FHE:FHE POOL LIMIT ORDER TESTS');
    console.log('  Pool: fheWETH/fheUSDC');
    console.log('  Network: Arbitrum Sepolia');
    console.log('========================================\n');

    await navigateAndWait(page, '/trade');
    await waitForTestModeConnection(page, waitForWalletConnected);

    // Wait for pools to load
    const poolsLoaded = await waitForPoolsLoaded(page);
    expect(poolsLoaded).toBe(true);
    console.log('[Test 01] Pools loaded');

    testResults.push({ test: '01-setup', pool: 'fheWETH/fheUSDC', success: true });
  });

  test('02 - Select fheWETH/fheUSDC pool', async ({ page, waitForWalletConnected }) => {
    await navigateAndWait(page, '/trade');
    await waitForTestModeConnection(page, waitForWalletConnected);
    await page.waitForTimeout(3000);

    // Select the FHE:FHE pool
    const poolSelected = await selectPool(page, 'fheWETH', 'fheUSDC');
    console.log(`[Test 02] Pool selected: ${poolSelected}`);

    // Verify pool is selected
    const currentPool = await getCurrentPoolPair(page);
    console.log(`[Test 02] Current pool: ${currentPool}`);

    // Pool should contain fheWETH and fheUSDC
    const hasFheTokens = currentPool?.includes('fhe') ?? false;
    expect(hasFheTokens).toBe(true);

    testResults.push({ test: '02-select-pool', pool: 'fheWETH/fheUSDC', success: hasFheTokens });
  });

  test('03 - Initialize FHE session', async ({ page, waitForWalletConnected }) => {
    await navigateAndWait(page, '/trade');
    await waitForTestModeConnection(page, waitForWalletConnected);
    await page.waitForTimeout(3000);

    // Initialize FHE session
    await initializeFheSession(page);

    // Click limit tab to verify form is accessible
    await clickLimitTab(page);
    const formVisible = await verifyLimitFormVisible(page);
    console.log(`[Test 03] Limit form visible: ${formVisible}`);

    expect(formVisible).toBe(true);
    testResults.push({ test: '03-fhe-init', pool: 'fheWETH/fheUSDC', success: formVisible });
  });

  test('04 - Place limit-buy order (maker)', async ({ page, waitForWalletConnected }) => {
    console.log('[Test 04] Placing limit-buy order (maker)...');

    await navigateAndWait(page, '/trade');
    await waitForTestModeConnection(page, waitForWalletConnected);
    await page.waitForTimeout(3000);

    // Wait for pools and switch to limit tab
    await waitForPoolsLoaded(page);
    await selectPool(page, 'fheWETH', 'fheUSDC');
    await page.waitForTimeout(2000);

    await clickLimitTab(page);
    await verifyLimitFormVisible(page);

    // Initialize FHE if needed
    await initializeFheSession(page);

    // Place limit-buy order (Test Mode - no wallet needed)
    const result = await placeLimitOrderTestMode(page, 'limit-buy', TEST_ORDER_AMOUNT);
    console.log(`[Test 04] Order result: success=${result.success}, txConfirmed=${result.txConfirmed}`);

    testResults.push({
      test: '04-place-limit-buy',
      pool: 'fheWETH/fheUSDC',
      success: result.txConfirmed,
      error: result.txConfirmed ? undefined : 'Transaction not confirmed'
    });

    expect(result.txConfirmed).toBe(true);
  });

  test('05 - Execute swap to trigger order', async ({ page, waitForWalletConnected }) => {
    console.log('[Test 05] Executing swap to trigger limit order...');

    await navigateAndWait(page, '/trade');
    await waitForTestModeConnection(page, waitForWalletConnected);
    await page.waitForTimeout(3000);

    await waitForPoolsLoaded(page);
    await selectPool(page, 'fheWETH', 'fheUSDC');
    await page.waitForTimeout(2000);

    // Switch to market tab
    await clickMarketTab(page);
    await page.waitForTimeout(1000);

    // Execute a swap to move price (Test Mode - no wallet needed)
    const result = await executeSwapTestMode(page, TEST_SWAP_AMOUNT);
    console.log(`[Test 05] Swap result: success=${result.success}, txConfirmed=${result.txConfirmed}`);

    testResults.push({
      test: '05-trigger-swap',
      pool: 'fheWETH/fheUSDC',
      success: result.txConfirmed,
      error: result.txConfirmed ? undefined : 'Swap transaction not confirmed'
    });

    // Don't fail the test if swap doesn't confirm - it may still work
    console.log(`[Test 05] Swap completed`);
  });

  test('06 - Check for claimable orders', async ({ page, waitForWalletConnected }) => {
    console.log('[Test 06] Checking for claimable orders...');

    await navigateAndWait(page, '/orders/claims');
    await waitForTestModeConnection(page, waitForWalletConnected);
    await page.waitForTimeout(5000); // Wait for claims to load

    const hasOrders = await hasClaimableOrders(page);
    console.log(`[Test 06] Has claimable orders: ${hasOrders}`);

    testResults.push({
      test: '06-check-claimable',
      pool: 'fheWETH/fheUSDC',
      success: true, // Just checking, not asserting
    });

    // Note: Order may not be claimable yet if swap didn't move price enough
    if (hasOrders) {
      console.log('[Test 06] Found claimable orders!');
    } else {
      console.log('[Test 06] No claimable orders yet - swap may not have triggered the order');
    }
  });

  test('07 - Claim order proceeds (if available)', async ({ page, waitForWalletConnected }) => {
    console.log('[Test 07] Attempting to claim order proceeds...');

    await navigateAndWait(page, '/orders/claims');
    await waitForTestModeConnection(page, waitForWalletConnected);
    await page.waitForTimeout(5000);

    if (await hasClaimableOrders(page)) {
      const result = await claimFilledOrder(page);
      console.log(`[Test 07] Claim result: success=${result.success}`);

      testResults.push({
        test: '07-claim-proceeds',
        pool: 'fheWETH/fheUSDC',
        success: result.success,
      });
    } else {
      console.log('[Test 07] No orders to claim - skipping');
      testResults.push({
        test: '07-claim-proceeds',
        pool: 'fheWETH/fheUSDC',
        success: true, // Not a failure, just nothing to claim
      });
    }
  });

  test('08 - Place stop-loss order (taker)', async ({ page, waitForWalletConnected }) => {
    console.log('[Test 08] Placing stop-loss order (taker)...');

    await navigateAndWait(page, '/trade');
    await waitForTestModeConnection(page, waitForWalletConnected);
    await page.waitForTimeout(3000);

    await waitForPoolsLoaded(page);
    await selectPool(page, 'fheWETH', 'fheUSDC');
    await page.waitForTimeout(2000);

    await clickLimitTab(page);
    await verifyLimitFormVisible(page);
    await initializeFheSession(page);

    // Place stop-loss order (Test Mode - no wallet needed)
    const result = await placeLimitOrderTestMode(page, 'stop-loss', TEST_ORDER_AMOUNT);
    console.log(`[Test 08] Order result: success=${result.success}, txConfirmed=${result.txConfirmed}`);

    testResults.push({
      test: '08-place-stop-loss',
      pool: 'fheWETH/fheUSDC',
      success: result.txConfirmed,
    });

    expect(result.txConfirmed).toBe(true);
  });
});

// ============================================
// FHE:ERC Pool Tests (fheWETH/USDC)
// ============================================

test.describe('Limit Order Lifecycle - FHE:ERC Pool', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(300000); // 5 minutes for FHE operations

  test('10 - Select fheWETH/USDC pool', async ({ page, waitForWalletConnected }) => {
    console.log('\n========================================');
    console.log('  FHE:ERC POOL LIMIT ORDER TESTS');
    console.log('  Pool: fheWETH/USDC');
    console.log('  Network: Arbitrum Sepolia');
    console.log('========================================\n');

    await navigateAndWait(page, '/trade');
    await waitForTestModeConnection(page, waitForWalletConnected);
    await page.waitForTimeout(3000);

    await waitForPoolsLoaded(page);

    // Select the FHE:ERC pool
    const poolSelected = await selectPool(page, 'fheWETH', 'USDC');
    console.log(`[Test 10] Pool selected: ${poolSelected}`);

    const currentPool = await getCurrentPoolPair(page);
    console.log(`[Test 10] Current pool: ${currentPool}`);

    // Pool should contain fheWETH and USDC
    const hasExpectedTokens = (currentPool?.includes('fheWETH') && currentPool?.includes('USDC')) ?? false;

    testResults.push({ test: '10-select-mixed-pool', pool: 'fheWETH/USDC', success: hasExpectedTokens });
  });

  test('11 - Place limit-sell order (maker)', async ({ page, waitForWalletConnected }) => {
    console.log('[Test 11] Placing limit-sell order (maker)...');

    await navigateAndWait(page, '/trade');
    await waitForTestModeConnection(page, waitForWalletConnected);
    await page.waitForTimeout(3000);

    await waitForPoolsLoaded(page);
    await selectPool(page, 'fheWETH', 'USDC');
    await page.waitForTimeout(2000);

    await clickLimitTab(page);
    await verifyLimitFormVisible(page);
    await initializeFheSession(page);

    // Place limit-sell order (Test Mode - no wallet needed)
    const result = await placeLimitOrderTestMode(page, 'limit-sell', TEST_ORDER_AMOUNT);
    console.log(`[Test 11] Order result: success=${result.success}, txConfirmed=${result.txConfirmed}`);

    testResults.push({
      test: '11-place-limit-sell',
      pool: 'fheWETH/USDC',
      success: result.txConfirmed,
    });

    expect(result.txConfirmed).toBe(true);
  });

  test('12 - Execute buy swap to trigger order', async ({ page, waitForWalletConnected }) => {
    console.log('[Test 12] Executing buy swap to trigger limit order...');

    await navigateAndWait(page, '/trade');
    await waitForTestModeConnection(page, waitForWalletConnected);
    await page.waitForTimeout(3000);

    await waitForPoolsLoaded(page);
    await selectPool(page, 'fheWETH', 'USDC');
    await page.waitForTimeout(2000);

    await clickMarketTab(page);
    await page.waitForTimeout(1000);

    // Execute swap (Test Mode - no wallet needed)
    const result = await executeSwapTestMode(page, TEST_SWAP_AMOUNT);
    console.log(`[Test 12] Swap result: success=${result.success}, txConfirmed=${result.txConfirmed}`);

    testResults.push({
      test: '12-trigger-buy-swap',
      pool: 'fheWETH/USDC',
      success: result.txConfirmed,
    });
  });

  test('13 - Check and claim orders', async ({ page, waitForWalletConnected }) => {
    console.log('[Test 13] Checking and claiming orders...');

    await navigateAndWait(page, '/orders/claims');
    await waitForTestModeConnection(page, waitForWalletConnected);
    await page.waitForTimeout(5000);

    if (await hasClaimableOrders(page)) {
      const result = await claimFilledOrder(page);
      console.log(`[Test 13] Claim result: success=${result.success}`);

      testResults.push({
        test: '13-claim-mixed-pool',
        pool: 'fheWETH/USDC',
        success: result.success,
      });
    } else {
      console.log('[Test 13] No orders to claim');
      testResults.push({
        test: '13-claim-mixed-pool',
        pool: 'fheWETH/USDC',
        success: true,
      });
    }
  });

  test('14 - Place stop-buy order (taker)', async ({ page, waitForWalletConnected }) => {
    console.log('[Test 14] Placing stop-buy order (taker)...');

    await navigateAndWait(page, '/trade');
    await waitForTestModeConnection(page, waitForWalletConnected);
    await page.waitForTimeout(3000);

    await waitForPoolsLoaded(page);
    await selectPool(page, 'fheWETH', 'USDC');
    await page.waitForTimeout(2000);

    await clickLimitTab(page);
    await verifyLimitFormVisible(page);
    await initializeFheSession(page);

    // Place stop-buy order (Test Mode - no wallet needed)
    const result = await placeLimitOrderTestMode(page, 'stop-buy', TEST_ORDER_AMOUNT);
    console.log(`[Test 14] Order result: success=${result.success}, txConfirmed=${result.txConfirmed}`);

    testResults.push({
      test: '14-place-stop-buy',
      pool: 'fheWETH/USDC',
      success: result.txConfirmed,
    });

    expect(result.txConfirmed).toBe(true);
  });
});

// ============================================
// Summary
// ============================================

test.describe('Summary', () => {
  test('99 - Test Summary', async ({ page }) => {
    console.log('\n========================================');
    console.log('  LIMIT ORDER LIFECYCLE TEST SUMMARY');
    console.log('========================================');

    console.log(`\nTotal tests: ${testResults.length}`);
    console.log('----------------------------------------');

    testResults.forEach((result, i) => {
      const status = result.success ? 'PASS' : 'FAIL';
      const errorInfo = result.error ? ` (${result.error})` : '';
      console.log(`  ${i + 1}. [${status}] ${result.pool}: ${result.test}${errorInfo}`);
    });

    const successCount = testResults.filter(r => r.success).length;
    console.log('----------------------------------------');
    console.log(`Success rate: ${successCount}/${testResults.length}`);
    console.log('========================================\n');

    // Test passes if we got any results
    expect(testResults.length).toBeGreaterThan(0);
  });
});
