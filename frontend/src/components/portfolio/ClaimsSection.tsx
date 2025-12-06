'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button, Badge, Skeleton } from '@/components/ui';
import { Loader2, Gift } from 'lucide-react';
import { useV3Position } from '@/hooks/useV3Position';
import { useV3Claim } from '@/hooks/useV3Claim';
import { BucketSide } from '@/types/bucket';
import { tickToPrice, formatPrice } from '@/lib/constants';

interface ClaimablePosition {
  tick: number;
  side: BucketSide;
  hasClaimable: boolean;
}

/**
 * Shows positions with claimable proceeds and allows claiming
 */
export function ClaimsSection() {
  const { fetchAllPositions, getAllPositions, isLoading } = useV3Position();
  const { claim, isClaiming } = useV3Claim();
  const [claimingPosition, setClaimingPosition] = useState<string | null>(null);

  useEffect(() => {
    fetchAllPositions();
  }, [fetchAllPositions]);

  const positions = getAllPositions();

  // Filter positions that might have claimable proceeds
  // In reality, we'd check the contract, but for now we show all positions
  const claimablePositions: ClaimablePosition[] = positions.map((p) => ({
    tick: p.tick,
    side: p.side,
    hasClaimable: true, // Would check actual claimable amount
  }));

  const handleClaim = async (tick: number, side: BucketSide) => {
    const key = `${tick}-${side}`;
    setClaimingPosition(key);
    try {
      await claim({ tick, side });
      fetchAllPositions();
    } finally {
      setClaimingPosition(null);
    }
  };

  const handleClaimAll = async () => {
    for (const pos of claimablePositions) {
      if (pos.hasClaimable) {
        await handleClaim(pos.tick, pos.side);
      }
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Available Claims</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (claimablePositions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="w-5 h-5" />
            Available Claims
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6 text-feather-white/40">
            <p>No claims available</p>
            <p className="text-sm mt-1">Proceeds from filled orders will appear here</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gift className="w-5 h-5 text-electric-teal" />
            Available Claims
          </div>
          <Button
            size="sm"
            onClick={handleClaimAll}
            disabled={isClaiming}
          >
            {isClaiming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              'Claim All'
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {claimablePositions.map((pos) => {
            const key = `${pos.tick}-${pos.side}`;
            const price = tickToPrice(pos.tick);
            const isBuy = pos.side === BucketSide.BUY;
            const isClaimingThis = claimingPosition === key;

            return (
              <div
                key={key}
                className="flex items-center justify-between p-3 bg-ash-gray/30 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <Badge variant={isBuy ? 'success' : 'error'}>
                    {isBuy ? 'BUY' : 'SELL'}
                  </Badge>
                  <div>
                    <div className="font-mono text-sm">${formatPrice(price)}</div>
                    <div className="text-xs text-feather-white/40">Tick {pos.tick}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-sm text-feather-white/60">Proceeds</div>
                    <div className="font-mono">••••••</div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleClaim(pos.tick, pos.side)}
                    disabled={isClaiming}
                  >
                    {isClaimingThis ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      'Claim'
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-4 text-xs text-center text-feather-white/40">
          Proceeds are encrypted. Claiming reveals and transfers to your wallet.
        </p>
      </CardContent>
    </Card>
  );
}
