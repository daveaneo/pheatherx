import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for PheatherX E2E tests
 *
 * Tests run with NEXT_PUBLIC_TEST_MODE=true which:
 * - Uses a mock wallet connector instead of MetaMask/Rainbow
 * - Auto-connects the test wallet on page load
 * - Allows full automation without browser extensions
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

  // Generous timeout for blockchain transactions
  timeout: 120000, // 2 minutes per test
  expect: {
    timeout: 30000, // 30 seconds for assertions
  },

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
    command: 'NEXT_PUBLIC_TEST_MODE=true npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      NEXT_PUBLIC_TEST_MODE: 'true',
    },
  },
});
