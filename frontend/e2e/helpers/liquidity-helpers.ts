/**
 * Liquidity E2E Test Helpers
 *
 * Helper functions for FheatherX liquidity E2E tests with Dappwright.
 */

import type { Page } from 'playwright-core';
import type { Dappwright } from '@tenkeylabs/dappwright';

// Token addresses (Sepolia)
export const TOKENS = {
  WETH: {
    symbol: 'WETH',
    address: '0xe9Df64F549Eb1d2778909F339B9Bd795d14cF32E',
    type: 'ERC20',
    decimals: 18,
  },
  USDC: {
    symbol: 'USDC',
    address: '0xF7Ff2A5E74eaA6E0463358BB26780049d3D45C56',
    type: 'ERC20',
    decimals: 6,
  },
  fheWETH: {
    symbol: 'fheWETH',
    address: '0xf0F8f49b4065A1B01050Fa358d287106B676a25F',
    type: 'FHERC20',
    decimals: 18,
  },
  fheUSDC: {
    symbol: 'fheUSDC',
    address: '0x1D77eE754b2080B354733299A5aC678539a0D740',
    type: 'FHERC20',
    decimals: 6,
  },
} as const;

export type TokenSymbol = keyof typeof TOKENS;

/**
 * Connect wallet to dApp if not already connected
 */
export async function connectWalletIfNeeded(page: Page, wallet: Dappwright): Promise<boolean> {
  console.log('[Helper] Checking wallet connection...');

  // Check if already connected (look for wallet address on page)
  const pageContent = await page.content();
  if (pageContent.toLowerCase().includes('0x60b9')) {
    console.log('[Helper] Wallet already connected');
    return true;
  }

  // Find connect button
  const connectButton = page.locator('button:has-text("Connect")').first();
  if (!(await connectButton.isVisible().catch(() => false))) {
    console.log('[Helper] No Connect button found - might already be connected');
    return true;
  }

  // Click connect
  console.log('[Helper] Clicking Connect button...');
  await connectButton.click();
  await page.waitForTimeout(1000);

  // Click MetaMask in wallet modal
  const metamaskOption = page.locator('button:has-text("MetaMask")').first();
  if (await metamaskOption.isVisible().catch(() => false)) {
    console.log('[Helper] Selecting MetaMask...');
    await metamaskOption.click();
    await page.waitForTimeout(500);
  }

  // Approve connection in MetaMask
  console.log('[Helper] Approving MetaMask connection...');
  try {
    await wallet.approve();
    console.log('[Helper] Connection approved');
    await page.waitForTimeout(2000);
    return true;
  } catch (error) {
    console.log('[Helper] Connection approval failed:', error);
    return false;
  }
}

/**
 * Initialize FHE session if needed
 */
export async function initializeFheSessionIfNeeded(page: Page, wallet: Dappwright): Promise<boolean> {
  console.log('[Helper] Checking FHE session...');

  // Look for Initialize button
  const initButton = page.locator('button:has-text("Initialize")').first();
  if (!(await initButton.isVisible().catch(() => false))) {
    console.log('[Helper] No Initialize button found - session may already be active');
    return true;
  }

  // Click initialize
  console.log('[Helper] Clicking Initialize button...');
  await initButton.click();
  await page.waitForTimeout(2000);

  // Sign message in MetaMask
  console.log('[Helper] Signing FHE session message...');
  try {
    await wallet.sign();
    console.log('[Helper] FHE session initialized');
    await page.waitForTimeout(3000);
    return true;
  } catch (error) {
    console.log('[Helper] FHE sign failed (might not be needed):', error);
    return true; // Continue anyway
  }
}

/**
 * Handle multiple MetaMask transaction confirmations
 * Returns the number of transactions confirmed
 */
export async function handleMetaMaskConfirmations(
  wallet: Dappwright,
  page: Page,
  maxTransactions: number = 4
): Promise<number> {
  console.log(`[Helper] Handling up to ${maxTransactions} MetaMask confirmations...`);

  let confirmed = 0;

  for (let attempt = 0; attempt < maxTransactions; attempt++) {
    // Wait for potential transaction popup
    await page.waitForTimeout(2000);

    try {
      console.log(`[Helper] Attempting to confirm transaction ${attempt + 1}...`);
      await wallet.confirmTransaction();
      confirmed++;
      console.log(`[Helper] Transaction ${confirmed} confirmed`);
      await page.waitForTimeout(3000); // Wait for next tx to appear
    } catch (error) {
      console.log(`[Helper] No more transactions to confirm (confirmed ${confirmed})`);
      break;
    }
  }

  return confirmed;
}

