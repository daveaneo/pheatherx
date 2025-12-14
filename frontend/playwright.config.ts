import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for FheatherX E2E tests
 *
 * Tests run with NEXT_PUBLIC_TEST_MODE=true which:
 * - Uses a mock wallet connector instead of MetaMask/Rainbow
 * - Auto-connects the test wallet on page load
 * - Allows full automation without browser extensions
 *
 * Test types:
 * - Smoke tests (01-06): Quick UI verification (~30s each)
 * - Functional tests (07+): Full transaction flows (~2min each)
 */
export default defineConfig({
  testDir: './e2e/tests',

  // Run tests sequentially (blockchain state requires order)
  fullyParallel: false,
  workers: 1,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry failed tests (helpful for flaky blockchain transactions)
  retries: process.env.CI ? 2 : 1,

  // Reporter configuration
  reporter: process.env.CI ? 'github' : 'html',

  // Output directory for screenshots and other artifacts
  outputDir: './e2e/test-results',

  // Generous timeout for blockchain transactions
  // Individual tests can override with test.setTimeout()
  timeout: 120000, // 2 minutes per test (default)
  expect: {
    timeout: 30000, // 30 seconds for assertions
  },

  // Global setup to create screenshot directory
  globalSetup: undefined, // Can add global setup if needed

  use: {
    // Base URL for the dev server
    baseURL: 'http://localhost:3000',

    // Collect trace on first retry
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure (helpful for debugging)
    video: 'on-first-retry',

    // Clear storage state before each test to prevent pool store caching across chains
    storageState: undefined,

    // Disable service worker to avoid caching issues during tests
    serviceWorkers: 'block',
  },

  // Only test on Chromium for now
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start the dev server before tests
  webServer: {
    command: 'NEXT_PUBLIC_TEST_MODE=true NEXT_PUBLIC_TEST_CHAIN=arb-sepolia npm run dev',
    url: 'http://localhost:3000',
    // Reuse existing server for faster test runs
    // Set PLAYWRIGHT_REUSE_SERVER=true when running with existing server
    // For CI or fresh runs, set to false
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === 'true' || !process.env.CI,
    timeout: 120000,
    env: {
      NEXT_PUBLIC_TEST_MODE: 'true',
      NEXT_PUBLIC_TEST_CHAIN: 'arb-sepolia',
    },
  },
});
