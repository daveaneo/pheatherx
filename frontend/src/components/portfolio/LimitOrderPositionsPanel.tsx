'use client';

/**
 * LimitOrderPositionsPanel - Cross-pool positions display for Portfolio page
 *
 * Displays all limit order positions across ALL pools grouped by pool.
 * Shows claimable proceeds status and provides Claim/Withdraw actions.
 */

import { Card, CardContent, CardHeader, CardTitle, Button, Skeleton, Badge, TransactionModal } from '@/components/ui';
import { Loader2, X, Lock, Coins, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { useAllPositions, type AllPoolPosition, type PoolPositionGroup } from '@/hooks/useAllPositions';
import { useCancelOrder } from '@/hooks/useCancelOrder';
import { useWithdraw } from '@/hooks/useWithdraw';
import { useTransactionModal } from '@/hooks/useTransactionModal';
import { useFherc20Balance } from '@/hooks/useFherc20Balance';
import type { BucketSideType } from '@/lib/contracts/fheatherXv6Abi';
import { tickToPrice, formatPrice } from '@/lib/constants';
import { useAccount, useBalance } from 'wagmi';

export function LimitOrderPositionsPanel() {
  const {
    positionsByPool,
    allPositions,
    claimableCount,
    isLoading,
    refetch,
    hasPositions,
    hasClaimable,
  } = useAllPositions();
  const { withdraw, isCancelling, step } = useCancelOrder();
  const { claim, isWithdrawing: isClaiming, step: claimStep } = useWithdraw();
  const txModal = useTransactionModal();
  const { address } = useAccount();

  // Track expanded pools (all expanded by default)
  const [expandedPools, setExpandedPools] = useState<Set<string>>(new Set());
  const [isAllExpanded, setIsAllExpanded] = useState(true);

  const togglePool = (poolKey: string) => {
    setExpandedPools(prev => {
      const next = new Set(prev);
      if (next.has(poolKey)) {
        next.delete(poolKey);
      } else {
        next.add(poolKey);
      }
      return next;
    });
  };

  const isPoolExpanded = (poolKey: string) => {
    return isAllExpanded || expandedPools.has(poolKey);
  };

  const handleWithdraw = async (position: AllPoolPosition) => {
    txModal.setPending(
      'Withdraw Order',
      `Withdrawing ${position.sideLabel} order at tick ${position.tick}...`
    );
    txModal.openModal();

    try {
      const hash = await withdraw(
        position.poolId,
        position.tick,
        position.side
      );

      const price = tickToPrice(position.tick);
      txModal.setSuccess(hash, [
        { label: 'Pool', value: `${position.pool.token0Meta?.symbol}/${position.pool.token1Meta?.symbol}` },
        { label: 'Order Type', value: position.sideLabel },
        { label: 'Tick', value: position.tick.toString() },
        { label: 'Price', value: formatPrice(price) },
      ]);

      refetch();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to withdraw order';
      txModal.setError(errorMessage);
      console.error('Withdraw failed:', err);
    }
  };

  const handleClaim = async (position: AllPoolPosition) => {
    txModal.setPending(
      'Claim Proceeds',
      `Claiming ${position.sideLabel} order proceeds at tick ${position.tick}...`
    );
    txModal.openModal();

    try {
      const hash = await claim(
        position.poolId,
        position.tick,
        position.side as BucketSideType
      );

      const price = tickToPrice(position.tick);
      txModal.setSuccess(hash, [
        { label: 'Pool', value: `${position.pool.token0Meta?.symbol}/${position.pool.token1Meta?.symbol}` },
        { label: 'Order Type', value: position.sideLabel },
        { label: 'Tick', value: position.tick.toString() },
        { label: 'Price', value: formatPrice(price) },
        { label: 'Proceeds', value: position.proceedsToken?.symbol ?? 'tokens' },
      ]);

      refetch();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to claim proceeds';
      txModal.setError(errorMessage);
      console.error('Claim failed:', err);
    }
  };

  const handleClaimAll = async () => {
    const claimablePositions = allPositions.filter(p => p.hasClaimableProceeds);
    if (claimablePositions.length === 0) return;

    txModal.setPending(
      'Claim All Proceeds',
      `Claiming proceeds from ${claimablePositions.length} position(s) across ${positionsByPool.size} pool(s)...`
    );
    txModal.openModal();

    try {
      let claimed = 0;
      for (const position of claimablePositions) {
        await claim(position.poolId, position.tick, position.side as BucketSideType);
        claimed++;
      }

      txModal.setSuccess('0x' as `0x${string}`, [
        { label: 'Positions Claimed', value: claimed.toString() },
        { label: 'Pools', value: new Set(claimablePositions.map(p => p.poolKey)).size.toString() },
      ]);

      refetch();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to claim all proceeds';
      txModal.setError(errorMessage);
      console.error('Claim all failed:', err);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Limit Order Positions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!hasPositions) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Limit Order Positions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-feather-white/40">
            <p className="text-lg mb-2">No active positions</p>
            <p className="text-sm">Place limit orders on the Trade page to see them here</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>Limit Order Positions</span>
              <Badge variant="default">{allPositions.length}</Badge>
            </div>
            <div className="flex items-center gap-2">
              {hasClaimable && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleClaimAll}
                  disabled={isClaiming || isCancelling}
                  className="bg-amber-600 hover:bg-amber-700"
                >
                  <Coins className="w-4 h-4 mr-1" />
                  Claim All ({claimableCount})
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsAllExpanded(!isAllExpanded)}
              >
                {isAllExpanded ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Grouped by Pool */}
          {Array.from(positionsByPool.values()).map((group) => (
            <PoolPositionGroupCard
              key={group.poolKey}
              group={group}
              isExpanded={isPoolExpanded(group.poolKey)}
              onToggle={() => togglePool(group.poolKey)}
              onWithdraw={handleWithdraw}
              onClaim={handleClaim}
              isClaiming={isClaiming}
              isCancelling={isCancelling}
              claimStep={claimStep}
              withdrawStep={step}
            />
          ))}

          {/* Footer */}
          <div className="pt-4 border-t border-carbon-gray text-xs text-feather-white/40 text-center">
            <Lock className="w-3 h-3 inline mr-1" />
            Order amounts are encrypted with FHE.
            {hasClaimable && (
              <span className="ml-2 text-amber-400">
                <Coins className="w-3 h-3 inline mr-1" />
                You have proceeds to claim!
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Transaction Modal */}
      <TransactionModal
        isOpen={txModal.isOpen}
        onClose={txModal.closeModal}
        data={txModal.modalData}
      />
    </>
  );
}

interface PoolPositionGroupCardProps {
  group: PoolPositionGroup;
  isExpanded: boolean;
  onToggle: () => void;
  onWithdraw: (position: AllPoolPosition) => Promise<void>;
  onClaim: (position: AllPoolPosition) => Promise<void>;
  isClaiming: boolean;
  isCancelling: boolean;
  claimStep: string;
  withdrawStep: string;
}

function PoolPositionGroupCard({
  group,
  isExpanded,
  onToggle,
  onWithdraw,
  onClaim,
  isClaiming,
  isCancelling,
  claimStep,
  withdrawStep,
}: PoolPositionGroupCardProps) {
  const { pool, positions, hasClaimable } = group;
  const pairLabel = `${pool.token0Meta?.symbol ?? '???'} / ${pool.token1Meta?.symbol ?? '???'}`;

  return (
    <div className="border border-carbon-gray rounded-lg overflow-hidden">
      {/* Pool Header */}
      <button
        className={`w-full flex items-center justify-between px-4 py-3 hover:bg-ash-gray/30 ${
          hasClaimable ? 'bg-amber-900/10' : 'bg-ash-gray/20'
        }`}
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium">{pairLabel}</span>
          <Badge variant="default">{positions.length}</Badge>
          {hasClaimable && (
            <Badge variant="warning" className="text-xs">
              <Coins className="w-3 h-3 mr-1" />
              Claimable
            </Badge>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-feather-white/60" />
        ) : (
          <ChevronDown className="w-4 h-4 text-feather-white/60" />
        )}
      </button>

      {/* Positions */}
      {isExpanded && (
        <div className="divide-y divide-carbon-gray">
          {/* Header Row */}
          <div className="grid grid-cols-5 gap-4 px-4 py-2 text-xs text-feather-white/40 bg-ash-gray/10">
            <span>Tick</span>
            <span>Price</span>
            <span>Side</span>
            <span>Status</span>
            <span className="text-right">Action</span>
          </div>

          {/* Position Rows */}
          {positions.map((position) => {
            const price = tickToPrice(position.tick);
            const priceFormatted = formatPrice(price);
            const isFullyFilled = position.sharesHandle === 0n && position.hasClaimableProceeds;
            const hasShares = position.sharesHandle > 0n;

            return (
              <div
                key={`${position.tick}-${position.side}`}
                className={`grid grid-cols-5 gap-4 px-4 py-3 items-center hover:bg-ash-gray/30 ${
                  position.hasClaimableProceeds ? 'bg-amber-900/10' : ''
                }`}
              >
                {/* Tick */}
                <div className="font-mono text-sm">{position.tick}</div>

                {/* Price */}
                <div className="font-mono text-sm">{priceFormatted}</div>

                {/* Side + Filled Badge */}
                <div className="flex items-center gap-1">
                  <Badge variant={position.sideLabel === 'BUY' ? 'success' : 'error'}>
                    {position.sideLabel}
                  </Badge>
                  {isFullyFilled && (
                    <Badge variant="warning" className="text-xs">
                      FILLED
                    </Badge>
                  )}
                </div>

                {/* Status */}
                <div className="flex flex-col gap-1 text-sm">
                  {hasShares && (
                    <div className="flex items-center gap-1 text-feather-white/40">
                      <Lock className="w-3 h-3" />
                      <span>****** {position.depositToken?.symbol}</span>
                    </div>
                  )}
                  {position.hasClaimableProceeds && (
                    <div className="flex items-center gap-1 text-amber-400">
                      <Coins className="w-3 h-3" />
                      <span>Claimable {position.proceedsToken?.symbol}</span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-2">
                  {position.hasClaimableProceeds && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => onClaim(position)}
                      disabled={isClaiming || isCancelling}
                      className="bg-amber-600 hover:bg-amber-700"
                    >
                      {isClaiming && claimStep === 'withdrawing' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Coins className="w-4 h-4 mr-1" />
                          Claim
                        </>
                      )}
                    </Button>
                  )}
                  {hasShares && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onWithdraw(position)}
                      disabled={isCancelling || isClaiming}
                      className="text-deep-magenta hover:text-deep-magenta"
                    >
                      {isCancelling ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-1" />
                          {withdrawStep === 'encrypting' ? 'Enc...' : 'Withdraw...'}
                        </>
                      ) : (
                        <>
                          <X className="w-4 h-4 mr-1" />
                          Withdraw
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
