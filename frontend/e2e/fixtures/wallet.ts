import { test as base, expect } from '@playwright/test';

/**
 * Test wallet fixture for PheatherX E2E tests
 *
 * Test wallet address: 0x60B9be2A29a02F49e8D6ba535303caD1Ddcb9659
 * Funded with: 0.1 ETH, 100 tWETH, 100 tUSDC on Ethereum Sepolia
 */

interface TestWalletFixtures {
  /** The test wallet address */
  walletAddress: string;

  /** Wait for wallet to be connected (check header shows address) */
  waitForWalletConnected: () => Promise<void>;

  /** Wait for a transaction toast confirmation */
  waitForTransactionSuccess: (timeout?: number) => Promise<void>;
}

export const test = base.extend<TestWalletFixtures>({
  // Test wallet address (derived from NEXT_PUBLIC_TEST_WALLET_PRIVATE_KEY)
  walletAddress: '0x60B9be2A29a02F49e8D6ba535303caD1Ddcb9659',

  // Clear localStorage before each test to prevent pool store and wagmi state caching
  page: async ({ page }, use) => {
    // Navigate to the app first to set the context
    await page.goto('/');
    // Clear ALL localStorage to ensure completely fresh state
    // This includes: wagmi state, pool store, RainbowKit state, etc.
    await page.evaluate(() => {
      localStorage.clear();
    });
    // Reload the page so the app initializes with fresh state
    await page.reload();
    await page.waitForLoadState('networkidle');
    await use(page);
  },

  // Helper to wait for wallet connection
  waitForWalletConnected: async ({ page }, use) => {
    const waitFn = async () => {
      // In test mode, the wallet auto-connects
      // Wait for the wallet connection element to show an address
      await page.waitForFunction(
        () => {
          const walletEl = document.querySelector('[data-testid="wallet-connection"]');
          // RainbowKit shows "0x..." when connected
          return walletEl?.textContent?.includes('0x');
        },
        { timeout: 30000 }
      );
    };
    await use(waitFn);
  },

  // Helper to wait for transaction confirmation toast
  waitForTransactionSuccess: async ({ page }, use) => {
    const waitFn = async (timeout = 60000) => {
      // Wait for success toast or confirmation message
      await page.waitForSelector('text=/confirmed|success|received/i', {
        timeout,
      });
    };
    await use(waitFn);
  },
});

export { expect };
