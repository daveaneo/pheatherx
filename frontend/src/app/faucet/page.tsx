'use client';

import { useAccount, useChainId } from 'wagmi';
import { FaucetTokenList } from '@/components/faucet/FaucetTokenList';
import { FaucetEthRequest } from '@/components/faucet/FaucetEthRequest';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export default function FaucetPage() {
  const { isConnected } = useAccount();
  const chainId = useChainId();

  // Show network indicator
  const getNetworkName = (id: number): string => {
    switch (id) {
      case 31337: return 'Local Anvil';
      case 11155111: return 'Ethereum Sepolia';
      case 421614: return 'Arbitrum Sepolia';
      case 8008135: return 'Fhenix Testnet';
      default: return 'Unknown';
    }
  };
  const networkName = getNetworkName(chainId);

  if (!isConnected) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-feather-white mb-2">Testnet Faucet</h1>
          <p className="text-feather-white/60">
            Get test tokens for the PheatherX ecosystem
          </p>
        </div>

        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <div className="text-6xl mb-4">{'\uD83D\uDCA7'}</div>
              <h2 className="text-xl font-medium text-feather-white mb-2">Connect Your Wallet</h2>
              <p className="text-feather-white/60 mb-4">
                Connect your wallet to request test tokens
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-feather-white mb-2">Testnet Faucet</h1>
            <p className="text-feather-white/60">
              Get test tokens for the PheatherX ecosystem
            </p>
          </div>
          <div
            className="px-3 py-1 bg-electric-teal/10 text-electric-teal rounded-full text-sm"
            data-testid="faucet-network-badge"
          >
            {networkName}
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* ETH Balance & Request */}
        <FaucetEthRequest />

        {/* Ecosystem Tokens */}
        <FaucetTokenList />

        {/* Instructions */}
        <Card>
          <CardContent className="py-6">
            <h3 className="font-medium text-feather-white mb-3">How to use</h3>
            <ol className="space-y-2 text-sm text-feather-white/70">
              <li className="flex gap-2">
                <span className="text-phoenix-ember font-medium">1.</span>
                Click "Get All Tokens" to receive 100 of each token, or request individually
              </li>
              <li className="flex gap-2">
                <span className="text-phoenix-ember font-medium">2.</span>
                Click the + button to add tokens to your wallet for visibility
              </li>
              <li className="flex gap-2">
                <span className="text-phoenix-ember font-medium">3.</span>
                Use standard ERC20 tokens for regular swaps, FHE tokens for privacy-preserving trades
              </li>
              <li className="flex gap-2">
                <span className="text-phoenix-ember font-medium">4.</span>
                Head to Swap or Liquidity to start trading!
              </li>
            </ol>
            <div className="mt-4 p-3 bg-ash-gray/50 rounded-lg">
              <p className="text-xs text-feather-white/60">
                <strong>Note:</strong> Faucet has a 1-hour cooldown per token. If a request fails, you may need to wait.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
