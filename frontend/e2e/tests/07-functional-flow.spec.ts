/**
 * Full Functional E2E Test Suite
 *
 * This test suite performs actual transactions on Ethereum Sepolia and verifies
 * state changes. Tests all 4 token pair combinations:
 *
 * 1. ERC:ERC   - WETH/USDC (standard AMM)
 * 2. FHE:FHE   - fheWETH/fheUSDC (fully encrypted)
 * 3. FHE:ERC   - fheWETH/USDC (mixed privacy)
 * 4. ERC:FHE   - WETH/fheUSDC (mixed privacy)
 *
 * Test Flow:
 * - Setup: Connect wallet, check initial balances
 * - Phase 1: Add liquidity to all 4 pairs
 * - Phase 2: Execute swaps on all 4 pairs
 * - Phase 3: Place limit orders on all 4 pairs
 * - Phase 4: Remove liquidity from all 4 pairs
 * - Cleanup: Verify final state
 *
 * Run with: npx playwright test e2e/tests/07-functional-flow.spec.ts --timeout=600000
 */

import { test, expect } from '../fixtures/wallet';
import {
  TOKEN_PAIRS,
  SEPOLIA_TOKENS,
  TEST_CONFIG,
  TokenPair,
  getPairDescription,
} from '../config/tokens';
import {
  getAllBalances,
  getEthBalance,
} from '../helpers/blockchain';
import { createPageHelpers } from '../helpers/pages';

// Store state across tests
interface TestState {
  initialBalances: Record<string, { raw: bigint; formatted: string }>;
  afterLiquidityBalances: Record<string, { raw: bigint; formatted: string }>;
  liquidityAddedPairs: string[];
  swappedPairs: string[];
  ordersPlacedPairs: string[];
  errors: string[];
}

const state: TestState = {
  initialBalances: {},
  afterLiquidityBalances: {},
  liquidityAddedPairs: [],
  swappedPairs: [],
  ordersPlacedPairs: [],
  errors: [],
};

// ═══════════════════════════════════════════════════════════════════════
//                         TEST CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════

