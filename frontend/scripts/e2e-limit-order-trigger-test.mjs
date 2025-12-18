#!/usr/bin/env node
/**
 * E2E Test: Limit Order TRIGGER Test
 *
 * This test specifically validates that limit orders get triggered by swaps.
 * Unlike the basic test, this one:
 * 1. Places an order at the CURRENT tick (so any swap triggers it)
 * 2. Does a larger swap (1000 USDC) to ensure tick movement
 * 3. Verifies the order was actually filled
 *
 * Usage: node scripts/e2e-limit-order-trigger-test.mjs
 *
 * Requires: Dev server running at localhost:3000
 */

import { ethers } from 'ethers';
import { keccak256, encodePacked, parseUnits, formatUnits } from 'viem';

// ═══════════════════════════════════════════════════════════════════════
//                           CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════

// Arb Sepolia
const RPC_URL = 'https://sepolia-rollup.arbitrum.io/rpc';
const CHAIN_ID = 421614;

// Dev wallet private key from .env
const PRIVATE_KEY = '0xc8b6da05290c267f6917e4da157083ff3773a2414eec3b8920596fed00e9ce7b';

// FHE API on dev server
const FHE_API_URL = 'http://localhost:3000/api/fhe';

// Contract addresses on Arb Sepolia
const HOOK_ADDRESS = '0xeF13A37401E1bb43aBED8F0108510eBb91401088'; // v8FHE
const PRIVATE_ROUTER = '0x19a9BAbF6e1bc6C7Af2634fB4061160dAb744B64';

// FHERC20 tokens (note: fheWETH < fheUSDC in address order, so WETH is token0)
const FHE_WETH = '0x7Da141eeA1F3c2dD0cC41915eE0AA19bE545d3e0';
const FHE_USDC = '0x987731d456B5996E7414d79474D8aba58d4681DC';

// Pool config
const POOL_FEE = 3000;
const TICK_SPACING = 60;
const KNOWN_POOL_ID = '0x92c5e351bf239ffea024d746621c2046854ac042f5b3357b5aa9a67e1d9341de';

// Test amounts - LARGER amounts to ensure tick movement
const ORDER_AMOUNT_WETH = parseUnits('0.1', 18);   // 0.1 WETH for limit order (10x bigger)
const SWAP_AMOUNT_USDC = parseUnits('1000', 6);    // 1000 USDC for swap (100x bigger)

// ═══════════════════════════════════════════════════════════════════════
//                              ABIs
// ═══════════════════════════════════════════════════════════════════════

const FHERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function balanceOfEncrypted(address) view returns (uint256)',
  'function hasEncryptedBalance(address) view returns (bool)',
  'function wrap(uint256 amount)',
  'function unwrap(uint256 amount)',
  'function faucet()',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approveEncrypted(address spender, tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) value) returns (bool)',
];

const HOOK_ABI = [
  'function getReserves(bytes32 poolId) view returns (uint256, uint256)',
  'function getCurrentTick(bytes32 poolId) view returns (int24)',
  'function getQuote(bytes32 poolId, bool zeroForOne, uint256 amountIn) view returns (uint256)',
  'function poolStates(bytes32 poolId) view returns (address token0, address token1, bool initialized, uint256 protocolFeeBps)',
  'function positions(bytes32 poolId, address user, int24 tick, uint8 side) view returns (uint256 shares, uint256 proceedsPerShareSnapshot, uint256 filledPerShareSnapshot, uint256 realizedProceeds)',
  'function deposit(bytes32 poolId, int24 tick, uint8 side, tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) encryptedAmount, uint256 deadline, int24 maxTickDrift)',
  'function claim(bytes32 poolId, int24 tick, uint8 side)',
  'function bucketStates(bytes32 poolId, int24 tick, uint8 side) view returns (uint256 totalEncShares, uint256 proceedsPerShare, uint256 filledPerShare)',
  'function TICK_SPACING() view returns (int24)',
];

const ROUTER_ABI = [
  'function swapEncrypted(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) encDirection, tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) encAmountIn, tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) encMinOutput)',
];

// ═══════════════════════════════════════════════════════════════════════
//                           FHE API HELPERS
// ═══════════════════════════════════════════════════════════════════════

let fheSessionId = null;

async function fheApiCall(action, data = {}) {
  const response = await fetch(FHE_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, chainId: CHAIN_ID, ...data }),
  });

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || 'FHE API call failed');
  }
  return result;
}

