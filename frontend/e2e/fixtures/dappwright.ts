/**
 * Dappwright Fixtures for FheatherX E2E Tests
 *
 * Uses real MetaMask (v12.x MV3) for genuine wallet interactions.
 * Test wallet: 0x60B9be2A29a02F49e8D6ba535303caD1Ddcb9659
 */

import { test as base } from '@playwright/test';
import type { BrowserContext } from 'playwright-core';
import dappwright, { Dappwright, MetaMaskWallet } from '@tenkeylabs/dappwright';

// Test wallet private key (TEST ONLY - no real funds)
const TEST_WALLET_PRIVATE_KEY =
  '0x8080ec2e8e4f4af5da37afac0dd95e47497a4ab9d16d83aa99d5ac67c028130f';

// Sepolia network config
const SEPOLIA_NETWORK = {
  networkName: 'Sepolia',
  rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
  chainId: 11155111,
  symbol: 'ETH',
};

// Extend Playwright test with wallet fixtures
export const test = base.extend<
  { wallet: Dappwright; page: any },
  { walletContext: BrowserContext }
>({
  // Worker-scoped: one browser context with MetaMask for all tests
  walletContext: [
    async ({}, use) => {
      // Bootstrap MetaMask with dappwright
      // Using v12.23.0 - Dappwright recommended version
      // Note: MV3 has known popup issues, may need manual approval
      const [wallet, , context] = await dappwright.bootstrap('', {
        wallet: 'metamask',
        version: '12.23.0',
        seed: 'test test test test test test test test test test test junk',
        headless: false,
      });

      // Import our test wallet
      await wallet.importPK(TEST_WALLET_PRIVATE_KEY);

      // Switch to Sepolia (built-in network in MetaMask)
      await wallet.switchNetwork('Sepolia');

      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],

  // Test-scoped: fresh page for each test
  page: async ({ walletContext }, use) => {
    const page = await walletContext.newPage();
    // Navigate to a blank page first to ensure clean state
    await page.goto('about:blank');
    await page.bringToFront();
    await use(page);
    await page.close();
  },

  // Get wallet instance for the current context
  wallet: async ({ walletContext }, use) => {
    const wallet = await dappwright.getWallet('metamask', walletContext);
    await use(wallet);
  },
});

export { expect } from '@playwright/test';
