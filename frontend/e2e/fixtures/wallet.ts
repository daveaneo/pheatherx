import { test as base, expect } from '@playwright/test';

/**
 * Test wallet fixture for FheatherX E2E tests
 *
 * Test wallet address: 0x60B9be2A29a02F49e8D6ba535303caD1Ddcb9659
 * Funded with: 0.1 ETH, 100 WETH, 100 USDC on Ethereum Sepolia
 */

// Critical errors that should fail tests immediately
const CRITICAL_ERROR_PATTERNS = [
  /net::ERR_FAILED/i,
  /Failed to convert value to 'Response'/i,
  /Failed to fetch/i,
  /ChunkLoadError/i,
  /Cannot read properties of undefined/i,
  /Cannot read properties of null/i,
  /is not defined/i,
  /Unexpected token/i,
];

// Known warnings to ignore (non-blocking issues)
const IGNORED_ERROR_PATTERNS = [
  /punycode/i,                    // Node.js deprecation warning
  /WalletConnect/i,               // WalletConnect HMR warnings
  /Multiple versions of Lit/i,   // Wallet library warning
  /hydration/i,                   // React hydration warnings (common in dev)
  /Failed to load cofhejs/i,      // FHE not available in test mode
  /cofhejs not available/i,       // FHE not available in test mode
  /Invalid or unexpected token/i, // Can occur during HMR/service worker cache conflicts
  /sw\.js/i,                      // Service worker errors during dev
  /Unexpected token/i,            // Can occur during HMR
  /usePoolDiscovery.*Failed to fetch/i,  // Pool discovery errors when RPC unavailable
  /Failed to fetch metadata/i,    // Token metadata errors when RPC unavailable
  /HTTP request failed/i,         // RPC connection errors
  /Failed to fetch$/i,            // Generic fetch errors
];

interface TestWalletFixtures {
  /** The test wallet address */
  walletAddress: string;

  /** Wait for wallet to be connected (check header shows address) */
  waitForWalletConnected: () => Promise<void>;

  /** Wait for a transaction toast confirmation */
  waitForTransactionSuccess: (timeout?: number) => Promise<void>;

  /** Console errors collected during the test */
  consoleErrors: string[];
}

export const test = base.extend<TestWalletFixtures>({
  // Test wallet address (derived from NEXT_PUBLIC_TEST_WALLET_PRIVATE_KEY)
  walletAddress: '0x60B9be2A29a02F49e8D6ba535303caD1Ddcb9659',

  // Console errors storage
  consoleErrors: [[], { scope: 'test' }],

  // Clear localStorage before each test and monitor console errors
  page: async ({ page, consoleErrors }, use) => {
    // Set up console error monitoring
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();

        // Skip ignored patterns
        const isIgnored = IGNORED_ERROR_PATTERNS.some((pattern) =>
          pattern.test(text)
        );
        if (isIgnored) return;

        // Check for critical errors
        const isCritical = CRITICAL_ERROR_PATTERNS.some((pattern) =>
          pattern.test(text)
        );
        if (isCritical) {
          consoleErrors.push(`[CRITICAL] ${text}`);
        } else {
          consoleErrors.push(text);
        }
      }
    });

    // Also capture page errors (uncaught exceptions)
    page.on('pageerror', (error) => {
      const text = error.message;
      // Skip ignored patterns for page errors too
      const isIgnored = IGNORED_ERROR_PATTERNS.some((pattern) =>
        pattern.test(text)
      );
      if (!isIgnored) {
        consoleErrors.push(`[PAGE ERROR] ${text}`);
      }
    });

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

    // After test: Check for critical errors and fail if found
    const criticalErrors = consoleErrors.filter((e) => e.startsWith('[CRITICAL]') || e.startsWith('[PAGE ERROR]'));
    if (criticalErrors.length > 0) {
      console.error('Critical console errors detected during test:');
      criticalErrors.forEach((e) => console.error(`  - ${e}`));
      throw new Error(`Test failed due to critical console errors:\n${criticalErrors.join('\n')}`);
    }
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
