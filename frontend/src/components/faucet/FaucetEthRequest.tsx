'use client';

import { useAccount, useBalance, useChainId } from 'wagmi';
import { formatEther } from 'viem';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/stores/uiStore';
import { getFaucetConfig } from '@/lib/faucetTokens';

// External faucet links by chain ID
const ETH_FAUCET_LINKS: Record<number, { name: string; url: string }[]> = {
  11155111: [
    { name: 'Alchemy Faucet', url: 'https://sepoliafaucet.com/' },
    { name: 'Infura Faucet', url: 'https://www.infura.io/faucet/sepolia' },
    { name: 'QuickNode Faucet', url: 'https://faucet.quicknode.com/ethereum/sepolia' },
  ],
  421614: [
    { name: 'Arbitrum Faucet', url: 'https://www.alchemy.com/faucets/arbitrum-sepolia' },
  ],
};

export function FaucetEthRequest() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { data: balance, isLoading } = useBalance({ address, chainId });
  const { success: successToast, error: errorToast } = useToast();

  const faucetConfig = getFaucetConfig(chainId);
  const faucetLinks = ETH_FAUCET_LINKS[chainId] || [];

  // For local Anvil, users get ETH automatically
  const handleRequestEth = () => {
    if (chainId === 31337) {
      successToast(
        'Local Development',
        'On Anvil, you already have test ETH. If you need more, restart Anvil.'
      );
    } else if (faucetLinks.length > 0) {
      // Open first faucet link
      window.open(faucetLinks[0].url, '_blank');
      successToast(
        'Opening Faucet',
        `Opening ${faucetLinks[0].name}. Request ${faucetConfig?.ethFaucetAmount || '0.01'} ETH for testing.`
      );
    } else {
      errorToast('No Faucet Available', 'No ETH faucet available for this network');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>ETH Balance</CardTitle>
        <p className="text-sm text-feather-white/60">
          {chainId === 31337
            ? 'Local Anvil provides test ETH automatically'
            : `Request ~${faucetConfig?.ethFaucetAmount || '0.01'} ETH from a testnet faucet`}
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between p-4 bg-ash-gray/30 rounded-lg">
          <div className="flex items-center gap-4">
            {/* ETH Icon */}
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xl">
              {'\u039E'}
            </div>

            {/* ETH Info */}
            <div>
              <span className="font-medium text-feather-white">ETH</span>
              <p className="text-sm text-feather-white/50">Native Token</p>
            </div>
          </div>

          {/* Balance & Actions */}
          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="text-sm text-feather-white/60">Balance</span>
              <p className="font-medium text-feather-white">
                {isLoading ? (
                  <span className="animate-pulse">...</span>
                ) : balance ? (
                  Number(formatEther(balance.value)).toLocaleString(undefined, {
                    maximumFractionDigits: 4,
                  })
                ) : (
                  '0'
                )}
              </p>
            </div>

            {chainId === 31337 ? (
              <div className="text-xs text-electric-teal bg-electric-teal/10 px-2 py-1 rounded">
                Auto-funded
              </div>
            ) : (
              <Button size="sm" onClick={handleRequestEth} data-testid="faucet-request-eth">
                Get ETH
              </Button>
            )}
          </div>
        </div>

        {chainId === 31337 ? (
          <p className="mt-3 text-xs text-feather-white/40 text-center">
            Anvil provides 10,000 ETH to each test account. Restart Anvil to reset balances.
          </p>
        ) : faucetLinks.length > 1 ? (
          <div className="mt-3">
            <p className="text-xs text-feather-white/60 mb-2">Other faucets:</p>
            <div className="flex flex-wrap gap-2">
              {faucetLinks.slice(1).map(({ name, url }) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-electric-teal hover:text-electric-teal/80 underline"
                >
                  {name}
                </a>
              ))}
            </div>
          </div>
        ) : null}

        {chainId !== 31337 && (
          <div className="mt-4 p-3 bg-phoenix-ember/10 border border-phoenix-ember/30 rounded-lg">
            <p className="text-xs text-phoenix-ember/90">
              <strong>Tip:</strong> You only need ~{faucetConfig?.ethFaucetAmount || '0.002'} ETH for gas fees.
              Most testnet faucets provide 0.01-0.5 ETH per request.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