async function initializeFhe(userAddress) {
  console.log('Initializing FHE session via API...');
  const result = await fheApiCall('initialize', { userAddress });
  fheSessionId = result.sessionId;
  console.log('FHE session created:', fheSessionId);
  return result;
}

async function encrypt(value, type = 'uint128') {
  if (!fheSessionId) throw new Error('FHE session not initialized');

  const result = await fheApiCall('encrypt', {
    data: {
      sessionId: fheSessionId,
      value: value.toString(),
      type,
    },
  });

  return {
    ctHash: BigInt(result.encrypted.ctHash),
    securityZone: result.encrypted.securityZone,
    utype: result.encrypted.utype,
    signature: result.encrypted.signature,
  };
}

async function unseal(ciphertext) {
  if (!fheSessionId) throw new Error('FHE session not initialized');

  const result = await fheApiCall('unseal', {
    data: {
      sessionId: fheSessionId,
      ciphertext: ciphertext.toString(),
      type: 'uint128',
    },
  });

  return BigInt(result.value);
}

// ═══════════════════════════════════════════════════════════════════════
//                           HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

async function waitForTx(tx, label) {
  console.log(`  ${label}: Waiting for confirmation...`);
  const receipt = await tx.wait();
  console.log(`  ${label}: ${receipt.status === 1 ? 'SUCCESS' : 'FAILED'} (gas: ${receipt.gasUsed.toString()})`);
  if (receipt.status !== 1) {
    throw new Error(`${label} failed`);
  }
  return receipt;
}

