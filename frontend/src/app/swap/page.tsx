'use client';

import { useAccount } from 'wagmi';
import { ConnectPrompt } from '@/components/common/ConnectPrompt';
import { FheSessionGuard } from '@/components/common/FheSessionGuard';
import { SwapCard } from '@/components/swap/SwapCard';

export default function SwapPage() {
  const { isConnected } = useAccount();

  if (!isConnected) {
    return <ConnectPrompt message="Connect your wallet to swap tokens" />;
  }

  return (
    <FheSessionGuard requireSession>
      <div className="max-w-lg mx-auto py-8">
        <SwapCard />
      </div>
    </FheSessionGuard>
  );
}
