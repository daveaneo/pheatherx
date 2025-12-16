/**
 * TypeScript Deployment Script for FheatherXv6 on Arbitrum Sepolia
 *
 * Uses cofhejs for proper encrypted liquidity seeding.
 *
 * Run with: npx ts-node scripts/deploy-arb-sepolia.ts
 * Or: npx tsx scripts/deploy-arb-sepolia.ts
 */

import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ============ Configuration ============
const ARB_SEPOLIA_RPC = process.env.ARB_SEPOLIA_RPC || 'https://sepolia-rollup.arbitrum.io/rpc';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  throw new Error('PRIVATE_KEY not set in .env');
}

// Uniswap v4 Arbitrum Sepolia addresses
const POOL_MANAGER = '0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317';
const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';

// Deployment config
const SWAP_FEE_BPS = 30n; // 0.3%
const POOL_FEE = 3000; // 0.3% for Uniswap V4
const TICK_SPACING = 60;
const SQRT_PRICE_1_1 = 79228162514264337593543950336n;

// Initial liquidity amounts
const INIT_WETH_AMOUNT = ethers.parseEther('10');
const INIT_USDC_AMOUNT = 10_000n * 10n ** 6n;
const INIT_FHE_WETH_AMOUNT = ethers.parseEther('10');
const INIT_FHE_USDC_AMOUNT = 10_000n * 10n ** 6n;

// ============ ABIs ============
// Minimal ABIs for deployment

const FaucetTokenABI = [
  'constructor(string name, string symbol, uint8 decimals)',
  'function mint(address to, uint256 amount) external',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
];

const FhenixFHERC20FaucetABI = [
  'constructor(string name, string symbol, uint8 decimals)',
  'function mint(address to, uint256 amount) external',
  'function mintEncrypted(address to, uint256 amount) external',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function approveEncrypted(address spender, tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) encryptedAmount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function balanceOfEncrypted(address account) external view returns (uint256)',
];

const FheatherXv6ABI = [
  'constructor(address poolManager, address owner, uint256 swapFeeBps)',
  'function addLiquidity(bytes32 poolId, uint256 amount0, uint256 amount1) external returns (uint256)',
  'function addLiquidityEncrypted(bytes32 poolId, tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) amount0, tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) amount1) external returns (uint256)',
  'function setDefaultPool(bytes32 poolId) external',
  'function getPoolState(bytes32 poolId) external view returns (address token0, address token1, bool initialized, int24 currentTick, uint256 reserve0, uint256 reserve1, uint256 encReserve0Handle, uint256 encReserve1Handle, bool token0IsFherc20, bool token1IsFherc20, uint256 totalLpShares)',
];

const PoolManagerABI = [
  'function initialize(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, uint160 sqrtPriceX96) external returns (int24 tick)',
];

// ============ Helper Functions ============

function sortTokens(tokenA: string, tokenB: string): [string, string] {
  return tokenA.toLowerCase() < tokenB.toLowerCase()
    ? [tokenA, tokenB]
    : [tokenB, tokenA];
}

function computePoolId(token0: string, token1: string, fee: number, tickSpacing: number, hooks: string): string {
  // PoolKey structure and ID computation
  const poolKey = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'address', 'uint24', 'int24', 'address'],
    [token0, token1, fee, tickSpacing, hooks]
  );
  return ethers.keccak256(poolKey);
}

async function loadBytecode(contractName: string): Promise<string> {
  const artifactPath = path.join(__dirname, '..', 'out', `${contractName}.sol`, `${contractName}.json`);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
  return artifact.bytecode.object;
}

// ============ Main Deployment ============

