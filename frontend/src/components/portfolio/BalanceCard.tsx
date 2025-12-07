'use client';

import { Lock } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { EncryptedBalance } from '@/components/common/EncryptedBalance';
import { Badge } from '@/components/ui/Badge';

interface BalanceCardProps {
  tokenSymbol: string;
  tokenName: string;
  decimals: number;
  isToken0: boolean;
  isNative?: boolean;
  /** Compact mode for embedding in other cards */
  compact?: boolean;
}

export function BalanceCard({
  tokenSymbol,
  tokenName,
  decimals,
  isToken0,
  isNative,
  compact = false,
}: BalanceCardProps) {
  // Compact mode - render as a simple row
  if (compact) {
    return (
      <div className="flex items-center justify-between p-3 bg-iridescent-violet/5 border border-iridescent-violet/20 rounded-lg">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-iridescent-violet/30 to-purple-600/30 flex items-center justify-center">
            <Lock className="w-4 h-4 text-iridescent-violet" />
          </div>
          <div>
            <span className="font-medium text-feather-white">{tokenSymbol}</span>
            <p className="text-xs text-feather-white/50">{tokenName}</p>
          </div>
        </div>
        <div className="text-right">
          <EncryptedBalance
            isToken0={isToken0}
            decimals={decimals}
            symbol={tokenSymbol}
          />
        </div>
      </div>
    );
  }

  // Full card mode (legacy)
  return (
    <Card className="border-iridescent-violet/30">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-iridescent-violet to-purple-600 flex items-center justify-center">
              <Lock className="w-4 h-4 text-white" />
            </div>
            {tokenSymbol}
          </CardTitle>
          {isNative && <Badge variant="info">Native</Badge>}
        </div>
        <p className="text-sm text-feather-white/60">{tokenName}</p>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <p className="text-sm text-iridescent-violet/80">Encrypted Balance</p>
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
