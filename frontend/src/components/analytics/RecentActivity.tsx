'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { TransactionLink } from '@/components/common/TransactionLink';
import { formatDistanceToNow } from 'date-fns';

type ActivityType =
  | 'swap'
  | 'limit_order'
  | 'withdraw'
  | 'claim'
  | 'exit'
  | 'order_filled'
  | 'faucet'
  | 'approve'
  | 'deposit'
  | 'order_placed';

interface Activity {
  type: ActivityType;
  amount: string;
  timestamp: Date;
  txHash: `0x${string}`;
}

interface RecentActivityProps {
  activities?: Activity[];
  isLoading?: boolean;
}

const activityConfig: Record<ActivityType, { label: string; variant: 'info' | 'success' | 'warning' | 'error'; icon: string }> = {
  swap: { label: 'Market Swap', variant: 'info', icon: '&#x21C4;' },
  limit_order: { label: 'Limit Order', variant: 'success', icon: '&#x1F4CB;' },
  withdraw: { label: 'Withdrawn', variant: 'warning', icon: '&#x2B06;' },
  claim: { label: 'Claimed', variant: 'success', icon: '&#x2705;' },
  exit: { label: 'Position Exited', variant: 'warning', icon: '&#x1F6AA;' },
  order_filled: { label: 'Order Filled', variant: 'success', icon: '&#x2705;' },
  faucet: { label: 'Faucet', variant: 'info', icon: '&#x1F6B0;' },
  approve: { label: 'Approved', variant: 'info', icon: '&#x2714;' },
  // Legacy types for backwards compatibility
  deposit: { label: 'Limit Order', variant: 'success', icon: '&#x1F4CB;' },
  order_placed: { label: 'Limit Order', variant: 'success', icon: '&#x1F4CB;' },
};

export function RecentActivity({ activities, isLoading }: RecentActivityProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </CardContent>
      </Card>
    );
  }

  if (!activities || activities.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-4xl mb-4">&#x1F4CA;</p>
            <p className="text-feather-white/60">No recent activity</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {activities.map((activity, index) => {
          const config = activityConfig[activity.type];
          return (
            <div
              key={index}
              className="flex items-center justify-between p-3 bg-ash-gray rounded-lg"
            >
              <div className="flex items-center gap-3">
                <span
                  className="text-xl"
                  dangerouslySetInnerHTML={{ __html: config.icon }}
                />
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant={config.variant}>{config.label}</Badge>
                    <span className="text-sm font-medium">{activity.amount}</span>
                  </div>
                  <p className="text-xs text-feather-white/40 mt-1">
                    {formatDistanceToNow(activity.timestamp, { addSuffix: true })}
                  </p>
                </div>
              </div>
              <TransactionLink hash={activity.txHash} />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
