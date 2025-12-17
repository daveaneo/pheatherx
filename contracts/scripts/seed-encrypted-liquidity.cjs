/**
 * Seed Encrypted Liquidity for FHERC20 Pools
 *
 * This script uses cofhejs to encrypt amounts and call addLiquidityEncrypted
 * Run after deploy-arb-sepolia.ts has deployed the hook and initialized pools.
 *
 * Usage: node scripts/seed-encrypted-liquidity.cjs
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ============ Configuration ============
// Select network: 'eth-sepolia' or 'arb-sepolia'
const NETWORK = process.env.NETWORK || 'eth-sepolia';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  throw new Error('PRIVATE_KEY not set in .env');
}

// Network configurations
const NETWORKS = {
  'eth-sepolia': {
    rpc: process.env.ETH_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com',
    hookAddress: '0x0b56ad0057B88252eACE75f7C066e5778e255088', // v8FHE 2024-12-17 - TickBitmapLib overflow fix
    fheWethAddress: '0xBa1A88cC0FCacF907E55297AC54607E60367019C',
    fheUsdcAddress: '0xDdc7808AD27a1C45fa216DB6292Eb2f359244014',
    poolId: '0x66d85a910b3b6f491f5233d2eb51f2eab72846a0056833d1fcd1c4cdf36dd7a3', // Pool B 2024-12-17
  },
  'arb-sepolia': {
    rpc: process.env.ARB_SEPOLIA_RPC || 'https://sepolia-rollup.arbitrum.io/rpc',
    hookAddress: '0xeF13A37401E1bb43aBED8F0108510eBb91401088', // v8FHE 2024-12-17 - TickBitmapLib overflow fix
    fheWethAddress: '0x7Da141eeA1F3c2dD0cC41915eE0AA19bE545d3e0',
    fheUsdcAddress: '0x987731d456B5996E7414d79474D8aba58d4681DC',
    poolId: '0x92c5e351bf239ffea024d746621c2046854ac042f5b3357b5aa9a67e1d9341de', // Pool B 2024-12-17
  },
};

const config = NETWORKS[NETWORK];
if (!config) {
  throw new Error(`Unknown network: ${NETWORK}. Use 'eth-sepolia' or 'arb-sepolia'`);
}

const { rpc: RPC_URL, hookAddress: HOOK_ADDRESS, fheWethAddress: FHE_WETH_ADDRESS, fheUsdcAddress: FHE_USDC_ADDRESS, poolId: POOL_ID_B } = config;

// Amounts for initial liquidity
const INIT_FHE_WETH_AMOUNT = ethers.parseEther('10');
const INIT_FHE_USDC_AMOUNT = 10000n * 10n ** 6n;

// ABIs
const FhenixFHERC20FaucetABI = [
  'function mint(address to, uint256 amount) external',
  'function mintEncrypted(address to, uint256 amount) external',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function approveEncrypted(address spender, tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) encryptedAmount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
];

// v8FHE hook ABI - addLiquidity and poolStates
// NOTE: v8FHE uses `addLiquidity` (not addLiquidityEncrypted) which directly takes InEuint128 params
const FheatherXv8FHEABI = [
  'function addLiquidity(bytes32 poolId, tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) amount0, tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) amount1) external returns (uint256)',
  // v8FHE poolStates returns: (address token0, address token1, bool initialized, uint256 protocolFeeBps)
  'function poolStates(bytes32 poolId) external view returns (address token0, address token1, bool initialized, uint256 protocolFeeBps)',
];

async function main() {
  console.log('===========================================');
  console.log('  Seed Encrypted Liquidity');
  console.log('  Pool B: fheWETH/fheUSDC (v8FHE)');
  console.log(`  Network: ${NETWORK}`);
  console.log('===========================================\n');

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const deployer = await wallet.getAddress();

  console.log('Deployer:', deployer);
  console.log('Hook:', HOOK_ADDRESS);
  console.log('fheWETH:', FHE_WETH_ADDRESS);
  console.log('fheUSDC:', FHE_USDC_ADDRESS);
  console.log('');

  // Import cofhejs - use the CJS node entry (v0.3.1 API)
  console.log('--- Initializing cofhejs ---');
  const { cofhejs, Encryptable } = require('cofhejs/node');

  // Get chain info
  const network = await provider.getNetwork();
  console.log('Chain ID:', network.chainId.toString());

  const cofheResult = await cofhejs.initializeWithEthers({
    ethersProvider: provider,
    ethersSigner: wallet,
    environment: 'TESTNET',
    generatePermit: true,
  });

  console.log('Init result:', JSON.stringify(cofheResult, null, 2));

  if ('error' in cofheResult && cofheResult.error) {
    console.error('Full error:', cofheResult.error);
    throw new Error(`cofhejs initialization failed: ${cofheResult.error.message || JSON.stringify(cofheResult.error)}`);
  }
  console.log('cofhejs initialized successfully');

  // Get contracts
  const hook = new ethers.Contract(HOOK_ADDRESS, FheatherXv8FHEABI, wallet);
  const fheWeth = new ethers.Contract(FHE_WETH_ADDRESS, FhenixFHERC20FaucetABI, wallet);
  const fheUsdc = new ethers.Contract(FHE_USDC_ADDRESS, FhenixFHERC20FaucetABI, wallet);

  // Check pool state (v8FHE uses poolStates mapping)
  console.log('\n--- Checking Pool B State ---');
  const poolState = await hook.poolStates(POOL_ID_B);
  console.log('Token0:', poolState[0]);
  console.log('Token1:', poolState[1]);
  console.log('Initialized:', poolState[2]);
  console.log('Protocol Fee Bps:', poolState[3].toString());

  if (!poolState[2]) {
    throw new Error('Pool B not initialized! Run DeployV8Complete first.');
  }

  // Sort amounts based on token order
  // In v8 Eth Sepolia: fheWETH (0xa22...) < fheUSDC (0xCa72...) so token0 = fheWETH, token1 = fheUSDC
  const [amt0, amt1] = poolState[0].toLowerCase() === FHE_USDC_ADDRESS.toLowerCase()
    ? [INIT_FHE_USDC_AMOUNT, INIT_FHE_WETH_AMOUNT]
    : [INIT_FHE_WETH_AMOUNT, INIT_FHE_USDC_AMOUNT];

  console.log('\n--- Encrypting Amounts ---');
  console.log('Amount0:', amt0.toString());
  console.log('Amount1:', amt1.toString());

  // Use v0.3.1 API with Encryptable helpers (same as frontend)
  const encResult = await cofhejs.encrypt([
    Encryptable.uint128(amt0),
    Encryptable.uint128(amt1),
  ]);

  if ('error' in encResult && encResult.error) {
    console.error('Encryption failed!');
    console.error('Error:', encResult.error);
    throw new Error(`Encryption failed: ${encResult.error.message || encResult.error}`);
  }

  const encrypted = 'data' in encResult ? encResult.data : encResult;
  const encAmt0 = encrypted[0];
  const encAmt1 = encrypted[1];
  console.log('Encrypted amount0:', encAmt0);
  console.log('Encrypted amount1:', encAmt1);

  // Approve encrypted for FHERC20 tokens
  console.log('\n--- Approving Encrypted Allowances ---');
  // Max uint128 for approval
  const maxU128 = BigInt('340282366920938463463374607431768211455');
  const maxApprovalResult = await cofhejs.encrypt([Encryptable.uint128(maxU128)]);

  if ('error' in maxApprovalResult && maxApprovalResult.error) {
    throw new Error(`Max approval encryption failed: ${maxApprovalResult.error.message || maxApprovalResult.error}`);
  }
  const maxApprovalData = 'data' in maxApprovalResult ? maxApprovalResult.data : maxApprovalResult;
  const maxApproval = maxApprovalData[0];

  const approveTx1 = await fheWeth.approveEncrypted(HOOK_ADDRESS, maxApproval);
  await approveTx1.wait();
  console.log('fheWETH approved');

  const approveTx2 = await fheUsdc.approveEncrypted(HOOK_ADDRESS, maxApproval);
  await approveTx2.wait();
  console.log('fheUSDC approved');

  // Add encrypted liquidity (v8FHE uses `addLiquidity` with InEuint128 params)
  console.log('\n--- Adding Liquidity (Encrypted) ---');
  const addLiqTx = await hook.addLiquidity(POOL_ID_B, encAmt0, encAmt1, {
    gasLimit: 5000000,
  });
  const receipt = await addLiqTx.wait();
  console.log('Transaction hash:', receipt.hash);
  console.log('Gas used:', receipt.gasUsed.toString());

  // Check updated pool state
  console.log('\n--- Updated Pool B State ---');
  const updatedPoolState = await hook.poolStates(POOL_ID_B);
  console.log('Initialized:', updatedPoolState[2]);

  console.log('\n===========================================');
  console.log('  Encrypted Liquidity Added Successfully!');
  console.log('===========================================');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
