/**
 * Test API route for debugging unseal functionality
 * GET /api/test-unseal
 */

import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';

const RPC_URL = 'https://sepolia-rollup.arbitrum.io/rpc';
const TOKEN_ADDRESS = '0x43AcAe0A089f3cd188f9fB0731059Eb7bC27D3Aa';
const USER_ADDRESS = '0x60B9be2A29a02F49e8D6ba535303caD1Ddcb9659';

const FHERC20_ABI = [
  'function balanceOfEncrypted(address account) view returns (uint256)',
  'function hasEncryptedBalance(address account) view returns (bool)',
];

export async function GET(request: NextRequest) {
  const results: any = { steps: [] };

  try {
    // 1. Setup provider
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    results.steps.push({ step: 1, action: 'Connected to RPC', rpcUrl: RPC_URL });

    // 2. Query encrypted balance
    const token = new ethers.Contract(TOKEN_ADDRESS, FHERC20_ABI, provider);
    const hasBalance = await token.hasEncryptedBalance(USER_ADDRESS);
    results.steps.push({ step: 2, action: 'Checked hasEncryptedBalance', hasBalance });

    if (!hasBalance) {
      return NextResponse.json({ ...results, error: 'No encrypted balance' });
    }

    const encryptedBalance = await token.balanceOfEncrypted(USER_ADDRESS);
    results.steps.push({
      step: 3,
      action: 'Got encrypted balance',
      encryptedBalance: encryptedBalance.toString(),
      encryptedBalanceHex: '0x' + encryptedBalance.toString(16),
    });

    if (encryptedBalance === 0n) {
      return NextResponse.json({ ...results, error: 'Encrypted balance is 0' });
    }

    // 3. Initialize cofhejs
    const { cofhejs, FheTypes } = await import('cofhejs/node');
    const sessionWallet = ethers.Wallet.createRandom().connect(provider);
    results.steps.push({
      step: 4,
      action: 'Created session wallet',
      sessionWalletAddress: sessionWallet.address,
    });

    const initResult = await cofhejs.initializeWithEthers({
      ethersProvider: provider,
      ethersSigner: sessionWallet,
      environment: 'TESTNET',
      generatePermit: true,
    });

    if (!initResult.success) {
      return NextResponse.json({ ...results, error: 'Init failed', initError: initResult.error });
    }

    results.steps.push({
      step: 5,
      action: 'Initialized cofhejs',
      permitIssuer: initResult.data?.issuer,
    });

    // 4. Try different unseal approaches
    const unsealAttempts: any[] = [];

    // Attempt 1: No account
    try {
      const result1 = await cofhejs.unseal(encryptedBalance, FheTypes.Uint128);
      unsealAttempts.push({
        attempt: 1,
        params: 'unseal(ctHash, type)',
        success: result1.success,
        data: result1.data?.toString(),
        error: result1.error,
      });
    } catch (err: any) {
      unsealAttempts.push({
        attempt: 1,
        params: 'unseal(ctHash, type)',
        success: false,
        error: err.message || String(err),
      });
    }

    // Attempt 2: With session wallet address
    try {
      const result2 = await cofhejs.unseal(encryptedBalance, FheTypes.Uint128, sessionWallet.address);
      unsealAttempts.push({
        attempt: 2,
        params: 'unseal(ctHash, type, sessionWalletAddress)',
        success: result2.success,
        data: result2.data?.toString(),
        error: result2.error,
      });
    } catch (err: any) {
      unsealAttempts.push({
        attempt: 2,
        params: 'unseal(ctHash, type, sessionWalletAddress)',
        success: false,
        error: err.message || String(err),
      });
    }

    // Attempt 3: With user address
    try {
      const result3 = await cofhejs.unseal(encryptedBalance, FheTypes.Uint128, USER_ADDRESS);
      unsealAttempts.push({
        attempt: 3,
        params: 'unseal(ctHash, type, userAddress)',
        success: result3.success,
        data: result3.data?.toString(),
        error: result3.error,
      });
    } catch (err: any) {
      unsealAttempts.push({
        attempt: 3,
        params: 'unseal(ctHash, type, userAddress)',
        success: false,
        error: err.message || String(err),
      });
    }

    results.steps.push({ step: 6, action: 'Unseal attempts', unsealAttempts });

    // 5. Include permit info
    results.permitInfo = {
      issuer: initResult.data?.issuer,
      chainId: initResult.data?._signedDomain?.chainId,
      verifyingContract: initResult.data?._signedDomain?.verifyingContract,
    };

    return NextResponse.json({ success: true, ...results });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      ...results,
      error: error.message || String(error),
    });
  }
}