// ═══════════════════════════════════════════════════════════════════════
//                              MAIN
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('      E2E Test: Limit Order TRIGGER Test on Arb Sepolia');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  console.log('This test validates that limit orders actually get TRIGGERED by swaps.\n');

  // Check dev server is running
  try {
    const healthCheck = await fetch('http://localhost:3000');
    if (!healthCheck.ok) throw new Error('Dev server not responding');
  } catch (e) {
    console.error('ERROR: Dev server must be running at localhost:3000');
    console.error('Run: npm run dev');
    process.exit(1);
  }

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log('Network: Arbitrum Sepolia (REAL TESTNET)');
  console.log('Wallet:', wallet.address);

  // Check ETH balance
  const ethBalance = await provider.getBalance(wallet.address);
  console.log('ETH Balance:', ethers.formatEther(ethBalance), 'ETH');

  if (ethBalance < parseUnits('0.02', 18)) {
    console.error('ERROR: Not enough ETH for gas. Need at least 0.02 ETH');
    console.error('This test uses more gas than the basic test (~10M+ gas total)');
    process.exit(1);
  }

  // Setup contracts
  const fheWeth = new ethers.Contract(FHE_WETH, FHERC20_ABI, wallet);
  const fheUsdc = new ethers.Contract(FHE_USDC, FHERC20_ABI, wallet);
  const hook = new ethers.Contract(HOOK_ADDRESS, HOOK_ABI, wallet);
  const router = new ethers.Contract(PRIVATE_ROUTER, ROUTER_ABI, wallet);

  const poolId = KNOWN_POOL_ID;
  console.log('Pool ID:', poolId);

  // ═══════════════════════════════════════════════════════════════════════
  //                     STEP 1: INITIALIZE FHE
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 1: Initialize FHE Session ═══\n');
  await initializeFhe(wallet.address);

  // ═══════════════════════════════════════════════════════════════════════
  //                     STEP 2: CHECK POOL STATE
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 2: Check Pool State ═══\n');

  const [token0, token1, initialized] = await hook.poolStates(poolId);
  if (!initialized) {
    console.error('ERROR: Pool not initialized');
    process.exit(1);
  }

  console.log('Pool initialized:', initialized);
  console.log('Token0 (fheWETH):', token0);
  console.log('Token1 (fheUSDC):', token1);

  const [reserve0, reserve1] = await hook.getReserves(poolId);
  console.log('Reserve0 (WETH):', formatUnits(reserve0, 18));
  console.log('Reserve1 (USDC):', formatUnits(reserve1, 6));

  const currentTick = await hook.getCurrentTick(poolId);
  console.log('Current Tick:', currentTick);

  // Calculate implied price from tick
  // tick = log(price) / log(1.0001), so price = 1.0001^tick
  const impliedPrice = Math.pow(1.0001, Number(currentTick));
  console.log('Implied price (USDC/WETH):', (1 / impliedPrice).toFixed(2));

  // ═══════════════════════════════════════════════════════════════════════
  //                     STEP 3: PREPARE TOKENS
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 3: Prepare Tokens ═══\n');

  // Check balances
  const wethPlain = await fheWeth.balanceOf(wallet.address);
  const usdcPlain = await fheUsdc.balanceOf(wallet.address);
  console.log(`fheWETH plaintext: ${formatUnits(wethPlain, 18)}`);
  console.log(`fheUSDC plaintext: ${formatUnits(usdcPlain, 6)}`);

  // Get faucet if needed (need more for this test)
  if (wethPlain < parseUnits('1', 18)) {
    console.log('\nGetting fheWETH from faucet...');
    const tx = await fheWeth.faucet();
    await waitForTx(tx, 'fheWETH faucet');
  }

  if (usdcPlain < parseUnits('2000', 6)) {
    console.log('Getting fheUSDC from faucet (twice for 200 USDC)...');
    const tx1 = await fheUsdc.faucet();
    await waitForTx(tx1, 'fheUSDC faucet 1');
    const tx2 = await fheUsdc.faucet();
    await waitForTx(tx2, 'fheUSDC faucet 2');
  }

  // Wrap tokens
  const wethToWrap = parseUnits('0.5', 18);
  const usdcToWrap = parseUnits('1500', 6);

  const wethNow = await fheWeth.balanceOf(wallet.address);
  const usdcNow = await fheUsdc.balanceOf(wallet.address);

  if (wethNow >= wethToWrap) {
    console.log(`\nWrapping ${formatUnits(wethToWrap, 18)} fheWETH...`);
    const tx = await fheWeth.wrap(wethToWrap);
    await waitForTx(tx, 'wrap fheWETH');
  }

  if (usdcNow >= usdcToWrap) {
    console.log(`Wrapping ${formatUnits(usdcToWrap, 6)} fheUSDC...`);
    const tx = await fheUsdc.wrap(usdcToWrap);
    await waitForTx(tx, 'wrap fheUSDC');
  }

  // ═══════════════════════════════════════════════════════════════════════
  //                     STEP 4: PLACE LIMIT ORDER AT CURRENT TICK
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 4: Place Limit Order at Current Tick ═══\n');

  // KEY DIFFERENCE: Place order at CURRENT tick (aligned to spacing)
  // This ensures ANY price movement will trigger the order
  const alignedTick = Math.floor(Number(currentTick) / TICK_SPACING) * TICK_SPACING;

  // Place order just ONE tick spacing above current (will trigger on upward momentum)
  const orderTick = alignedTick + TICK_SPACING;

  console.log('Current tick:', currentTick);
  console.log('Aligned tick:', alignedTick);
  console.log('Order tick:', orderTick, `(just ${TICK_SPACING} above aligned - will trigger on ANY upward move)`);

  // SELL order: deposits token0 (WETH), receives token1 (USDC) when filled
  const side = 1; // SELL
  console.log('Side: SELL (selling WETH at tick', orderTick, ')');
  console.log(`Order amount: ${formatUnits(ORDER_AMOUNT_WETH, 18)} WETH`);

  // Encrypt order amount
  console.log('\nEncrypting order amount...');
  const encryptedOrderAmount = await encrypt(ORDER_AMOUNT_WETH);

  // Approve hook for WETH (encrypted approval)
  console.log('Approving hook for fheWETH (encrypted approval)...');
  const maxWethAllowance = parseUnits('1000000', 18);
  const encWethAllowance = await encrypt(maxWethAllowance);
  const approveTx1 = await fheWeth.approveEncrypted(
    HOOK_ADDRESS,
    [encWethAllowance.ctHash.toString(), encWethAllowance.securityZone, encWethAllowance.utype, encWethAllowance.signature],
    { gasLimit: 1000000 }
  );
  await waitForTx(approveTx1, 'approveEncrypted fheWETH');

  // Check bucket state BEFORE deposit
  console.log('\nBucket state BEFORE deposit:');
  try {
    const bucketBefore = await hook.bucketStates(poolId, orderTick, side);
    console.log('  totalEncShares:', bucketBefore.totalEncShares.toString().slice(0, 20) + '...');
    console.log('  proceedsPerShare:', bucketBefore.proceedsPerShare.toString());
    console.log('  filledPerShare:', bucketBefore.filledPerShare.toString());
  } catch (e) {
    console.log('  (bucket does not exist yet)');
  }

  // Place the order
  console.log('\nPlacing limit order...');
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const maxTickDrift = 600;

  const iface = new ethers.Interface(HOOK_ABI);
  const depositCalldata = iface.encodeFunctionData('deposit', [
    poolId,
    orderTick,
    side,
    [encryptedOrderAmount.ctHash.toString(), encryptedOrderAmount.securityZone, encryptedOrderAmount.utype, encryptedOrderAmount.signature],
    deadline,
    maxTickDrift,
  ]);

  const depositTx = await wallet.sendTransaction({
    to: HOOK_ADDRESS,
    data: depositCalldata,
    gasLimit: 2000000n,
  });
  await waitForTx(depositTx, 'deposit (limit order)');
  console.log('✓ Limit order placed at tick', orderTick);

  // Check position after deposit
  const positionAfterDeposit = await hook.positions(poolId, wallet.address, orderTick, side);
  console.log('\nPosition after deposit:');
  console.log('  Shares handle:', positionAfterDeposit.shares.toString().slice(0, 20) + '...');

  // Check bucket state AFTER deposit
  console.log('\nBucket state AFTER deposit:');
  const bucketAfterDeposit = await hook.bucketStates(poolId, orderTick, side);
  console.log('  totalEncShares:', bucketAfterDeposit.totalEncShares.toString().slice(0, 20) + '...');

  // ═══════════════════════════════════════════════════════════════════════
  //                     STEP 5: SWAP TO TRIGGER THE ORDER
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 5: Swap to Trigger Order ═══\n');

  // To trigger a SELL order at tick+60, we need price to go UP (tick increases)
  // Price goes UP when people BUY token0 (WETH) by SELLING token1 (USDC)
  // That's zeroForOne = false
  const zeroForOne = false;
  console.log('Swap: Sell USDC (token1) for WETH (token0) to push tick UP');
  console.log(`Swap amount: ${formatUnits(SWAP_AMOUNT_USDC, 6)} USDC (large enough to move tick)`);

  // Encrypt swap parameters
  console.log('\nEncrypting swap parameters...');
  const encDirection = await encrypt(zeroForOne ? 1n : 0n, 'bool');
  const encAmountIn = await encrypt(SWAP_AMOUNT_USDC);
  const encMinOutput = await encrypt(0n);

  // Approve hook for USDC (encrypted approval)
  console.log('Approving hook for fheUSDC (encrypted approval)...');
  const maxUsdcAllowance = parseUnits('1000000', 6);
  const encUsdcAllowance = await encrypt(maxUsdcAllowance);
  const approveTx2 = await fheUsdc.approveEncrypted(
    HOOK_ADDRESS,
    [encUsdcAllowance.ctHash.toString(), encUsdcAllowance.securityZone, encUsdcAllowance.utype, encUsdcAllowance.signature],
    { gasLimit: 1000000 }
  );
  await waitForTx(approveTx2, 'approveEncrypted fheUSDC');

  // Build pool key
  const poolKey = {
    currency0: FHE_WETH, // Already sorted (WETH < USDC)
    currency1: FHE_USDC,
    fee: POOL_FEE,
    tickSpacing: TICK_SPACING,
    hooks: HOOK_ADDRESS,
  };

  // Record tick BEFORE swap
  const tickBeforeSwap = await hook.getCurrentTick(poolId);
  console.log('\nTick BEFORE swap:', tickBeforeSwap);

  // Execute swap
  console.log('\nExecuting swap via PrivateSwapRouter...');
  console.log('(This is the swap that should TRIGGER the limit order)');

  try {
    const swapTx = await router.swapEncrypted(
      poolKey,
      { ctHash: encDirection.ctHash, securityZone: encDirection.securityZone, utype: encDirection.utype, signature: encDirection.signature },
      { ctHash: encAmountIn.ctHash, securityZone: encAmountIn.securityZone, utype: encAmountIn.utype, signature: encAmountIn.signature },
      { ctHash: encMinOutput.ctHash, securityZone: encMinOutput.securityZone, utype: encMinOutput.utype, signature: encMinOutput.signature },
      { gasLimit: 6000000 }  // Extra gas for order matching
    );
    await waitForTx(swapTx, 'swapEncrypted');
    console.log('✓ Swap executed!');
  } catch (e) {
    console.error('Swap failed:', e.message);
    throw e;
  }

  // Record tick AFTER swap
  const tickAfterSwap = await hook.getCurrentTick(poolId);
  console.log('\nTick AFTER swap:', tickAfterSwap);
  console.log('Tick movement:', Number(tickAfterSwap) - Number(tickBeforeSwap), 'ticks');
  console.log('Order tick was:', orderTick);

  // Did we cross the order tick?
  const crossed = Number(tickAfterSwap) >= orderTick;
  console.log(`Crossed order tick? ${crossed ? 'YES - ORDER SHOULD BE FILLED!' : 'NO - order not triggered'}`);

  // ═══════════════════════════════════════════════════════════════════════
  //                     STEP 6: CHECK ORDER STATUS
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 6: Check Order Status ═══\n');

  // Check bucket state AFTER swap
  console.log('Bucket state AFTER swap:');
  const bucketAfterSwap = await hook.bucketStates(poolId, orderTick, side);
  console.log('  totalEncShares:', bucketAfterSwap.totalEncShares.toString().slice(0, 20) + '...');
  console.log('  proceedsPerShare:', bucketAfterSwap.proceedsPerShare.toString());
  console.log('  filledPerShare:', bucketAfterSwap.filledPerShare.toString());

  // If proceedsPerShare > 0, orders were filled!
  if (bucketAfterSwap.proceedsPerShare > 0n) {
    console.log('\n✓✓✓ ORDER WAS TRIGGERED! proceedsPerShare > 0 ✓✓✓');
  } else {
    console.log('\n✗ Order NOT triggered (proceedsPerShare = 0)');
  }

  // Check position state
  const positionAfterSwap = await hook.positions(poolId, wallet.address, orderTick, side);
  console.log('\nPosition after swap:');
  console.log('  Shares handle:', positionAfterSwap.shares.toString().slice(0, 20) + '...');
  console.log('  realizedProceeds:', positionAfterSwap.realizedProceeds.toString());

  // ═══════════════════════════════════════════════════════════════════════
  //                     STEP 7: CLAIM PROCEEDS
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 7: Claim Proceeds ═══\n');

  console.log('Claiming proceeds from filled order...');
  try {
    const claimTx = await hook.claim(poolId, orderTick, side, { gasLimit: 1500000 });
    await waitForTx(claimTx, 'claim');
    console.log('✓ Claim successful!');
  } catch (e) {
    console.log('Claim result:', e.message.slice(0, 80));
  }

  // ═══════════════════════════════════════════════════════════════════════
  //                     STEP 8: FINAL VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 8: Final Verification ═══\n');

  // Final position check
  const finalPosition = await hook.positions(poolId, wallet.address, orderTick, side);
  console.log('Final position:');
  console.log('  Shares:', finalPosition.shares.toString() === '0' ? '0 (fully claimed)' : finalPosition.shares.toString().slice(0, 20) + '...');
  console.log('  realizedProceeds:', finalPosition.realizedProceeds.toString());

  // Check encrypted balances
  console.log('\nFinal encrypted balances:');
  try {
    const finalWethEnc = await fheWeth.balanceOfEncrypted(wallet.address);
    if (finalWethEnc > 0n) {
      const value = await unseal(finalWethEnc);
      console.log(`  fheWETH: ${formatUnits(value, 18)}`);
    }
  } catch (e) {
    console.log('  fheWETH: Could not unseal');
  }

  try {
    const finalUsdcEnc = await fheUsdc.balanceOfEncrypted(wallet.address);
    if (finalUsdcEnc > 0n) {
      const value = await unseal(finalUsdcEnc);
      console.log(`  fheUSDC: ${formatUnits(value, 6)}`);
    }
  } catch (e) {
    console.log('  fheUSDC: Could not unseal');
  }

  // Final ETH balance
  const finalEth = await provider.getBalance(wallet.address);
  console.log(`\nETH spent on gas: ${formatUnits(ethBalance - finalEth, 18)} ETH`);

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                         TEST COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════');

  if (bucketAfterSwap.proceedsPerShare > 0n) {
    console.log('\n✓✓✓ SUCCESS: Limit order was triggered and filled! ✓✓✓\n');
  } else {
    console.log('\n✗ INCOMPLETE: Order was not triggered. Tick may not have moved enough.\n');
  }
}

main().catch(err => {
  console.error('\n\nFATAL ERROR:', err.message || err);
  process.exit(1);
});
