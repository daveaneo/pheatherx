'use client';

import { useState, useMemo, useEffect } from 'react';
import { Button, Input, Select, Badge, TransactionModal } from '@/components/ui';
import { Loader2, Lock, AlertTriangle, ArrowRight, Ban, ChevronUp, ChevronDown } from 'lucide-react';
import { usePlaceOrder } from '@/hooks/usePlaceOrder';
import { useSelectedPool } from '@/stores/poolStore';
import { parseUnits, formatUnits } from 'viem';
import { BucketSide, OrderType, ORDER_TYPE_CONFIG } from '@/types/bucket';
import { TICK_SPACING, tickToPrice, formatPrice, isValidTick, MIN_TICK_V3, MAX_TICK_V3 } from '@/lib/constants';
import { getLimitOrderAvailability } from '@/lib/validation/privacyRules';
import type { CurrentPrice } from '@/types/bucket';
import { useAccount, useBalance } from 'wagmi';
import Link from 'next/link';
import { useTransactionModal } from '@/hooks/useTransactionModal';

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
  const txModal = useTransactionModal();

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
  const depositTokenSymbol = depositToken?.symbol ?? 'Token';
  const receiveTokenSymbol = receiveToken?.symbol ?? 'Token';

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

  // Handle percentage button click
  const handlePercentageClick = (pct: number) => {
    if (!walletBalance || walletBalance === 0n) return;
    const amountValue = (walletBalance * BigInt(pct)) / 100n;
    const formatted = formatUnits(amountValue, depositTokenDecimals);
    // Trim trailing zeros but keep reasonable precision
    const trimmed = parseFloat(formatted).toString();
    setAmount(trimmed);
  };

  // Adjust tick by delta (for up/down buttons)
  const adjustTick = (delta: number) => {
    const current = parseInt(targetTick) || 0;
    const newTick = current + delta;
    if (isValidTick(newTick)) {
      setTargetTick(newTick.toString());
    }
  };

  // Handle manual tick input with snapping to valid tick
  const handleTickChange = (value: string) => {
    const tick = parseInt(value);
    if (!isNaN(tick)) {
      // Snap to nearest valid tick
      const snapped = Math.round(tick / TICK_SPACING) * TICK_SPACING;
      const clamped = Math.max(MIN_TICK_V3, Math.min(MAX_TICK_V3, snapped));
      setTargetTick(clamped.toString());
    } else if (value === '' || value === '-') {
      setTargetTick(value);
    }
  };

  // Calculate receive amount (when filled) based on tick price
  const receiveAmount = useMemo(() => {
    if (!amount || !targetTick || parseFloat(amount) === 0) return '0';
    const amountNum = parseFloat(amount);
    const tick = parseInt(targetTick);
    if (isNaN(tick)) return '0';

    const tickPrice = Number(tickToPrice(tick)) / 1e18;
    if (tickPrice === 0) return '0';

    const receiveDecimals = receiveToken?.decimals ?? 18;

    if (config.depositToken === 'token1') {
      // Buying token0 with token1: receiveAmount = deposit / price
      const result = amountNum / tickPrice;
      return result.toFixed(Math.min(6, receiveDecimals));
    } else {
      // Selling token0 for token1: receiveAmount = deposit * price
      const result = amountNum * tickPrice;
      return result.toFixed(Math.min(6, receiveDecimals));
    }
  }, [amount, targetTick, config.depositToken, receiveToken]);

  // Calculate limit order availability based on token types
  const limitOrderAvailability = useMemo(() => {
    return getLimitOrderAvailability(token0, token1);
  }, [token0, token1]);

  const noOrdersAvailable = !limitOrderAvailability.buyEnabled && !limitOrderAvailability.sellEnabled;

  // Check if current tick is outside the valid limit order range
  const isOutsideLimitOrderRange = currentTick < MIN_TICK_V3 || currentTick > MAX_TICK_V3;

  // Generate order type options for select, filtering by availability
  // Buy orders: limit-buy (deposits token1)
  // Sell orders: limit-sell, stop-loss, take-profit (all deposit token0)
  const orderTypeOptions = useMemo(() => {
    const options = [];

    if (limitOrderAvailability.buyEnabled) {
      options.push({ value: 'limit-buy', label: 'Limit Buy' });
    }

    if (limitOrderAvailability.sellEnabled) {
      options.push(
        { value: 'limit-sell', label: 'Limit Sell' },
        { value: 'stop-loss', label: 'Stop Loss' },
        { value: 'take-profit', label: 'Take Profit' }
      );
    }

    return options;
  }, [limitOrderAvailability.buyEnabled, limitOrderAvailability.sellEnabled]);

  // Auto-select first available order type when availability changes
  useEffect(() => {
    if (orderTypeOptions.length > 0) {
      const currentTypeAvailable = orderTypeOptions.some(opt => opt.value === orderType);
      if (!currentTypeAvailable) {
        setOrderType(orderTypeOptions[0].value as OrderType);
      }
    }
  }, [orderTypeOptions, orderType]);

  // Calculate target tick options based on order type
  const tickOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    const numTicks = 10;

    // Normalize currentTick to nearest valid tick spacing
    // Clamp to valid range to ensure we always generate options
    const clampedTick = Math.max(-5400, Math.min(5400, currentTick));
    const normalizedCurrentTick = Math.round(clampedTick / TICK_SPACING) * TICK_SPACING;
    const currentPriceValue = tickToPrice(normalizedCurrentTick);

    // If we have a prefill tick that's valid, always include it as the first option
    if (prefill && isValidTick(prefill.tick)) {
      const price = tickToPrice(prefill.tick);
      const diff = ((Number(price) - Number(currentPriceValue)) / Number(currentPriceValue) * 100).toFixed(1);
      options.push({
        value: prefill.tick.toString(),
        label: `$${formatPrice(price)} (${parseFloat(diff) >= 0 ? '+' : ''}${diff}% • tick ${prefill.tick})`
      });
    }

    if (config.tickRelation === 'below') {
      // Generate ticks below current
      for (let i = 1; i <= numTicks; i++) {
        const tick = normalizedCurrentTick - i * TICK_SPACING;
        if (!isValidTick(tick)) continue;
        // Skip if already added as prefill
        if (prefill && tick === prefill.tick) continue;
        const price = tickToPrice(tick);
        const diff = ((Number(price) - Number(currentPriceValue)) / Number(currentPriceValue) * 100).toFixed(1);
        options.push({
          value: tick.toString(),
          label: `$${formatPrice(price)} (${diff}% • tick ${tick})`
        });
      }
    } else {
      // Generate ticks above current
      for (let i = 1; i <= numTicks; i++) {
        const tick = normalizedCurrentTick + i * TICK_SPACING;
        if (!isValidTick(tick)) continue;
        // Skip if already added as prefill
        if (prefill && tick === prefill.tick) continue;
        const price = tickToPrice(tick);
        const diff = ((Number(price) - Number(currentPriceValue)) / Number(currentPriceValue) * 100).toFixed(1);
        options.push({
          value: tick.toString(),
          label: `$${formatPrice(price)} (+${diff}% • tick ${tick})`
        });
      }
    }

    return options;
  }, [currentTick, config.tickRelation, prefill]);

  // Update target tick when options change and current value is not valid
  useEffect(() => {
    if (tickOptions.length > 0 && !tickOptions.find(o => o.value === targetTick)) {
      setTargetTick(tickOptions[0].value);
    }
  }, [tickOptions, targetTick]);

  const handlePlaceOrder = async () => {
    const tick = parseInt(targetTick);
    if (!amount || parseFloat(amount) === 0 || !isValidTick(tick)) return;

    // Open modal and show pending state
    txModal.setPending(
      `${config.label} Order`,
      `Placing ${config.label.toLowerCase()} order for ${amount} ${depositTokenSymbol}...`
    );
    txModal.openModal();

    try {
      const amountIn = parseUnits(amount, depositTokenDecimals);
      const slippageBps = parseInt(slippage) || 50;

      const hash = await placeOrder(orderType, tick, amountIn, slippageBps);

      if (hash) {
        txModal.setSuccess(hash, [
          { label: 'Order Type', value: config.label },
          { label: 'Amount', value: `${amount} ${depositTokenSymbol}` },
          { label: 'Target Price', value: `$${formatPrice(tickToPrice(tick))}` },
          { label: 'Tick', value: tick.toString() },
        ]);
        setAmount('');
      }
    } catch (err) {
      // Show error in modal
      const errorMessage = err instanceof Error ? err.message : 'Transaction failed';
      txModal.setError(errorMessage);
      console.error('Place order failed:', err);
    }
  };

  const selectedTick = parseInt(targetTick) || currentTick;

  // Show disabled state when price is outside valid range
  if (isOutsideLimitOrderRange) {
    return (
      <div className="space-y-4" data-testid="limit-form">
        <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-lg text-center">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-red-400" />
          <h3 className="text-lg font-medium text-red-300 mb-2">
            Price Outside Limit Order Range
          </h3>
          <p className="text-sm text-red-400 mb-4">
            Current price (tick {currentTick}) is outside the valid limit order range ({MIN_TICK_V3} to {MAX_TICK_V3}).
          </p>
          <p className="text-xs text-red-500">
            Use the Market tab for instant swaps. This is a known limitation being addressed in a future contract update.
          </p>
        </div>
      </div>
    );
  }

  // Show disabled state when no orders available
  if (noOrdersAvailable) {
    return (
      <div className="space-y-4" data-testid="limit-form">
        <div className="p-6 bg-gray-500/10 border border-gray-500/20 rounded-lg text-center">
          <Ban className="w-10 h-10 mx-auto mb-3 text-gray-400" />
          <h3 className="text-lg font-medium text-gray-300 mb-2">
            Limit Orders Unavailable
          </h3>
          <p className="text-sm text-gray-400 mb-4">
            {limitOrderAvailability.message || 'Limit orders require at least one FHERC20 token for privacy.'}
          </p>
          <p className="text-xs text-gray-500">
            Use the Market tab for instant swaps, or select a pool with FHERC20 tokens.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="limit-form">
      {/* Privacy Restriction Notice */}
      {limitOrderAvailability.message && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <span className="text-xs text-amber-500">{limitOrderAvailability.message}</span>
        </div>
      )}

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

      {/* Target Price/Tick with Up/Down Controls */}
      <div className="space-y-2">
        <label className="text-sm text-feather-white/60">Target Price (Tick)</label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => adjustTick(-TICK_SPACING)}
            className="p-2 bg-ash-gray/50 hover:bg-ash-gray rounded transition-colors disabled:opacity-50"
            disabled={isSubmitting || !isValidTick((parseInt(targetTick) || 0) - TICK_SPACING)}
            title="Decrease tick"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
          <div className="flex-1">
            <Select
              value={targetTick}
              onChange={setTargetTick}
              options={tickOptions}
              placeholder="Select target price..."
              data-testid="target-tick-select"
            />
          </div>
          <button
            type="button"
            onClick={() => adjustTick(TICK_SPACING)}
            className="p-2 bg-ash-gray/50 hover:bg-ash-gray rounded transition-colors disabled:opacity-50"
            disabled={isSubmitting || !isValidTick((parseInt(targetTick) || 0) + TICK_SPACING)}
            title="Increase tick"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
        </div>
        <div className="flex justify-between text-xs text-feather-white/40">
          <span>Tick: {targetTick || '—'}</span>
          <span>Price: ${targetTick ? formatPrice(tickToPrice(parseInt(targetTick))) : '—'}</span>
        </div>
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
        <div className="flex gap-1 mt-1">
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => handlePercentageClick(pct)}
              className="px-2 py-0.5 text-xs bg-ash-gray/50 hover:bg-ash-gray rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!walletBalance || walletBalance === 0n || isSubmitting}
            >
              {pct}%
            </button>
          ))}
        </div>
      </div>

      {/* Slippage Tolerance */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-feather-white/60">Max Tick Drift</span>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={slippage}
            onChange={(e) => setSlippage(e.target.value)}
            className="w-20 h-8 text-right text-sm"
            disabled={isSubmitting}
            min="0"
            max="1000"
          />
          <span className="text-feather-white/60 text-xs">bps</span>
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
          <span>{receiveAmount} {receiveTokenSymbol}</span>
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

      {/* Transaction Modal */}
      <TransactionModal
        isOpen={txModal.isOpen}
        onClose={txModal.closeModal}
        data={txModal.modalData}
      />
    </div>
  );
}
