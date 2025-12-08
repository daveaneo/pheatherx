'use client';

import { useAccount } from 'wagmi';
import { Loader2, X } from 'lucide-react';
import { ConnectPrompt } from '@/components/common/ConnectPrompt';
import { FheSessionGuard } from '@/components/common/FheSessionGuard';
import { TokenBalanceTable } from '@/components/portfolio/TokenBalanceTable';
import { WrapUnwrapCard } from '@/components/tokens/WrapUnwrapCard';
import { Card, CardContent, CardHeader, CardTitle, Button, Badge, Tabs, TabsList, TabsTrigger, TabsContent, Skeleton } from '@/components/ui';
import { useActiveOrders } from '@/hooks/useActiveOrders';
import { useCancelOrder } from '@/hooks/useCancelOrder';

export default function PortfolioPage() {
  const { isConnected } = useAccount();

  if (!isConnected) {
    return <ConnectPrompt message="Connect your wallet to view your portfolio" />;
  }

  return (
    <FheSessionGuard requireSession>
      <div className="max-w-4xl mx-auto space-y-6 px-4 sm:px-0">
        {/* Header */}
        <div>
          <h1 className="text-2xl sm:text-heading-2 font-bold mb-1">Portfolio</h1>
          <p className="text-sm sm:text-base text-feather-white/60">
            Manage your balances and orders
          </p>
        </div>

        {/* Unified Token Balance Table */}
        <TokenBalanceTable />

        {/* Wrap/Unwrap Section */}
        <WrapUnwrapCard />

        {/* Tabs for Orders and History */}
        <Tabs defaultValue="orders">
          <TabsList className="mb-6">
            <TabsTrigger value="orders">Active Orders</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="orders">
            <ActiveOrdersSection />
          </TabsContent>

          <TabsContent value="history">
            <TradeHistoryPlaceholder />
          </TabsContent>
        </Tabs>
      </div>
    </FheSessionGuard>
  );
}

/**
 * Active orders section using V4 hooks
 */
function ActiveOrdersSection() {
  const { orderIds, isLoading, refetch } = useActiveOrders();
  const { cancelOrder, isCancelling } = useCancelOrder();

  const handleCancel = async (orderId: bigint) => {
    try {
      await cancelOrder(orderId);
      refetch();
    } catch (err) {
      console.error('Cancel failed:', err);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Active Orders</CardTitle>
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

  const hasOrders = orderIds && orderIds.length > 0;

  if (!hasOrders) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Active Orders</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-feather-white/40">
            <p className="text-lg mb-2">No active orders</p>
            <p className="text-sm">Place limit orders on the Trade page to see them here</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Active Orders</span>
          <Badge variant="default">{orderIds?.length ?? 0}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Table Header */}
        <div className="grid grid-cols-4 gap-4 px-4 py-2 text-xs text-feather-white/40 border-b border-carbon-gray">
          <span>Order ID</span>
          <span>Amount</span>
          <span>Status</span>
          <span className="text-right">Action</span>
        </div>

        {/* Order Rows */}
        <div className="divide-y divide-carbon-gray">
          {orderIds?.map((orderId) => (
            <div
              key={orderId.toString()}
              className="grid grid-cols-4 gap-4 px-4 py-4 items-center hover:bg-ash-gray/20"
            >
              {/* Order ID */}
              <div className="font-mono">#{orderId.toString()}</div>

              {/* Amount (encrypted) */}
              <div className="font-mono text-feather-white/60">••••••</div>

              {/* Status */}
              <div>
                <Badge variant="default">Active</Badge>
              </div>

              {/* Action */}
              <div className="text-right">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleCancel(orderId)}
                  disabled={isCancelling}
                  className="text-deep-magenta hover:text-deep-magenta"
                >
                  {isCancelling ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <X className="w-4 h-4 mr-1" />
                      Cancel
                    </>
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-4 pt-4 border-t border-carbon-gray text-xs text-feather-white/40 text-center">
          Order amounts are encrypted. Cancel to retrieve your funds.
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Placeholder for trade history - will be implemented to show chain events
 */
function TradeHistoryPlaceholder() {
  return (
    <div className="rounded-xl border border-carbon-gray bg-ash-gray/20 p-8">
      <div className="text-center text-feather-white/40">
        <div className="text-4xl mb-4">📜</div>
        <h3 className="text-lg font-medium text-feather-white mb-2">Trade History</h3>
        <p className="text-sm">
          Your swap and order history will appear here.
        </p>
        <p className="text-xs mt-2">
          Coming soon: View past swaps, orders, claims, and cancellations.
        </p>
      </div>
    </div>
  );
}
