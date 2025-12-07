'use client';

import { useState, useCallback } from 'react';
import { useAccount, useBalance, useChainId } from 'wagmi';
import { formatUnits } from 'viem';
import { Wallet, Lock, Loader2, Droplets } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EncryptedBalance } from '@/components/common/EncryptedBalance';
import { getFaucetTokens } from '@/lib/faucetTokens';
import { TOKEN_LIST } from '@/lib/tokens';
import { useFaucet } from '@/hooks/useFaucet';

// Token type styling
const TOKEN_STYLES: Record<string, { gradient: string; badge?: string; badgeVariant?: 'info' | 'warning' | 'success' }> = {
  ETH: { gradient: 'from-blue-500 to-indigo-600' },
  WETH: { gradient: 'from-cyan-400 to-blue-500', badge: 'ERC20', badgeVariant: 'info' },
  USDC: { gradient: 'from-emerald-400 to-green-500', badge: 'ERC20', badgeVariant: 'info' },
  fheWETH: { gradient: 'from-violet-500 to-purple-600', badge: 'FHE', badgeVariant: 'warning' },
  fheUSDC: { gradient: 'from-fuchsia-500 to-pink-600', badge: 'FHE', badgeVariant: 'warning' },
};

interface WalletTokenProps {
  symbol: string;
  name: string;
  decimals: number;
  tokenAddress?: `0x${string}`;
  isNative?: boolean;
}

function WalletToken({ symbol, name, decimals, tokenAddress, isNative }: WalletTokenProps) {
  const { address } = useAccount();
  const { data: balance, isLoading } = useBalance({
    address,
    token: isNative ? undefined : tokenAddress,
  });

  const style = TOKEN_STYLES[symbol] || { gradient: 'from-gray-500 to-gray-600' };
  const formattedBalance = balance
    ? Number(formatUnits(balance.value, balance.decimals)).toLocaleString(undefined, {
        maximumFractionDigits: symbol.includes('USDC') ? 2 : 4,
      })
    : '0';

  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${style.gradient} flex items-center justify-center shadow-lg`}>
          <span className="text-white text-sm font-bold">
            {symbol === 'ETH' ? 'Ξ' : symbol.charAt(0)}
          </span>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-feather-white">{symbol}</span>
            {style.badge && (
              <Badge variant={style.badgeVariant} className="text-[10px] px-1.5 py-0">
                {style.badge}
              </Badge>
            )}
          </div>
          <p className="text-xs text-feather-white/40">{name}</p>
        </div>
      </div>
      <div className="text-right">
        {isLoading ? (
          <div className="h-5 w-20 bg-ash-gray/50 animate-pulse rounded" />
        ) : (
          <span className="font-mono text-feather-white font-medium">{formattedBalance}</span>
        )}
      </div>
    </div>
  );
}

interface FheatherXTokenProps {
  symbol: string;
  decimals: number;
  isToken0: boolean;
}

function FheatherXToken({ symbol, decimals, isToken0 }: FheatherXTokenProps) {
  const style = TOKEN_STYLES[symbol] || { gradient: 'from-gray-500 to-gray-600' };

  return (
    <div className="flex items-center justify-between p-3 bg-gradient-to-r from-iridescent-violet/5 to-transparent border border-iridescent-violet/20 rounded-xl">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${style.gradient} flex items-center justify-center shadow-lg relative`}>
          <span className="text-white text-sm font-bold">{symbol.charAt(0)}</span>
          <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-iridescent-violet rounded-full flex items-center justify-center">
            <Lock className="w-2.5 h-2.5 text-white" />
          </div>
        </div>
        <span className="font-semibold text-feather-white">{symbol}</span>
      </div>
      <EncryptedBalance
        isToken0={isToken0}
        decimals={decimals}
        symbol=""
        showRevealButton={true}
      />
    </div>
  );
}

/**
 * Modern portfolio balance display
 * Two-column layout: Wallet | FheatherX positions
 */
export function TokenBalanceTable() {
  const chainId = useChainId();
  const { address } = useAccount();
  const faucetTokens = getFaucetTokens(chainId);
  const poolTokens = TOKEN_LIST[chainId] || [];
  const { requestAllTokens, isRequesting } = useFaucet();
  const [isRequestingAll, setIsRequestingAll] = useState(false);

  const handleGetAllTokens = useCallback(async () => {
    if (faucetTokens.length === 0) return;
    setIsRequestingAll(true);
    try {
      await requestAllTokens(faucetTokens);
    } finally {
      setIsRequestingAll(false);
    }
  }, [faucetTokens, requestAllTokens]);

  return (
    <div className="space-y-4">
      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Wallet Balances */}
        <Card className="overflow-hidden">
          <div className="p-4 border-b border-carbon-gray/30 bg-gradient-to-r from-emerald-500/10 to-transparent">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <Wallet className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <h3 className="font-semibold text-feather-white">Wallet</h3>
                <p className="text-xs text-feather-white/50">Your token balances</p>
              </div>
            </div>
          </div>
          <CardContent className="p-4 space-y-1">
            {/* ETH */}
            <WalletToken symbol="ETH" name="Ether" decimals={18} isNative />

            {/* Divider */}
            <div className="border-t border-carbon-gray/20 my-2" />

            {/* Faucet/Pool Tokens */}
            {faucetTokens.length > 0 ? (
              faucetTokens.map((token) => (
                <WalletToken
                  key={token.address}
                  symbol={token.symbol}
                  name={token.name}
                  decimals={token.decimals}
                  tokenAddress={token.address}
                />
              ))
            ) : (
              poolTokens.map((token) => (
                <WalletToken
                  key={token.address}
                  symbol={token.symbol}
                  name={token.name}
                  decimals={token.decimals}
                  tokenAddress={token.address}
                />
              ))
            )}
          </CardContent>
        </Card>

        {/* FheatherX Positions */}
        <Card className="overflow-hidden">
          <div className="p-4 border-b border-carbon-gray/30 bg-gradient-to-r from-iridescent-violet/10 to-transparent">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-iridescent-violet/20 flex items-center justify-center">
                <Lock className="w-4 h-4 text-iridescent-violet" />
              </div>
              <div>
                <h3 className="font-semibold text-feather-white">In FheatherX</h3>
                <p className="text-xs text-feather-white/50">Encrypted order balances</p>
              </div>
            </div>
          </div>
          <CardContent className="p-4 space-y-3">
            {poolTokens.length > 0 ? (
              poolTokens.map((token, index) => (
                <FheatherXToken
                  key={token.address}
                  symbol={token.symbol}
                  decimals={token.decimals}
                  isToken0={index === 0}
                />
              ))
            ) : (
              <div className="text-center py-6 text-feather-white/40">
                <Lock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No pool tokens configured</p>
              </div>
            )}

            {/* Info text */}
            <p className="text-xs text-feather-white/30 text-center pt-2">
              Only FHERC20 tokens (fheWETH, fheUSDC) can be deposited into FheatherX
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Faucet Bar */}
      {faucetTokens.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 rounded-xl bg-gradient-to-r from-phoenix-ember/10 via-feather-gold/10 to-phoenix-ember/10 border border-phoenix-ember/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-phoenix-ember to-feather-gold flex items-center justify-center">
              <Droplets className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-medium text-feather-white">Testnet Faucet</p>
              <p className="text-xs text-feather-white/50">Get 100 of each token • 1hr cooldown</p>
            </div>
          </div>
          <Button
            onClick={handleGetAllTokens}
            disabled={isRequesting || isRequestingAll}
            className="w-full sm:w-auto"
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
        </div>
      )}
    </div>
  );
}
