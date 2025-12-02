'use client';

import Link from 'next/link';
import { useAccount } from 'wagmi';
import { ConnectPrompt } from '@/components/common/ConnectPrompt';
import { FheSessionGuard } from '@/components/common/FheSessionGuard';
import { OrderList } from '@/components/orders/OrderList';
import { Button } from '@/components/ui/Button';

export default function ActiveOrdersPage() {
  const { isConnected } = useAccount();

  if (!isConnected) {
    return <ConnectPrompt message="Connect your wallet to view orders" />;
  }

  return (
    <FheSessionGuard requireSession>
      <div className="max-w-2xl mx-auto py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-heading-2 mb-2">Active Orders</h1>
            <p className="text-feather-white/60">
              Manage your open orders
            </p>
          </div>
          <Link href="/orders/new">
            <Button>New Order</Button>
          </Link>
        </div>
        <OrderList />
      </div>
    </FheSessionGuard>
  );
}
