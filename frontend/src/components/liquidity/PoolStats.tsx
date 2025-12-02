'use client';

import { formatUnits } from 'viem';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { usePoolReserves } from '@/hooks/usePoolReserves';
import { useSelectedPool } from '@/stores/poolStore';

export function PoolStats() {
  // Get tokens from selected pool
  const { token0, token1 } = useSelectedPool();
  const { reserve0, reserve1, isLoading } = usePoolReserves();

  const formattedReserve0 = token0
    ? parseFloat(formatUnits(reserve0, token0.decimals)).toLocaleString(undefined, {
        maximumFractionDigits: 4,
      })
    : '0';

  const formattedReserve1 = token1
    ? parseFloat(formatUnits(reserve1, token1.decimals)).toLocaleString(undefined, {
        maximumFractionDigits: 4,
      })
    : '0';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pool Overview</CardTitle>
        <p className="text-sm text-feather-white/60">
          Total liquidity in the pool
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-ash-gray rounded-lg">
            <p className="text-sm text-feather-white/60 mb-1">
              {token0?.symbol || 'Token0'} Reserve
            </p>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="text-xl font-bold text-feather-white">
                {formattedReserve0}
              </p>
            )}
          </div>
          <div className="p-4 bg-ash-gray rounded-lg">
            <p className="text-sm text-feather-white/60 mb-1">
              {token1?.symbol || 'Token1'} Reserve
            </p>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="text-xl font-bold text-feather-white">
                {formattedReserve1}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