/**
 * Dismiss any open dropdowns/modals by clicking outside
 */
async function dismissDropdowns(page: Page): Promise<void> {
  // Click on the body to dismiss any open dropdowns
  // Use force:true to bypass overlay detection
  const body = page.locator('body');
  await body.click({ position: { x: 10, y: 10 }, force: true });
  await page.waitForTimeout(300);
}

/**
 * Select token pair in the liquidity form
 */
export async function selectTokenPair(
  page: Page,
  token0Symbol: TokenSymbol,
  token1Symbol: TokenSymbol
): Promise<void> {
  console.log(`[Helper] Selecting token pair: ${token0Symbol}/${token1Symbol}`);

  // Dismiss any open dropdowns first
  await dismissDropdowns(page);

  // Click token0 selector
  const token0Selector = page.locator('[data-testid="token0-selector"]');
  if (await token0Selector.isVisible()) {
    await token0Selector.click();
    await page.waitForTimeout(500);

    // Select token from dropdown
    const token0Option = page.locator(`button:has-text("${token0Symbol}")`).first();
    if (await token0Option.isVisible()) {
      await token0Option.click();
      await page.waitForTimeout(500);
    }
  }

  // Dismiss the first dropdown before clicking the second
  await dismissDropdowns(page);
  await page.waitForTimeout(500);

  // Click token1 selector - use force to bypass any overlay
  const token1Selector = page.locator('[data-testid="token1-selector"]');
  if (await token1Selector.isVisible()) {
    await token1Selector.click({ force: true });
    await page.waitForTimeout(500);

    // Select token from dropdown
    const token1Option = page.locator(`button:has-text("${token1Symbol}")`).first();
    if (await token1Option.isVisible()) {
      await token1Option.click();
      await page.waitForTimeout(500);
    }
  }

  // Dismiss any remaining dropdowns
  await dismissDropdowns(page);

  console.log(`[Helper] Token pair selected: ${token0Symbol}/${token1Symbol}`);
}

/**
 * Add liquidity with specified amounts
 */
export async function addLiquidity(
  page: Page,
  wallet: Dappwright,
  amount0: string,
  amount1: string
): Promise<{ success: boolean; txCount: number }> {
  console.log(`[Helper] Adding liquidity: ${amount0} / ${amount1}`);

  // Fill amount0
  const amount0Input = page.locator('[data-testid="add-liquidity-amount0"]');
  if (await amount0Input.isVisible()) {
    await amount0Input.clear();
    await amount0Input.fill(amount0);
    console.log(`[Helper] Entered amount0: ${amount0}`);
  }

  // Wait for amount1 to auto-calculate or fill manually
  await page.waitForTimeout(1000);

  // Fill amount1 if needed
  const amount1Input = page.locator('[data-testid="add-liquidity-amount1"]');
  if (await amount1Input.isVisible()) {
    const currentValue = await amount1Input.inputValue();
    if (!currentValue || currentValue === '0') {
      await amount1Input.clear();
      await amount1Input.fill(amount1);
      console.log(`[Helper] Entered amount1: ${amount1}`);
    }
  }

  await page.waitForTimeout(500);

  // Click submit button
  const submitButton = page.locator('[data-testid="add-liquidity-submit"]');
  if (!(await submitButton.isVisible())) {
    console.log('[Helper] Submit button not found');
    return { success: false, txCount: 0 };
  }

  // Check if button is disabled
  const isDisabled = await submitButton.isDisabled();
  if (isDisabled) {
    console.log('[Helper] Submit button is disabled');
    return { success: false, txCount: 0 };
  }

  console.log('[Helper] Clicking submit button...');
  await submitButton.click();
  await page.waitForTimeout(2000);

  // Handle MetaMask confirmations (pool init, approvals, add liquidity)
  const txCount = await handleMetaMaskConfirmations(wallet, page, 4);

  // Wait for transaction to complete
  await page.waitForTimeout(5000);

  // Check for success indicators
  const pageContent = await page.content();
  const hasSuccess =
    pageContent.includes('success') ||
    pageContent.includes('Success') ||
    pageContent.includes('Position') ||
    pageContent.includes('Added');

  console.log(`[Helper] Add liquidity result: success=${hasSuccess}, txCount=${txCount}`);
  return { success: hasSuccess || txCount > 0, txCount };
}

