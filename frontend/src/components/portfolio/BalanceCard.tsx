'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { EncryptedBalance } from '@/components/common/EncryptedBalance';
import { Badge } from '@/components/ui/Badge';

interface BalanceCardProps {
  tokenSymbol: string;
  tokenName: string;
  decimals: number;
  isToken0: boolean;
  isNative?: boolean;
}

export function BalanceCard({
  tokenSymbol,
  tokenName,
  decimals,
  isToken0,
  isNative,
}: BalanceCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <span className="text-2xl">{isNative ? 'Ξ' : '💰'}</span>
            {tokenSymbol}
          </CardTitle>
          {isNative && <Badge variant="info">Native</Badge>}
        </div>
        <p className="text-sm text-feather-white/60">{tokenName}</p>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <p className="text-sm text-feather-white/60">Private Balance</p>
          <EncryptedBalance
            isToken0={isToken0}
            decimals={decimals}
            symbol={tokenSymbol}
          />
        </div>
      </CardContent>
    </Card>
  );
}
