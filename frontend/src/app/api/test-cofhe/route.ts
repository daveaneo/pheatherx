/**
 * Server-side API route for testing cofhejs initialization
 * This runs in Node.js where cofhejs/node works correctly
 */

import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';

const RPC_URLS: Record<number, string> = {
  11155111: 'https://ethereum-sepolia-rpc.publicnode.com',
  421614: 'https://sepolia-rollup.arbitrum.io/rpc',
};

const CHAIN_NAMES: Record<number, string> = {
  11155111: 'Ethereum Sepolia',
  421614: 'Arbitrum Sepolia',
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { chainId, variation = 1 } = body;

    if (!chainId || !RPC_URLS[chainId]) {
      return NextResponse.json(
        { success: false, error: `Unsupported chain ID: ${chainId}` },
        { status: 400 }
      );
    }

    const rpcUrl = RPC_URLS[chainId];
    const chainName = CHAIN_NAMES[chainId];

    // Create a random wallet for testing
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = ethers.Wallet.createRandom().connect(provider);

    // Load cofhejs/node (works in Node.js)
    const { cofhejs } = await import('cofhejs/node');

    // Build options based on variation
    const baseOptions = {
      ethersProvider: provider,
      ethersSigner: wallet,
    };

    const variations: Record<number, { name: string; options: any }> = {
      1: {
        name: 'env + generatePermit',
        options: { ...baseOptions, environment: 'TESTNET', generatePermit: true },
      },
      2: {
        name: 'env only',
        options: { ...baseOptions, environment: 'TESTNET' },
      },
      3: {
        name: 'permit only',
        options: { ...baseOptions, generatePermit: true },
      },
      4: {
        name: 'minimal',
        options: baseOptions,
      },
    };

    const v = variations[variation] || variations[1];

    const startTime = Date.now();
    const result = await cofhejs.initializeWithEthers(v.options);
    const elapsed = Date.now() - startTime;

    if (result.success) {
      return NextResponse.json({
        success: true,
        chainId,
        chainName,
        variation: v.name,
        elapsed,
        wallet: wallet.address,
        data: {
          // Don't expose private keys, just confirmation it worked
          issuer: result.data.issuer,
          chainId: result.data._signedDomain?.chainId,
          verifyingContract: result.data._signedDomain?.verifyingContract,
        },
      });
    } else {
      return NextResponse.json({
        success: false,
        chainId,
        chainName,
        variation: v.name,
        elapsed,
        error: result.error,
      });
    }
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 5),
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Run tests on both chains
  const results = [];

  for (const chainId of [11155111, 421614]) {
    const rpcUrl = RPC_URLS[chainId];
    const chainName = CHAIN_NAMES[chainId];

    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const wallet = ethers.Wallet.createRandom().connect(provider);

      const { cofhejs } = await import('cofhejs/node');

      const startTime = Date.now();
      const result = await cofhejs.initializeWithEthers({
        ethersProvider: provider,
        ethersSigner: wallet,
        environment: 'TESTNET',
        generatePermit: true,
      });
      const elapsed = Date.now() - startTime;

      results.push({
        chainId,
        chainName,
        success: result.success,
        elapsed,
        wallet: wallet.address,
        error: result.success ? null : result.error,
      });
    } catch (error: any) {
      results.push({
        chainId,
        chainName,
        success: false,
        error: error.message,
      });
    }
  }

  const allPassed = results.every((r) => r.success);

  return NextResponse.json({
    summary: allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED',
    timestamp: new Date().toISOString(),
    results,
  });
}
