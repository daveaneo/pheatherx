'use client';

import { Card, CardContent, CardHeader, CardTitle, Button, Skeleton, Badge, TransactionModal } from '@/components/ui';
import { Loader2, X, Lock } from 'lucide-react';
import { useActiveOrders, type ActivePosition } from '@/hooks/useActiveOrders';
import { useCancelOrder } from '@/hooks/useCancelOrder';
import { useTransactionModal } from '@/hooks/useTransactionModal';
import { tickToPrice, formatPrice } from '@/lib/constants';
import { useSelectedPool } from '@/stores/poolStore';

interface ActiveOrdersPanelProps {
  currentTick: number;
}

export function ActiveOrdersPanel({ currentTick }: ActiveOrdersPanelProps) {
  const { positions, isLoading, refetch } = useActiveOrders();
  const { withdraw, isCancelling, step } = useCancelOrder();
  const { token0, token1 } = useSelectedPool();
  const txModal = useTransactionModal();

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

      // Refresh positions list
      refetch();
    } catch (err) {
      // Show error in modal
      const errorMessage = err instanceof Error ? err.message : 'Failed to withdraw order';
      txModal.setError(errorMessage);
      console.error('Withdraw failed:', err);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Active Orders</CardTitle>
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
          <CardTitle>Your Active Orders</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-feather-white/40">
            <p>No active orders</p>
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
            <span>Your Active Orders</span>
            <Badge variant="default">{positions?.length ?? 0}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Header */}
          <div className="grid grid-cols-5 gap-4 px-4 py-2 text-xs text-feather-white/40 border-b border-carbon-gray">
            <span>Tick</span>
            <span>Price</span>
            <span>Side</span>
            <span>Amount</span>
            <span className="text-right">Action</span>
          </div>

          {/* Orders */}
          <div className="divide-y divide-carbon-gray">
            {positions?.map((position) => {
              const price = tickToPrice(position.tick);
              const priceFormatted = formatPrice(price);
              // Determine deposit/receive tokens based on side
              const depositToken = position.side === 1 ? token0 : token1; // SELL deposits token0, BUY deposits token1
              const receiveToken = position.side === 1 ? token1 : token0;

              return (
                <div
                  key={`${position.tick}-${position.side}`}
                  className="grid grid-cols-5 gap-4 px-4 py-3 items-center hover:bg-ash-gray/30"
                >
                  {/* Tick */}
                  <div className="font-mono text-sm">{position.tick}</div>

                  {/* Price */}
                  <div className="font-mono text-sm">
                    {priceFormatted}
                  </div>

                  {/* Side */}
                  <div>
                    <Badge variant={position.sideLabel === 'BUY' ? 'success' : 'error'}>
                      {position.sideLabel}
                    </Badge>
                  </div>

                  {/* Amount (encrypted) */}
                  <div className="flex items-center gap-1 font-mono text-feather-white/40">
                    <Lock className="w-3 h-3" />
                    <span>******</span>
                  </div>

                  {/* Action */}
                  <div className="text-right">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleCancel(position)}
                      disabled={isCancelling}
                      className="text-deep-magenta hover:text-deep-magenta"
                    >
                      {isCancelling ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-1" />
                          {step === 'encrypting' ? 'Encrypting...' : 'Withdrawing...'}
                        </>
                      ) : (
                        <>
                          <X className="w-4 h-4 mr-1" />
                          Withdraw
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="mt-4 pt-4 border-t border-carbon-gray text-xs text-feather-white/40 text-center">
            <Lock className="w-3 h-3 inline mr-1" />
            Order amounts are encrypted with FHE. Withdraw to retrieve your funds.
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
