import { supportedChains } from '@/lib/chains';

/**
 * Get block explorer URL for a transaction
 */
export function getExplorerTxUrl(
  chainId: number,
  txHash: `0x${string}`
): string | null {
  const chain = supportedChains.find(c => c.id === chainId);
  const explorer = chain?.blockExplorers?.default;
  if (!explorer) return null;
  return `${explorer.url}/tx/${txHash}`;
}

/**
 * Get block explorer URL for an address
 */
export function getExplorerAddressUrl(
  chainId: number,
  address: `0x${string}`
): string | null {
  const chain = supportedChains.find(c => c.id === chainId);
  const explorer = chain?.blockExplorers?.default;
  if (!explorer) return null;
  return `${explorer.url}/address/${address}`;
}

/**
 * Get block explorer URL for a block
 */
export function getExplorerBlockUrl(
  chainId: number,
  blockNumber: bigint
): string | null {
  const chain = supportedChains.find(c => c.id === chainId);
  const explorer = chain?.blockExplorers?.default;
  if (!explorer) return null;
  return `${explorer.url}/block/${blockNumber.toString()}`;
}
