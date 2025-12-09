/**
 * Blockchain Helper Functions for E2E Tests
 *
 * Provides utilities for reading on-chain state directly via RPC,
 * without relying on the frontend UI.
 */

import { TEST_CONFIG, TestToken, formatAmount } from '../config/tokens';

// ERC20 ABI (minimal for balance/allowance checks)
const ERC20_ABI = {
  balanceOf: 'function balanceOf(address owner) view returns (uint256)',
  allowance:
    'function allowance(address owner, address spender) view returns (uint256)',
  decimals: 'function decimals() view returns (uint8)',
  symbol: 'function symbol() view returns (string)',
};

// ═══════════════════════════════════════════════════════════════════════
//                           RPC HELPERS
// ═══════════════════════════════════════════════════════════════════════

interface RpcResponse {
  jsonrpc: string;
  id: number;
  result?: string;
  error?: { code: number; message: string };
}

/**
 * Make a raw JSON-RPC call to the Sepolia RPC
 */
async function rpcCall(
  method: string,
  params: unknown[]
): Promise<RpcResponse> {
  const response = await fetch(TEST_CONFIG.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Encode a function call for eth_call
 */
function encodeFunctionCall(
  functionSig: string,
  args: string[] = []
): string {
  // Simple encoding for balanceOf(address) - keccak256 first 4 bytes
  const sigHash = functionSignatureHash(functionSig);
  const encodedArgs = args
    .map((arg) => arg.replace('0x', '').padStart(64, '0'))
    .join('');
  return sigHash + encodedArgs;
}

/**
 * Get function signature hash (first 4 bytes of keccak256)
 */
function functionSignatureHash(sig: string): string {
  // Pre-computed hashes for common functions
  const hashes: Record<string, string> = {
    'balanceOf(address)': '0x70a08231',
    'allowance(address,address)': '0xdd62ed3e',
    'decimals()': '0x313ce567',
    'symbol()': '0x95d89b41',
  };

  return hashes[sig] || '0x00000000';
}

// ═══════════════════════════════════════════════════════════════════════
//                         BALANCE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get ERC20 token balance for an address
 */
export async function getTokenBalance(
  tokenAddress: `0x${string}`,
  walletAddress: `0x${string}`
): Promise<bigint> {
  const data = encodeFunctionCall('balanceOf(address)', [walletAddress]);

  const response = await rpcCall('eth_call', [
    {
      to: tokenAddress,
      data,
    },
    'latest',
  ]);

  if (response.error) {
    console.error('[RPC] Balance query failed:', response.error);
    return 0n;
  }

  if (!response.result || response.result === '0x') {
    return 0n;
  }

  return BigInt(response.result);
}

/**
 * Get formatted token balance
 */
export async function getFormattedBalance(
  token: TestToken,
  walletAddress: `0x${string}`
): Promise<string> {
  const balance = await getTokenBalance(token.address, walletAddress);
  return formatAmount(balance, token.decimals);
}

/**
 * Get all token balances for a wallet
 */
export async function getAllBalances(
  tokens: TestToken[],
  walletAddress: `0x${string}`
): Promise<Record<string, { raw: bigint; formatted: string }>> {
  const balances: Record<string, { raw: bigint; formatted: string }> = {};

  await Promise.all(
    tokens.map(async (token) => {
      const balance = await getTokenBalance(token.address, walletAddress);
      balances[token.symbol] = {
        raw: balance,
        formatted: formatAmount(balance, token.decimals),
      };
    })
  );

  return balances;
}

/**
 * Get ETH balance for an address
 */
export async function getEthBalance(
  walletAddress: `0x${string}`
): Promise<bigint> {
  const response = await rpcCall('eth_getBalance', [walletAddress, 'latest']);

  if (response.error) {
    console.error('[RPC] ETH balance query failed:', response.error);
    return 0n;
  }

  if (!response.result || response.result === '0x') {
    return 0n;
  }

  return BigInt(response.result);
}

// ═══════════════════════════════════════════════════════════════════════
//                      TRANSACTION HELPERS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Wait for a transaction to be confirmed
 */
export async function waitForTransaction(
  txHash: string,
  confirmations: number = TEST_CONFIG.blockConfirmations,
  timeout: number = TEST_CONFIG.txTimeout
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const response = await rpcCall('eth_getTransactionReceipt', [txHash]);

    if (response.result) {
      const receipt = response.result as unknown as {
        status: string;
        blockNumber: string;
      };

      // Check if transaction succeeded
      if (receipt.status === '0x1') {
        // Wait for confirmations
        const blockResponse = await rpcCall('eth_blockNumber', []);
        const currentBlock = parseInt(blockResponse.result || '0', 16);
        const txBlock = parseInt(receipt.blockNumber, 16);

        if (currentBlock - txBlock >= confirmations) {
          return true;
        }
      } else if (receipt.status === '0x0') {
        // Transaction reverted
        console.error('[TX] Transaction reverted:', txHash);
        return false;
      }
    }

    // Wait 2 seconds before next check
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.error('[TX] Transaction timed out:', txHash);
  return false;
}

/**
 * Get current block number
 */
export async function getBlockNumber(): Promise<number> {
  const response = await rpcCall('eth_blockNumber', []);
  return parseInt(response.result || '0', 16);
}

// ═══════════════════════════════════════════════════════════════════════
//                       ALLOWANCE HELPERS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Check token allowance
 */
export async function getTokenAllowance(
  tokenAddress: `0x${string}`,
  ownerAddress: `0x${string}`,
  spenderAddress: `0x${string}`
): Promise<bigint> {
  const data = encodeFunctionCall('allowance(address,address)', [
    ownerAddress,
    spenderAddress,
  ]);

  const response = await rpcCall('eth_call', [
    {
      to: tokenAddress,
      data,
    },
    'latest',
  ]);

  if (response.error) {
    console.error('[RPC] Allowance query failed:', response.error);
    return 0n;
  }

  if (!response.result || response.result === '0x') {
    return 0n;
  }

  return BigInt(response.result);
}

// ═══════════════════════════════════════════════════════════════════════
//                        ASSERTION HELPERS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Assert balance changed by expected amount
 */
export async function assertBalanceChanged(
  token: TestToken,
  walletAddress: `0x${string}`,
  previousBalance: bigint,
  expectedChange: bigint,
  tolerance: bigint = 0n
): Promise<{ passed: boolean; actual: bigint; expected: bigint }> {
  const currentBalance = await getTokenBalance(token.address, walletAddress);
  const actualChange = currentBalance - previousBalance;
  const diff =
    actualChange > expectedChange
      ? actualChange - expectedChange
      : expectedChange - actualChange;

  return {
    passed: diff <= tolerance,
    actual: actualChange,
    expected: expectedChange,
  };
}

/**
 * Check if wallet has sufficient balance for operation
 */
export async function hasSufficientBalance(
  token: TestToken,
  walletAddress: `0x${string}`,
  requiredAmount: bigint
): Promise<boolean> {
  const balance = await getTokenBalance(token.address, walletAddress);
  return balance >= requiredAmount;
}

// ═══════════════════════════════════════════════════════════════════════
//                          UTILITY EXPORTS
// ═══════════════════════════════════════════════════════════════════════

export { rpcCall };
