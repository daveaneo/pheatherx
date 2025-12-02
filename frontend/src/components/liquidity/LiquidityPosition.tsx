'use client';

import { formatUnits } from 'viem';
import { useAccount } from 'wagmi';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { useLiquidityPosition } from '@/hooks/useLiquidityPosition';
import { usePoolReserves } from '@/hooks/usePoolReserves';
import { useSelectedPool } from '@/stores/poolStore';

export function LiquidityPosition() {
  const { isConnected } = useAccount();
  // Get tokens from selected pool
  const { token0, token1 } = useSelectedPool();
  const { balance0, balance1, isLoading: positionLoading } = useLiquidityPosition();
  const { reserve0, reserve1, isLoading: reservesLoading } = usePoolReserves();

  const isLoading = positionLoading || reservesLoading;

  const formattedBalance0 = token0
    ? parseFloat(formatUnits(balance0, token0.decimals)).toLocaleString(undefined, {
        maximumFractionDigits: 4,
      })
    : '0';

  const formattedBalance1 = token1
    ? parseFloat(formatUnits(balance1, token1.decimals)).toLocaleString(undefined, {
        maximumFractionDigits: 4,
      })
    : '0';

  // Calculate share percentage
  const share0 = reserve0 > 0n ? Number((balance0 * 10000n) / reserve0) / 100 : 0;
  const share1 = reserve1 > 0n ? Number((balance1 * 10000n) / reserve1) / 100 : 0;
  const avgShare = (share0 + share1) / 2;

  const hasPosition = balance0 > 0n || balance1 > 0n;

  if (!isConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Position</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-feather-white/60 text-center py-8">
            Connect wallet to view your position
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Your Position</CardTitle>
          <p className="text-sm text-feather-white/60">
            Your liquidity in the pool
          </p>
        </div>
        {hasPosition && !isLoading && (
          <Badge variant="success">{avgShare.toFixed(2)}% of pool</Badge>
        )}
      </CardHeader>
      <CardContent>
        {!hasPosition && !isLoading ? (
          <div className="text-center py-8">
            <p className="text-feather-white/60 mb-2">No liquidity position</p>
            <p className="text-sm text-feather-white/40">
              Add liquidity to start earning
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-ash-gray rounded-lg">
              <div>
                <p className="text-sm text-feather-white/60">
                  {token0?.symbol || 'Token0'}
                </p>
                {isLoading ? (
                  <Skeleton className="h-6 w-20 mt-1" />
                ) : (
                  <p className="text-lg font-semibold text-feather-white">
                    {formattedBalance0}
                  </p>
                )}
              </div>
              {!isLoading && balance0 > 0n && (
                <span className="text-sm text-feather-white/40">
                  {share0.toFixed(2)}%
                </span>
              )}
            </div>

            <div className="flex items-center justify-between p-4 bg-ash-gray rounded-lg">
              <div>
                <p className="text-sm text-feather-white/60">
                  {token1?.symbol || 'Token1'}
                </p>
                {isLoading ? (
                  <Skeleton className="h-6 w-20 mt-1" />
                ) : (
                  <p className="text-lg font-semibold text-feather-white">
                    {formattedBalance1}
                  </p>
                )}
              </div>
              {!isLoading && balance1 > 0n && (
                <span className="text-sm text-feather-white/40">
                  {share1.toFixed(2)}%
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
