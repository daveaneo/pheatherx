'use client';

import { useState, useCallback } from 'react';
import { useAccount, useBalance, useChainId } from 'wagmi';
import { formatUnits, formatEther } from 'viem';
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from '@/components/ui';
import { Loader2 } from 'lucide-react';
import { useFaucet } from '@/hooks/useFaucet';
import { getFaucetTokens, getFaucetConfig, type FaucetToken } from '@/lib/faucetTokens';

/**
 * Compact faucet section for the portfolio page
 * Provides quick access to testnet tokens
 */
export function FaucetSection() {
  const chainId = useChainId();
  const { address } = useAccount();
  const tokens = getFaucetTokens(chainId);
  const faucetConfig = getFaucetConfig(chainId);
  const { requestTokens, requestAllTokens, isRequesting, requestingToken } = useFaucet();
  const [isRequestingAll, setIsRequestingAll] = useState(false);

  const { data: ethBalance } = useBalance({ address, chainId });

  const handleRequestAll = useCallback(async () => {
    setIsRequestingAll(true);
    try {
      await requestAllTokens(tokens);
    } finally {
      setIsRequestingAll(false);
    }
  }, [tokens, requestAllTokens]);

  // Get network name
  const getNetworkName = (id: number): string => {
    switch (id) {
      case 31337: return 'Local Anvil';
      case 11155111: return 'Ethereum Sepolia';
      case 421614: return 'Arbitrum Sepolia';
      case 8008135: return 'Fhenix Testnet';
      default: return 'Unknown';
    }
  };

  if (tokens.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Testnet Faucet</span>
            <Badge variant="warning">{getNetworkName(chainId)}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-feather-white/60 text-center py-4">
            No faucet tokens available. Switch to a supported testnet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Testnet Faucet</span>
          <Badge variant="success">{getNetworkName(chainId)}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ETH Balance */}
        <div className="flex items-center justify-between p-3 bg-ash-gray/30 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm">
              Ξ
            </div>
            <div>
              <span className="font-medium text-feather-white">ETH</span>
              <p className="text-xs text-feather-white/50">
                {ethBalance ? Number(formatEther(ethBalance.value)).toFixed(4) : '0'} ETH
              </p>
            </div>
          </div>
          {chainId === 31337 ? (
            <Badge variant="success">Auto-funded</Badge>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => window.open('https://sepoliafaucet.com/', '_blank')}
            >
              Get ETH
            </Button>
          )}
        </div>

        {/* Token Grid (styled like ETH section) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {tokens.slice(0, 4).map((token) => (
            <TokenRowCompact
              key={token.address}
              token={token}
              onRequest={requestTokens}
              isRequesting={isRequesting && requestingToken === token.address}
              disabled={isRequesting}
            />
          ))}
        </div>

        {/* Get All Button */}
        <Button
          className="w-full"
          onClick={handleRequestAll}
          disabled={isRequesting || isRequestingAll}
        >
          {isRequestingAll ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Requesting...
            </>
          ) : (
            'Get All Tokens'
          )}
        </Button>

        <p className="text-xs text-center text-feather-white/40">
          Faucet cooldown: 1 hour per token
        </p>
      </CardContent>
    </Card>
  );
}

function TokenRowCompact({
  token,
  onRequest,
  isRequesting,
  disabled,
}: {
  token: FaucetToken;
  onRequest: (token: FaucetToken) => void;
  isRequesting: boolean;
  disabled: boolean;
}) {
  const { address } = useAccount();
  const { data: balance } = useBalance({
    address,
    token: token.address,
  });

  // Gradient colors based on token type
  const gradientClass = token.type === 'fheerc20'
    ? 'from-amber-500 to-orange-600'
    : 'from-emerald-500 to-teal-600';

  return (
    <div className="flex items-center justify-between p-3 bg-ash-gray/30 rounded-lg">
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${gradientClass} flex items-center justify-center text-sm`}>
          {token.type === 'fheerc20' ? '🔐' : '💰'}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-feather-white">{token.symbol}</span>
            <Badge variant={token.type === 'fheerc20' ? 'warning' : 'info'} className="text-xs">
              {token.type === 'fheerc20' ? 'FHE' : 'ERC20'}
            </Badge>
          </div>
          <p className="text-xs text-feather-white/50">
            {balance ? Number(formatUnits(balance.value, balance.decimals)).toFixed(2) : '0'} {token.symbol}
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onRequest(token)}
        disabled={disabled}
      >
        {isRequesting ? <Loader2 className="w-3 h-3 animate-spin" /> : '+100'}
      </Button>
    </div>
  );
}
