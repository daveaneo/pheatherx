'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Card } from '@/components/ui/Card';

interface ConnectPromptProps {
  message?: string;
}

export function ConnectPrompt({
  message = 'Connect your wallet to continue',
}: ConnectPromptProps) {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Card className="text-center max-w-md">
        <div className="text-4xl mb-4">&#x1F517;</div>
        <h2 className="text-xl font-semibold mb-2">Wallet Required</h2>
        <p className="text-feather-white/60 mb-6">{message}</p>
        <ConnectButton />
      </Card>
    </div>
  );
}
