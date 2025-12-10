'use client';

/**
 * Dev Wallet Connector
 *
 * A custom wagmi connector that:
 * 1. Uses a pre-funded test wallet private key (bypasses MetaMask/Rainbow)
 * 2. Provides comprehensive console logging for debugging
 * 3. Signs transactions directly with viem
 *
 * This connector appears in RainbowKit's wallet list as "Dev Wallet (Debug)"
 */

import { createConnector } from 'wagmi';
import {
  createWalletClient,
  createPublicClient,
  http,
  type WalletClient,
  type PublicClient,
  type Chain,
  type TransactionRequest,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { ethereumSepolia, arbSepolia, localAnvil } from './chains';

// Logger with structured output
const log = (action: string, data?: unknown) => {
  const timestamp = new Date().toISOString().slice(11, 23);
  console.log(`%c[Dev Wallet ${timestamp}] ${action}`, 'color: #f59e0b; font-weight: bold', data ?? '');
};

const logError = (action: string, error: unknown) => {
  const timestamp = new Date().toISOString().slice(11, 23);
  console.error(`%c[Dev Wallet ${timestamp}] ${action}`, 'color: #ef4444; font-weight: bold');
  if (error instanceof Error) {
    console.error('  Name:', error.name);
    console.error('  Message:', error.message);
    if ('cause' in error) console.error('  Cause:', error.cause);
    if ('shortMessage' in error) console.error('  Short:', (error as { shortMessage?: string }).shortMessage);
    if ('data' in error) console.error('  Data:', (error as { data?: unknown }).data);
  } else {
    console.error('  Error:', error);
  }
};

// Chain ID to RPC URL mapping
const chainRpcUrls: Record<number, string> = {
  31337: 'http://127.0.0.1:8545',
  11155111: 'https://ethereum-sepolia-rpc.publicnode.com',
  421614: 'https://sepolia-rollup.arbitrum.io/rpc',
};

// Chain ID to Chain object mapping
const chainMap: Record<number, Chain> = {
  31337: localAnvil,
  11155111: ethereumSepolia,
  421614: arbSepolia,
};

export type DevWalletConnectorOptions = {
  privateKey: `0x${string}`;
};

/**
 * Creates a dev wallet connector for wagmi
 * Returns null if no private key is configured
 */
export function devWalletConnector(options?: DevWalletConnectorOptions) {
  const privateKey =
    options?.privateKey ||
    (process.env.NEXT_PUBLIC_TEST_WALLET_PRIVATE_KEY as `0x${string}` | undefined);

  if (!privateKey) {
    log('No private key configured - dev wallet disabled');
    return null;
  }

  let account: PrivateKeyAccount;
  try {
    account = privateKeyToAccount(privateKey);
    log('Initialized', { address: account.address });
  } catch (e) {
    logError('Failed to create account from private key', e);
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createConnector((config): any => {
    let currentChainId = 11155111; // Default to Eth Sepolia
    let walletClient: WalletClient | null = null;
    let publicClient: PublicClient | null = null;

    const getClients = (chainId: number) => {
      const rpcUrl = chainRpcUrls[chainId] || chainRpcUrls[11155111];
      const chain = chainMap[chainId] || ethereumSepolia;

      publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
      });

      walletClient = createWalletClient({
        account,
        chain,
        transport: http(rpcUrl),
      });

      return { publicClient, walletClient };
    };

    // Initialize clients
    getClients(currentChainId);

    // EIP-1193 provider implementation
    const provider = async ({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> => {
      log(`Provider request: ${method}`, params);

      try {
        switch (method) {
          case 'eth_accounts':
          case 'eth_requestAccounts':
            return [account.address];

          case 'eth_chainId':
            return `0x${currentChainId.toString(16)}`;

          case 'wallet_switchEthereumChain': {
            const [{ chainId: newChainIdHex }] = params as [{ chainId: string }];
            const newChainId = parseInt(newChainIdHex, 16);
            log('Switching chain', { from: currentChainId, to: newChainId });

            if (!chainRpcUrls[newChainId]) {
              throw new Error(`Chain ${newChainId} not supported by dev wallet`);
            }

            currentChainId = newChainId;
            getClients(currentChainId);
            config.emitter.emit('change', { chainId: newChainId });
            return null;
          }

          case 'eth_sendTransaction': {
            const [txParams] = params as [TransactionRequest];
            log('Sending transaction', {
              to: txParams.to,
              value: txParams.value?.toString(),
              data: txParams.data ? `${String(txParams.data).slice(0, 66)}...` : undefined,
              gas: txParams.gas?.toString(),
            });

            if (!walletClient) throw new Error('Wallet client not initialized');

            // Simulate first for better error messages
            if (publicClient && txParams.to && txParams.data) {
              try {
                log('Simulating transaction...');
                await publicClient.call({
                  account: account.address,
                  to: txParams.to as `0x${string}`,
                  data: txParams.data as `0x${string}`,
                  value: txParams.value,
                });
                log('Simulation successful');
              } catch (simError) {
                logError('Simulation failed (transaction will likely revert)', simError);
                // Continue anyway - let the actual tx show the real error
              }
            }

            const hash = await walletClient.sendTransaction({
              to: txParams.to as `0x${string}`,
              data: txParams.data as `0x${string}`,
              value: txParams.value,
              gas: txParams.gas,
              nonce: txParams.nonce ? Number(txParams.nonce) : undefined,
              chain: chainMap[currentChainId],
              account,
            });

            log('Transaction sent', { hash });

            // Wait for receipt in background and log it
            if (publicClient) {
              publicClient.waitForTransactionReceipt({ hash }).then((receipt) => {
                log('Transaction confirmed', {
                  hash,
                  status: receipt.status,
                  gasUsed: receipt.gasUsed.toString(),
                  blockNumber: receipt.blockNumber.toString(),
                });
              }).catch((err) => {
                logError('Failed to get receipt', err);
              });
            }

            return hash;
          }

          case 'personal_sign': {
            const [message, address] = params as [string, string];
            log('Signing message', { address, message: message.slice(0, 100) });

            if (!walletClient) throw new Error('Wallet client not initialized');

            const signature = await walletClient.signMessage({
              account,
              message: { raw: message as `0x${string}` },
            });

            log('Message signed', { signature: signature.slice(0, 20) + '...' });
            return signature;
          }

          case 'eth_signTypedData_v4': {
            const [, typedDataStr] = params as [string, string];
            const typedData = JSON.parse(typedDataStr);
            log('Signing typed data', { primaryType: typedData.primaryType });

            if (!walletClient) throw new Error('Wallet client not initialized');

            const signature = await walletClient.signTypedData({
              account,
              ...typedData,
            });

            log('Typed data signed', { signature: signature.slice(0, 20) + '...' });
            return signature;
          }

          case 'eth_getBalance': {
            const [addr] = params as [string];
            if (!publicClient) throw new Error('Public client not initialized');
            const balance = await publicClient.getBalance({ address: addr as `0x${string}` });
            return `0x${balance.toString(16)}`;
          }

          case 'eth_blockNumber': {
            if (!publicClient) throw new Error('Public client not initialized');
            const blockNumber = await publicClient.getBlockNumber();
            return `0x${blockNumber.toString(16)}`;
          }

          case 'eth_call': {
            const [callParams] = params as [{ to: string; data: string }];
            if (!publicClient) throw new Error('Public client not initialized');
            const result = await publicClient.call({
              to: callParams.to as `0x${string}`,
              data: callParams.data as `0x${string}`,
            });
            return result.data;
          }

          case 'eth_estimateGas': {
            const [estimateParams] = params as [TransactionRequest];
            if (!publicClient) throw new Error('Public client not initialized');
            const gas = await publicClient.estimateGas({
              account: account.address,
              to: estimateParams.to as `0x${string}`,
              data: estimateParams.data as `0x${string}`,
              value: estimateParams.value,
            });
            return `0x${gas.toString(16)}`;
          }

          case 'eth_gasPrice': {
            if (!publicClient) throw new Error('Public client not initialized');
            const gasPrice = await publicClient.getGasPrice();
            return `0x${gasPrice.toString(16)}`;
          }

          case 'eth_getTransactionCount': {
            const [addr] = params as [string, string];
            if (!publicClient) throw new Error('Public client not initialized');
            const count = await publicClient.getTransactionCount({
              address: addr as `0x${string}`,
            });
            return `0x${count.toString(16)}`;
          }

          default:
            log(`Unhandled method: ${method}`, params);
            throw new Error(`Method ${method} not implemented in dev wallet`);
        }
      } catch (error) {
        logError(`Provider ${method} failed`, error);
        throw error;
      }
    };

    return {
      id: 'devWallet',
      name: 'Dev Wallet (Debug)',
      type: 'devWallet' as const,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23f59e0b" width="100" height="100" rx="20"/><text x="50" y="65" font-size="50" text-anchor="middle" fill="white">D</text></svg>',

      async setup() {
        log('Setup called');
      },

      async connect({ chainId }: { chainId?: number } = {}) {
        log('Connect called', { requestedChainId: chainId });

        if (chainId && chainRpcUrls[chainId]) {
          currentChainId = chainId;
          getClients(chainId);
        }

        log('Connected', { address: account.address, chainId: currentChainId });
        return {
          accounts: [account.address] as readonly `0x${string}`[],
          chainId: currentChainId,
        };
      },

      async disconnect() {
        log('Disconnect called');
      },

      async getAccounts() {
        return [account.address] as readonly `0x${string}`[];
      },

      async getChainId() {
        return currentChainId;
      },

      async getProvider() {
        return { request: provider };
      },

      async isAuthorized() {
        return true;
      },

      async switchChain({ chainId }: { chainId: number }) {
        log('Switch chain called', { chainId });

        if (!chainRpcUrls[chainId]) {
          throw new Error(`Chain ${chainId} not supported by dev wallet`);
        }

        currentChainId = chainId;
        getClients(chainId);

        log('Chain switched', { chainId, chain: chainMap[chainId]?.name });
        config.emitter.emit('change', { chainId });

        return chainMap[chainId] || ethereumSepolia;
      },

      onAccountsChanged(accounts: string[]) {
        log('Accounts changed', { accounts });
      },

      onChainChanged(chainId: string) {
        log('Chain changed', { chainId });
        currentChainId = parseInt(chainId, 16);
        getClients(currentChainId);
      },

      onDisconnect() {
        log('Disconnected');
      },
    };
  });
}

// Export the address for display purposes
export function getDevWalletAddress(): `0x${string}` | null {
  const privateKey = process.env.NEXT_PUBLIC_TEST_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey) return null;

  try {
    return privateKeyToAccount(privateKey).address;
  } catch {
    return null;
  }
}
