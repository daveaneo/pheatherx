'use client';

import { ReactNode } from 'react';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { supportedChains } from '@/lib/chains';

interface NetworkGuardProps {
  children: ReactNode;
}

export function NetworkGuard({ children }: NetworkGuardProps) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();

  const isSupported = supportedChains.some(chain => chain.id === chainId);

  if (!isConnected) {
    return <>{children}</>;
  }

  if (!isSupported) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Card className="text-center max-w-md">
          <div className="text-4xl mb-4">&#x26A0;</div>
          <h2 className="text-xl font-semibold mb-2">Unsupported Network</h2>
          <p className="text-feather-white/60 mb-6">
            Please switch to a supported network to use PheatherX.
          </p>
          <div className="flex flex-col gap-2">
            {supportedChains.map(chain => (
              <Button
                key={chain.id}
                variant="secondary"
                onClick={() => switchChain({ chainId: chain.id })}
                loading={isPending}
              >
                Switch to {chain.name}
              </Button>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
