'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { TransactionModal } from '@/components/ui';
import { useClaimableOrders, type ClaimableOrder } from '@/hooks/useClaimableOrders';
import { useWithdraw, BucketSide } from '@/hooks/useWithdraw';
import { useTransactionModal } from '@/hooks/useTransactionModal';
import { useSelectedPool } from '@/stores/poolStore';
import { Gift, Loader2, RefreshCw } from 'lucide-react';

interface ClaimableOrderItemProps {
  order: ClaimableOrder;
  onClaim: (order: ClaimableOrder) => void;
  isClaiming: boolean;
  isClaimingThis: boolean;
}

function ClaimableOrderItem({ order, onClaim, isClaiming, isClaimingThis }: ClaimableOrderItemProps) {
  const sideIcon = order.side === BucketSide.BUY ? '📈' : '📉';

  return (
    <div
      className="flex items-center justify-between p-4 bg-ash-gray rounded-lg"
      data-testid={`claimable-order-${order.tick}-${order.side}`}
    >
      <div className="flex items-center gap-4">
        <span className="text-2xl">{sideIcon}</span>
        <div>
          <p className="font-medium">Limit {order.sideLabel}</p>
          <p className="text-sm text-feather-white/60">
            Trigger: ${order.price.toFixed(4)} | Tick: {order.tick}
          </p>
          <p className="text-xs text-electric-teal mt-1">
            Ready to claim proceeds
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Badge variant="success">Filled</Badge>
        <Button
          variant="primary"
          size="sm"
          onClick={() => onClaim(order)}
          disabled={isClaiming}
          data-testid="claim-button"
        >
          {isClaimingThis ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Claiming...
            </>
          ) : (
            <>
              <Gift className="mr-2 h-4 w-4" />
              Claim
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

export function ClaimableOrdersPanel() {
  const { claimableOrders, isLoading, error, refetch } = useClaimableOrders();
  const { claim, isWithdrawing, step, reset: resetWithdraw } = useWithdraw();
  const { token0, token1 } = useSelectedPool();
  const txModal = useTransactionModal();

  const [claimingOrderKey, setClaimingOrderKey] = useState<string | null>(null);

  const handleClaim = async (order: ClaimableOrder) => {
    setClaimingOrderKey(order.key);

    // Open modal
    txModal.setPending(
      'Claim Proceeds',
      `Claiming ${order.sideLabel.toLowerCase()} order proceeds at tick ${order.tick}...`
    );
    txModal.openModal();

    try {
      const hash = await claim(order.poolId, order.tick, order.side);

      if (hash) {
        txModal.setSuccess(hash, [
          { label: 'Order Type', value: `Limit ${order.sideLabel}` },
          { label: 'Trigger Price', value: `$${order.price.toFixed(4)}` },
          { label: 'Tick', value: order.tick.toString() },
          { label: 'Proceeds', value: 'Encrypted amount claimed' },
        ]);

        // Refresh the list after successful claim
        setTimeout(() => refetch(), 2000);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Claim failed';
      txModal.setError(errorMessage);
    } finally {
      setClaimingOrderKey(null);
      resetWithdraw();
    }
  };

  const handleClaimAll = async () => {
    if (claimableOrders.length === 0) return;

    txModal.setPending(
      'Claim All Proceeds',
      `Claiming proceeds from ${claimableOrders.length} orders...`
    );
    txModal.openModal();

    let successCount = 0;
    let lastHash: `0x${string}` | null = null;

    for (const order of claimableOrders) {
      try {
        setClaimingOrderKey(order.key);
        const hash = await claim(order.poolId, order.tick, order.side);
        if (hash) {
          lastHash = hash;
          successCount++;
        }
      } catch (err) {
        console.error(`Failed to claim order at tick ${order.tick}:`, err);
      }
    }

    setClaimingOrderKey(null);
    resetWithdraw();

    if (successCount === claimableOrders.length && lastHash) {
      txModal.setSuccess(lastHash, [
        { label: 'Orders Claimed', value: successCount.toString() },
        { label: 'Status', value: 'All proceeds claimed successfully' },
      ]);
    } else if (successCount > 0) {
      txModal.setSuccess(lastHash!, [
        { label: 'Orders Claimed', value: `${successCount} of ${claimableOrders.length}` },
        { label: 'Note', value: 'Some claims may have failed' },
      ]);
    } else {
      txModal.setError('Failed to claim any orders');
    }

    // Refresh the list
    setTimeout(() => refetch(), 2000);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Claimable Proceeds</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Claimable Proceeds</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-deep-magenta mb-4">{error}</p>
            <Button variant="secondary" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (claimableOrders.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Claimable Proceeds</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-4xl mb-4">
              <Gift className="w-12 h-12 mx-auto text-feather-white/40" />
            </p>
            <p className="text-feather-white/60">No proceeds to claim</p>
            <p className="text-sm text-feather-white/40 mt-2">
              When your limit orders are filled, you can claim proceeds here
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Claimable Proceeds ({claimableOrders.length})</CardTitle>
            <p className="text-sm text-feather-white/60 mt-1">
              {token0?.symbol}/{token1?.symbol} orders ready to claim
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            {claimableOrders.length > 1 && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleClaimAll}
                disabled={isWithdrawing}
              >
                {isWithdrawing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Claiming...
                  </>
                ) : (
                  'Claim All'
                )}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {claimableOrders.map((order) => (
            <ClaimableOrderItem
              key={order.key}
              order={order}
              onClaim={handleClaim}
              isClaiming={isWithdrawing}
              isClaimingThis={claimingOrderKey === order.key}
            />
          ))}
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
