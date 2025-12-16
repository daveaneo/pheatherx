'use client';

import { useMemo } from 'react';
import { formatUnits } from 'viem';
import { TrendingUp, Droplets, Info, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { usePoolReserves } from '@/hooks/usePoolReserves';
import { useSelectedPool } from '@/stores/poolStore';

export function PoolStats() {
  // Get tokens from selected pool
  const { token0, token1, contractType, hookAddress, isLoading: isLoadingPool } = useSelectedPool();
  const { reserve0, reserve1, isLoading: isLoadingReserves } = usePoolReserves();

  const isLoading = isLoadingPool || isLoadingReserves;
  const hasReserves = reserve0 > 0n && reserve1 > 0n;

  // Format reserves
  const formattedReserves = useMemo(() => {
    if (!token0 || !token1 || reserve0 === 0n) return null;

    const r0 = parseFloat(formatUnits(reserve0, token0.decimals));
    const r1 = parseFloat(formatUnits(reserve1, token1.decimals));

    return {
      reserve0: r0.toLocaleString(undefined, { maximumFractionDigits: 4 }),
      reserve1: r1.toLocaleString(undefined, { maximumFractionDigits: 4 }),
    };
  }, [reserve0, reserve1, token0, token1]);

  // Calculate current price from reserves
  const currentPrice = useMemo(() => {
    if (!token0 || !token1 || reserve0 === 0n || reserve1 === 0n) return null;

    const r0 = Number(formatUnits(reserve0, token0.decimals));
    const r1 = Number(formatUnits(reserve1, token1.decimals));

    if (r0 === 0) return null;

    const price = r1 / r0;

    // Format based on magnitude
    if (price >= 1000) return price.toFixed(2);
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(6);
  }, [reserve0, reserve1, token0, token1]);

  // Calculate estimated TVL
  const tvlEstimate = useMemo(() => {
    if (!token0 || !token1 || reserve0 === 0n) return null;

    const r0 = Number(formatUnits(reserve0, token0.decimals));
    const r1 = Number(formatUnits(reserve1, token1.decimals));

    // Simple TVL estimate based on token type
    const isToken0Stable = token0.symbol.includes('USDC');
    const isToken1Stable = token1.symbol.includes('USDC');

    if (isToken0Stable) return r0 * 2;
    if (isToken1Stable) return r1 * 2;
    // For ETH pairs, rough estimate at ~$2000/ETH
    if (token0.symbol.includes('ETH')) return r0 * 2000 * 2;
    if (token1.symbol.includes('ETH')) return r1 * 2000 * 2;

    return null;
  }, [reserve0, reserve1, token0, token1]);

  // Get pool type label
  const poolTypeLabel = useMemo(() => {
    switch (contractType) {
      case 'v8fhe': return 'Full Privacy (FHE:FHE)';
      case 'v8mixed': return 'Partial Privacy (ERC:FHE)';
      case 'native': return 'Standard AMM';
      default: return '';
    }
  }, [contractType]);

  // No pool selected
  if (!hookAddress) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center justify-center gap-2 text-feather-white/60">
            <Info className="w-5 h-5" />
            <span>Select a pool to view stats</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">
            {token0?.symbol || '?'} / {token1?.symbol || '?'}
          </CardTitle>
          <span className="text-xs px-2 py-1 rounded-full bg-ash-gray text-feather-white/60">
            {poolTypeLabel}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Current Price */}
          <div className="p-4 bg-ash-gray/50 rounded-lg">
            <div className="flex items-center gap-2 text-feather-white/60 mb-2">
              <TrendingUp className="w-4 h-4" />
              <span className="text-xs uppercase tracking-wider">Current Price</span>
            </div>
            {isLoading ? (
              <div className="flex items-center gap-2 text-feather-white/40">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : currentPrice ? (
              <>
                <p className="text-xl font-bold text-electric-cyan">{currentPrice}</p>
                <p className="text-xs text-feather-white/40 mt-1">
                  {token1?.symbol} per {token0?.symbol}
                </p>
              </>
            ) : (
              <>
                <p className="text-xl font-bold text-feather-white/40">--</p>
                <p className="text-xs text-feather-white/40 mt-1">No liquidity</p>
              </>
            )}
          </div>

          {/* Pool Liquidity */}
          <div className="p-4 bg-ash-gray/50 rounded-lg">
            <div className="flex items-center gap-2 text-feather-white/60 mb-2">
              <Droplets className="w-4 h-4" />
              <span className="text-xs uppercase tracking-wider">Pool Liquidity</span>
            </div>
            {isLoading ? (
              <div className="flex items-center gap-2 text-feather-white/40">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : formattedReserves ? (
              <>
                <p className="text-xl font-bold text-iridescent-violet">
                  {tvlEstimate !== null
                    ? `~$${tvlEstimate.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                    : formattedReserves.reserve0}
                </p>
                <p className="text-xs text-feather-white/40 mt-1">
                  {formattedReserves.reserve0} {token0?.symbol} + {formattedReserves.reserve1} {token1?.symbol}
                </p>
              </>
            ) : (
              <>
                <p className="text-xl font-bold text-feather-white/40">--</p>
                <p className="text-xs text-feather-white/40 mt-1">No liquidity</p>
              </>
            )}
          </div>

          {/* Pool Status */}
          <div className="p-4 bg-ash-gray/50 rounded-lg">
            <div className="flex items-center gap-2 text-feather-white/60 mb-2">
              <Info className="w-4 h-4" />
              <span className="text-xs uppercase tracking-wider">Status</span>
            </div>
            {isLoading ? (
              <div className="flex items-center gap-2 text-feather-white/40">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : hasReserves ? (
              <>
                <p className="text-xl font-bold text-green-400">Active</p>
                <p className="text-xs text-feather-white/40 mt-1">Pool is initialized</p>
              </>
            ) : (
              <>
                <p className="text-xl font-bold text-blue-400">New Pool</p>
                <p className="text-xs text-feather-white/40 mt-1">Add liquidity to start</p>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
