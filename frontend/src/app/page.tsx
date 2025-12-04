'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { StatsCard } from '@/components/analytics/StatsCard';
import { VolumeChart } from '@/components/analytics/VolumeChart';
import { RecentActivity } from '@/components/analytics/RecentActivity';
import { useProtocolStats } from '@/hooks/useProtocolStats';
import { useTransactionStore } from '@/stores/transactionStore';

const features = [
  {
    icon: (
      <svg className="w-8 h-8 text-phoenix-ember" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    title: 'Encrypted Swaps',
    description: 'Your trades are encrypted using FHE technology. No one can see your order sizes or strategies.',
  },
  {
    icon: (
      <svg className="w-8 h-8 text-phoenix-ember" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
    title: 'Private Limit Orders',
    description: 'Place encrypted limit orders, stop-losses, and take-profits with complete privacy.',
  },
  {
    icon: (
      <svg className="w-8 h-8 text-phoenix-ember" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    title: 'MEV Protection',
    description: 'Encrypted order flow means no front-running, sandwich attacks, or MEV extraction.',
  },
  {
    icon: (
      <svg className="w-8 h-8 text-phoenix-ember" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
    title: 'Institutional-Grade',
    description: 'Built for serious traders who need confidential execution at scale.',
  },
];

const howItWorks = [
  {
    step: 1,
    title: 'Deposit',
    description: 'Deposit tokens into your PheatherX balance to enable encrypted accounting.',
  },
  {
    step: 2,
    title: 'Trade',
    description: 'Execute encrypted trades - swap or place limit orders privately.',
  },
  {
    step: 3,
    title: 'Manage & Withdraw',
    description: 'Cancel orders and withdraw tokens back to your wallet anytime.',
  },
];

// Static volume data for chart (would come from indexer in production)
const staticVolumeData = Array.from({ length: 24 }, (_, i) => ({
  time: `${i}:00`,
  value: Math.floor(Math.random() * 50000 + 10000),
}));

export default function HomePage() {
  // Fetch real protocol stats from the blockchain
  const { tvl, poolCount, isLoading: isLoadingStats } = useProtocolStats();
  const transactions = useTransactionStore(state => state.transactions);

  // Convert transactions to activity format for RecentActivity component
  const recentActivities = useMemo(() => {
    return transactions
      .filter(tx => tx.status === 'confirmed')
      .slice(0, 5)
      .map(tx => {
        // Map transaction types to activity types
        const typeMap: Record<string, 'swap' | 'deposit' | 'withdraw' | 'order_placed' | 'order_filled'> = {
          swap: 'swap',
          deposit: 'deposit',
          withdraw: 'withdraw',
          placeOrder: 'order_placed',
          cancelOrder: 'withdraw', // Show as withdraw since funds return
          approve: 'deposit', // Show approvals as deposits
          faucet: 'deposit', // Show faucet as deposits
        };

        return {
          type: typeMap[tx.type] || 'swap',
          amount: tx.description,
          timestamp: new Date(tx.createdAt),
          txHash: tx.hash,
        };
      });
  }, [transactions]);

  // Stats to display in the hero bar - protocol-agnostic metrics
  const heroStats = [
    { label: 'Total Value Locked', value: isLoadingStats ? '...' : tvl },
    { label: 'Active Pools', value: isLoadingStats ? '...' : poolCount.toString() },
    { label: 'Transactions', value: transactions.length.toString() },
  ];

  return (
    <div className="min-h-[80vh] flex flex-col">
      {/* Hero Section */}
      <section className="flex-1 flex flex-col items-center justify-center text-center py-16 px-4">
        <div className="max-w-3xl">
          <h1 className="text-display-2 md:text-display-1 mb-6">
            <span className="text-phoenix-ember">Trade in Silence</span>
          </h1>
          <p className="text-xl text-feather-white/70 mb-8 max-w-2xl mx-auto">
            Private execution powered by FHE. Your trades, your secret.
            PheatherX keeps your orders hidden from everyone - including validators.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/portfolio">
              <Button size="lg" className="w-full sm:w-auto">
                Launch dApp
              </Button>
            </Link>
            <Link href="#how-it-works">
              <Button variant="secondary" size="lg" className="w-full sm:w-auto">
                Learn More
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="py-8 px-4 border-y border-carbon-gray/50 bg-ash-gray/30">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-3 gap-4">
            {heroStats.map((stat, index) => (
              <div key={index} className="text-center">
                <p className="text-2xl md:text-3xl font-bold text-phoenix-ember">
                  {stat.value}
                </p>
                <p className="text-sm text-feather-white/60">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-heading-2 text-center mb-12">
            Why PheatherX?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, index) => (
              <Card key={index} interactive>
                <CardContent className="pt-6">
                  <div className="mb-4">
                    {feature.icon}
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                  <p className="text-feather-white/60 text-sm">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-16 px-4 bg-ash-gray/20">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-heading-2 text-center mb-4">
            How It Works
          </h2>
          <p className="text-center text-feather-white/60 mb-12 max-w-2xl mx-auto">
            Unlike traditional DEXs where you swap directly from your wallet,
            PheatherX requires depositing tokens first. This enables encrypted
            accounting - your balance and trades remain private on-chain.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {howItWorks.map((item) => (
              <div key={item.step} className="text-center">
                <div className="w-12 h-12 rounded-full bg-carbon-gray border border-phoenix-ember/30 flex items-center justify-center mx-auto mb-4">
                  <span className="text-xl font-bold text-phoenix-ember">{item.step}</span>
                </div>
                <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                <p className="text-feather-white/60 text-sm">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Analytics Dashboard Section */}
      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-heading-2 text-center mb-4">
            Protocol Analytics
          </h2>
          <p className="text-center text-feather-white/60 mb-12">
            Real-time statistics from the PheatherX protocol
          </p>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatsCard
              title="Total Value Locked"
              value={tvl}
              isLoading={isLoadingStats}
            />
            <StatsCard
              title="Active Pools"
              value={poolCount.toString()}
              isLoading={isLoadingStats}
            />
            <StatsCard
              title="Your Transactions"
              value={transactions.length.toString()}
            />
            <StatsCard
              title="Supported Networks"
              value="3"
            />
          </div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <VolumeChart data={staticVolumeData} />
            <RecentActivity
              activities={recentActivities.length > 0 ? recentActivities : undefined}
            />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 px-4">
        <Card className="max-w-4xl mx-auto border-phoenix-ember/30 p-8 text-center">
          <h2 className="text-heading-2 mb-4">Ready to trade privately?</h2>
          <p className="text-feather-white/70 mb-6 max-w-xl mx-auto">
            Connect your wallet and experience the future of private DeFi trading.
          </p>
          <Link href="/portfolio">
            <Button size="lg">
              Launch dApp
            </Button>
          </Link>
        </Card>
      </section>
    </div>
  );
}
