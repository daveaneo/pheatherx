'use client';

import { useAccount } from 'wagmi';
import { ConnectPrompt } from '@/components/common/ConnectPrompt';
import { FheSessionGuard } from '@/components/common/FheSessionGuard';
import { OrderForm } from '@/components/orders/OrderForm';

export default function NewOrderPage() {
  const { isConnected } = useAccount();

  if (!isConnected) {
    return <ConnectPrompt message="Connect your wallet to place orders" />;
  }

  return (
    <FheSessionGuard requireSession>
      <div className="max-w-lg mx-auto py-8">
        <div className="mb-6">
          <h1 className="text-heading-2 mb-2">New Order</h1>
          <p className="text-feather-white/60">
            Create a private limit or stop order
          </p>
        </div>
        <OrderForm />
      </div>
    </FheSessionGuard>
  );
}
