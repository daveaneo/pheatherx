import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for Dappwright wallet tests
 *
 * Uses real MetaMask (v12.x MV3) extension.
 * Requires dev server running separately: npm run dev
 */
export default defineConfig({
  testDir: './e2e/tests',
  testMatch: '08-dappwright-wallet.spec.ts',

  // Run tests sequentially
  fullyParallel: false,
  workers: 1,

  // No retries for wallet tests (they're deterministic)
  retries: 0,

  // Reporter
  reporter: [['list'], ['html', { open: 'never' }]],

  // Output directory
  outputDir: './e2e/test-results',

  // Long timeout for MetaMask interactions
  timeout: 180000, // 3 minutes
  expect: {
    timeout: 30000,
  },

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  // Single project - dappwright handles browser setup
  projects: [
    {
      name: 'wallet',
      testMatch: '08-dappwright-wallet.spec.ts',
    },
  ],

  // No webServer - dev server must be started manually
  // This allows real wallet testing without TEST_MODE
  webServer: undefined,
});
