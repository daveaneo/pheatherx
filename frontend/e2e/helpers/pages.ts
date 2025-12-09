/**
 * Page Object Model Helpers for E2E Tests
 *
 * Provides reusable page interaction patterns for:
 * - Portfolio page
 * - Liquidity page
 * - Trade page
 */

import { Page, Locator, expect } from '@playwright/test';
import { TokenPair, TestToken, TEST_CONFIG } from '../config/tokens';

// ═══════════════════════════════════════════════════════════════════════
//                         BASE PAGE CLASS
// ═══════════════════════════════════════════════════════════════════════

export class BasePage {
  constructor(protected page: Page) {}

  /**
   * Wait for page to be fully loaded
   */
  async waitForPageLoad(timeout = 10000): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout });
  }

  /**
   * Wait for wallet to be connected - looks for 0x address anywhere on page
   */
  async waitForWalletConnected(timeout = 30000): Promise<void> {
    // Wait for any element showing a wallet address (0x...)
    await this.page.waitForFunction(
      () => {
        // Check for wallet connection element first
        const walletEl = document.querySelector('[data-testid="wallet-connection"]');
        if (walletEl?.textContent?.includes('0x')) return true;

        // Also check for address displayed in header/nav
        const bodyText = document.body.innerText;
        return bodyText.includes('0x60B9') || bodyText.includes('0x60b9');
      },
      { timeout }
    );
  }

  /**
   * Initialize FHE session if required
   */
  async initializeFheSessionIfNeeded(): Promise<boolean> {
    const privacySession = this.page.locator('text=Privacy Session Required');
    const hasPrivacy = await privacySession.isVisible().catch(() => false);

    if (hasPrivacy) {
      const initButton = this.page.locator('button:has-text("Initialize")');
      const hasInit = await initButton.isVisible().catch(() => false);
      if (hasInit) {
        await initButton.click();
        await this.page.waitForTimeout(5000); // Wait for FHE initialization
        return true;
      }
    }
    return false;
  }

  /**
   * Wait for a success toast/notification
   */
  async waitForSuccessToast(timeout = 60000): Promise<void> {
    await this.page.waitForSelector('text=/confirmed|success|received/i', {
      timeout,
    });
  }

  /**
   * Wait for loading state to clear
   */
  async waitForLoading(timeout = 30000): Promise<void> {
    const loadingIndicator = this.page.locator(
      'text=/Loading|Discovering|Processing/i'
    );
    const isLoading = await loadingIndicator.isVisible().catch(() => false);
    if (isLoading) {
      await loadingIndicator.waitFor({ state: 'hidden', timeout });
    }
  }

  /**
   * Take a screenshot with timestamp
   */
  async screenshot(name: string): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    await this.page.screenshot({
      path: `e2e/screenshots/${name}-${timestamp}.png`,
      fullPage: true,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
//                        PORTFOLIO PAGE
// ═══════════════════════════════════════════════════════════════════════

export class PortfolioPage extends BasePage {
  // Locators
  get balanceSection(): Locator {
    return this.page.locator(
      '[data-testid="token-balances"], text=/Balance/i'
    );
  }

  get faucetButton(): Locator {
    return this.page.locator('button:has-text("Faucet"), button:has-text("Get Tokens")');
  }

  /**
   * Navigate to portfolio page
   */
  async goto(): Promise<void> {
    await this.page.goto('/portfolio');
    await this.waitForPageLoad();
    await this.waitForWalletConnected();
    await this.page.waitForTimeout(2000);
  }

  /**
   * Check if token balance is displayed
   */
  async hasTokenBalance(symbol: string): Promise<boolean> {
    const tokenLocator = this.page.locator(`text=${symbol}`);
    return tokenLocator.first().isVisible().catch(() => false);
  }

  /**
   * Get displayed balance for a token
   */
  async getDisplayedBalance(symbol: string): Promise<string | null> {
    // Look for token row with balance
    const tokenRow = this.page.locator(`[data-testid="token-row-${symbol}"]`);
    const hasRow = await tokenRow.isVisible().catch(() => false);

    if (hasRow) {
      const balanceEl = tokenRow.locator('[data-testid="token-balance"]');
      const text = await balanceEl.textContent().catch(() => null);
      return text;
    }

    return null;
  }

  /**
   * Click faucet to get test tokens
   */
  async requestFaucetTokens(): Promise<void> {
    const hasButton = await this.faucetButton.isVisible().catch(() => false);
    if (hasButton) {
      await this.faucetButton.click();
      await this.page.waitForTimeout(3000);
    }
  }

  /**
   * Verify all expected tokens are displayed
   */
  async verifyTokensDisplayed(tokens: TestToken[]): Promise<boolean> {
    let allFound = true;
    for (const token of tokens) {
      const found = await this.hasTokenBalance(token.symbol);
      if (!found) {
        console.log(`[Portfolio] Token not found: ${token.symbol}`);
        allFound = false;
      }
    }
    return allFound;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//                        LIQUIDITY PAGE
// ═══════════════════════════════════════════════════════════════════════

export class LiquidityPage extends BasePage {
  // Locators
  get addLiquidityCard(): Locator {
    return this.page.locator('text="Add Liquidity"');
  }

  get token0AmountInput(): Locator {
    return this.page.locator(
      '[data-testid="liquidity-amount-0"], input[placeholder*="0.0"]'
    ).first();
  }

  get token1AmountInput(): Locator {
    return this.page.locator(
      '[data-testid="liquidity-amount-1"], input[placeholder*="0.0"]'
    ).nth(1);
  }

  get submitButton(): Locator {
    return this.page.locator(
      'button:has-text("Add Liquidity"), button:has-text("Create Pool"), button:has-text("Submit")'
    );
  }

  get token0Selector(): Locator {
    return this.page.locator('[data-testid="token-selector-0"]');
  }

  get token1Selector(): Locator {
    return this.page.locator('[data-testid="token-selector-1"]');
  }

  /**
   * Navigate to liquidity page
   */
  async goto(): Promise<void> {
    await this.page.goto('/liquidity');
    await this.waitForPageLoad();
    await this.waitForWalletConnected();
    await this.page.waitForTimeout(2000);
    await this.initializeFheSessionIfNeeded();
    await this.waitForLoading();
  }

  /**
   * Select token pair for liquidity
   */
  async selectTokenPair(pair: TokenPair): Promise<void> {
    // Try to find and click token selectors
    const hasToken0Selector = await this.token0Selector.isVisible().catch(() => false);
    const hasToken1Selector = await this.token1Selector.isVisible().catch(() => false);

    if (hasToken0Selector) {
      await this.token0Selector.click();
      await this.page.waitForTimeout(500);
      await this.page.locator(`text=${pair.token0.symbol}`).click();
      await this.page.waitForTimeout(500);
    }

    if (hasToken1Selector) {
      await this.token1Selector.click();
      await this.page.waitForTimeout(500);
      await this.page.locator(`text=${pair.token1.symbol}`).click();
      await this.page.waitForTimeout(500);
    }

    // Alternative: look for pool selector dropdown
    const poolSelector = this.page.locator('button:has-text("/")');
    const hasPoolSelector = await poolSelector.first().isVisible().catch(() => false);

    if (hasPoolSelector) {
      await poolSelector.first().click();
      await this.page.waitForTimeout(500);
      await this.page.locator(`text=${pair.name}`).click();
      await this.page.waitForTimeout(500);
    }
  }

  /**
   * Enter liquidity amounts
   */
  async enterAmounts(amount0: string, amount1: string): Promise<void> {
    const hasInput0 = await this.token0AmountInput.isVisible().catch(() => false);
    const hasInput1 = await this.token1AmountInput.isVisible().catch(() => false);

    if (hasInput0) {
      await this.token0AmountInput.fill(amount0);
      await this.page.waitForTimeout(500);
    }

    if (hasInput1) {
      await this.token1AmountInput.fill(amount1);
      await this.page.waitForTimeout(500);
    }
  }

  /**
   * Submit add liquidity transaction
   */
  async submitAddLiquidity(): Promise<boolean> {
    const hasSubmit = await this.submitButton.first().isVisible().catch(() => false);

    if (hasSubmit) {
      const isDisabled = await this.submitButton.first().isDisabled().catch(() => true);
      if (!isDisabled) {
        await this.submitButton.first().click();
        return true;
      }
    }
    return false;
  }

  /**
   * Full flow: Add liquidity to a pair
   */
  async addLiquidity(
    pair: TokenPair,
    amount0: string,
    amount1: string
  ): Promise<boolean> {
    console.log(`[Liquidity] Adding liquidity to ${pair.name}: ${amount0}/${amount1}`);

    await this.selectTokenPair(pair);
    await this.enterAmounts(amount0, amount1);
    const submitted = await this.submitAddLiquidity();

    if (submitted) {
      // Wait for transaction confirmation
      try {
        await this.waitForSuccessToast(TEST_CONFIG.txTimeout);
        console.log(`[Liquidity] Successfully added to ${pair.name}`);
        return true;
      } catch {
        console.log(`[Liquidity] Transaction may have timed out for ${pair.name}`);
        return false;
      }
    }

    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//                          TRADE PAGE
// ═══════════════════════════════════════════════════════════════════════

export class TradePage extends BasePage {
  // Locators
  get marketTab(): Locator {
    return this.page.locator(
      'button:has-text("Market"), [role="tab"]:has-text("Market")'
    );
  }

  get limitTab(): Locator {
    return this.page.locator(
      'button:has-text("Limit"), [role="tab"]:has-text("Limit")'
    );
  }

  get swapAmountInput(): Locator {
    return this.page.locator(
      '[data-testid="swap-amount-in"], input[placeholder*="0.0"]'
    ).first();
  }

  get swapButton(): Locator {
    return this.page.locator('button:has-text("Swap"), button:has-text("Trade")');
  }

  get limitAmountInput(): Locator {
    return this.page.locator(
      'input[name="amount"], input[data-testid="order-amount"]'
    );
  }

  get limitPriceInput(): Locator {
    return this.page.locator(
      'input[name="triggerPrice"], input[data-testid="order-price"]'
    );
  }

  get placeOrderButton(): Locator {
    return this.page.locator(
      'button:has-text("Place Order"), button:has-text("Submit")'
    );
  }

  /**
   * Navigate to trade page
   */
  async goto(): Promise<void> {
    await this.page.goto('/trade');
    await this.waitForPageLoad();
    await this.waitForWalletConnected();
    await this.page.waitForTimeout(2000);
    await this.initializeFheSessionIfNeeded();
  }

  /**
   * Select pool for trading
   */
  async selectPool(pair: TokenPair): Promise<void> {
    // Look for pool selector
    const poolSelector = this.page.locator('button:has-text("/")');
    const hasPoolSelector = await poolSelector.first().isVisible().catch(() => false);

    if (hasPoolSelector) {
      await poolSelector.first().click();
      await this.page.waitForTimeout(500);
      await this.page.locator(`text=${pair.name}`).click();
      await this.page.waitForTimeout(500);
    }
  }

  /**
   * Execute a market swap
   */
  async swap(pair: TokenPair, amount: string): Promise<boolean> {
    console.log(`[Trade] Swapping ${amount} on ${pair.name}`);

    await this.selectPool(pair);

    // Click Market tab
    const hasMarketTab = await this.marketTab.first().isVisible().catch(() => false);
    if (hasMarketTab) {
      await this.marketTab.first().click();
      await this.page.waitForTimeout(500);
    }

    // Enter amount
    const hasAmountInput = await this.swapAmountInput.isVisible().catch(() => false);
    if (hasAmountInput) {
      await this.swapAmountInput.fill(amount);
      await this.page.waitForTimeout(500);
    }

    // Click swap
    const hasSwapBtn = await this.swapButton.first().isVisible().catch(() => false);
    if (hasSwapBtn) {
      const isDisabled = await this.swapButton.first().isDisabled().catch(() => true);
      if (!isDisabled) {
        await this.swapButton.first().click();

        try {
          await this.waitForSuccessToast(TEST_CONFIG.txTimeout);
          console.log(`[Trade] Swap successful on ${pair.name}`);
          return true;
        } catch {
          console.log(`[Trade] Swap may have timed out on ${pair.name}`);
          return false;
        }
      }
    }

    return false;
  }

  /**
   * Place a limit order
   */
  async placeLimitOrder(
    pair: TokenPair,
    amount: string,
    price: string
  ): Promise<boolean> {
    console.log(`[Trade] Placing limit order on ${pair.name}: ${amount} @ ${price}`);

    await this.selectPool(pair);

    // Click Limit tab
    const hasLimitTab = await this.limitTab.first().isVisible().catch(() => false);
    if (hasLimitTab) {
      await this.limitTab.first().click();
      await this.page.waitForTimeout(1000);

      // Fill amount
      const hasAmount = await this.limitAmountInput.isVisible().catch(() => false);
      if (hasAmount) {
        await this.limitAmountInput.fill(amount);
      }

      // Fill price
      const hasPrice = await this.limitPriceInput.isVisible().catch(() => false);
      if (hasPrice) {
        await this.limitPriceInput.fill(price);
      }

      await this.page.waitForTimeout(500);

      // Submit order
      const hasPlaceBtn = await this.placeOrderButton.first().isVisible().catch(() => false);
      if (hasPlaceBtn) {
        const isDisabled = await this.placeOrderButton.first().isDisabled().catch(() => true);
        if (!isDisabled) {
          await this.placeOrderButton.first().click();

          try {
            await this.waitForSuccessToast(TEST_CONFIG.txTimeout);
            console.log(`[Trade] Limit order placed on ${pair.name}`);
            return true;
          } catch {
            console.log(`[Trade] Limit order may have timed out on ${pair.name}`);
            return false;
          }
        }
      }
    }

    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//                       ACTIVE ORDERS PAGE
// ═══════════════════════════════════════════════════════════════════════

export class ActiveOrdersPage extends BasePage {
  get orderRows(): Locator {
    return this.page.locator('[data-testid^="order-row"]');
  }

  get closeButtons(): Locator {
    return this.page.locator('[data-testid="close-position-btn"]');
  }

  /**
   * Navigate to active orders page
   */
  async goto(): Promise<void> {
    await this.page.goto('/orders/active');
    await this.waitForPageLoad();
    await this.waitForWalletConnected();
    await this.page.waitForTimeout(2000);
  }

  /**
   * Get number of active orders
   */
  async getOrderCount(): Promise<number> {
    return this.orderRows.count();
  }

  /**
   * Cancel/close all active orders
   */
  async closeAllOrders(): Promise<number> {
    const closeCount = await this.closeButtons.count();
    let closed = 0;

    for (let i = 0; i < closeCount; i++) {
      const button = this.closeButtons.nth(i);
      const isVisible = await button.isVisible().catch(() => false);
      if (isVisible) {
        await button.click();
        await this.page.waitForTimeout(2000);
        closed++;
      }
    }

    return closed;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//                           EXPORTS
// ═══════════════════════════════════════════════════════════════════════

export function createPageHelpers(page: Page) {
  return {
    portfolio: new PortfolioPage(page),
    liquidity: new LiquidityPage(page),
    trade: new TradePage(page),
    activeOrders: new ActiveOrdersPage(page),
  };
}
