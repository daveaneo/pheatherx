'use client';

import { useAccount, useBalance } from 'wagmi';
import { formatUnits } from 'viem';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAllTokens } from '@/stores/poolStore';
import { useFaucet } from '@/hooks/useFaucet';
import { cn } from '@/lib/utils';
import type { Token } from '@/types/pool';

interface TokenRowProps {
  token: Token;
  onRequestTokens: (token: Token) => void;
  onAddToWallet: (token: Token) => void;
  isRequesting: boolean;
  requestingToken: `0x${string}` | null;
}

function TokenRow({ token, onRequestTokens, onAddToWallet, isRequesting, requestingToken }: TokenRowProps) {
  const { address } = useAccount();
  const { data: balance, isLoading: isLoadingBalance } = useBalance({
    address,
    token: token.address,
  });

  const truncateAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const copyAddress = () => {
    navigator.clipboard.writeText(token.address);
  };

  const isRequestingThis = isRequesting && requestingToken === token.address;

  return (
    <div className="flex items-center justify-between p-4 bg-ash-gray/30 rounded-lg">
      <div className="flex items-center gap-4">
        {/* Token Icon */}
        <div className="w-10 h-10 rounded-full bg-carbon-gray flex items-center justify-center text-xl">
          {'\uD83D\uDCB0'}
        </div>

        {/* Token Info */}
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-feather-white">{token.symbol}</span>
            <span className="text-sm text-feather-white/50">{token.name}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-feather-white/40">
            <span>{truncateAddress(token.address)}</span>
            <button
              onClick={copyAddress}
              className="hover:text-feather-white/70 transition-colors"
              title="Copy address"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Balance & Actions */}
      <div className="flex items-center gap-4">
        {/* Balance */}
        <div className="text-right">
          <span className="text-sm text-feather-white/60">Balance</span>
          <p className="font-medium text-feather-white">
            {isLoadingBalance ? (
              <span className="animate-pulse">...</span>
            ) : balance ? (
              Number(formatUnits(balance.value, balance.decimals)).toLocaleString(undefined, {
                maximumFractionDigits: 4,
              })
            ) : (
              '0'
            )}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onAddToWallet(token)}
            title="Add to wallet"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </Button>
          <Button
            size="sm"
            onClick={() => onRequestTokens(token)}
            loading={isRequestingThis}
            disabled={isRequesting}
          >
            Request
          </Button>
        </div>
      </div>
    </div>
  );
}

export function FaucetTokenList() {
  const tokens = useAllTokens();
  const { requestTokens, addTokenToWallet, isRequesting, requestingToken } = useFaucet();

  if (tokens.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-feather-white/60">
            <p>No tokens available</p>
            <p className="text-sm mt-2">Pools need to be created first</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ecosystem Tokens</CardTitle>
        <p className="text-sm text-feather-white/60">
          Request 1,000 of each token from the faucet
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {tokens.map(token => (
            <TokenRow
              key={token.address}
              token={token}
              onRequestTokens={requestTokens}
              onAddToWallet={addTokenToWallet}
              isRequesting={isRequesting}
              requestingToken={requestingToken}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
