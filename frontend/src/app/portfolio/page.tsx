'use client';

import { useAccount, useChainId } from 'wagmi';
import { ConnectPrompt } from '@/components/common/ConnectPrompt';
import { FheSessionGuard } from '@/components/common/FheSessionGuard';
import { BalanceCard } from '@/components/portfolio/BalanceCard';
import { DepositForm } from '@/components/portfolio/DepositForm';
import { WithdrawForm } from '@/components/portfolio/WithdrawForm';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
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
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-heading-2 mb-2">Portfolio</h1>
          <p className="text-feather-white/60">
            Manage your private balances in PheatherX
          </p>
        </div>

        {/* Balance Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

        {/* Deposit/Withdraw Tabs */}
        <Tabs defaultValue="deposit">
          <TabsList className="mb-6">
            <TabsTrigger value="deposit">Deposit</TabsTrigger>
            <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
          </TabsList>

          <TabsContent value="deposit">
            <div className="max-w-md">
              <DepositForm />
            </div>
          </TabsContent>

          <TabsContent value="withdraw">
            <div className="max-w-md">
              <WithdrawForm />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </FheSessionGuard>
  );
}
