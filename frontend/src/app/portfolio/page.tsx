'use client';

import { useAccount } from 'wagmi';
import { ConnectPrompt } from '@/components/common/ConnectPrompt';
import { FheSessionGuard } from '@/components/common/FheSessionGuard';
import { TokenBalanceTable } from '@/components/portfolio/TokenBalanceTable';
import { LimitOrderPositionsPanel } from '@/components/portfolio/LimitOrderPositionsPanel';
import { WrapUnwrapCard } from '@/components/tokens/WrapUnwrapCard';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui';

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

        {/* Tabs for Positions and History */}
        <Tabs defaultValue="positions">
          <TabsList className="mb-6">
            <TabsTrigger value="positions">Limit Orders</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="positions">
            <LimitOrderPositionsPanel />
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