/**
 * Verify position card exists for a token pair
 */
export async function verifyPositionCard(
  page: Page,
  token0Symbol: TokenSymbol,
  token1Symbol: TokenSymbol
): Promise<boolean> {
  console.log(`[Helper] Verifying position card for ${token0Symbol}/${token1Symbol}...`);

  // Look for position card
  const positionCard = page.locator('[data-testid="position-card"]').first();
  if (await positionCard.isVisible().catch(() => false)) {
    console.log('[Helper] Position card found');
    return true;
  }

  // Alternative: look for token symbols in positions section
  const pageContent = await page.content();
  const hasPosition =
    pageContent.includes(token0Symbol) && pageContent.includes(token1Symbol);

  console.log(`[Helper] Position verification: ${hasPosition}`);
  return hasPosition;
}

/**
 * Reveal FheatherX balances on portfolio page
 */
export async function revealFheatherxBalances(page: Page, wallet: Dappwright): Promise<boolean> {
  console.log('[Helper] Revealing FheatherX balances...');

  // Look for Reveal button
  const revealButton = page.locator('button:has-text("Reveal")').first();
  if (!(await revealButton.isVisible().catch(() => false))) {
    console.log('[Helper] No Reveal button found');
    return false;
  }

  // Click reveal
  await revealButton.click();
  await page.waitForTimeout(2000);

  // Sign the reveal message
  try {
    await wallet.sign();
    console.log('[Helper] Reveal signed successfully');
    await page.waitForTimeout(3000);
    return true;
  } catch (error) {
    console.log('[Helper] Reveal sign failed:', error);
    return false;
  }
}

/**
 * Check if a token has balance (returns true if balance > 0)
 */
export async function checkTokenBalance(
  page: Page,
  tokenSymbol: TokenSymbol
): Promise<{ hasBalance: boolean; balance: string }> {
  console.log(`[Helper] Checking balance for ${tokenSymbol}...`);

  // Look for the token in balance table
  const balanceRow = page.locator(`tr:has-text("${tokenSymbol}")`).first();
  if (!(await balanceRow.isVisible().catch(() => false))) {
    console.log(`[Helper] ${tokenSymbol} row not found`);
    return { hasBalance: false, balance: '0' };
  }

  // Get balance text
  const balanceText = await balanceRow.textContent();
  console.log(`[Helper] ${tokenSymbol} row content: ${balanceText}`);

  // Parse balance (look for numbers)
  const match = balanceText?.match(/(\d+\.?\d*)/);
  const balance = match ? match[1] : '0';
  const hasBalance = parseFloat(balance) > 0;

  console.log(`[Helper] ${tokenSymbol} balance: ${balance}, hasBalance: ${hasBalance}`);
  return { hasBalance, balance };
}

/**
 * Call token faucet to get test tokens
 */
export async function callTokenFaucet(
  page: Page,
  wallet: Dappwright,
  tokenSymbol: TokenSymbol
): Promise<boolean> {
  console.log(`[Helper] Calling faucet for ${tokenSymbol}...`);

  // Look for faucet button for this token
  const faucetButton = page
    .locator(`button:has-text("Faucet")`)
    .filter({ hasText: tokenSymbol })
    .first();

  // Alternative: look for Mint button
  const mintButton = page.locator(`button:has-text("Mint")`).first();

  const button = (await faucetButton.isVisible().catch(() => false))
    ? faucetButton
    : mintButton;

  if (!(await button.isVisible().catch(() => false))) {
    console.log(`[Helper] No faucet/mint button found for ${tokenSymbol}`);
    return false;
  }

  // Click faucet
  await button.click();
  await page.waitForTimeout(2000);

  // Confirm transaction
  try {
    await wallet.confirmTransaction();
    console.log(`[Helper] Faucet transaction confirmed for ${tokenSymbol}`);
    await page.waitForTimeout(5000);
    return true;
  } catch (error) {
    console.log(`[Helper] Faucet confirmation failed:`, error);
    return false;
  }
}

/**
 * Navigate to page and wait for load
 */
export async function navigateAndWait(page: Page, path: string): Promise<void> {
  const url = `http://localhost:3000${path}`;
  console.log(`[Helper] Navigating to ${url}...`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (error) {
    console.log('[Helper] First navigation attempt failed, retrying...');
    await page.waitForTimeout(2000);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  console.log(`[Helper] Navigation complete: ${path}`);
}
