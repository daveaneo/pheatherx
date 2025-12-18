'use client';

/**
 * useVaultClaims - Hook for managing FheVault and VaultRouter async unwrap claims
 *
 * Provides functionality to:
 * - Fetch user's pending claims
 * - Check if claims are ready to fulfill
 * - Fulfill ready claims to receive ERC20 tokens
 *
 * Claims are created when:
 * - User calls FheVault.unwrap() to convert encrypted balance to ERC20
 * - User swaps via VaultRouter with ERC20 output
 *
 * The async flow requires waiting for FHE decrypt before fulfillment.
 */

import { useState, useCallback, useEffect } from 'react';
import { useAccount, useChainId, usePublicClient, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { FHE_VAULT_ABI } from '@/lib/contracts/fheVault-abi';
import { VAULT_ROUTER_ABI } from '@/lib/contracts/vaultRouter-abi';
import { FHE_VAULT_ADDRESSES, VAULT_ROUTER_ADDRESSES } from '@/lib/contracts/addresses';
import { useToast } from '@/stores/uiStore';

// Claim ID offset (matches contract)
const CLAIM_ID_OFFSET = BigInt(1) << BigInt(160);

export interface Claim {
  id: bigint;
  recipient: `0x${string}`;
  erc20Token: `0x${string}`;
  requestedAt: bigint;
  fulfilled: boolean;
  ready: boolean;
  amount?: bigint; // Available when ready
  source: 'vault' | 'router';
}

interface UseVaultClaimsResult {
  // State
  claims: Claim[];
  isLoading: boolean;
  error: string | null;

  // Actions
  refreshClaims: () => Promise<void>;
  fulfillClaim: (claimId: bigint, source: 'vault' | 'router') => Promise<`0x${string}`>;

  // Fulfill status
  isFulfilling: boolean;
  fulfillTxHash: `0x${string}` | undefined;
}

export function useVaultClaims(): UseVaultClaimsResult {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { success: successToast, error: errorToast, warning: warningToast } = useToast();
  const { writeContractAsync } = useWriteContract();

  const [claims, setClaims] = useState<Claim[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFulfilling, setIsFulfilling] = useState(false);
  const [fulfillTxHash, setFulfillTxHash] = useState<`0x${string}` | undefined>();

  const vaultAddress = FHE_VAULT_ADDRESSES[chainId];
  const routerAddress = VAULT_ROUTER_ADDRESSES[chainId];

  // Fetch claims from events
  const refreshClaims = useCallback(async () => {
    if (!address || !publicClient) return;

    setIsLoading(true);
    setError(null);

    try {
      const fetchedClaims: Claim[] = [];

      // Fetch from vault if deployed
      if (vaultAddress && vaultAddress !== '0x0000000000000000000000000000000000000000') {
        const vaultClaims = await fetchClaimsFromContract(
          publicClient,
          vaultAddress,
          FHE_VAULT_ABI,
          address,
          'vault'
        );
        fetchedClaims.push(...vaultClaims);
      }

      // Fetch from router if deployed
      if (routerAddress && routerAddress !== '0x0000000000000000000000000000000000000000') {
        const routerClaims = await fetchClaimsFromContract(
          publicClient,
          routerAddress,
          VAULT_ROUTER_ABI,
          address,
          'router'
        );
        fetchedClaims.push(...routerClaims);
      }

      // Sort by requestedAt descending (newest first)
      fetchedClaims.sort((a, b) => Number(b.requestedAt - a.requestedAt));

      setClaims(fetchedClaims);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch claims';
      setError(message);
      console.error('[useVaultClaims] Error fetching claims:', err);
    } finally {
      setIsLoading(false);
    }
  }, [address, publicClient, vaultAddress, routerAddress]);

  // Fulfill a claim
  const fulfillClaim = useCallback(
    async (claimId: bigint, source: 'vault' | 'router'): Promise<`0x${string}`> => {
      const contractAddress = source === 'vault' ? vaultAddress : routerAddress;
      const abi = source === 'vault' ? FHE_VAULT_ABI : VAULT_ROUTER_ABI;

      if (!contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error(`${source} contract not deployed on this chain`);
      }

      setIsFulfilling(true);
      setFulfillTxHash(undefined);

      try {
        warningToast('Fulfilling Claim', 'Submitting transaction...');

        const hash = await writeContractAsync({
          address: contractAddress,
          abi,
          functionName: 'fulfillClaim',
          args: [claimId],
        });

        setFulfillTxHash(hash);
        successToast('Claim Fulfilled', 'Waiting for confirmation...');

        // Refresh claims after a short delay
        setTimeout(() => refreshClaims(), 2000);

        return hash;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fulfill claim';
        errorToast('Failed to Fulfill Claim', message);
        throw err;
      } finally {
        setIsFulfilling(false);
      }
    },
    [vaultAddress, routerAddress, writeContractAsync, successToast, errorToast, warningToast, refreshClaims]
  );

  // Auto-refresh on mount and address change
  useEffect(() => {
    if (address) {
      refreshClaims();
    } else {
      setClaims([]);
    }
  }, [address, refreshClaims]);

  return {
    claims,
    isLoading,
    error,
    refreshClaims,
    fulfillClaim,
    isFulfilling,
    fulfillTxHash,
  };
}

// Helper to fetch claims from a contract
async function fetchClaimsFromContract(
  publicClient: ReturnType<typeof usePublicClient>,
  contractAddress: `0x${string}`,
  abi: readonly unknown[],
  userAddress: `0x${string}`,
  source: 'vault' | 'router'
): Promise<Claim[]> {
  if (!publicClient) return [];

  const claims: Claim[] = [];

  try {
    // Get UnwrapRequested events (vault) or UnwrapClaimCreated events (router)
    const eventName = source === 'vault' ? 'UnwrapRequested' : 'UnwrapClaimCreated';

    // Fetch logs based on source type
    let logs;
    if (source === 'vault') {
      logs = await publicClient.getLogs({
        address: contractAddress,
        event: {
          type: 'event',
          name: 'UnwrapRequested',
          inputs: [
            { name: 'user', type: 'address', indexed: true },
            { name: 'token', type: 'address', indexed: true },
            { name: 'claimId', type: 'uint256', indexed: true },
          ],
        },
        args: { user: userAddress },
        fromBlock: 'earliest',
        toBlock: 'latest',
      });
    } else {
      logs = await publicClient.getLogs({
        address: contractAddress,
        event: {
          type: 'event',
          name: 'UnwrapClaimCreated',
          inputs: [
            { name: 'claimId', type: 'uint256', indexed: true },
            { name: 'recipient', type: 'address', indexed: true },
            { name: 'erc20Token', type: 'address', indexed: true },
          ],
        },
        args: { recipient: userAddress },
        fromBlock: 'earliest',
        toBlock: 'latest',
      });
    }

    // For each claim event, fetch current status
    for (const log of logs) {
      const claimId = log.args?.claimId as bigint;
      if (!claimId) continue;

      try {
        // Get claim details
        const [recipient, erc20Token, requestedAt, fulfilled] = (await publicClient.readContract({
          address: contractAddress,
          abi,
          functionName: 'getClaim',
          args: [claimId],
        })) as [`0x${string}`, `0x${string}`, bigint, boolean];

        // Skip if already fulfilled
        if (fulfilled) continue;

        // Check if ready
        const [ready, amount] = (await publicClient.readContract({
          address: contractAddress,
          abi,
          functionName: 'isClaimReady',
          args: [claimId],
        })) as [boolean, bigint];

        claims.push({
          id: claimId,
          recipient,
          erc20Token,
          requestedAt,
          fulfilled,
          ready,
          amount: ready ? amount : undefined,
          source,
        });
      } catch (err) {
        console.warn(`[useVaultClaims] Failed to fetch claim ${claimId}:`, err);
      }
    }
  } catch (err) {
    console.error(`[useVaultClaims] Error fetching ${source} claims:`, err);
  }

  return claims;
}

// Hook to check a single claim's status
export function useClaimStatus(claimId: bigint | undefined, source: 'vault' | 'router') {
  const chainId = useChainId();
  const publicClient = usePublicClient();

  const [isReady, setIsReady] = useState(false);
  const [amount, setAmount] = useState<bigint | undefined>();
  const [isLoading, setIsLoading] = useState(false);

  const contractAddress = source === 'vault' ? FHE_VAULT_ADDRESSES[chainId] : VAULT_ROUTER_ADDRESSES[chainId];
  const abi = source === 'vault' ? FHE_VAULT_ABI : VAULT_ROUTER_ABI;

  const checkStatus = useCallback(async () => {
    if (!claimId || !publicClient || !contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
      return;
    }

    setIsLoading(true);
    try {
      const [ready, amt] = (await publicClient.readContract({
        address: contractAddress,
        abi,
        functionName: 'isClaimReady',
        args: [claimId],
      })) as [boolean, bigint];

      setIsReady(ready);
      setAmount(ready ? amt : undefined);
    } catch (err) {
      console.error('[useClaimStatus] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [claimId, publicClient, contractAddress, abi]);

  // Poll for status
  useEffect(() => {
    if (!claimId) return;

    checkStatus();
    const interval = setInterval(checkStatus, 5000); // Poll every 5 seconds

    return () => clearInterval(interval);
  }, [claimId, checkStatus]);

  return { isReady, amount, isLoading, checkStatus };
}