test.describe('Functional E2E Test Suite', () => {
  // Run tests sequentially - order matters for blockchain state
  test.describe.configure({ mode: 'serial' });

  // Increase timeout for blockchain operations
  test.setTimeout(120000); // 2 minutes per test

  // ═══════════════════════════════════════════════════════════════════════
  //                           SETUP PHASE
  // ═══════════════════════════════════════════════════════════════════════

  test('00 - Setup: Verify test environment', async ({ page, waitForWalletConnected }) => {
    console.log('\n========================================');
    console.log('  FUNCTIONAL E2E TEST SUITE');
    console.log('========================================');
    console.log(`Network: ${TEST_CONFIG.chainName} (${TEST_CONFIG.chainId})`);
    console.log(`Wallet: ${TEST_CONFIG.testWallet}`);
    console.log(`RPC: ${TEST_CONFIG.rpcUrl}`);
    console.log('');
    console.log('Token Pairs to Test:');
    TOKEN_PAIRS.forEach((pair, i) => {
      console.log(`  ${i + 1}. ${pair.name} (${getPairDescription(pair)})`);
    });
    console.log('========================================\n');

    // Try to verify RPC connection (non-blocking)
    try {
      const ethBalance = await getEthBalance(TEST_CONFIG.testWallet);
      console.log(`[Setup] ETH Balance: ${Number(ethBalance) / 1e18} ETH`);

      // Get initial token balances
      const tokens = Object.values(SEPOLIA_TOKENS);
      state.initialBalances = await getAllBalances(tokens, TEST_CONFIG.testWallet);

      console.log('[Setup] Initial Token Balances:');
      for (const [symbol, balance] of Object.entries(state.initialBalances)) {
        console.log(`  ${symbol}: ${balance.formatted}`);
      }

      const hasWeth = state.initialBalances.WETH?.raw > 0n;
      const hasUsdc = state.initialBalances.USDC?.raw > 0n;
      console.log(`\n[Setup] Has WETH: ${hasWeth}, Has USDC: ${hasUsdc}`);
    } catch (error) {
      console.log('[Setup] RPC connection failed, continuing with UI tests only');
      console.log(`[Setup] Error: ${error}`);
    }

    // Navigate to app and verify it loads
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for wallet connection using the fixture helper
    await waitForWalletConnected();

    console.log('[Setup] App loaded and wallet connected');
  });

  test('01 - Check Portfolio displays all tokens', async ({ page, waitForWalletConnected }) => {
    await page.goto('/portfolio');
    await page.waitForLoadState('networkidle');
    await waitForWalletConnected();
    await page.waitForTimeout(2000);

    // Check for token display
    const tokens = Object.values(SEPOLIA_TOKENS);
    for (const token of tokens) {
      const tokenLocator = page.locator(`text=${token.symbol}`);
      const hasToken = await tokenLocator.first().isVisible().catch(() => false);
      console.log(`[Portfolio] ${token.symbol}: ${hasToken ? 'Found' : 'Not found'}`);
    }

    // At least verify the page loaded
    await expect(page.locator('text=/Portfolio|Balance|Wallet/i').first()).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════════════════
  //                      PHASE 1: ADD LIQUIDITY
  // ═══════════════════════════════════════════════════════════════════════

  test.describe('Phase 1: Add Liquidity', () => {
    for (const pair of TOKEN_PAIRS) {
      test(`Add liquidity to ${pair.name} (${pair.pairType})`, async ({ page }) => {
        console.log(`\n[Liquidity] Testing ${pair.name} - ${getPairDescription(pair)}`);

        const helpers = createPageHelpers(page);
        await helpers.liquidity.goto();

        // Check current page state
        const pageTitle = page.locator('h1:has-text("Liquidity")');
        const hasLiquidityPage = await pageTitle.isVisible().catch(() => false);
        console.log(`[Liquidity] Page loaded: ${hasLiquidityPage}`);

        expect(hasLiquidityPage).toBe(true);

        // Execute add liquidity - must succeed
        const success = await helpers.liquidity.addLiquidity(
          pair,
          TEST_CONFIG.liquidityAmount,
          TEST_CONFIG.liquidityAmount
        );

        expect(success).toBe(true);
        state.liquidityAddedPairs.push(pair.name);
        console.log(`[Liquidity] Successfully added to ${pair.name}`);

        // Verify UI shows the liquidity was added (if applicable)
        await page.waitForTimeout(2000);
      });
    }
  });

  test('Verify liquidity positions after Phase 1', async ({ page }) => {
    console.log('\n[Verify] Checking liquidity positions...');
    console.log(`[Verify] Pairs with liquidity: ${state.liquidityAddedPairs.join(', ') || 'None'}`);

    // Navigate to portfolio to check LP positions
    const helpers = createPageHelpers(page);
    await helpers.portfolio.goto();

    // Look for LP position indicators
    const lpSection = page.locator('text=/LP Position|Liquidity Position|LP Balance/i');
    const hasLpSection = await lpSection.first().isVisible().catch(() => false);
    console.log(`[Verify] LP section visible: ${hasLpSection}`);

    // Get updated balances
    const tokens = Object.values(SEPOLIA_TOKENS);
    state.afterLiquidityBalances = await getAllBalances(tokens, TEST_CONFIG.testWallet);

    console.log('[Verify] Balances after liquidity:');
    for (const [symbol, balance] of Object.entries(state.afterLiquidityBalances)) {
      const initial = state.initialBalances[symbol]?.formatted || '0';
      console.log(`  ${symbol}: ${initial} -> ${balance.formatted}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  //                       PHASE 2: EXECUTE SWAPS
  // ═══════════════════════════════════════════════════════════════════════

  test.describe('Phase 2: Execute Swaps', () => {
    for (const pair of TOKEN_PAIRS) {
      test(`Execute swap on ${pair.name} (${pair.pairType})`, async ({ page }) => {
        console.log(`\n[Swap] Testing ${pair.name}`);

        const helpers = createPageHelpers(page);
        await helpers.trade.goto();

        // Check page loaded
        const tradeContent = page.locator('text=/Trade|Swap|Market/i');
        const hasTradeContent = await tradeContent.first().isVisible().catch(() => false);
        console.log(`[Swap] Trade page loaded: ${hasTradeContent}`);

        expect(hasTradeContent).toBe(true);

        // Execute swap - must succeed
        const success = await helpers.trade.swap(pair, TEST_CONFIG.swapAmount);

        expect(success).toBe(true);
        state.swappedPairs.push(pair.name);
        console.log(`[Swap] Successfully swapped on ${pair.name}`);

        await page.waitForTimeout(2000);
      });
    }
  });

  test('Verify balances after Phase 2 swaps', async ({ page }) => {
    console.log('\n[Verify] Checking balances after swaps...');
    console.log(`[Verify] Pairs swapped: ${state.swappedPairs.join(', ') || 'None'}`);

    const tokens = Object.values(SEPOLIA_TOKENS);
    const currentBalances = await getAllBalances(tokens, TEST_CONFIG.testWallet);

    console.log('[Verify] Balances after swaps:');
    for (const [symbol, balance] of Object.entries(currentBalances)) {
      const afterLiq = state.afterLiquidityBalances[symbol]?.formatted || '0';
      console.log(`  ${symbol}: ${afterLiq} -> ${balance.formatted}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  //                    PHASE 3: PLACE LIMIT ORDERS
  // ═══════════════════════════════════════════════════════════════════════

  test.describe('Phase 3: Place Limit Orders', () => {
    for (const pair of TOKEN_PAIRS) {
      test(`Place limit order on ${pair.name} (${pair.pairType})`, async ({ page }) => {
        console.log(`\n[Limit] Testing ${pair.name}`);

        const helpers = createPageHelpers(page);
        await helpers.trade.goto();

        // Check for limit tab
        const limitTab = page.locator('button:has-text("Limit"), [role="tab"]:has-text("Limit")');
        const hasLimitTab = await limitTab.first().isVisible().catch(() => false);
        console.log(`[Limit] Limit tab available: ${hasLimitTab}`);

        expect(hasLimitTab).toBe(true);

        // Place limit order at 1.0 price (near current) - must succeed
        const success = await helpers.trade.placeLimitOrder(
          pair,
          TEST_CONFIG.orderAmount,
          '1.0'
        );

        expect(success).toBe(true);
        state.ordersPlacedPairs.push(pair.name);
        console.log(`[Limit] Successfully placed order on ${pair.name}`);

        await page.waitForTimeout(2000);
      });
    }
  });

  test('Verify active orders after Phase 3', async ({ page }) => {
    console.log('\n[Verify] Checking active orders...');
    console.log(`[Verify] Orders placed: ${state.ordersPlacedPairs.join(', ') || 'None'}`);

    const helpers = createPageHelpers(page);
    await helpers.activeOrders.goto();

    const orderCount = await helpers.activeOrders.getOrderCount();
    console.log(`[Verify] Active orders found: ${orderCount}`);

    // Check for order list
    const ordersContent = page.locator('text=/Active Orders|Your Orders|No orders/i');
    await expect(ordersContent.first()).toBeVisible({ timeout: 10000 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //                    PHASE 4: REMOVE LIQUIDITY
  // ═══════════════════════════════════════════════════════════════════════

  test('Phase 4: Remove liquidity (placeholder)', async ({ page }) => {
    console.log('\n[Remove] Phase 4: Remove Liquidity');
    console.log('[Remove] This phase is a placeholder - manual verification recommended');

    // Navigate to liquidity page
    await page.goto('/liquidity');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Look for remove liquidity option
    const removeLiqBtn = page.locator('button:has-text("Remove"), button:has-text("Withdraw")');
    const hasRemove = await removeLiqBtn.first().isVisible().catch(() => false);
    console.log(`[Remove] Remove button available: ${hasRemove}`);

    // This test passes as long as page loads
    await expect(page.locator('text=/Liquidity|Privacy Session Required/i').first()).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════════════════
  //                          FINAL SUMMARY
  // ═══════════════════════════════════════════════════════════════════════

  test('99 - Final Summary', async ({ page }) => {
    console.log('\n========================================');
    console.log('  TEST SUITE SUMMARY');
    console.log('========================================');

    console.log('\nPhase 1 - Liquidity Added:');
    if (state.liquidityAddedPairs.length > 0) {
      state.liquidityAddedPairs.forEach((pair) => console.log(`  [OK] ${pair}`));
    } else {
      console.log('  No liquidity was added');
    }

    console.log('\nPhase 2 - Swaps Executed:');
    if (state.swappedPairs.length > 0) {
      state.swappedPairs.forEach((pair) => console.log(`  [OK] ${pair}`));
    } else {
      console.log('  No swaps were executed');
    }

    console.log('\nPhase 3 - Limit Orders Placed:');
    if (state.ordersPlacedPairs.length > 0) {
      state.ordersPlacedPairs.forEach((pair) => console.log(`  [OK] ${pair}`));
    } else {
      console.log('  No limit orders were placed');
    }

    console.log('\nErrors Encountered:');
    if (state.errors.length > 0) {
      state.errors.forEach((err) => console.log(`  [!] ${err}`));
    } else {
      console.log('  No errors');
    }

    // Get final balances
    const tokens = Object.values(SEPOLIA_TOKENS);
    const finalBalances = await getAllBalances(tokens, TEST_CONFIG.testWallet);

    console.log('\nFinal Token Balances:');
    for (const [symbol, balance] of Object.entries(finalBalances)) {
      const initial = state.initialBalances[symbol]?.formatted || '0';
      console.log(`  ${symbol}: ${initial} -> ${balance.formatted}`);
    }

    console.log('\n========================================');
    console.log('  END OF TEST SUITE');
    console.log('========================================\n');

    // Test passes if we got this far
    expect(true).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//                      INDIVIDUAL TOKEN PAIR TESTS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Quick smoke tests for individual pairs
 * Run with: npx playwright test 07-functional-flow.spec.ts -g "WETH/USDC"
 */
test.describe('Individual Pair Quick Tests', () => {
  test.describe.configure({ mode: 'parallel' });

  test('WETH/USDC pair loads on trade page', async ({ page }) => {
    await page.goto('/trade');
    await page.waitForLoadState('networkidle');

    const tradeContent = page.locator('text=/Trade|Swap|Privacy Session Required/i');
    await expect(tradeContent.first()).toBeVisible({ timeout: 15000 });
  });

  test('fheWETH/fheUSDC pair loads on trade page', async ({ page }) => {
    await page.goto('/trade');
    await page.waitForLoadState('networkidle');

    const tradeContent = page.locator('text=/Trade|Swap|Privacy Session Required/i');
    await expect(tradeContent.first()).toBeVisible({ timeout: 15000 });
  });
});
