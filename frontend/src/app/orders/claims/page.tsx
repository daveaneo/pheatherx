'use client';

import Link from 'next/link';
import { useAccount } from 'wagmi';
import { ConnectPrompt } from '@/components/common/ConnectPrompt';
import { FheSessionGuard } from '@/components/common/FheSessionGuard';
import { ClaimableOrdersPanel } from '@/components/orders/ClaimableOrdersPanel';
import { Button } from '@/components/ui/Button';

export default function ClaimsPage() {
  const { isConnected } = useAccount();

  if (!isConnected) {
    return <ConnectPrompt message="Connect your wallet to view claimable orders" />;
  }

  return (
    <FheSessionGuard requireSession>
      <div className="max-w-2xl mx-auto py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-heading-2 mb-2">Claim Proceeds</h1>
            <p className="text-feather-white/60">
              Claim tokens from your filled limit orders
            </p>
          </div>
          <Link href="/orders/new">
            <Button>New Order</Button>
          </Link>
        </div>
        <ClaimableOrdersPanel />
      </div>
    </FheSessionGuard>
  );
}
