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
  const {
    status,
    error,
    isReady,
    isInitializing,
    isMock,
    initSource,
    wasAutoInitRejected,
    initialize,
  } = useFheSession();

  if (!isConnected) {
    return <ConnectPrompt message="Connect your wallet to access private features" />;
  }

  if (!requireSession) {
    return <>{children}</>;
  }

  // Error state
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

  // Expired state
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

  // Not ready - show appropriate message based on context
  if (!isReady) {
    // Auto-initialization in progress - show waiting state without button
    if (isInitializing && initSource === 'auto') {
      return (
        <div className="flex items-center justify-center min-h-[50vh]">
          <Card className="text-center max-w-md">
            <div className="text-4xl mb-4">&#x1F510;</div>
            <h2 className="text-xl font-semibold mb-2">Setting Up Privacy Session</h2>
            <p className="text-feather-white/60 mb-4">
              {isMock
                ? 'Initializing mock FHE session...'
                : 'Please sign the message in your wallet to establish a secure privacy session.'}
            </p>
            <div className="flex items-center justify-center gap-2 text-phoenix-ember">
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              <span>Waiting for signature...</span>
            </div>
          </Card>
        </div>
      );
    }

    // Manual initialization in progress
    if (isInitializing && initSource === 'manual') {
      return (
        <div className="flex items-center justify-center min-h-[50vh]">
          <Card className="text-center max-w-md">
            <div className="text-4xl mb-4">&#x1F510;</div>
            <h2 className="text-xl font-semibold mb-2">Privacy Session Required</h2>
            <p className="text-feather-white/60 mb-4">
              {isMock
                ? 'Initializing mock FHE session...'
                : 'Sign a message to establish a secure privacy session.'}
            </p>
            <Button loading disabled>
              Initializing...
            </Button>
          </Card>
        </div>
      );
    }

    // User rejected auto-init signature - show manual button
    if (wasAutoInitRejected) {
      return (
        <div className="flex items-center justify-center min-h-[50vh]">
          <Card className="text-center max-w-md">
            <div className="text-4xl mb-4">&#x1F510;</div>
            <h2 className="text-xl font-semibold mb-2">Privacy Session Required</h2>
            <p className="text-feather-white/60 mb-4">
              A signature is required to establish your privacy session.
              Click below when you&apos;re ready.
            </p>
            <Button onClick={initialize}>Initialize Privacy Session</Button>
          </Card>
        </div>
      );
    }

    // Default: show manual init button (auto-init disabled, not yet triggered, or no initSource)
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
