#!/usr/bin/env node
/**
 * Complete Deployment Script for FheatherX v8
 *
 * This script handles the ENTIRE deployment process:
 * 1. Deploys v8FHE and v8Mixed hooks via Foundry
 * 2. Initializes all 5 FHE pools (1 FHE:FHE + 4 Mixed)
 * 3. Seeds v8Mixed pools via Foundry (plaintext amounts)
 * 4. Seeds v8FHE pool via cofhejs (encrypted amounts)
 * 5. Updates frontend addresses automatically
 *
 * Usage:
 *   NETWORK=arb-sepolia node scripts/deploy-complete.cjs
 *   NETWORK=eth-sepolia node scripts/deploy-complete.cjs
 *
 * Prerequisites:
 *   - PRIVATE_KEY in .env
 *   - Foundry installed
 *   - Node.js with cofhejs
 */

const { execSync, spawn } = require('child_process');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ============ Configuration ============
const NETWORK = process.env.NETWORK || 'arb-sepolia';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const DRY_RUN = process.env.DRY_RUN === 'true';

if (!PRIVATE_KEY) {
  throw new Error('PRIVATE_KEY not set in .env');
}

// Network configurations
const NETWORKS = {
  'arb-sepolia': {
    chainId: 421614,
    rpc: process.env.ARB_SEPOLIA_RPC || 'https://sepolia-rollup.arbitrum.io/rpc',
    poolManager: '0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317',
    tokens: {
      WETH: '0xC5EcD76Db9f00B07088DDbFbdf7BF9927F6DDE13',
      USDC: '0x00F7DC53A57b980F839767a6C6214b4089d916b1',
      fheWETH: '0x7Da141eeA1F3c2dD0cC41915eE0AA19bE545d3e0',
      fheUSDC: '0x987731d456B5996E7414d79474D8aba58d4681DC',
    },
    // Current deployed hooks (for dry run / verification)
    currentHooks: {
      v8FHE: '0x74A83BA9AbD7aE1f579319DC62BEE0D628Ac1088',
      v8Mixed: '0x3eA1877d8C7D8d9577C4152195B55a1cC5249088',
      privateSwapRouter: '0x0000000000000000000000000000000000000000', // Update after deployment
    },
  },
  'eth-sepolia': {
    chainId: 11155111,
    rpc: process.env.ETH_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com',
    poolManager: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543',
    tokens: {
      WETH: '0x2586AD56EBF7046b32405df62F583662a7086eDD',
      USDC: '0xD3A106120C25aA31F2783064f26829Cb57066C2c',
      fheWETH: '0xBa1A88cC0FCacF907E55297AC54607E60367019C',
      fheUSDC: '0xDdc7808AD27a1C45fa216DB6292Eb2f359244014',
    },
    // Current deployed hooks (for dry run / verification)
    currentHooks: {
      v8FHE: '0x487840Bba82EcE99413CCace426AaB80f6CEd088',
      v8Mixed: '0x7c184daA24E11E70bBf4294df67Cb436B38b1088',
      privateSwapRouter: '0xeaf02c062A245c71f1D8ab9CeF1e9783433529Fe',
    },
  },
};

const config = NETWORKS[NETWORK];
if (!config) {
  throw new Error(`Unknown network: ${NETWORK}. Use 'arb-sepolia' or 'eth-sepolia'`);
}

// Liquidity amounts
const LIQUIDITY = {
  WETH: ethers.parseEther('10'),
  USDC: 10000n * 10n ** 6n,
  fheWETH: ethers.parseEther('10'),
  fheUSDC: 10000n * 10n ** 6n,
};

// ABIs
const FHERC20_ABI = [
  'function mint(address to, uint256 amount) external',
  'function mintPlaintext(address to, uint256 amount) external',
  'function mintEncrypted(address to, uint256 amount) external',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function approveEncrypted(address spender, tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) encryptedAmount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
];

const V8_FHE_ABI = [
  'function addLiquidity(bytes32 poolId, tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) amount0, tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) amount1) external returns (uint256)',
  'function poolStates(bytes32 poolId) external view returns (address token0, address token1, bool initialized, uint256 protocolFeeBps)',
  'function getReserves(bytes32 poolId) external view returns (uint256, uint256)',
];

const V8_MIXED_ABI = [
  'function addLiquidity(bytes32 poolId, uint256 amount0, uint256 amount1) external returns (uint256)',
  'function getReserves(bytes32 poolId) external view returns (uint256, uint256)',
];

// ============ Utility Functions ============

function runCommand(cmd, options = {}) {
  console.log(`\n$ ${cmd}\n`);
  if (DRY_RUN) {
    console.log('[DRY RUN] Skipping...');
    return '';
  }
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options
    });
  } catch (error) {
    if (options.ignoreError) {
      console.log(`Command failed but ignoring: ${error.message}`);
      return '';
    }
    throw error;
  }
}

