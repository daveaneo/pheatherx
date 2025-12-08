'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useAccount, useChainId, useSwitchChain, usePublicClient } from 'wagmi';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { supportedChains } from '@/lib/chains';
import { isTestMode } from '@/lib/wagmiConfig';

interface NetworkGuardProps {
  children: ReactNode;
}

export function NetworkGuard({ children }: NetworkGuardProps) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { switchChain, isPending } = useSwitchChain();

  const [rpcStatus, setRpcStatus] = useState<'checking' | 'ok' | 'error'>('checking');

  const isSupported = supportedChains.some(chain => chain.id === chainId);
  const currentChain = supportedChains.find(chain => chain.id === chainId);
  const isLocalhost = chainId === 31337;

  // Check RPC health when connected to a supported chain
  // Skip in test mode since E2E tests use mock connectors
  useEffect(() => {
    if (!isConnected || !publicClient || !isSupported || isTestMode()) {
      setRpcStatus('ok'); // Skip check if not connected, unsupported, or in test mode
      return;
    }

    setRpcStatus('checking');

    const checkRpc = async () => {
      try {
        await publicClient.getBlockNumber();
        setRpcStatus('ok');
      } catch {
        setRpcStatus('error');
      }
    };

    checkRpc();
  }, [isConnected, chainId, publicClient, isSupported]);

  // Not connected - show content
  if (!isConnected) {
    return <>{children}</>;
  }

  // WRONG NETWORK - wallet on unsupported chain
  if (!isSupported) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Card className="text-center max-w-md p-6">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold mb-2 text-phoenix-ember">Wrong Network</h2>
          <p className="text-feather-white/60 mb-6">
            Your wallet is connected to an unsupported network (Chain {chainId}).
            <br />
            Please switch to a supported network.
          </p>
          <div className="flex flex-col gap-2">
            {supportedChains
              .filter(chain => chain.id !== 31337) // Hide localhost from main options
              .map(chain => (
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

  // NETWORK UNREACHABLE - on supported chain but RPC failed
  if (rpcStatus === 'error') {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Card className="text-center max-w-md p-6">
          <div className="text-4xl mb-4">🔌</div>
          <h2 className="text-xl font-semibold mb-2 text-phoenix-ember">
            {isLocalhost ? 'Local Node Not Running' : 'Network Unreachable'}
          </h2>
          <p className="text-feather-white/60 mb-4">
            {isLocalhost ? (
              <>
                Your wallet is on localhost but no local node is running.
                <br />
                <code className="text-xs bg-ash-gray/50 px-2 py-1 rounded mt-2 inline-block">
                  cd contracts && anvil
                </code>
              </>
            ) : (
              <>
                Cannot connect to {currentChain?.name || 'the network'}.
                <br />
                The RPC endpoint may be down.
              </>
            )}
          </p>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-feather-white/40 mb-2">Or switch to another network:</p>
            {supportedChains
              .filter(chain => chain.id !== chainId && chain.id !== 31337)
              .map(chain => (
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

  // Still checking RPC - show loading briefly
  if (rpcStatus === 'checking') {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin w-8 h-8 border-2 border-phoenix-ember border-t-transparent rounded-full" />
      </div>
    );
  }

  // All good - render content
  return <>{children}</>;
}
