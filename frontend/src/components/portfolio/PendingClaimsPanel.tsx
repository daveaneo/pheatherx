'use client';

/**
 * PendingClaimsPanel - Display and manage async unwrap claims
 *
 * Shows pending claims from:
 * - FheVault: When user unwraps encrypted balance to ERC20
 * - VaultRouter: When user swaps FHERC20 to ERC20
 *
 * Provides:
 * - List of pending claims with status (pending/ready)
 * - Fulfill button for ready claims
 * - Auto-refresh to detect when claims become ready
 */

import { Card, CardContent, CardHeader, CardTitle, Button, Skeleton, Badge, TransactionModal } from '@/components/ui';
import { Loader2, RefreshCw, Clock, CheckCircle, Coins, AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { useVaultClaims, type Claim } from '@/hooks/useVaultClaims';
import { useTransactionModal } from '@/hooks/useTransactionModal';
import { formatUnits } from 'viem';
import { useChainId } from 'wagmi';

// Token symbol lookup (basic - could be enhanced with token registry)
const TOKEN_SYMBOLS: Record<string, string> = {
  // Add known token addresses and their symbols
};

function getTokenSymbol(address: `0x${string}`): string {
  return TOKEN_SYMBOLS[address.toLowerCase()] || `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatClaimAmount(amount: bigint | undefined, decimals: number = 18): string {
  if (!amount) return '—';
  const formatted = formatUnits(amount, decimals);
  const num = parseFloat(formatted);
  if (num < 0.0001) return '<0.0001';
  if (num < 1) return num.toFixed(4);
  if (num < 1000) return num.toFixed(2);
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatBlockNumber(blockNumber: bigint): string {
  return `Block #${blockNumber.toLocaleString()}`;
}

interface ClaimRowProps {
  claim: Claim;
  onFulfill: () => void;
  isFulfilling: boolean;
}

function ClaimRow({ claim, onFulfill, isFulfilling }: ClaimRowProps) {
  const tokenSymbol = getTokenSymbol(claim.erc20Token);

  return (
    <div className="flex items-center justify-between p-3 bg-feather-dark/50 rounded-lg border border-feather-gray-dark/30">
      <div className="flex items-center gap-3">
        {/* Status indicator */}
        <div className={`p-2 rounded-full ${claim.ready ? 'bg-green-500/20' : 'bg-yellow-500/20'}`}>
          {claim.ready ? (
            <CheckCircle className="h-4 w-4 text-green-400" />
          ) : (
            <Clock className="h-4 w-4 text-yellow-400" />
          )}
        </div>

        {/* Claim details */}
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="font-medium text-feather-white">
              {claim.ready && claim.amount ? formatClaimAmount(claim.amount) : 'Pending'} {tokenSymbol}
            </span>
            <Badge
              variant={claim.source === 'vault' ? 'info' : 'default'}
              className="text-xs"
            >
              {claim.source === 'vault' ? 'Vault' : 'Router'}
            </Badge>
          </div>
          <span className="text-xs text-feather-white/50">
            {formatBlockNumber(claim.requestedAt)}
          </span>
        </div>
      </div>

      {/* Action button */}
      <div className="flex items-center gap-2">
        {claim.ready ? (
          <Button
            size="sm"
            onClick={onFulfill}
            disabled={isFulfilling}
            className="bg-green-600 hover:bg-green-500"
          >
            {isFulfilling ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Claiming...
              </>
            ) : (
              <>
                <Coins className="h-4 w-4 mr-1" />
                Claim
              </>
            )}
          </Button>
        ) : (
          <Badge variant="warning" className="text-yellow-400">
            <Clock className="h-3 w-3 mr-1" />
            Decrypting...
          </Badge>
        )}
      </div>
    </div>
  );
}

export function PendingClaimsPanel() {
  const chainId = useChainId();
  const { claims, isLoading, error, refreshClaims, fulfillClaim, isFulfilling } = useVaultClaims();
  const txModal = useTransactionModal();
  const [fulfillingClaimId, setFulfillingClaimId] = useState<bigint | null>(null);

  const pendingClaims = claims.filter((c) => !c.fulfilled);
  const readyClaims = pendingClaims.filter((c) => c.ready);
  const waitingClaims = pendingClaims.filter((c) => !c.ready);

  const handleFulfill = async (claim: Claim) => {
    setFulfillingClaimId(claim.id);

    txModal.setPending(
      'Claim Tokens',
      `Claiming ${getTokenSymbol(claim.erc20Token)} from ${claim.source}...`
    );
    txModal.openModal();

    try {
      const hash = await fulfillClaim(claim.id, claim.source);

      txModal.setSuccess(hash, [
        { label: 'Token', value: getTokenSymbol(claim.erc20Token) },
        { label: 'Amount', value: claim.amount ? formatClaimAmount(claim.amount) : 'Unknown' },
        { label: 'Source', value: claim.source === 'vault' ? 'FheVault' : 'VaultRouter' },
      ]);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to claim';
      txModal.setError(errorMessage);
    } finally {
      setFulfillingClaimId(null);
    }
  };

  // Don't render if no claims
  if (!isLoading && pendingClaims.length === 0) {
    return null;
  }

  return (
    <>
      <Card className="bg-feather-gray-dark/50 border-feather-gray-dark">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Coins className="h-5 w-5 text-feather-orange" />
              Pending Claims
              {readyClaims.length > 0 && (
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                  {readyClaims.length} ready
                </Badge>
              )}
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={refreshClaims}
              disabled={isLoading}
              className="text-feather-white/60 hover:text-feather-white"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 rounded-lg border border-red-500/30">
              <AlertCircle className="h-4 w-4 text-red-400" />
              <span className="text-sm text-red-400">{error}</span>
            </div>
          ) : (
            <>
              {/* Ready claims first */}
              {readyClaims.map((claim) => (
                <ClaimRow
                  key={`${claim.source}-${claim.id.toString()}`}
                  claim={claim}
                  onFulfill={() => handleFulfill(claim)}
                  isFulfilling={isFulfilling && fulfillingClaimId === claim.id}
                />
              ))}

              {/* Then waiting claims */}
              {waitingClaims.map((claim) => (
                <ClaimRow
                  key={`${claim.source}-${claim.id.toString()}`}
                  claim={claim}
                  onFulfill={() => handleFulfill(claim)}
                  isFulfilling={false}
                />
              ))}

              {/* Help text */}
              {waitingClaims.length > 0 && (
                <p className="text-xs text-feather-white/40 text-center pt-2">
                  Claims become ready after FHE decryption completes (typically 10-30 seconds)
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <TransactionModal
        isOpen={txModal.isOpen}
        onClose={txModal.closeModal}
        data={txModal.modalData}
      />
    </>
  );
}