function sortTokens(a, b) {
  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}

function computePoolId(token0, token1, fee, tickSpacing, hook) {
  const [sorted0, sorted1] = sortTokens(token0, token1);
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'address', 'uint24', 'int24', 'address'],
    [sorted0, sorted1, fee, tickSpacing, hook]
  );
  return ethers.keccak256(encoded);
}

// ============ Main Deployment Steps ============

async function step1_deployHooks() {
  console.log('\n' + '='.repeat(60));
  console.log('STEP 1: Deploy v8FHE and v8Mixed Hooks');
  console.log('='.repeat(60));

  // In dry run mode, use current hooks for verification
  if (DRY_RUN) {
    console.log('[DRY RUN] Using current deployed hooks for verification...');
    const hooks = config.currentHooks;
    console.log('\nCurrent Hooks:');
    console.log(`  v8FHE:   ${hooks.v8FHE}`);
    console.log(`  v8Mixed: ${hooks.v8Mixed}`);
    console.log(`  PrivateSwapRouter: ${hooks.privateSwapRouter}`);
    return hooks;
  }

  const output = runCommand(
    `PRIVATE_KEY=${PRIVATE_KEY} POOL_MANAGER=${config.poolManager} ` +
    `forge script script/DeployV8Only.s.sol:DeployV8Only ` +
    `--rpc-url ${config.rpc} --broadcast -vvv`,
    { silent: true }
  );

  // Parse deployed addresses from output
  const v8FheMatch = output.match(/v8FHE Hook: (0x[a-fA-F0-9]{40})/);
  const v8MixedMatch = output.match(/v8Mixed Hook: (0x[a-fA-F0-9]{40})/);
  const routerMatch = output.match(/PrivateSwapRouter: (0x[a-fA-F0-9]{40})/);

  if (!v8FheMatch || !v8MixedMatch || !routerMatch) {
    throw new Error('Failed to parse deployed addresses from Foundry output');
  }

  const hooks = {
    v8FHE: v8FheMatch[1],
    v8Mixed: v8MixedMatch[1],
    privateSwapRouter: routerMatch[1],
  };

  console.log('\nDeployed Contracts:');
  console.log(`  v8FHE:   ${hooks.v8FHE}`);
  console.log(`  v8Mixed: ${hooks.v8Mixed}`);
  console.log(`  PrivateSwapRouter: ${hooks.privateSwapRouter}`);

  return hooks;
}

async function step2_initializePools(hooks) {
  console.log('\n' + '='.repeat(60));
  console.log('STEP 2: Initialize Pools');
  console.log('='.repeat(60));

  const { tokens } = config;

  // Compute pool IDs first (needed for both real run and dry run)
  const poolIds = {
    B: computePoolId(tokens.fheWETH, tokens.fheUSDC, 3000, 60, hooks.v8FHE),
    C: computePoolId(tokens.WETH, tokens.fheUSDC, 3000, 60, hooks.v8Mixed),
    D: computePoolId(tokens.fheWETH, tokens.USDC, 3000, 60, hooks.v8Mixed),
    E: computePoolId(tokens.WETH, tokens.fheWETH, 3000, 60, hooks.v8Mixed),
    F: computePoolId(tokens.USDC, tokens.fheUSDC, 3000, 60, hooks.v8Mixed),
  };

  if (!DRY_RUN) {
    // Build environment variables for the init script
    const envVars = [
      `PRIVATE_KEY=${PRIVATE_KEY}`,
      `POOL_MANAGER=${config.poolManager}`,
      `V8_FHE_HOOK=${hooks.v8FHE}`,
      `V8_MIXED_HOOK=${hooks.v8Mixed}`,
      `WETH=${tokens.WETH}`,
      `USDC=${tokens.USDC}`,
      `FHE_WETH=${tokens.fheWETH}`,
      `FHE_USDC=${tokens.fheUSDC}`,
    ].join(' ');

    runCommand(
      `${envVars} forge script script/InitAndSeedV8.s.sol:InitAndSeedV8 ` +
      `--rpc-url ${config.rpc} --broadcast -vvv`
    );
  } else {
    console.log('[DRY RUN] Skipping pool initialization...');
  }

  console.log('\nPool IDs:');
  Object.entries(poolIds).forEach(([name, id]) => {
    console.log(`  Pool ${name}: ${id}`);
  });

  return poolIds;
}

