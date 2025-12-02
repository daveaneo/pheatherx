'use client';

import Link from 'next/link';
import { useAccount } from 'wagmi';
import { ConnectPrompt } from '@/components/common/ConnectPrompt';
import { OrderHistoryList } from '@/components/orders/OrderHistory';
import { Button } from '@/components/ui/Button';

export default function OrderHistoryPage() {
  const { isConnected } = useAccount();

  if (!isConnected) {
    return <ConnectPrompt message="Connect your wallet to view order history" />;
  }

  return (
    <div className="max-w-2xl mx-auto py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-heading-2 mb-2">Order History</h1>
          <p className="text-feather-white/60">
            View your past orders
          </p>
        </div>
        <Link href="/orders/new">
          <Button>New Order</Button>
        </Link>
      </div>
      <OrderHistoryList />
    </div>
  );
}
