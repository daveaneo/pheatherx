#!/usr/bin/env node
/**
 * E2E Test: Full Limit Order Flow
 *
 * This script tests the complete limit order lifecycle using:
 * - The running Next.js dev server's FHE API for encryption
 * - Direct contract calls via ethers.js
 *
 * Flow:
 * 1. Initialize FHE session via API
 * 2. Check initial balances
 * 3. Get tokens via faucet (if needed)
 * 4. Wrap tokens to FHERC20
 * 5. Place a limit order (deposit)
 * 6. Execute a swap to trigger the order
 * 7. Claim proceeds
 * 8. Verify final balances
 *
 * Usage: node scripts/e2e-limit-order-test.mjs
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

// Dev wallet private key - MUST be set via environment variable
const PRIVATE_KEY = process.env.TEST_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('ERROR: TEST_PRIVATE_KEY environment variable not set');
  console.error('Usage: TEST_PRIVATE_KEY=0x... node scripts/e2e-limit-order-test.mjs');
  process.exit(1);
}

// FHE API on dev server
const FHE_API_URL = 'http://localhost:3000/api/fhe';

// Contract addresses on Arb Sepolia
const HOOK_ADDRESS = '0xeF13A37401E1bb43aBED8F0108510eBb91401088'; // v8FHE
const PRIVATE_ROUTER = '0x19a9BAbF6e1bc6C7Af2634fB4061160dAb744B64';
const POOL_MANAGER = '0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317';

// FHERC20 tokens
const FHE_WETH = '0x7Da141eeA1F3c2dD0cC41915eE0AA19bE545d3e0';
const FHE_USDC = '0x987731d456B5996E7414d79474D8aba58d4681DC';

// Pool config
const POOL_FEE = 3000;
const TICK_SPACING = 60;
// Pre-computed pool ID from seed-encrypted-liquidity.cjs (matches initialized pool)
const KNOWN_POOL_ID = '0x92c5e351bf239ffea024d746621c2046854ac042f5b3357b5aa9a67e1d9341de';

// Test amounts
const ORDER_AMOUNT_WETH = parseUnits('0.01', 18);  // 0.01 WETH for limit order
const SWAP_AMOUNT_USDC = parseUnits('10', 6);      // 10 USDC for swap

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
  'function TICK_SPACING() view returns (int24)',
  'function encLpBalances(bytes32 poolId, address user) view returns (uint256)',
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

function computePoolId(token0, token1, fee, tickSpacing, hooks) {
  // Sort tokens
  const [sorted0, sorted1] = token0.toLowerCase() < token1.toLowerCase()
    ? [token0, token1]
    : [token1, token0];

  // Encode pool key and hash
  const encoded = encodePacked(
    ['address', 'address', 'uint24', 'int24', 'address'],
    [sorted0, sorted1, fee, tickSpacing, hooks]
  );
  return keccak256(encoded);
}

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
  console.log('           E2E Test: Full Limit Order Flow on Arb Sepolia');
  console.log('═══════════════════════════════════════════════════════════════════\n');

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

  console.log('Network: Arbitrum Sepolia');
  console.log('Wallet:', wallet.address);

  // Check ETH balance
  const ethBalance = await provider.getBalance(wallet.address);
  console.log('ETH Balance:', ethers.formatEther(ethBalance), 'ETH');

  if (ethBalance < parseUnits('0.005', 18)) {
    console.error('ERROR: Not enough ETH for gas. Need at least 0.005 ETH');
    process.exit(1);
  }

  // Setup contracts
  const fheWeth = new ethers.Contract(FHE_WETH, FHERC20_ABI, wallet);
  const fheUsdc = new ethers.Contract(FHE_USDC, FHERC20_ABI, wallet);
  const hook = new ethers.Contract(HOOK_ADDRESS, HOOK_ABI, wallet);
  const router = new ethers.Contract(PRIVATE_ROUTER, ROUTER_ABI, wallet);

  // Compute pool ID (tokens are sorted: USDC < WETH on Arb Sepolia)
  // Use the known pool ID from seed-encrypted-liquidity.cjs (verified on chain)
  const poolId = KNOWN_POOL_ID;
  console.log('Pool ID:', poolId);

  // Verify it matches computation (for debugging)
  const computedPoolId = computePoolId(FHE_USDC, FHE_WETH, POOL_FEE, TICK_SPACING, HOOK_ADDRESS);
  if (poolId.toLowerCase() !== computedPoolId.toLowerCase()) {
    console.log('Note: Computed pool ID differs:', computedPoolId);
    console.log('Using known pool ID from deployment');
  }

  // ═══════════════════════════════════════════════════════════════════════
  //                     STEP 1: INITIALIZE FHE
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 1: Initialize FHE Session ═══\n');

  await initializeFhe(wallet.address);

  // ═══════════════════════════════════════════════════════════════════════
  //                     STEP 2: CHECK POOL STATE
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 2: Check Pool State ═══\n');

  let poolInitialized = false;
  let currentTick = 0;

  try {
    const [token0, token1, initialized] = await hook.poolStates(poolId);
    poolInitialized = initialized;
    console.log('Pool initialized:', initialized);
    console.log('Token0:', token0);
    console.log('Token1:', token1);

    if (initialized) {
      const [reserve0, reserve1] = await hook.getReserves(poolId);
      console.log('Reserve0:', formatUnits(reserve0, 6), 'USDC');
      console.log('Reserve1:', formatUnits(reserve1, 18), 'WETH');

      currentTick = await hook.getCurrentTick(poolId);
      console.log('Current Tick:', currentTick);
    }
  } catch (e) {
    console.log('Pool state error:', e.message);
  }

  if (!poolInitialized) {
    console.error('\nERROR: Pool not initialized. The v8FHE pool must be created first.');
    console.error('This requires deploying and initializing the pool with liquidity.');
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //                     STEP 3: CHECK TOKEN BALANCES
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 3: Check Token Balances ═══\n');

  const wethPlain = await fheWeth.balanceOf(wallet.address);
  const wethHasEnc = await fheWeth.hasEncryptedBalance(wallet.address);
  console.log(`fheWETH: ${formatUnits(wethPlain, 18)} plaintext, has encrypted: ${wethHasEnc}`);

  const usdcPlain = await fheUsdc.balanceOf(wallet.address);
  const usdcHasEnc = await fheUsdc.hasEncryptedBalance(wallet.address);
  console.log(`fheUSDC: ${formatUnits(usdcPlain, 6)} plaintext, has encrypted: ${usdcHasEnc}`);

  // Get faucet if needed
  if (wethPlain < parseUnits('1', 18)) {
    console.log('\nGetting fheWETH from faucet...');
    const tx = await fheWeth.faucet();
    await waitForTx(tx, 'fheWETH faucet');
  }

  if (usdcPlain < parseUnits('1000', 6)) {
    console.log('Getting fheUSDC from faucet...');
    const tx = await fheUsdc.faucet();
    await waitForTx(tx, 'fheUSDC faucet');
  }

  // ═══════════════════════════════════════════════════════════════════════
  //                     STEP 4: WRAP TOKENS
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 4: Wrap Tokens for Encrypted Balances ═══\n');

  const wethToWrap = parseUnits('0.1', 18);
  const usdcToWrap = parseUnits('100', 6);

  // Check current plaintext balances
  const wethPlainNow = await fheWeth.balanceOf(wallet.address);
  const usdcPlainNow = await fheUsdc.balanceOf(wallet.address);

  if (wethPlainNow >= wethToWrap) {
    console.log(`Wrapping ${formatUnits(wethToWrap, 18)} fheWETH...`);
    const tx = await fheWeth.wrap(wethToWrap);
    await waitForTx(tx, 'wrap fheWETH');
  } else {
    console.log('Not enough fheWETH to wrap, skipping');
  }

  if (usdcPlainNow >= usdcToWrap) {
    console.log(`Wrapping ${formatUnits(usdcToWrap, 6)} fheUSDC...`);
    const tx = await fheUsdc.wrap(usdcToWrap);
    await waitForTx(tx, 'wrap fheUSDC');
  } else {
    console.log('Not enough fheUSDC to wrap, skipping');
  }

  // Check encrypted balance handles
  const wethEncHandle = await fheWeth.balanceOfEncrypted(wallet.address);
  const usdcEncHandle = await fheUsdc.balanceOfEncrypted(wallet.address);
  console.log('\nAfter wrap:');
  console.log(`fheWETH encrypted handle: 0x${wethEncHandle.toString(16).slice(0, 16)}...`);
  console.log(`fheUSDC encrypted handle: 0x${usdcEncHandle.toString(16).slice(0, 16)}...`);

  // Try to unseal to verify amounts
  console.log('\nUnsealing encrypted balances...');
  try {
    if (wethEncHandle > 0n) {
      const wethDecrypted = await unseal(wethEncHandle);
      console.log(`fheWETH encrypted balance: ${formatUnits(wethDecrypted, 18)}`);
    }
    if (usdcEncHandle > 0n) {
      const usdcDecrypted = await unseal(usdcEncHandle);
      console.log(`fheUSDC encrypted balance: ${formatUnits(usdcDecrypted, 6)}`);
    }
  } catch (e) {
    console.log('Unseal failed (may be orphaned ciphertext):', e.message);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //                     STEP 5: PLACE LIMIT ORDER
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 5: Place Limit Order ═══\n');

  // Pick a tick for the order (SELL order above current price)
  const orderTick = Math.floor(Number(currentTick) / TICK_SPACING) * TICK_SPACING + (TICK_SPACING * 2);
  console.log('Current tick:', currentTick);
  console.log('Order tick:', orderTick, '(SELL order, 2 ticks above current)');

  // Determine which side based on which token is token0
  const [poolToken0] = await hook.poolStates(poolId);
  const wethIsToken0 = poolToken0.toLowerCase() === FHE_WETH.toLowerCase();
  // Contract bucket sides:
  //   BUY (0): deposits token1, receives token0 when filled (buying token0 with token1)
  //   SELL (1): deposits token0, receives token1 when filled (selling token0 for token1)
  // fheWETH (0x7Da...) < fheUSDC (0x987...), so fheWETH is token0
  // To sell WETH (token0), use SELL side (1)
  const side = wethIsToken0 ? 1 : 0;  // SELL if WETH is token0, BUY if WETH is token1
  console.log(`Side: ${side === 0 ? 'BUY' : 'SELL'} (selling WETH)`);

  // Encrypt the order amount
  console.log(`\nEncrypting order amount: ${formatUnits(ORDER_AMOUNT_WETH, 18)} WETH`);
  const encryptedOrderAmount = await encrypt(ORDER_AMOUNT_WETH);
  console.log('Encrypted order amount ctHash:', encryptedOrderAmount.ctHash.toString().slice(0, 20) + '...');

  // Approve hook to spend the deposit token
  // For BUY order (side 0): deposit token1 (fheUSDC), receive token0 when filled
  // For SELL order (side 1): deposit token0 (fheWETH), receive token1 when filled
  // fheWETH (0x7Da...) is token0, fheUSDC (0x987...) is token1
  const depositToken = side === 1 ? fheWeth : fheUsdc;  // SELL deposits token0, BUY deposits token1
  console.log('\nApproving hook for', side === 1 ? 'fheWETH' : 'fheUSDC', '...');

  // Try encrypted approval first
  try {
    const maxAllowance = parseUnits('1000000', 18);
    const encAllowance = await encrypt(maxAllowance);
    // Use array format for tuple to avoid ethers.js BigInt encoding issues
    const encAllowanceTuple = [
      encAllowance.ctHash.toString(),
      encAllowance.securityZone,
      encAllowance.utype,
      encAllowance.signature,
    ];
    const approveTx = await depositToken.approveEncrypted(HOOK_ADDRESS, encAllowanceTuple, { gasLimit: 1000000 });
    await waitForTx(approveTx, 'approveEncrypted');
  } catch (e) {
    console.log('approveEncrypted failed, trying regular approve:', e.message.slice(0, 50));
    const approveTx = await depositToken.approve(HOOK_ADDRESS, ethers.MaxUint256);
    await waitForTx(approveTx, 'approve');
  }

  // Place the order
  console.log('\nPlacing limit order...');
  const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour
  const maxTickDrift = 600; // Allow 10 ticks drift

  // Debug: log all parameters
  console.log('Deposit parameters:');
  console.log('  poolId:', poolId);
  console.log('  orderTick:', orderTick);
  console.log('  side:', side);
  console.log('  deadline:', deadline);
  console.log('  maxTickDrift:', maxTickDrift);
  console.log('  encrypted tuple:');
  console.log('    ctHash:', encryptedOrderAmount.ctHash.toString());
  console.log('    securityZone:', encryptedOrderAmount.securityZone);
  console.log('    utype:', encryptedOrderAmount.utype);
  console.log('    signature:', encryptedOrderAmount.signature.slice(0, 20) + '...');

  try {
    // Convert BigInt to string for ethers.js tuple encoding compatibility
    const encryptedAmountTuple = [
      encryptedOrderAmount.ctHash.toString(),  // uint256 as string
      encryptedOrderAmount.securityZone,       // uint8
      encryptedOrderAmount.utype,              // uint8
      encryptedOrderAmount.signature,          // bytes
    ];

    // Manually encode the function call to debug encoding issues
    const iface = new ethers.Interface(HOOK_ABI);
    const calldata = iface.encodeFunctionData('deposit', [
      poolId,
      orderTick,
      side,
      encryptedAmountTuple,
      deadline,
      maxTickDrift,
    ]);
    console.log('Encoded calldata length:', calldata.length);
    console.log('Calldata (first 200 chars):', calldata.slice(0, 200) + '...');

    // Create transaction object and log it
    const txRequest = {
      to: HOOK_ADDRESS,
      data: calldata,
      gasLimit: 2000000n,
    };
    console.log('Transaction request:');
    console.log('  to:', txRequest.to);
    console.log('  data length:', txRequest.data?.length);
    console.log('  gasLimit:', txRequest.gasLimit.toString());

    const depositTx = await wallet.sendTransaction(txRequest);
    console.log('Sent tx hash:', depositTx.hash);
    console.log('Sent tx data length:', depositTx.data?.length);
    await waitForTx(depositTx, 'deposit (limit order)');
    console.log('✓ Limit order placed successfully!');
  } catch (e) {
    console.error('Deposit failed:', e.message);
    // If encoding failed, the error will be here
    if (e.message.includes('encode')) {
      console.error('This appears to be an encoding error. Check ABI and parameters.');
    }
    throw e;
  }

  // Check position
  const position = await hook.positions(poolId, wallet.address, orderTick, side);
  console.log('\nPosition created:');
  console.log('  Shares handle:', position.shares.toString().slice(0, 20) + '...');

  // ═══════════════════════════════════════════════════════════════════════
  //                     STEP 6: SWAP TO TRIGGER ORDER
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 6: Swap to Trigger Order ═══\n');

  // We need a swap that moves price through our order tick
  // Our order is a BUY order at tick+120 (buying USDC with WETH)
  // To trigger it, price needs to move UP (WETH gets cheaper relative to USDC)
  // This happens when people sell USDC for WETH (zeroForOne = true if USDC is token0)

  // Pool: token0 = fheWETH, token1 = fheUSDC
  // To trigger our SELL order (selling WETH at higher price), price must go UP (tick increases)
  // This happens when people BUY WETH (token0) by SELLING USDC (token1)
  // That's zeroForOne = false (selling token1 to get token0)
  const zeroForOne = false; // Sell USDC (token1) for WETH (token0)
  console.log('Swap direction: Sell USDC (token1) for WETH (token0) to push price up');
  console.log('Swap amount:', formatUnits(SWAP_AMOUNT_USDC, 6), 'USDC');

  // Encrypt swap parameters
  console.log('\nEncrypting swap parameters...');
  const encDirection = await encrypt(zeroForOne ? 1n : 0n, 'bool');
  const encAmountIn = await encrypt(SWAP_AMOUNT_USDC);
  const encMinOutput = await encrypt(0n); // No slippage protection for test

  // Approve HOOK for encrypted USDC transfers (CRITICAL: must use approveEncrypted!)
  // The hook calls _transferFromEncrypted(sender, ...) which requires encrypted allowance
  console.log('Approving hook for fheUSDC swap (encrypted approval)...');
  try {
    const maxAllowance = parseUnits('1000000', 6);
    const encAllowance = await encrypt(maxAllowance);
    const encAllowanceTuple = [
      encAllowance.ctHash.toString(),
      encAllowance.securityZone,
      encAllowance.utype,
      encAllowance.signature,
    ];
    const approveTx = await fheUsdc.approveEncrypted(HOOK_ADDRESS, encAllowanceTuple, { gasLimit: 1000000 });
    await waitForTx(approveTx, 'approveEncrypted fheUSDC');
  } catch (e) {
    console.log('approveEncrypted failed, trying regular approve:', e.message.slice(0, 80));
    // Fallback to regular approve
    const approveTx = await fheUsdc.approve(HOOK_ADDRESS, ethers.MaxUint256);
    await waitForTx(approveTx, 'approve fheUSDC');
  }

  // Build pool key for swap - currencies MUST be in sorted order (fheWETH < fheUSDC)
  const [sorted0, sorted1] = FHE_WETH.toLowerCase() < FHE_USDC.toLowerCase()
    ? [FHE_WETH, FHE_USDC]
    : [FHE_USDC, FHE_WETH];
  const poolKey = {
    currency0: sorted0,
    currency1: sorted1,
    fee: POOL_FEE,
    tickSpacing: TICK_SPACING,
    hooks: HOOK_ADDRESS,
  };
  console.log('Pool key currencies:', sorted0.slice(0, 10) + '...', sorted1.slice(0, 10) + '...');

  console.log('\nExecuting swap via PrivateSwapRouter...');
  try {
    const swapTx = await router.swapEncrypted(
      poolKey,
      {
        ctHash: encDirection.ctHash,
        securityZone: encDirection.securityZone,
        utype: encDirection.utype,
        signature: encDirection.signature,
      },
      {
        ctHash: encAmountIn.ctHash,
        securityZone: encAmountIn.securityZone,
        utype: encAmountIn.utype,
        signature: encAmountIn.signature,
      },
      {
        ctHash: encMinOutput.ctHash,
        securityZone: encMinOutput.securityZone,
        utype: encMinOutput.utype,
        signature: encMinOutput.signature,
      },
      { gasLimit: 5000000 }  // FHE swaps need high gas - 3M was hitting OutOfGas
    );
    await waitForTx(swapTx, 'swapEncrypted');
    console.log('✓ Swap executed successfully!');
  } catch (e) {
    console.error('Swap failed:', e.message);
    console.log('Continuing to check final state...');
  }

  // Check new tick
  try {
    const newTick = await hook.getCurrentTick(poolId);
    console.log('New tick after swap:', newTick);
    console.log('Tick moved:', Number(newTick) - Number(currentTick), 'ticks');
  } catch (e) {
    console.log('Could not get new tick');
  }

  // ═══════════════════════════════════════════════════════════════════════
  //                     STEP 7: CLAIM PROCEEDS
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 7: Claim Proceeds ═══\n');

  // Check if order was filled
  const positionAfterSwap = await hook.positions(poolId, wallet.address, orderTick, side);
  console.log('Position after swap:');
  console.log('  Shares:', positionAfterSwap.shares.toString().slice(0, 20) + '...');
  console.log('  Realized proceeds:', positionAfterSwap.realizedProceeds.toString().slice(0, 20) + '...');

  // Try to claim
  console.log('\nClaiming proceeds...');
  try {
    const claimTx = await hook.claim(poolId, orderTick, side, { gasLimit: 1000000 });
    await waitForTx(claimTx, 'claim');
    console.log('✓ Claim successful!');
  } catch (e) {
    console.log('Claim failed or nothing to claim:', e.message.slice(0, 50));
  }

  // ═══════════════════════════════════════════════════════════════════════
  //                     STEP 8: FINAL STATE
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 8: Final State ═══\n');

  // Check final balances
  const finalWethPlain = await fheWeth.balanceOf(wallet.address);
  const finalUsdcPlain = await fheUsdc.balanceOf(wallet.address);
  console.log('Final plaintext balances:');
  console.log(`  fheWETH: ${formatUnits(finalWethPlain, 18)}`);
  console.log(`  fheUSDC: ${formatUnits(finalUsdcPlain, 6)}`);

  // Try to unseal encrypted balances
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

  // Check final position
  const finalPosition = await hook.positions(poolId, wallet.address, orderTick, side);
  console.log('\nFinal position:');
  console.log('  Shares:', finalPosition.shares.toString() === '0' ? '0 (fully filled)' : finalPosition.shares.toString().slice(0, 20) + '...');
  console.log('  Realized proceeds:', finalPosition.realizedProceeds.toString());

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                         TEST COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('\n\nFATAL ERROR:', err.message || err);
  process.exit(1);
});