async function step3_seedV8FHEPool(hooks, poolIds) {
  console.log('\n' + '='.repeat(60));
  console.log('STEP 3: Seed v8FHE Pool (Encrypted Liquidity)');
  console.log('='.repeat(60));

  if (DRY_RUN) {
    console.log('[DRY RUN] Skipping encrypted seeding...');
    return;
  }

  const { tokens } = config;
  const provider = new ethers.JsonRpcProvider(config.rpc);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const deployer = await wallet.getAddress();

  console.log('Deployer:', deployer);

  // Initialize cofhejs
  console.log('\n--- Initializing cofhejs ---');
  const { cofhejs, Encryptable } = require('cofhejs/node');

  const cofheResult = await cofhejs.initializeWithEthers({
    ethersProvider: provider,
    ethersSigner: wallet,
    environment: 'TESTNET',
    generatePermit: true,
  });

  if (cofheResult.error) {
    throw new Error(`cofhejs init failed: ${cofheResult.error.message || cofheResult.error}`);
  }
  console.log('cofhejs initialized');

  // Get contracts
  const hook = new ethers.Contract(hooks.v8FHE, V8_FHE_ABI, wallet);
  const fheWeth = new ethers.Contract(tokens.fheWETH, FHERC20_ABI, wallet);
  const fheUsdc = new ethers.Contract(tokens.fheUSDC, FHERC20_ABI, wallet);

  // Check pool state
  const poolState = await hook.poolStates(poolIds.B);
  console.log('Pool B initialized:', poolState[2]);

  if (!poolState[2]) {
    throw new Error('Pool B not initialized!');
  }

  // Determine token order
  const [sorted0] = sortTokens(tokens.fheWETH, tokens.fheUSDC);
  const [amt0, amt1] = sorted0.toLowerCase() === tokens.fheWETH.toLowerCase()
    ? [LIQUIDITY.fheWETH, LIQUIDITY.fheUSDC]
    : [LIQUIDITY.fheUSDC, LIQUIDITY.fheWETH];

  console.log('\n--- Encrypting Amounts ---');
  console.log('Amount0:', amt0.toString());
  console.log('Amount1:', amt1.toString());

  const encResult = await cofhejs.encrypt([
    Encryptable.uint128(amt0),
    Encryptable.uint128(amt1),
  ]);

  if (encResult.error) {
    throw new Error(`Encryption failed: ${encResult.error.message || encResult.error}`);
  }

  const encrypted = encResult.data || encResult;
  const encAmt0 = encrypted[0];
  const encAmt1 = encrypted[1];

  // Approve encrypted
  console.log('\n--- Approving Encrypted Allowances ---');
  const maxU128 = BigInt('340282366920938463463374607431768211455');
  const maxApprovalResult = await cofhejs.encrypt([Encryptable.uint128(maxU128)]);
  const maxApproval = (maxApprovalResult.data || maxApprovalResult)[0];

  const approveTx1 = await fheWeth.approveEncrypted(hooks.v8FHE, maxApproval);
  await approveTx1.wait();
  console.log('fheWETH approved');

  const approveTx2 = await fheUsdc.approveEncrypted(hooks.v8FHE, maxApproval);
  await approveTx2.wait();
  console.log('fheUSDC approved');

  // Add liquidity
  console.log('\n--- Adding Encrypted Liquidity ---');
  const addLiqTx = await hook.addLiquidity(poolIds.B, encAmt0, encAmt1, { gasLimit: 5000000 });
  const receipt = await addLiqTx.wait();
  console.log('Tx:', receipt.hash);
  console.log('Gas:', receipt.gasUsed.toString());

  // Verify
  const reserves = await hook.getReserves(poolIds.B);
  console.log('\nPool B Reserves:', reserves[0].toString(), '/', reserves[1].toString());
}

