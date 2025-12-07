'use client';

import { useAccount, useChainId } from 'wagmi';
import { ConnectPrompt } from '@/components/common/ConnectPrompt';
import { FheSessionGuard } from '@/components/common/FheSessionGuard';
import { BalanceCard } from '@/components/portfolio/BalanceCard';
import { FaucetSection } from '@/components/portfolio/FaucetSection';
import { BucketPositionsTable } from '@/components/portfolio/BucketPositionsTable';
import { ClaimsSection } from '@/components/portfolio/ClaimsSection';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui';
import { TOKEN_LIST } from '@/lib/tokens';

export default function PortfolioPage() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const tokens = TOKEN_LIST[chainId] || [];

  if (!isConnected) {
    return <ConnectPrompt message="Connect your wallet to view your portfolio" />;
  }

  return (
    <FheSessionGuard requireSession>
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-heading-2 mb-2">Portfolio</h1>
          <p className="text-feather-white/60">
            Manage your balances, positions, and claims
          </p>
        </div>

        {/* Top Row: Balances + Faucet */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Balance Cards */}
          <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
            {tokens.slice(0, 2).map((token, index) => (
              <BalanceCard
                key={token.symbol}
                tokenSymbol={token.symbol}
                tokenName={token.name}
                decimals={token.decimals}
                isToken0={index === 0}
                isNative={token.isNative}
              />
            ))}
          </div>

          {/* Faucet Section */}
          <div className="lg:col-span-1">
            <FaucetSection />
          </div>
        </div>

        {/* Tabs for Positions, Claims, History */}
        <Tabs defaultValue="positions">
          <TabsList className="mb-6">
            <TabsTrigger value="positions">Positions</TabsTrigger>
            <TabsTrigger value="claims">Claims</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="positions">
            <BucketPositionsTable />
          </TabsContent>

          <TabsContent value="claims">
            <ClaimsSection />
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
