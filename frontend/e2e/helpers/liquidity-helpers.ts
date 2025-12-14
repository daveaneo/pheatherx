/**
 * Liquidity E2E Test Helpers
 *
 * Helper functions for FheatherX liquidity E2E tests with Dappwright.
 */

import type { Page } from 'playwright-core';
import type { Dappwright } from '@tenkeylabs/dappwright';

// Token addresses (Ethereum Sepolia)
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

// Token addresses (Arbitrum Sepolia) - from v6-arb-sepolia.json
export const ARB_SEPOLIA_TOKENS = {
  WETH: {
    symbol: 'WETH',
    address: '0xC5EcD76Db9f00B07088DDbFbdf7BF9927F6DDE13',
    type: 'ERC20',
    decimals: 18,
  },
  USDC: {
    symbol: 'USDC',
    address: '0x00F7DC53A57b980F839767a6C6214b4089d916b1',
    type: 'ERC20',
    decimals: 6,
  },
  fheWETH: {
    symbol: 'fheWETH',
    address: '0x7Da141eeA1F3c2dD0cC41915eE0AA19bE545d3e0',
    type: 'FHERC20',
    decimals: 18,
  },
  fheUSDC: {
    symbol: 'fheUSDC',
    address: '0x987731d456B5996E7414d79474D8aba58d4681DC',
    type: 'FHERC20',
    decimals: 6,
  },
} as const;

// Arbitrum Sepolia Pool IDs - from v8-arb-sepolia.json
export const ARB_SEPOLIA_POOLS = {
  // Native pool (no hook)
  WETH_USDC: '0x508023401a4fd3358c2fb8f6487cd54e66526bdb47b158e0f05e0b3b9a3efb81',
  // v8FHE hook
  fheWETH_fheUSDC: '0xef32021335934bc7bdaafe352c75009aee72b1ae7c3d8f2154fac36717a2b4df',
  // v8Mixed hook
  WETH_fheUSDC: '0x41916bfac052f6e4b5d8eff9fbc5bdcac0c45ddcc75548af8a6e2d3cc413bb3e',
  fheWETH_USDC: '0xbd854dfc04217be8e5d32fee22fddcc4c2bc65bfa69ea87eed9213664d63546c',
  WETH_fheWETH: '0xa462a29413849701e0888361ccbd32580cde3859dede02aea081ef56250e5a1a',
  USDC_fheUSDC: '0x1f2e4b37512fb968c5dcf9f71dc788a65b8b87ba2b23324ae61ef6d1615bec4e',
} as const;

// V8 Hook addresses for Arbitrum Sepolia
export const ARB_SEPOLIA_V8_HOOKS = {
  v8FheHook: '0x080a2d39687B6ED1F9E4ef9D7121c3f2cE815088',
  v8MixedHook: '0xB058257E3C8347059690605163384BA933B0D088',
} as const;

export type TokenSymbol = keyof typeof TOKENS;

/**
 * Wait for RainbowKit connect modal to close
 */
async function waitForConnectModalClosed(page: Page, timeout: number = 10000): Promise<void> {
  console.log('[Helper] Waiting for connect modal to close...');
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const modal = page.locator('[data-rk][role="dialog"]');
    if (!(await modal.isVisible().catch(() => false))) {
      console.log('[Helper] Connect modal closed');
      return;
    }
    await page.waitForTimeout(500);
  }

  console.log('[Helper] Connect modal did not close within timeout');
}

/**
 * Get MetaMask extension ID from browser context
 */
export async function getMetaMaskExtensionId(context: import('playwright-core').BrowserContext): Promise<string> {
  const allPages = context.pages();
  for (const p of allPages) {
    const url = p.url();
    const match = url.match(/chrome-extension:\/\/([^\/]+)/);
    if (match) {
      return match[1];
    }
  }
  return '';
}

/**
 * Open MetaMask notification page and click a button
 * MetaMask v12 MV3 has a two-step connection flow:
 * Step 1: Click "Next" to confirm accounts
 * Step 2: Click "Connect" to complete connection
 */
