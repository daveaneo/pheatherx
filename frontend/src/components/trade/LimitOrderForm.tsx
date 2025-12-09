'use client';

import { useState, useMemo, useEffect } from 'react';
import { Button, Input, Select, Badge } from '@/components/ui';
import { Loader2, Lock, AlertTriangle, ArrowRight } from 'lucide-react';
import { usePlaceOrder } from '@/hooks/usePlaceOrder';
import { useSelectedPool } from '@/stores/poolStore';
import { parseUnits } from 'viem';
import { BucketSide, OrderType, ORDER_TYPE_CONFIG } from '@/types/bucket';
import { TICK_SPACING, tickToPrice, formatPrice, isValidTick } from '@/lib/constants';
import type { CurrentPrice } from '@/types/bucket';
import { useAccount, useBalance } from 'wagmi';
import Link from 'next/link';

interface LimitOrderFormProps {
  currentTick: number;
  currentPrice: CurrentPrice | null;
  prefill?: { tick: number; isBuy: boolean } | null;
  onPrefillUsed?: () => void;
}

export function LimitOrderForm({
  currentTick,
  currentPrice,
  prefill,
  onPrefillUsed,
}: LimitOrderFormProps) {
  const [orderType, setOrderType] = useState<OrderType>('limit-buy');
  const [amount, setAmount] = useState('');
  const [targetTick, setTargetTick] = useState<string>('');
  const [slippage, setSlippage] = useState('50'); // 0.5% = 50 bps

  const { placeOrder, step, isSubmitting, error, reset } = usePlaceOrder();
  const { address } = useAccount();
  const { token0, token1 } = useSelectedPool();

  // Handle prefill from Quick Limit Order panel
  useEffect(() => {
    if (prefill) {
      // Set the target tick
      setTargetTick(prefill.tick.toString());

      // Determine order type based on isBuy and tick position relative to current
      if (prefill.isBuy) {
        // Buying: if tick is below current, it's a limit-buy; if above, it's a take-profit
        if (prefill.tick < currentTick) {
          setOrderType('limit-buy');
        } else {
          setOrderType('take-profit');
        }
      } else {
        // Selling: if tick is above current, it's a limit-sell; if below, it's a stop-loss
        if (prefill.tick > currentTick) {
          setOrderType('limit-sell');
        } else {
          setOrderType('stop-loss');
        }
      }

      // Clear prefill after using
      if (onPrefillUsed) {
        onPrefillUsed();
      }
    }
  }, [prefill, currentTick, onPrefillUsed]);

  const config = ORDER_TYPE_CONFIG[orderType];

  // Get token info from selected pool
  const depositToken = config.depositToken === 'token0' ? token0 : token1;
  const receiveToken = config.receiveToken === 'token0' ? token0 : token1;
  const depositTokenAddress = depositToken?.address;
  const depositTokenDecimals = depositToken?.decimals ?? 18;

  // Get FHERC20 balance for the deposit token (wagmi useBalance reads plaintext wrapped amount)
  const { data: balanceData } = useBalance({
    address,
    token: depositTokenAddress,
  });

  // Check if user has sufficient FHERC20 balance
  const amountBigInt = amount ? parseUnits(amount, depositTokenDecimals) : BigInt(0);
  const walletBalance = balanceData?.value ?? BigInt(0);
  const hasInsufficientBalance = amountBigInt > BigInt(0) && amountBigInt > walletBalance;

  // Show wrap prompt if balance is insufficient
  const needsWrap = hasInsufficientBalance && depositTokenAddress !== undefined;

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

  const handlePlaceOrder = async () => {
    const tick = parseInt(targetTick);
    if (!amount || parseFloat(amount) === 0 || !isValidTick(tick)) return;

    try {
      const amountIn = parseUnits(amount, depositTokenDecimals);
      const slippageBps = parseInt(slippage) || 50;

      const hash = await placeOrder(orderType, tick, amountIn, slippageBps);

      if (hash) {
        setAmount('');
      }
    } catch (err) {
      // Error is already handled by the hook
      console.error('Place order failed:', err);
    }
  };

  const depositTokenSymbol = depositToken?.symbol ?? 'Token';
  const receiveTokenSymbol = receiveToken?.symbol ?? 'Token';
  const selectedTick = parseInt(targetTick) || currentTick;

  return (
    <div className="space-y-4" data-testid="limit-form">
      {/* Order Type Selection */}
      <div className="space-y-2">
        <label className="text-sm text-feather-white/60">Order Type</label>
        <Select
          value={orderType}
          onChange={(v) => setOrderType(v as OrderType)}
          options={orderTypeOptions}
          data-testid="order-type-select"
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
          data-testid="target-tick-select"
        />
      </div>

      {/* Amount Input */}
      <div className="space-y-2">
        <label className="text-sm text-feather-white/60">Order Amount</label>
        <div className="relative">
          <Input
            type="number"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="pr-20 text-lg"
            disabled={isSubmitting}
            data-testid="order-amount-input"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-feather-white/60 font-medium">
            {depositTokenSymbol}
          </span>
        </div>
      </div>

      {/* Order Summary */}
      <div className="p-3 bg-ash-gray/30 rounded-lg text-sm space-y-1">
        <div className="flex justify-between">
          <span className="text-feather-white/60">Order Size</span>
          <span>{amount || '0'} {depositTokenSymbol}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-feather-white/60">Receive (when filled)</span>
          <span>{receiveTokenSymbol}</span>
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
          Order amount will be encrypted with FHE - hidden from everyone
        </span>
      </div>

      {/* Wrap Prompt - shown when user has insufficient encrypted balance */}
      {needsWrap && depositTokenSymbol && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="text-amber-500 font-medium">Insufficient encrypted balance</p>
              <p className="text-amber-500/80 text-xs mt-1">
                You need to wrap your {depositTokenSymbol.replace('fhe', '')} tokens to {depositTokenSymbol} before placing a limit order.
                This enables order privacy.
              </p>
            </div>
          </div>
          <Link href="/faucet" className="block">
            <Button
              variant="secondary"
              size="sm"
              className="w-full border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
            >
              <span>Go to Faucet to Wrap Tokens</span>
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 bg-deep-magenta/10 border border-deep-magenta/20 rounded-lg text-sm text-deep-magenta">
          {error}
        </div>
      )}

      {/* Submit Button */}
      <Button
        className="w-full"
        size="lg"
        onClick={handlePlaceOrder}
        disabled={isSubmitting || !amount || parseFloat(amount) === 0}
        data-testid="place-order-button"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {step === 'checking' ? 'Checking...' :
             step === 'approving' ? 'Approving...' :
             step === 'encrypting' ? 'Encrypting...' :
             step === 'submitting' ? 'Placing Order...' : 'Processing...'}
          </>
        ) : (
          `Place ${config.label} Order`
        )}
      </Button>
    </div>
  );
}
