'use client';

/**
 * @deprecated This component is deprecated in v6.
 *
 * In v6:
 * - For AMM liquidity: Use AddLiquidityForm
 * - For limit orders: Use LimitOrderForm (which uses usePlaceOrder)
 *
 * The v6 deposit() function is specifically for placing limit orders
 * with the signature: deposit(poolId, tick, side, encryptedAmount, deadline, maxTickDrift)
 */

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

export function DepositForm() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Deprecated</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center text-feather-white/60 py-8">
          <p>This component has been deprecated in v6.</p>
          <p className="text-sm mt-2">
            For AMM liquidity, use the <strong>Add Liquidity</strong> page.
          </p>
          <p className="text-sm mt-1">
            For limit orders, use the <strong>Trade</strong> page.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
