'use client';

import { useAccount, useBalance, useChainId } from 'wagmi';
import { formatEther } from 'viem';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/stores/uiStore';

export function FaucetEthRequest() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { data: balance, isLoading } = useBalance({ address, chainId });
  const { success: successToast, error: errorToast } = useToast();

  // For local Anvil, users get ETH automatically when they connect
  // For testnets, we'd link to a faucet
  const handleRequestEth = () => {
    if (chainId === 31337) {
      successToast(
        'Local Development',
        'On Anvil, you already have test ETH. If you need more, restart Anvil.'
      );
    } else {
      // Would link to external faucet for testnets
      errorToast('External Faucet', 'Please use an external faucet for this testnet');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>ETH Balance</CardTitle>
        <p className="text-sm text-feather-white/60">
          {chainId === 31337
            ? 'Local Anvil provides test ETH automatically'
            : 'Request ETH from a testnet faucet'}
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
              <Button size="sm" onClick={handleRequestEth}>
                Get ETH
              </Button>
            )}
          </div>
        </div>

        {chainId === 31337 && (
          <p className="mt-3 text-xs text-feather-white/40 text-center">
            Anvil provides 10,000 ETH to each test account. Restart Anvil to reset balances.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
