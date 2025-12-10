#!/usr/bin/env npx tsx
/**
 * Direct swap test script - bypasses frontend wagmi, uses viem directly
 * This gives us full error visibility and control
 *
 * Usage: npx tsx scripts/test-swap.ts
 */

import { createPublicClient, createWalletClient, http, formatUnits, parseUnits, erc20Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

// Configuration
const RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com';
const HOOK_ADDRESS = '0x1e2F7C494fe1C34dD7Bc8E389eF4e922288c90C8' as const;
const WETH_ADDRESS = '0xe9Df64F549Eb1d2778909F339B9Bd795d14cF32E' as const;
const USDC_ADDRESS = '0xF7Ff2A5E74eaA6E0463358BB26780049d3D45C56' as const;

// Test wallet - use your test wallet private key
// WARNING: Never use a wallet with real funds!
const PRIVATE_KEY = process.env.TEST_PRIVATE_KEY as `0x${string}`;

if (!PRIVATE_KEY) {
  console.error('ERROR: Set TEST_PRIVATE_KEY environment variable');
  console.error('Example: TEST_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 npx tsx scripts/test-swap.ts');
  process.exit(1);
}

// FheatherXv6 ABI (minimal for swap)
const HOOK_ABI = [
  {
    name: 'swap',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'minAmountOut', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    name: 'getQuote',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountIn', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    name: 'getPoolReserves',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [
      { name: 'reserve0', type: 'uint256' },
      { name: 'reserve1', type: 'uint256' },
      { name: 'lpSupply', type: 'uint256' },
    ],
  },
  {
    name: 'defaultPoolId',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
] as const;

async function main() {
  console.log('=== FheatherX v6 Direct Swap Test ===\n');

  // Create clients
  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log('Wallet Address:', account.address);

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(RPC_URL),
  });

  // Check wallet ETH balance
  const ethBalance = await publicClient.getBalance({ address: account.address });
  console.log('ETH Balance:', formatUnits(ethBalance, 18), 'ETH');

  if (ethBalance < parseUnits('0.01', 18)) {
    console.error('ERROR: Not enough ETH for gas. Need at least 0.01 ETH');
    process.exit(1);
  }

  // Check WETH balance
  const wethBalance = await publicClient.readContract({
    address: WETH_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  });
  console.log('WETH Balance:', formatUnits(wethBalance, 18), 'WETH');

  // Check USDC balance
  const usdcBalance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  });
  console.log('USDC Balance:', formatUnits(usdcBalance, 6), 'USDC');

  // Get default pool ID
  console.log('\n--- Pool Info ---');
  const poolId = await publicClient.readContract({
    address: HOOK_ADDRESS,
    abi: HOOK_ABI,
    functionName: 'defaultPoolId',
  });
  console.log('Default Pool ID:', poolId);

  // Get pool reserves
  const [reserve0, reserve1, lpSupply] = await publicClient.readContract({
    address: HOOK_ADDRESS,
    abi: HOOK_ABI,
    functionName: 'getPoolReserves',
    args: [poolId],
  });
  console.log('Reserve0 (WETH):', formatUnits(reserve0, 18));
  console.log('Reserve1 (USDC):', formatUnits(reserve1, 6));
  console.log('LP Supply:', formatUnits(lpSupply, 18));

  // Swap parameters
  const swapAmountIn = parseUnits('0.01', 18); // 0.01 WETH
  const zeroForOne = true; // WETH -> USDC

  // Get quote
  console.log('\n--- Getting Quote ---');
  console.log('Swap Amount In:', formatUnits(swapAmountIn, 18), 'WETH');

  try {
    const quoteOut = await publicClient.readContract({
      address: HOOK_ADDRESS,
      abi: HOOK_ABI,
      functionName: 'getQuote',
      args: [zeroForOne, swapAmountIn],
    });
    console.log('Quote Amount Out:', formatUnits(quoteOut, 6), 'USDC');

    // Set minAmountOut with 1% slippage
    const minAmountOut = (quoteOut * 99n) / 100n;
    console.log('Min Amount Out (1% slippage):', formatUnits(minAmountOut, 6), 'USDC');

    // Check if we have enough WETH
    if (wethBalance < swapAmountIn) {
      console.error('\nERROR: Insufficient WETH balance for swap');
      console.log('Need to mint WETH first. Call faucet() on WETH contract.');
      process.exit(1);
    }

    // Check and do approval
    console.log('\n--- Checking Approval ---');
    const allowance = await publicClient.readContract({
      address: WETH_ADDRESS,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account.address, HOOK_ADDRESS],
    });
    console.log('Current Allowance:', formatUnits(allowance, 18), 'WETH');

    if (allowance < swapAmountIn) {
      console.log('Approving WETH for hook...');
      const approveHash = await walletClient.writeContract({
        address: WETH_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [HOOK_ADDRESS, swapAmountIn * 10n], // Approve 10x for future swaps
      });
      console.log('Approval TX:', approveHash);

      const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
      console.log('Approval Status:', approveReceipt.status === 'success' ? 'SUCCESS' : 'FAILED');

      if (approveReceipt.status !== 'success') {
        console.error('Approval failed!');
        process.exit(1);
      }
    } else {
      console.log('Allowance sufficient, skipping approval');
    }

    // Execute swap
    console.log('\n--- Executing Swap ---');
    console.log('Calling swap(zeroForOne=true, amountIn=' + swapAmountIn + ', minAmountOut=' + minAmountOut + ')');

    try {
      // First simulate the transaction
      console.log('Simulating transaction...');
      const { request } = await publicClient.simulateContract({
        account,
        address: HOOK_ADDRESS,
        abi: HOOK_ABI,
        functionName: 'swap',
        args: [zeroForOne, swapAmountIn, minAmountOut],
      });
      console.log('Simulation successful!');

      // Execute the swap
      const swapHash = await walletClient.writeContract(request);
      console.log('Swap TX Hash:', swapHash);

      console.log('Waiting for confirmation...');
      const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
      console.log('Swap Status:', swapReceipt.status === 'success' ? 'SUCCESS' : 'FAILED');
      console.log('Gas Used:', swapReceipt.gasUsed.toString());

      if (swapReceipt.status === 'success') {
        // Check new balances
        const newWethBalance = await publicClient.readContract({
          address: WETH_ADDRESS,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [account.address],
        });
        const newUsdcBalance = await publicClient.readContract({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [account.address],
        });

        console.log('\n--- Final Balances ---');
        console.log('WETH:', formatUnits(newWethBalance, 18), '(was:', formatUnits(wethBalance, 18) + ')');
        console.log('USDC:', formatUnits(newUsdcBalance, 6), '(was:', formatUnits(usdcBalance, 6) + ')');
        console.log('\nSWAP SUCCESSFUL!');
      }
    } catch (swapError: any) {
      console.error('\n=== SWAP FAILED ===');
      console.error('Error Type:', swapError.name);
      console.error('Error Message:', swapError.message);

      if (swapError.cause) {
        console.error('Cause:', swapError.cause);
      }

      if (swapError.shortMessage) {
        console.error('Short Message:', swapError.shortMessage);
      }

      // Try to decode revert reason
      if (swapError.data) {
        console.error('Revert Data:', swapError.data);
      }

      // Log full error for debugging
      console.error('\nFull Error:', JSON.stringify(swapError, null, 2));
    }
  } catch (quoteError: any) {
    console.error('Quote failed:', quoteError.message);
    process.exit(1);
  }
}

main().catch(console.error);