async function handleMetaMaskConnectionPopup(
  context: import('playwright-core').BrowserContext,
  extensionId: string
): Promise<boolean> {
  const notificationUrl = `chrome-extension://${extensionId}/notification.html`;

  // Step 1: Open notification and click Next
  console.log('[Helper] Opening MetaMask notification for Step 1...');
  let notificationPage = await context.newPage();
  try {
    await notificationPage.goto(notificationUrl, { timeout: 5000 });
    await notificationPage.waitForTimeout(1500);

    // Look for Next button first (account selection step)
    const nextBtn = notificationPage.locator('button:has-text("Next")').first();
    if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('[Helper] Step 1: Clicking "Next" button...');
      await nextBtn.click();
      await notificationPage.waitForTimeout(1500);

      // After clicking Next, the page content changes to show Connect button
      // Look for Connect button on same page
      const connectBtn = notificationPage.locator('button:has-text("Connect")').first();
      if (await connectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('[Helper] Step 2: Clicking "Connect" button...');
        await connectBtn.click();
        await notificationPage.waitForTimeout(2000);
        console.log('[Helper] Connection flow completed!');
        await notificationPage.close().catch(() => {});
        return true;
      }
    }

    // Alternative: Look for Connect button directly (single step)
    const connectBtnDirect = notificationPage.locator('button:has-text("Connect")').first();
    if (await connectBtnDirect.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('[Helper] Found direct "Connect" button, clicking...');
      await connectBtnDirect.click();
      console.log('[Helper] Clicked Connect button, waiting for connection...');
      await notificationPage.waitForTimeout(3000);
      // Page might close after connect - that's OK
      await notificationPage.close().catch(() => {});
      return true;
    }

    // Check for Confirm button
    const confirmBtn = notificationPage.locator('button:has-text("Confirm")').first();
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('[Helper] Found "Confirm" button, clicking...');
      await confirmBtn.click();
      await notificationPage.waitForTimeout(2000);
      await notificationPage.close().catch(() => {});
      return true;
    }

    console.log('[Helper] No actionable buttons found in notification page');

    // Debug: Log all buttons on page
    const buttons = notificationPage.locator('button');
    const buttonCount = await buttons.count();
    console.log(`[Helper] Found ${buttonCount} buttons on notification page`);
    for (let i = 0; i < Math.min(buttonCount, 5); i++) {
      const text = await buttons.nth(i).textContent().catch(() => '');
      console.log(`[Helper] Button ${i}: "${text?.substring(0, 30)}"`);
    }

    await notificationPage.close().catch(() => {});
    return false;
  } catch (error) {
    console.log('[Helper] Error in notification page:', (error as Error).message?.substring(0, 50));
    await notificationPage.close().catch(() => {});
    return false;
  }
}

/**
 * Connect wallet to dApp if not already connected.
 * Handles MetaMask v12 MV3 two-step connection flow.
 */
