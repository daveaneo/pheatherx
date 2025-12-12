'use client';

import { Card, CardContent, CardHeader, CardTitle, Button, Skeleton, Badge, TransactionModal } from '@/components/ui';
import { Loader2, X, Lock, Coins } from 'lucide-react';
import { useActiveOrders, type ActivePosition } from '@/hooks/useActiveOrders';
import { useCancelOrder } from '@/hooks/useCancelOrder';
import { useWithdraw } from '@/hooks/useWithdraw';
import { useTransactionModal } from '@/hooks/useTransactionModal';
import { useFherc20Balance } from '@/hooks/useFherc20Balance';
import type { BucketSideType } from '@/lib/contracts/fheatherXv6Abi';
import { tickToPrice, formatPrice } from '@/lib/constants';
import { useSelectedPool } from '@/stores/poolStore';
import { useAccount, useBalance } from 'wagmi';

interface ActiveOrdersPanelProps {
  currentTick: number;
}

export function ActiveOrdersPanel({ currentTick }: ActiveOrdersPanelProps) {
  const { positions, isLoading, refetch } = useActiveOrders();
  const { withdraw, isCancelling, step } = useCancelOrder();
  const { claim, isWithdrawing: isClaiming, step: claimStep } = useWithdraw();
  const { token0, token1, hookAddress } = useSelectedPool();
  const txModal = useTransactionModal();
  const { address } = useAccount();

  // Balance refresh hooks for both tokens (to refresh after claim)
  const { invalidateAndRefresh: refreshToken0Encrypted } = useFherc20Balance(token0, address);
  const { invalidateAndRefresh: refreshToken1Encrypted } = useFherc20Balance(token1, address);
  const { refetch: refetchToken0Balance } = useBalance({ address, token: token0?.address });
  const { refetch: refetchToken1Balance } = useBalance({ address, token: token1?.address });

  // Positions with claimable proceeds
  const claimablePositions = positions?.filter(p => p.hasClaimableProceeds) ?? [];
  const hasClaimableProceeds = claimablePositions.length > 0;

  // Refresh balance for the proceeds token based on side
  const refreshProceedsBalance = (side: number) => {
    // SELL orders get token1, BUY orders get token0
    const proceedsToken = side === 1 ? token1 : token0;
    if (proceedsToken?.type === 'fheerc20') {
      if (side === 1) {
        refreshToken1Encrypted?.();
      } else {
        refreshToken0Encrypted?.();
      }
    } else {
      if (side === 1) {
        refetchToken1Balance?.();
      } else {
        refetchToken0Balance?.();
      }
    }
  };

  const handleCancel = async (position: ActivePosition) => {
    // Show pending modal
    txModal.setPending(
      'Withdraw Order',
      `Withdrawing ${position.sideLabel} order at tick ${position.tick}...`
    );
    txModal.openModal();

    try {
      // Call v6 withdraw - uses max amount for full withdrawal
      const hash = await withdraw(
        position.poolId,
        position.tick,
        position.side
      );

      // Show success
      const price = tickToPrice(position.tick);
      txModal.setSuccess(hash, [
        { label: 'Order Type', value: position.sideLabel },
        { label: 'Tick', value: position.tick.toString() },
        { label: 'Price', value: formatPrice(price) },
      ]);

      // Refresh positions list and balances
      refetch();
      // Withdraw returns the deposited token (opposite of proceeds)
      const depositToken = position.side === 1 ? token0 : token1;
      if (depositToken?.type === 'fheerc20') {
        if (position.side === 1) {
          refreshToken0Encrypted?.();
        } else {
          refreshToken1Encrypted?.();
        }
      } else {
        if (position.side === 1) {
          refetchToken0Balance?.();
        } else {
          refetchToken1Balance?.();
        }
      }
    } catch (err) {
      // Show error in modal
      const errorMessage = err instanceof Error ? err.message : 'Failed to withdraw order';
      txModal.setError(errorMessage);
      console.error('Withdraw failed:', err);
    }
  };

  const handleClaim = async (position: ActivePosition) => {
    // Show pending modal
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

      // Show success
      const price = tickToPrice(position.tick);
      const proceedsToken = position.side === 1 ? token1 : token0;
      txModal.setSuccess(hash, [
        { label: 'Order Type', value: position.sideLabel },
        { label: 'Tick', value: position.tick.toString() },
        { label: 'Price', value: formatPrice(price) },
        { label: 'Proceeds', value: proceedsToken?.symbol ?? 'tokens' },
      ]);

      // Refresh positions list and balance
      refetch();
      refreshProceedsBalance(position.side);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to claim proceeds';
      txModal.setError(errorMessage);
      console.error('Claim failed:', err);
    }
  };

  const handleClaimAll = async () => {
    if (claimablePositions.length === 0) return;

    txModal.setPending(
      'Claim All Proceeds',
      `Claiming proceeds from ${claimablePositions.length} position(s)...`
    );
    txModal.openModal();

    try {
      // Claim each position sequentially
      for (const position of claimablePositions) {
        await claim(position.poolId, position.tick, position.side as BucketSideType);
        refreshProceedsBalance(position.side);
      }

      txModal.setSuccess('0x' as `0x${string}`, [
        { label: 'Positions Claimed', value: claimablePositions.length.toString() },
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
          <CardTitle>Your Positions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasOrders = positions && positions.length > 0;

  if (!hasOrders) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Positions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-feather-white/40">
            <p>No active positions</p>
            <p className="text-sm mt-1">Place a limit order above to get started</p>
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
              <span>Your Positions</span>
              <Badge variant="default">{positions?.length ?? 0}</Badge>
            </div>
            {hasClaimableProceeds && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleClaimAll}
                disabled={isClaiming || isCancelling}
                className="bg-amber-600 hover:bg-amber-700"
              >
                <Coins className="w-4 h-4 mr-1" />
                Claim All ({claimablePositions.length})
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Header */}
          <div className="grid grid-cols-5 gap-4 px-4 py-2 text-xs text-feather-white/40 border-b border-carbon-gray">
            <span>Tick</span>
            <span>Price</span>
            <span>Side</span>
            <span>Status</span>
            <span className="text-right">Action</span>
          </div>

          {/* Orders */}
          <div className="divide-y divide-carbon-gray">
            {positions?.map((position) => {
              const price = tickToPrice(position.tick);
              const priceFormatted = formatPrice(price);
              // Determine deposit/receive tokens based on side
              const depositToken = position.side === 1 ? token0 : token1; // SELL deposits token0, BUY deposits token1
              const proceedsToken = position.side === 1 ? token1 : token0;

              // Check if fully filled (no shares but has claimable)
              const isFullyFilled = position.sharesHandle === 0n && position.hasClaimableProceeds;
              // Has unfilled shares
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
                  <div className="font-mono text-sm">
                    {priceFormatted}
                  </div>

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
                        <span>****** {depositToken?.symbol}</span>
                      </div>
                    )}
                    {position.hasClaimableProceeds && (
                      <div className="flex items-center gap-1 text-amber-400">
                        <Coins className="w-3 h-3" />
                        <span>Claimable {proceedsToken?.symbol}</span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end gap-2">
                    {position.hasClaimableProceeds && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleClaim(position)}
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
                        onClick={() => handleCancel(position)}
                        disabled={isCancelling || isClaiming}
                        className="text-deep-magenta hover:text-deep-magenta"
                      >
                        {isCancelling ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin mr-1" />
                            {step === 'encrypting' ? 'Enc...' : 'Withdraw...'}
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

          {/* Footer */}
          <div className="mt-4 pt-4 border-t border-carbon-gray text-xs text-feather-white/40 text-center">
            <Lock className="w-3 h-3 inline mr-1" />
            Order amounts are encrypted with FHE.
            {hasClaimableProceeds && (
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
