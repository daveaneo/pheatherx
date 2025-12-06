'use client';

import { useState, useMemo } from 'react';
import { Button, Input, Select, Badge } from '@/components/ui';
import { Loader2, Lock, ChevronDown, ChevronUp } from 'lucide-react';
import { useV3Deposit } from '@/hooks/useV3Deposit';
import { parseUnits } from 'viem';
import { BucketSide, OrderType, ORDER_TYPE_CONFIG } from '@/types/bucket';
import { TICK_SPACING, tickToPrice, formatPrice, isValidTick } from '@/lib/constants';
import type { CurrentPrice } from '@/types/bucket';

interface LimitOrderFormProps {
  currentTick: number;
  currentPrice: CurrentPrice | null;
}

export function LimitOrderForm({ currentTick, currentPrice }: LimitOrderFormProps) {
  const [orderType, setOrderType] = useState<OrderType>('limit-buy');
  const [amount, setAmount] = useState('');
  const [targetTick, setTargetTick] = useState<string>('');

  const { deposit, step, isDepositing, error, reset } = useV3Deposit();

  const config = ORDER_TYPE_CONFIG[orderType];

  // Generate order type options for select
  const orderTypeOptions = [
    { value: 'limit-buy', label: 'Limit Buy' },
    { value: 'limit-sell', label: 'Limit Sell' },
    { value: 'stop-loss', label: 'Stop Loss' },
    { value: 'take-profit', label: 'Take Profit' },
  ];

  // Calculate target tick options based on order type
  const tickOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    const numTicks = 10;

    if (config.tickRelation === 'below') {
      // Generate ticks below current
      for (let i = 1; i <= numTicks; i++) {
        const tick = currentTick - i * TICK_SPACING;
        if (!isValidTick(tick)) continue;
        const price = tickToPrice(tick);
        const diff = ((Number(price) - Number(tickToPrice(currentTick))) / Number(tickToPrice(currentTick)) * 100).toFixed(1);
        options.push({
          value: tick.toString(),
          label: `$${formatPrice(price)} (${diff}% • tick ${tick})`
        });
      }
    } else {
      // Generate ticks above current
      for (let i = 1; i <= numTicks; i++) {
        const tick = currentTick + i * TICK_SPACING;
        if (!isValidTick(tick)) continue;
        const price = tickToPrice(tick);
        const diff = ((Number(price) - Number(tickToPrice(currentTick))) / Number(tickToPrice(currentTick)) * 100).toFixed(1);
        options.push({
          value: tick.toString(),
          label: `$${formatPrice(price)} (+${diff}% • tick ${tick})`
        });
      }
    }

    return options;
  }, [currentTick, config.tickRelation]);

  // Update target tick when options change and current value is not valid
  useMemo(() => {
    if (tickOptions.length > 0 && !tickOptions.find(o => o.value === targetTick)) {
      setTargetTick(tickOptions[0].value);
    }
  }, [tickOptions, targetTick]);

  const handleDeposit = async () => {
    const tick = parseInt(targetTick);
    if (!amount || parseFloat(amount) === 0 || !isValidTick(tick)) return;

    const amountIn = parseUnits(amount, 18);

    const result = await deposit({
      tick,
      amount: amountIn,
      side: config.side,
    });

    if (result) {
      setAmount('');
    }
  };

  const depositToken = config.depositToken === 'token0' ? 'tWETH' : 'tUSDC';
  const receiveToken = config.receiveToken === 'token0' ? 'tWETH' : 'tUSDC';
  const selectedTick = parseInt(targetTick) || currentTick;

  return (
    <div className="space-y-4">
      {/* Order Type Selection */}
      <div className="space-y-2">
        <label className="text-sm text-feather-white/60">Order Type</label>
        <Select
          value={orderType}
          onChange={(v) => setOrderType(v as OrderType)}
          options={orderTypeOptions}
        />
        <p className="text-xs text-feather-white/40">{config.description}</p>
      </div>

      {/* Target Price/Tick */}
      <div className="space-y-2">
        <label className="text-sm text-feather-white/60">Target Price (Tick)</label>
        <Select
          value={targetTick}
          onChange={setTargetTick}
          options={tickOptions}
          placeholder="Select target price..."
        />
      </div>

      {/* Amount Input */}
      <div className="space-y-2">
        <label className="text-sm text-feather-white/60">Amount to Deposit</label>
        <div className="relative">
          <Input
            type="number"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="pr-20 text-lg"
            disabled={isDepositing}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-feather-white/60 font-medium">
            {depositToken}
          </span>
        </div>
      </div>

      {/* Order Summary */}
      <div className="p-3 bg-ash-gray/30 rounded-lg text-sm space-y-1">
        <div className="flex justify-between">
          <span className="text-feather-white/60">Deposit</span>
          <span>{amount || '0'} {depositToken}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-feather-white/60">Receive (when filled)</span>
          <span>{receiveToken}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-feather-white/60">Target Price</span>
          <span>${formatPrice(tickToPrice(selectedTick))}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-feather-white/60">Bucket Side</span>
          <Badge variant={config.side === BucketSide.BUY ? 'success' : 'error'}>
            {config.side === BucketSide.BUY ? 'BUY' : 'SELL'}
          </Badge>
        </div>
      </div>

      {/* Encryption Notice */}
      <div className="flex items-center gap-2 p-3 bg-iridescent-violet/10 border border-iridescent-violet/20 rounded-lg">
        <Lock className="w-4 h-4 text-iridescent-violet" />
        <span className="text-xs text-iridescent-violet">
          Amount will be encrypted with FHE before deposit
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-deep-magenta/10 border border-deep-magenta/20 rounded-lg text-sm text-deep-magenta">
          {error.message}
        </div>
      )}

      {/* Submit Button */}
      <Button
        className="w-full"
        size="lg"
        onClick={handleDeposit}
        disabled={isDepositing || !amount || parseFloat(amount) === 0}
      >
        {isDepositing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {step === 'encrypting' ? 'Encrypting...' :
             step === 'approving' ? 'Approving...' :
             step === 'depositing' ? 'Depositing...' : 'Processing...'}
          </>
        ) : (
          `Place ${config.label} Order`
        )}
      </Button>
    </div>
  );
}
