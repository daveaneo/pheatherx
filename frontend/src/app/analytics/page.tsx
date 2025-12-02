'use client';

import { useAccount } from 'wagmi';
import { ConnectPrompt } from '@/components/common/ConnectPrompt';
import { StatsCard } from '@/components/analytics/StatsCard';
import { VolumeChart } from '@/components/analytics/VolumeChart';
import { RecentActivity } from '@/components/analytics/RecentActivity';

// Mock data for demo
const mockStats = {
  tvl: '$1.2M',
  volume24h: '$450K',
  trades24h: '1,234',
  fees24h: '$4.5K',
};

const mockVolumeData = Array.from({ length: 24 }, (_, i) => ({
  time: `${i}:00`,
  value: Math.random() * 50000 + 10000,
}));

const mockActivities = [
  {
    type: 'swap' as const,
    amount: '1.5 ETH -> 3000 USDC',
    timestamp: new Date(Date.now() - 5 * 60 * 1000),
    txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as `0x${string}`,
  },
  {
    type: 'order_filled' as const,
    amount: '0.5 ETH @ $2000',
    timestamp: new Date(Date.now() - 15 * 60 * 1000),
    txHash: '0x2345678901abcdef2345678901abcdef2345678901abcdef2345678901abcdef' as `0x${string}`,
  },
  {
    type: 'deposit' as const,
    amount: '2 ETH',
    timestamp: new Date(Date.now() - 30 * 60 * 1000),
    txHash: '0x3456789012abcdef3456789012abcdef3456789012abcdef3456789012abcdef' as `0x${string}`,
  },
];

export default function AnalyticsPage() {
  const { isConnected } = useAccount();

  if (!isConnected) {
    return <ConnectPrompt message="Connect your wallet to view analytics" />;
  }

  return (
    <div className="max-w-6xl mx-auto py-8 space-y-8">
      <div>
        <h1 className="text-heading-2 mb-2">Analytics</h1>
        <p className="text-feather-white/60">
          Protocol statistics and your trading activity
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total Value Locked" value={mockStats.tvl} change={5.2} icon="&#x1F4B0;" />
        <StatsCard title="24h Volume" value={mockStats.volume24h} change={-2.1} icon="&#x1F4CA;" />
        <StatsCard title="24h Trades" value={mockStats.trades24h} change={12.5} icon="&#x21C4;" />
        <StatsCard title="24h Fees" value={mockStats.fees24h} change={8.3} icon="&#x1F4B8;" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <VolumeChart data={mockVolumeData} />
        <RecentActivity activities={mockActivities} />
      </div>
    </div>
  );
}