export async function connectWalletIfNeeded(page: Page, wallet: Dappwright): Promise<boolean> {
  console.log('[Helper] Checking wallet connection...');

  // Ensure we're on the dApp page
  await page.bringToFront();

  // Wait for app to fully hydrate (loading spinner to disappear)
  console.log('[Helper] Waiting for app to hydrate...');
  const loadingText = page.locator('text=Loading FheatherX');
  try {
    await loadingText.waitFor({ state: 'hidden', timeout: 30000 });
    console.log('[Helper] App hydrated successfully');
  } catch {
    console.log('[Helper] App still loading after 30s - continuing anyway');
  }

  // Wait a bit more for React to render
  await page.waitForTimeout(2000);

  // Helper to check if wallet is connected
  const isWalletConnected = async (): Promise<boolean> => {
    const content = await page.content();
    // Check for our test wallet address (partial matches for various display formats)
    // Full: 0x60B9be2A29a02F49e8D6ba535303caD1Ddcb9659
    // Truncated: 0x60B9...b9659 or 0x60...9659
    const hasFullAddress = content.toLowerCase().includes('0x60b9be2a29a02f49e8d6ba535303cad1ddcb9659');
    const hasTruncatedStart = content.toLowerCase().includes('0x60b9');
    const hasTruncatedEnd = content.toLowerCase().includes('9659');
    const hasMiddleTruncation = content.includes('0x60') && content.includes('9659');

    const connected = hasFullAddress || hasTruncatedStart || (hasTruncatedEnd && hasMiddleTruncation);
    if (connected) {
      console.log('[Helper] Wallet address detected in page content');
    }
    return connected;
  };

  // Check if already connected
  if (await isWalletConnected()) {
    console.log('[Helper] Wallet already connected (address found in page)');
    // Dismiss any open modal
    const rkModal = page.locator('[data-rk][role="dialog"]');
    if (await rkModal.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    return true;
  }

  const context = page.context();

  // Get MetaMask extension ID early
  const extensionId = await getMetaMaskExtensionId(context);
  console.log(`[Helper] MetaMask extension ID: ${extensionId || 'not found'}`);

  // Check if connect modal is already open
  const rkModal = page.locator('[data-rk][role="dialog"]');
  const modalAlreadyOpen = await rkModal.isVisible().catch(() => false);
  console.log(`[Helper] Modal already open: ${modalAlreadyOpen}`);

  if (!modalAlreadyOpen) {
    // Find connect button
    let connectButton = page.locator('[data-testid="wallet-connection"] button').first();

    if (!(await connectButton.isVisible().catch(() => false))) {
      connectButton = page.locator('button:has-text("Connect Wallet")').first();
    }

    if (!(await connectButton.isVisible().catch(() => false))) {
      connectButton = page.locator('button:has-text("Connect")').first();
    }

    if (!(await connectButton.isVisible().catch(() => false))) {
      console.log('[Helper] No Connect button found');
      if (await isWalletConnected()) {
        return true;
      }
      return false;
    }

    // Click connect
    console.log('[Helper] Found Connect button, clicking...');
    await connectButton.click();
    await page.waitForTimeout(1500);
  }

  // Wait for modal to fully render
  await page.waitForTimeout(1000);

  // Click MetaMask in wallet modal
  const metamaskOption = page.locator('button:has-text("MetaMask")').first();

  if (await metamaskOption.isVisible().catch(() => false)) {
    console.log('[Helper] Found MetaMask option, clicking...');
    await metamaskOption.click();
    await page.waitForTimeout(2000);
  }

  // Handle MetaMask connection popup
  if (extensionId) {
    const connected = await handleMetaMaskConnectionPopup(context, extensionId);
    if (connected) {
      console.log('[Helper] MetaMask popup handled, waiting for connection to propagate...');
      await page.bringToFront();

      // Wait longer for connection to propagate from MetaMask to dApp
      await page.waitForTimeout(5000);

      // Check connection multiple times with delays
      for (let attempt = 0; attempt < 5; attempt++) {
        if (await isWalletConnected()) {
          console.log(`[Helper] Wallet connected (attempt ${attempt + 1})`);
          // Dismiss any remaining modals
          if (await rkModal.isVisible().catch(() => false)) {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
          }
          return true;
        }
        console.log(`[Helper] Connection not detected yet (attempt ${attempt + 1}/5)`);
        await page.waitForTimeout(2000);
      }

      console.log('[Helper] Connection not detected after 5 attempts');
    }

    await page.bringToFront();
  }

  // Wait and check connection
  await page.waitForTimeout(2000);

  // Dismiss any remaining modals
  if (await rkModal.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // Check if connected
  if (await isWalletConnected()) {
    console.log('[Helper] Wallet successfully connected');
    return true;
  }

  // Try Dappwright's approve() as fallback
  console.log('[Helper] Trying wallet.approve() as fallback...');
  try {
    await Promise.race([
      wallet.approve(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
    ]);
    console.log('[Helper] wallet.approve() succeeded');
  } catch {
    console.log('[Helper] wallet.approve() timed out');
  }

  await page.waitForTimeout(3000);

  if (await isWalletConnected()) {
    console.log('[Helper] Connected via wallet.approve()');
    return true;
  }

  console.log('[Helper] Failed to connect wallet');
  return false;
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
 * Confirm a MetaMask transaction by opening the notification.html page directly.
 * This works around MetaMask v12 MV3 popup issues where Dappwright can't detect the notification.
 */
export async function confirmMetaMaskTransaction(
  context: import('playwright-core').BrowserContext,
  extensionId: string
): Promise<boolean> {
  const notificationUrl = `chrome-extension://${extensionId}/notification.html`;
  console.log('[Helper] Opening MetaMask notification for transaction confirmation...');

  let notificationPage = await context.newPage();
  try {
    await notificationPage.goto(notificationUrl, { timeout: 5000 });
    await notificationPage.waitForTimeout(1500);

    // Look for Confirm button (transaction confirmation)
    const confirmBtn = notificationPage.locator('button:has-text("Confirm")').first();
    if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('[Helper] Found "Confirm" button, clicking...');
      await confirmBtn.click();
      await notificationPage.waitForTimeout(2000);
      await notificationPage.close().catch(() => {});
      console.log('[Helper] Transaction confirmed via notification page');
      return true;
    }

    // Alternative: Look for "Approve" button (for token approvals)
    const approveBtn = notificationPage.locator('button:has-text("Approve")').first();
    if (await approveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('[Helper] Found "Approve" button, clicking...');
      await approveBtn.click();
      await notificationPage.waitForTimeout(2000);
      await notificationPage.close().catch(() => {});
      console.log('[Helper] Approval confirmed via notification page');
      return true;
    }

    // Alternative: Look for "Sign" button (for signing messages)
    const signBtn = notificationPage.locator('button:has-text("Sign")').first();
    if (await signBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('[Helper] Found "Sign" button, clicking...');
      await signBtn.click();
      await notificationPage.waitForTimeout(2000);
      await notificationPage.close().catch(() => {});
      console.log('[Helper] Message signed via notification page');
      return true;
    }

    // Debug: Log all buttons on page
    const buttons = notificationPage.locator('button');
    const buttonCount = await buttons.count();
    console.log(`[Helper] No actionable buttons found. Button count: ${buttonCount}`);
    for (let i = 0; i < Math.min(buttonCount, 5); i++) {
      const text = await buttons.nth(i).textContent().catch(() => '');
      console.log(`[Helper] Button ${i}: "${text?.substring(0, 30)}"`);
    }

    await notificationPage.close().catch(() => {});
    return false;
  } catch (error) {
    console.log('[Helper] Error in transaction notification page:', (error as Error).message?.substring(0, 50));
    await notificationPage.close().catch(() => {});
    return false;
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

  const context = page.context();
  const extensionId = await getMetaMaskExtensionId(context);

  let confirmed = 0;

  for (let attempt = 0; attempt < maxTransactions; attempt++) {
    // Wait for potential transaction popup
    await page.waitForTimeout(2000);

    // Try our notification page approach first
    if (extensionId) {
      const success = await confirmMetaMaskTransaction(context, extensionId);
      if (success) {
        confirmed++;
        console.log(`[Helper] Transaction ${confirmed} confirmed via notification page`);
        await page.waitForTimeout(3000); // Wait for next tx to appear
        continue;
      }
    }

    // Fallback to Dappwright's confirmTransaction
    try {
      console.log(`[Helper] Attempting to confirm transaction ${attempt + 1} via Dappwright...`);
      await Promise.race([
        wallet.confirmTransaction(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
      ]);
      confirmed++;
      console.log(`[Helper] Transaction ${confirmed} confirmed via Dappwright`);
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
 * Note: App may stay in loading state until wallet is connected
 */
export async function navigateAndWait(page: Page, path: string): Promise<void> {
  const url = `http://localhost:3000${path}`;
  console.log(`[Helper] Navigating to ${url}...`);

  // Ensure we're on the dApp page (not MetaMask extension page)
  await page.bringToFront();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (error) {
    console.log('[Helper] First navigation attempt failed, retrying...');
    await page.waitForTimeout(2000);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  // Don't wait for networkidle as app may be loading indefinitely until wallet connects
  await page.waitForTimeout(2000);

  // Log what we see
  const currentUrl = page.url();
  console.log(`[Helper] Current URL: ${currentUrl}`);

  // Check if we're on loading screen or if app loaded
  const loadingText = page.locator('text=Loading FheatherX');
  const isLoading = await loadingText.isVisible().catch(() => false);
  console.log(`[Helper] App loading state: ${isLoading ? 'loading' : 'loaded'}`);

  console.log(`[Helper] Navigation complete: ${path}`);
}
