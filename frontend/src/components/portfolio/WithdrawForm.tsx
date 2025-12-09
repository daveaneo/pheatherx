'use client';

/**
 * @deprecated This component is deprecated in v6.
 *
 * In v6:
 * - For AMM liquidity removal: Use RemoveLiquidityForm
 * - For limit order withdrawal: Use the Trade page (exit/claim/withdraw functions)
 *
 * The v6 withdraw() function is specifically for withdrawing unfilled limit orders
 * with the signature: withdraw(poolId, tick, side, encryptedAmount)
 */

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

export function WithdrawForm() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Deprecated</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center text-feather-white/60 py-8">
          <p>This component has been deprecated in v6.</p>
          <p className="text-sm mt-2">
            For AMM liquidity removal, use the <strong>Liquidity</strong> page.
          </p>
          <p className="text-sm mt-1">
            For limit order management, use the <strong>Trade</strong> page.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