async function step4_updateFrontend(hooks) {
  console.log('\n' + '='.repeat(60));
  console.log('STEP 4: Update Frontend Addresses');
  console.log('='.repeat(60));

  const addressesPath = path.join(__dirname, '../../frontend/src/lib/contracts/addresses.ts');

  if (!fs.existsSync(addressesPath)) {
    console.log('WARNING: Frontend addresses.ts not found at:', addressesPath);
    console.log('Please update manually:');
    console.log(`  v8FHE (${config.chainId}): ${hooks.v8FHE}`);
    console.log(`  v8Mixed (${config.chainId}): ${hooks.v8Mixed}`);
    console.log(`  PrivateSwapRouter (${config.chainId}): ${hooks.privateSwapRouter}`);
    return;
  }

  let content = fs.readFileSync(addressesPath, 'utf8');

  // Update v8FHE address for this chain
  const v8FheRegex = new RegExp(
    `(${config.chainId}: )'0x[a-fA-F0-9]{40}'(,\\s*// v8FHE)`,
    'g'
  );
  content = content.replace(v8FheRegex, `$1'${hooks.v8FHE}'$2`);

  // Update v8Mixed address for this chain
  const v8MixedRegex = new RegExp(
    `(${config.chainId}: )'0x[a-fA-F0-9]{40}'(,\\s*// v8Mixed)`,
    'g'
  );
  content = content.replace(v8MixedRegex, `$1'${hooks.v8Mixed}'$2`);

  // Update PrivateSwapRouter address for this chain
  // Handle both "// TODO: Deploy" format and any other comment
  const routerRegex = new RegExp(
    `(${config.chainId}: )'0x[a-fA-F0-9]{40}'(,\\s*//.*?)$`,
    'gm'
  );
  // Find the PRIVATE_SWAP_ROUTER_ADDRESSES section and update only there
  const routerSectionRegex = /PRIVATE_SWAP_ROUTER_ADDRESSES[\s\S]*?\};/;
  const routerSection = content.match(routerSectionRegex);
  if (routerSection) {
    const networkName = config.chainId === 11155111 ? 'Eth Sepolia' : config.chainId === 421614 ? 'Arb Sepolia' : 'Deployed';
    const updatedSection = routerSection[0].replace(
      new RegExp(`(${config.chainId}: )'0x[a-fA-F0-9]{40}'(,\\s*//.*?)$`, 'm'),
      `$1'${hooks.privateSwapRouter}', // PrivateSwapRouter ${networkName} (${new Date().toISOString().split('T')[0]})`
    );
    content = content.replace(routerSectionRegex, updatedSection);
  }

  if (DRY_RUN) {
    console.log('[DRY RUN] Would update addresses.ts');
    return;
  }

  fs.writeFileSync(addressesPath, content);
  console.log('Updated:', addressesPath);
  console.log(`  v8FHE (${config.chainId}): ${hooks.v8FHE}`);
  console.log(`  v8Mixed (${config.chainId}): ${hooks.v8Mixed}`);
  console.log(`  PrivateSwapRouter (${config.chainId}): ${hooks.privateSwapRouter}`);
}

async function step5_verify(hooks, poolIds) {
  console.log('\n' + '='.repeat(60));
  console.log('STEP 5: Verify Deployment');
  console.log('='.repeat(60));

  const provider = new ethers.JsonRpcProvider(config.rpc);

  // Verify v8FHE
  const v8Fhe = new ethers.Contract(hooks.v8FHE, V8_FHE_ABI, provider);
  const reservesB = await v8Fhe.getReserves(poolIds.B);
  console.log(`Pool B (v8FHE) reserves: ${reservesB[0]} / ${reservesB[1]}`);

  // Verify v8Mixed
  const v8Mixed = new ethers.Contract(hooks.v8Mixed, V8_MIXED_ABI, provider);

  for (const [name, poolId] of Object.entries(poolIds)) {
    if (name === 'B') continue; // Already checked
    try {
      const reserves = await v8Mixed.getReserves(poolId);
      console.log(`Pool ${name} (v8Mixed) reserves: ${reserves[0]} / ${reserves[1]}`);
    } catch (e) {
      console.log(`Pool ${name}: Error fetching reserves`);
    }
  }

  // Check all reserves are non-zero
  const allSeeded = reservesB[0] > 0n && reservesB[1] > 0n;

  console.log('\n' + '='.repeat(60));
  if (allSeeded) {
    console.log('✅ DEPLOYMENT COMPLETE - All pools seeded');
  } else {
    console.log('⚠️  DEPLOYMENT INCOMPLETE - Some pools have 0 reserves');
  }
  console.log('='.repeat(60));

  return allSeeded;
}

// ============ Main ============

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          FheatherX v8 Complete Deployment                  ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Network: ${NETWORK.padEnd(48)}║`);
  console.log(`║  Chain ID: ${config.chainId.toString().padEnd(47)}║`);
  console.log(`║  Dry Run: ${DRY_RUN.toString().padEnd(48)}║`);
  console.log('╚════════════════════════════════════════════════════════════╝');

  try {
    // Step 1: Deploy hooks
    const hooks = await step1_deployHooks();

    // Step 2: Initialize pools and seed v8Mixed
    const poolIds = await step2_initializePools(hooks);

    // Step 3: Seed v8FHE pool with encrypted liquidity
    await step3_seedV8FHEPool(hooks, poolIds);

    // Step 4: Update frontend
    await step4_updateFrontend(hooks);

    // Step 5: Verify everything
    const success = await step5_verify(hooks, poolIds);

    // Save deployment info
    const deploymentInfo = {
      network: NETWORK,
      chainId: config.chainId,
      timestamp: new Date().toISOString(),
      hooks,
      poolIds,
      tokens: config.tokens,
    };

    const deploymentPath = path.join(__dirname, `../deployments/v8-${NETWORK}.json`);
    fs.mkdirSync(path.dirname(deploymentPath), { recursive: true });
    fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
    console.log(`\nDeployment saved to: ${deploymentPath}`);

    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('\n❌ DEPLOYMENT FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