async function main() {
  console.log('===========================================');
  console.log('  FheatherXv6 TypeScript Deployment');
  console.log('  Arbitrum Sepolia (Chain ID: 421614)');
  console.log('===========================================\n');

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(ARB_SEPOLIA_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY!, provider);
  const deployer = await wallet.getAddress();

  console.log('Deployer:', deployer);
  console.log('Pool Manager:', POOL_MANAGER);
  console.log('');

  // ============ Step 1: Deploy Faucet Tokens ============
  console.log('--- Step 1: Deploying Faucet Tokens ---');

  // Load bytecodes
  const faucetTokenBytecode = await loadBytecode('FaucetToken');
  const fhenixFherc20Bytecode = await loadBytecode('FhenixFHERC20Faucet');

  // Deploy WETH
  const wethFactory = new ethers.ContractFactory(FaucetTokenABI, faucetTokenBytecode, wallet);
  const weth = await wethFactory.deploy('Wrapped Ether', 'WETH', 18);
  await weth.waitForDeployment();
  const wethAddress = await weth.getAddress();
  console.log('WETH deployed at:', wethAddress);

  // Deploy USDC
  const usdcFactory = new ethers.ContractFactory(FaucetTokenABI, faucetTokenBytecode, wallet);
  const usdc = await usdcFactory.deploy('USD Coin', 'USDC', 6);
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log('USDC deployed at:', usdcAddress);

  // Deploy fheWETH
  const fheWethFactory = new ethers.ContractFactory(FhenixFHERC20FaucetABI, fhenixFherc20Bytecode, wallet);
  const fheWeth = await fheWethFactory.deploy('FHE Wrapped Ether', 'fheWETH', 18);
  await fheWeth.waitForDeployment();
  const fheWethAddress = await fheWeth.getAddress();
  console.log('fheWETH deployed at:', fheWethAddress);

  // Deploy fheUSDC
  const fheUsdcFactory = new ethers.ContractFactory(FhenixFHERC20FaucetABI, fhenixFherc20Bytecode, wallet);
  const fheUsdc = await fheUsdcFactory.deploy('FHE USD Coin', 'fheUSDC', 6);
  await fheUsdc.waitForDeployment();
  const fheUsdcAddress = await fheUsdc.getAddress();
  console.log('fheUSDC deployed at:', fheUsdcAddress);

  // Mint initial supply to deployer (plaintext for ERC20, will use encrypted for FHERC20 pools)
  const wethMint = ethers.parseEther('1000');
  const usdcMint = 1_000_000n * 10n ** 6n;

  await (await (weth as any).mint(deployer, wethMint)).wait();
  await (await (usdc as any).mint(deployer, usdcMint)).wait();
  // For FHERC20, mint to encrypted balance
  await (await (fheWeth as any).mintEncrypted(deployer, wethMint)).wait();
  await (await (fheUsdc as any).mintEncrypted(deployer, usdcMint)).wait();
  console.log('Minted initial supply to deployer\n');

  // ============ Step 2: Deploy Hook using CREATE2 ============
  console.log('--- Step 2: Deploying FheatherXv6 Hook ---');

  // Hook flags required (from Uniswap v4-core Hooks.sol)
  const AFTER_INITIALIZE_FLAG = 1 << 12;  // 4096
  const BEFORE_SWAP_FLAG = 1 << 7;         // 128
  const AFTER_SWAP_FLAG = 1 << 6;          // 64
  const BEFORE_SWAP_RETURNS_DELTA_FLAG = 1 << 3; // 8
  const flags = AFTER_INITIALIZE_FLAG | BEFORE_SWAP_FLAG | AFTER_SWAP_FLAG | BEFORE_SWAP_RETURNS_DELTA_FLAG; // 4296

  console.log('Required flags:', flags);

  // Load hook bytecode
  const hookBytecode = await loadBytecode('FheatherXv6');
  const constructorArgs = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'address', 'uint256'],
    [POOL_MANAGER, deployer, SWAP_FEE_BPS]
  );
  const initCode = hookBytecode + constructorArgs.slice(2);
  const initCodeHash = ethers.keccak256(initCode);

  // Mine for a valid hook address
  console.log('Mining valid hook address...');
  let salt = 0n;
  let hookAddress = '';
  const maxIterations = 100000;

  for (let i = 0; i < maxIterations; i++) {
    const saltBytes = ethers.zeroPadValue(ethers.toBeHex(salt), 32);
    const computedAddress = ethers.getCreate2Address(CREATE2_DEPLOYER, saltBytes, initCodeHash);

    // Check if address has correct flags (last 2 bytes)
    const addressNum = BigInt(computedAddress);
    if ((addressNum & BigInt(0xFFFF)) === BigInt(flags)) {
      hookAddress = computedAddress;
      console.log('Found valid address:', hookAddress);
      console.log('Salt:', saltBytes);
      break;
    }
    salt++;
  }

  if (!hookAddress) {
    throw new Error('Could not find valid hook address');
  }

  // Deploy via CREATE2
  const saltBytes = ethers.zeroPadValue(ethers.toBeHex(salt), 32);
  const deployData = saltBytes + initCode.slice(2);

  const deployTx = await wallet.sendTransaction({
    to: CREATE2_DEPLOYER,
    data: deployData,
  });
  await deployTx.wait();

  // Verify deployment
  const code = await provider.getCode(hookAddress);
  if (code === '0x') {
    throw new Error('Hook deployment failed');
  }
  console.log('Hook deployed at:', hookAddress);
  console.log('');

  // ============ Step 3: Initialize Pools ============
  console.log('--- Step 3: Initializing Pools ---');

  const poolManager = new ethers.Contract(POOL_MANAGER, PoolManagerABI, wallet);

  // Pool A: WETH/USDC (ERC20:ERC20)
  const [token0A, token1A] = sortTokens(wethAddress, usdcAddress);
  const poolKeyA = {
    currency0: token0A,
    currency1: token1A,
    fee: POOL_FEE,
    tickSpacing: TICK_SPACING,
    hooks: hookAddress,
  };
  await (await poolManager.initialize(poolKeyA, SQRT_PRICE_1_1)).wait();
  const poolIdA = computePoolId(token0A, token1A, POOL_FEE, TICK_SPACING, hookAddress);
  console.log('Pool A (WETH/USDC) initialized');
  console.log('  PoolId:', poolIdA);

  // Pool B: fheWETH/fheUSDC (FHERC20:FHERC20)
  const [token0B, token1B] = sortTokens(fheWethAddress, fheUsdcAddress);
  const poolKeyB = {
    currency0: token0B,
    currency1: token1B,
    fee: POOL_FEE,
    tickSpacing: TICK_SPACING,
    hooks: hookAddress,
  };
  await (await poolManager.initialize(poolKeyB, SQRT_PRICE_1_1)).wait();
  const poolIdB = computePoolId(token0B, token1B, POOL_FEE, TICK_SPACING, hookAddress);
  console.log('Pool B (fheWETH/fheUSDC) initialized');
  console.log('  PoolId:', poolIdB);

  // Pool C: WETH/fheUSDC (ERC20:FHERC20)
  const [token0C, token1C] = sortTokens(wethAddress, fheUsdcAddress);
  const poolKeyC = {
    currency0: token0C,
    currency1: token1C,
    fee: POOL_FEE,
    tickSpacing: TICK_SPACING,
    hooks: hookAddress,
  };
  await (await poolManager.initialize(poolKeyC, SQRT_PRICE_1_1)).wait();
  const poolIdC = computePoolId(token0C, token1C, POOL_FEE, TICK_SPACING, hookAddress);
  console.log('Pool C (WETH/fheUSDC) initialized');
  console.log('  PoolId:', poolIdC);

  // Pool D: fheWETH/USDC (FHERC20:ERC20)
  const [token0D, token1D] = sortTokens(fheWethAddress, usdcAddress);
  const poolKeyD = {
    currency0: token0D,
    currency1: token1D,
    fee: POOL_FEE,
    tickSpacing: TICK_SPACING,
    hooks: hookAddress,
  };
  await (await poolManager.initialize(poolKeyD, SQRT_PRICE_1_1)).wait();
  const poolIdD = computePoolId(token0D, token1D, POOL_FEE, TICK_SPACING, hookAddress);
  console.log('Pool D (fheWETH/USDC) initialized');
  console.log('  PoolId:', poolIdD);
  console.log('');

  // ============ Step 4: Seed Liquidity ============
  console.log('--- Step 4: Seeding Initial Liquidity ---');

  const hook = new ethers.Contract(hookAddress, FheatherXv6ABI, wallet);

  // Approve tokens for hook
  await (await (weth as any).approve(hookAddress, ethers.MaxUint256)).wait();
  await (await (usdc as any).approve(hookAddress, ethers.MaxUint256)).wait();
  await (await (fheWeth as any).approve(hookAddress, ethers.MaxUint256)).wait();
  await (await (fheUsdc as any).approve(hookAddress, ethers.MaxUint256)).wait();
  console.log('Approved hook for all tokens');

  // Add liquidity to Pool A (WETH/USDC) - plaintext
  const [amt0A, amt1A] = token0A === wethAddress
    ? [INIT_WETH_AMOUNT, INIT_USDC_AMOUNT]
    : [INIT_USDC_AMOUNT, INIT_WETH_AMOUNT];
  await (await hook.addLiquidity(poolIdA, amt0A, amt1A)).wait();
  console.log('Added liquidity to Pool A (WETH/USDC)');

  // For Pool B (fheWETH/fheUSDC) - need encrypted liquidity via cofhejs
  console.log('');
  console.log('--- Setting up cofhejs for encrypted liquidity ---');

  const { cofhejs } = await import('cofhejs/node');

  // Initialize cofhejs with our wallet
  const cofheResult = await cofhejs.initializeWithEthers({
    ethersProvider: provider,
    ethersSigner: wallet,
    environment: 'TESTNET',
    generatePermit: true,
  });

  if (!cofheResult.success) {
    throw new Error(`cofhejs initialization failed: ${cofheResult.error}`);
  }

  console.log('cofhejs initialized');

  // Encrypt amounts for Pool B
  const [amt0B, amt1B] = token0B === fheWethAddress
    ? [INIT_FHE_WETH_AMOUNT, INIT_FHE_USDC_AMOUNT]
    : [INIT_FHE_USDC_AMOUNT, INIT_FHE_WETH_AMOUNT];

  console.log('Encrypting liquidity amounts...');
  const encAmt0B = await cofhejs.encrypt(amt0B, { type: 'euint128' });
  const encAmt1B = await cofhejs.encrypt(amt1B, { type: 'euint128' });

  // Approve encrypted for FHERC20 tokens
  console.log('Approving encrypted allowances...');
  const fheWethContract = new ethers.Contract(fheWethAddress, FhenixFHERC20FaucetABI, wallet);
  const fheUsdcContract = new ethers.Contract(fheUsdcAddress, FhenixFHERC20FaucetABI, wallet);

  // Need to encrypt max approval amounts
  const maxApproval = await cofhejs.encrypt(ethers.MaxUint256, { type: 'euint128' });
  await (await fheWethContract.approveEncrypted(hookAddress, maxApproval)).wait();
  await (await fheUsdcContract.approveEncrypted(hookAddress, maxApproval)).wait();

  // Add encrypted liquidity to Pool B
  await (await hook.addLiquidityEncrypted(poolIdB, encAmt0B, encAmt1B)).wait();
  console.log('Added encrypted liquidity to Pool B (fheWETH/fheUSDC)');

  // Pool C and D are mixed - for now use plaintext path
  // (The hook handles FHERC20 detection and wraps internally if needed)
  const [amt0C, amt1C] = token0C === wethAddress
    ? [INIT_WETH_AMOUNT, INIT_FHE_USDC_AMOUNT]
    : [INIT_FHE_USDC_AMOUNT, INIT_WETH_AMOUNT];
  await (await hook.addLiquidity(poolIdC, amt0C, amt1C)).wait();
  console.log('Added liquidity to Pool C (WETH/fheUSDC)');

  const [amt0D, amt1D] = token0D === fheWethAddress
    ? [INIT_FHE_WETH_AMOUNT, INIT_USDC_AMOUNT]
    : [INIT_USDC_AMOUNT, INIT_FHE_WETH_AMOUNT];
  await (await hook.addLiquidity(poolIdD, amt0D, amt1D)).wait();
  console.log('Added liquidity to Pool D (fheWETH/USDC)');

  // Set default pool
  await (await hook.setDefaultPool(poolIdA)).wait();
  console.log('Set default pool to Pool A\n');

  // ============ Step 5: Save Deployment ============
  const deployment = {
    version: 'v6',
    network: 'arb-sepolia',
    chainId: 421614,
    deployedAt: Math.floor(Date.now() / 1000).toString(),
    contracts: {
      hook: hookAddress,
      poolManager: POOL_MANAGER,
    },
    tokens: {
      WETH: { address: wethAddress, decimals: 18, type: 'ERC20' },
      USDC: { address: usdcAddress, decimals: 6, type: 'ERC20' },
      fheWETH: { address: fheWethAddress, decimals: 18, type: 'FHERC20' },
      fheUSDC: { address: fheUsdcAddress, decimals: 6, type: 'FHERC20' },
    },
    pools: {
      WETH_USDC: { poolId: poolIdA, token0: token0A, token1: token1A, type: 'ERC:ERC' },
      fheWETH_fheUSDC: { poolId: poolIdB, token0: token0B, token1: token1B, type: 'FHE:FHE' },
      WETH_fheUSDC: { poolId: poolIdC, token0: token0C, token1: token1C, type: 'ERC:FHE' },
      fheWETH_USDC: { poolId: poolIdD, token0: token0D, token1: token1D, type: 'FHE:ERC' },
    },
  };

  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(deploymentsDir, 'v6-arb-sepolia.json'),
    JSON.stringify(deployment, null, 2)
  );

  console.log('===========================================');
  console.log('  DEPLOYMENT COMPLETE - FheatherXv6');
  console.log('  Arbitrum Sepolia');
  console.log('===========================================\n');
  console.log('Hook:', hookAddress);
  console.log('WETH:', wethAddress);
  console.log('USDC:', usdcAddress);
  console.log('fheWETH:', fheWethAddress);
  console.log('fheUSDC:', fheUsdcAddress);
  console.log('\nDeployment saved to: deployments/v6-arb-sepolia.json');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
