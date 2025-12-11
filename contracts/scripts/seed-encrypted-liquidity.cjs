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
const ARB_SEPOLIA_RPC = process.env.ARB_SEPOLIA_RPC || 'https://sepolia-rollup.arbitrum.io/rpc';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  throw new Error('PRIVATE_KEY not set in .env');
}

// Latest deployment addresses (update these after running deploy-arb-sepolia.ts)
const HOOK_ADDRESS = '0xaBDB92FAC44c850D6472f82B8d63Bb52947610C8';
const FHE_WETH_ADDRESS = '0xf7dD1ed6f513b22e05645EE8BA3D3A712Cc76128';
const FHE_USDC_ADDRESS = '0x43AcAe0A089f3cd188f9fB0731059Eb7bC27D3Aa';

// Pool B (fheWETH/fheUSDC) pool ID
const POOL_ID_B = '0xa14757f1f8704af7e013af1fe0adc201edd591d977449d66c2a903aa481caa8e';

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

const FheatherXv6ABI = [
  'function addLiquidityEncrypted(bytes32 poolId, tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) amount0, tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) amount1) external returns (uint256)',
  'function getPoolState(bytes32 poolId) external view returns (address token0, address token1, bool token0IsFherc20, bool token1IsFherc20, bool initialized, uint256 maxBucketsPerSwap, uint256 protocolFeeBps)',
];

async function main() {
  console.log('===========================================');
  console.log('  Seed Encrypted Liquidity');
  console.log('  Pool B: fheWETH/fheUSDC');
  console.log('===========================================\n');

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(ARB_SEPOLIA_RPC);
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
  const hook = new ethers.Contract(HOOK_ADDRESS, FheatherXv6ABI, wallet);
  const fheWeth = new ethers.Contract(FHE_WETH_ADDRESS, FhenixFHERC20FaucetABI, wallet);
  const fheUsdc = new ethers.Contract(FHE_USDC_ADDRESS, FhenixFHERC20FaucetABI, wallet);

  // Check pool state
  console.log('\n--- Checking Pool B State ---');
  const poolState = await hook.getPoolState(POOL_ID_B);
  console.log('Token0:', poolState[0]);
  console.log('Token1:', poolState[1]);
  console.log('token0IsFherc20:', poolState[2]);
  console.log('token1IsFherc20:', poolState[3]);
  console.log('Initialized:', poolState[4]);

  // Sort amounts based on token order
  // fheUSDC (0x43AcA...) < fheWETH (0xf7dD1...) so token0 = fheUSDC, token1 = fheWETH
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

  // Add encrypted liquidity
  console.log('\n--- Adding Encrypted Liquidity ---');
  const addLiqTx = await hook.addLiquidityEncrypted(POOL_ID_B, encAmt0, encAmt1, {
    gasLimit: 5000000,
  });
  const receipt = await addLiqTx.wait();
  console.log('Transaction hash:', receipt.hash);
  console.log('Gas used:', receipt.gasUsed.toString());

  // Check updated pool state
  console.log('\n--- Updated Pool B State ---');
  console.log('Initialized:', poolState[4]);

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
