/**
 * Initialize Missing Pools (E and F) for Arb Sepolia
 *
 * Adds the WETH/fheWETH and USDC/fheUSDC wrap/unwrap pools.
 *
 * Usage: node scripts/init-missing-pools.cjs
 */

const { ethers } = require('ethers');
require('dotenv').config();

// ============ Configuration ============
const ARB_SEPOLIA_RPC = process.env.ARB_SEPOLIA_RPC || 'https://sepolia-rollup.arbitrum.io/rpc';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  throw new Error('PRIVATE_KEY not set in .env');
}

// Deployment addresses from TypeScript deployment
const POOL_MANAGER = '0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317';
const HOOK_ADDRESS = '0xaBDB92FAC44c850D6472f82B8d63Bb52947610C8';

const WETH_ADDRESS = '0xf60eB0df91142e31384851b66022833Be2c08007';
const USDC_ADDRESS = '0x5Ffa3F4620aF4434A662aA89e37775d776604D6E';
const FHE_WETH_ADDRESS = '0xf7dD1ed6f513b22e05645EE8BA3D3A712Cc76128';
const FHE_USDC_ADDRESS = '0x43AcAe0A089f3cd188f9fB0731059Eb7bC27D3Aa';

// Pool configuration
const POOL_FEE = 3000;
const TICK_SPACING = 60;
const SQRT_PRICE_1_1 = BigInt('79228162514264337593543950336');

// ABIs
const PoolManagerABI = [
  'function initialize(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, uint160 sqrtPriceX96) external returns (int24 tick)',
];

function sortTokens(tokenA, tokenB) {
  return tokenA.toLowerCase() < tokenB.toLowerCase()
    ? [tokenA, tokenB]
    : [tokenB, tokenA];
}

function computePoolId(token0, token1, fee, tickSpacing, hooks) {
  const poolKey = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'address', 'uint24', 'int24', 'address'],
    [token0, token1, fee, tickSpacing, hooks]
  );
  return ethers.keccak256(poolKey);
}

async function main() {
  console.log('===========================================');
  console.log('  Initialize Missing Pools E and F');
  console.log('  Arbitrum Sepolia');
  console.log('===========================================\n');

  const provider = new ethers.JsonRpcProvider(ARB_SEPOLIA_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const deployer = await wallet.getAddress();

  console.log('Deployer:', deployer);
  console.log('Hook:', HOOK_ADDRESS);
  console.log('');

  const poolManager = new ethers.Contract(POOL_MANAGER, PoolManagerABI, wallet);

  // Pool E: WETH/fheWETH (wrap/unwrap pair)
  console.log('--- Initializing Pool E (WETH/fheWETH) ---');
  const [token0E, token1E] = sortTokens(WETH_ADDRESS, FHE_WETH_ADDRESS);
  console.log('Token0:', token0E);
  console.log('Token1:', token1E);

  const poolKeyE = {
    currency0: token0E,
    currency1: token1E,
    fee: POOL_FEE,
    tickSpacing: TICK_SPACING,
    hooks: HOOK_ADDRESS,
  };

  try {
    const txE = await poolManager.initialize(poolKeyE, SQRT_PRICE_1_1);
    await txE.wait();
    const poolIdE = computePoolId(token0E, token1E, POOL_FEE, TICK_SPACING, HOOK_ADDRESS);
    console.log('Pool E initialized!');
    console.log('PoolId:', poolIdE);
  } catch (error) {
    if (error.message.includes('already initialized')) {
      console.log('Pool E already initialized, skipping...');
    } else {
      throw error;
    }
  }

  console.log('');

  // Pool F: USDC/fheUSDC (wrap/unwrap pair)
  console.log('--- Initializing Pool F (USDC/fheUSDC) ---');
  const [token0F, token1F] = sortTokens(USDC_ADDRESS, FHE_USDC_ADDRESS);
  console.log('Token0:', token0F);
  console.log('Token1:', token1F);

  const poolKeyF = {
    currency0: token0F,
    currency1: token1F,
    fee: POOL_FEE,
    tickSpacing: TICK_SPACING,
    hooks: HOOK_ADDRESS,
  };

  try {
    const txF = await poolManager.initialize(poolKeyF, SQRT_PRICE_1_1);
    await txF.wait();
    const poolIdF = computePoolId(token0F, token1F, POOL_FEE, TICK_SPACING, HOOK_ADDRESS);
    console.log('Pool F initialized!');
    console.log('PoolId:', poolIdF);
  } catch (error) {
    if (error.message.includes('already initialized')) {
      console.log('Pool F already initialized, skipping...');
    } else {
      throw error;
    }
  }

  console.log('\n===========================================');
  console.log('  Pools E and F Initialized!');
  console.log('===========================================');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
