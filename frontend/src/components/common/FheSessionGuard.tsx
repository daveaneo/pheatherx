'use client';

import { ReactNode } from 'react';
import { useAccount } from 'wagmi';
import { useFheSession } from '@/hooks/useFheSession';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ConnectPrompt } from './ConnectPrompt';

interface FheSessionGuardProps {
  children: ReactNode;
  requireSession?: boolean;
}

export function FheSessionGuard({
  children,
  requireSession = false,
}: FheSessionGuardProps) {
  const { isConnected } = useAccount();
  const { status, error, isReady, isInitializing, isMock, initialize } = useFheSession();

  if (!isConnected) {
    return <ConnectPrompt message="Connect your wallet to access private features" />;
  }

  if (!requireSession) {
    return <>{children}</>;
  }

  if (status === 'error') {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Card className="text-center max-w-md">
          <div className="text-4xl mb-4">&#x26A0;</div>
          <h2 className="text-xl font-semibold mb-2">Session Error</h2>
          <p className="text-feather-white/60 mb-4">{error}</p>
          <Button onClick={initialize}>Try Again</Button>
        </Card>
      </div>
    );
  }

  if (status === 'expired') {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Card className="text-center max-w-md">
          <div className="text-4xl mb-4">&#x23F0;</div>
          <h2 className="text-xl font-semibold mb-2">Session Expired</h2>
          <p className="text-feather-white/60 mb-4">
            Your privacy session has expired. Please re-authenticate.
          </p>
          <Button onClick={initialize}>Refresh Session</Button>
        </Card>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Card className="text-center max-w-md">
          <div className="text-4xl mb-4">&#x1F510;</div>
          <h2 className="text-xl font-semibold mb-2">Privacy Session Required</h2>
          <p className="text-feather-white/60 mb-4">
            {isMock
              ? 'Initialize a mock FHE session for local testing.'
              : 'Sign a message to establish a secure privacy session.'}
          </p>
          <Button onClick={initialize} loading={isInitializing}>
            {isInitializing ? 'Initializing...' : 'Initialize Privacy Session'}
          </Button>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
