'use client';

import { useState, useMemo, useEffect } from 'react';
import { Button, Input, Select, Badge, TransactionModal } from '@/components/ui';
import { Loader2, Lock, AlertTriangle, ArrowRight, Ban, ChevronUp, ChevronDown } from 'lucide-react';
import { usePlaceOrder } from '@/hooks/usePlaceOrder';
import { useSelectedPool } from '@/stores/poolStore';
import { parseUnits, formatUnits } from 'viem';
import { BucketSide, OrderType, ORDER_TYPE_CONFIG } from '@/types/bucket';
import { TICK_SPACING, tickToPrice, priceToTick, formatPrice, isValidTick, MIN_TICK, MAX_TICK } from '@/lib/constants';
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
  zeroForOne: boolean;
}

export function LimitOrderForm({
  currentTick,
  currentPrice,
  prefill,
  onPrefillUsed,
  zeroForOne,
}: LimitOrderFormProps) {
  // Default order type based on direction: zeroForOne=true means selling token0, so default to limit-sell
  const [orderType, setOrderType] = useState<OrderType>(zeroForOne ? 'limit-sell' : 'limit-buy');
  const [amount, setAmount] = useState('');
  const [targetTick, setTargetTick] = useState<string>('');
  const [priceInput, setPriceInput] = useState<string>('');

  const { placeOrder, step, isSubmitting, error, reset } = usePlaceOrder();
  const { address } = useAccount();
  const { token0, token1 } = useSelectedPool();
  const txModal = useTransactionModal();

  // Update order type when global direction changes
  useEffect(() => {
    setOrderType(zeroForOne ? 'limit-sell' : 'limit-buy');
    setAmount(''); // Clear amount when direction changes
  }, [zeroForOne]);

  // Handle prefill from Quick Limit Order panel
  useEffect(() => {
    if (prefill) {
      // Set the target tick and price
      setTargetTick(prefill.tick.toString());
      const price = tickToPrice(prefill.tick);
      setPriceInput((Number(price) / 1e18).toFixed(4));

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
  const { data: balanceData, isLoading: isBalanceLoading } = useBalance({
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
    if (walletBalance === 0n) return;
    const amountValue = (walletBalance * BigInt(pct)) / 100n;
    const formatted = formatUnits(amountValue, depositTokenDecimals);
    // Trim trailing zeros but keep reasonable precision
    const trimmed = parseFloat(formatted).toString();
    setAmount(trimmed);
  };

  // Adjust tick by delta (for up/down buttons) - also updates price display
  const adjustTick = (delta: number) => {
    const current = parseInt(targetTick) || 0;
    const newTick = current + delta;
    if (isValidTick(newTick)) {
      setTargetTick(newTick.toString());
      const newPrice = tickToPrice(newTick);
      setPriceInput((Number(newPrice) / 1e18).toFixed(4));
    }
  };

  // Handle price input blur - snap to nearest valid tick
  const handlePriceBlur = () => {
    if (!priceInput) return;
    const priceNum = parseFloat(priceInput);
    if (isNaN(priceNum) || priceNum <= 0) return;

    // Convert to 1e18 scaled bigint and get nearest tick
    const priceBigInt = BigInt(Math.floor(priceNum * 1e18));
    const tick = priceToTick(priceBigInt);
    const clampedTick = Math.max(MIN_TICK, Math.min(MAX_TICK, tick));

    setTargetTick(clampedTick.toString());
    // Update price input to show the actual tick price
    const actualPrice = tickToPrice(clampedTick);
    setPriceInput((Number(actualPrice) / 1e18).toFixed(4));
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

  // Initialize default tick to current price (0-slip equivalent) when no tick is set
  useEffect(() => {
    // Don't override if we have a prefill or if there's already a tick
    if (prefill || targetTick) return;

    // Default to current tick (normalized to tick spacing)
    const normalizedCurrentTick = Math.round(currentTick / TICK_SPACING) * TICK_SPACING;

    if (isValidTick(normalizedCurrentTick)) {
      setTargetTick(normalizedCurrentTick.toString());
      const price = tickToPrice(normalizedCurrentTick);
      setPriceInput((Number(price) / 1e18).toFixed(4));
    }
  }, [currentTick, prefill, targetTick]);

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

      const hash = await placeOrder(orderType, tick, amountIn);

      if (hash) {
        txModal.setSuccess(hash, [
          { label: 'Order Type', value: config.label },
          { label: 'Amount', value: `${amount} ${depositTokenSymbol}` },
          { label: 'Target Price', value: `${formatPrice(tickToPrice(tick))} ${token1?.symbol ?? 'Token1'}` },
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

      {/* Target Price with Up/Down Controls */}
      <div className="space-y-2">
        <label className="text-sm text-feather-white/60">Target Price</label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => adjustTick(-TICK_SPACING)}
            className="p-2 bg-ash-gray/50 hover:bg-ash-gray rounded transition-colors disabled:opacity-50"
            disabled={isSubmitting || !isValidTick((parseInt(targetTick) || 0) - TICK_SPACING)}
            title="Decrease price"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
          <div className="flex-1 relative">
            <Input
              type="number"
              placeholder="0.0000"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              onBlur={handlePriceBlur}
              className="text-lg"
              disabled={isSubmitting}
              data-testid="target-price-input"
              step="0.0001"
            />
          </div>
          <button
            type="button"
            onClick={() => adjustTick(TICK_SPACING)}
            className="p-2 bg-ash-gray/50 hover:bg-ash-gray rounded transition-colors disabled:opacity-50"
            disabled={isSubmitting || !isValidTick((parseInt(targetTick) || 0) + TICK_SPACING)}
            title="Increase price"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
        </div>
        <div className="flex justify-between text-xs text-feather-white/40">
          <span>Tick: {targetTick || '—'}</span>
          <span>
            {targetTick && currentTick ? (() => {
              const currentPriceVal = tickToPrice(currentTick);
              const targetPriceVal = tickToPrice(parseInt(targetTick));
              const pctDiff = ((Number(targetPriceVal) - Number(currentPriceVal)) / Number(currentPriceVal) * 100).toFixed(2);
              return `${parseFloat(pctDiff) >= 0 ? '+' : ''}${pctDiff}% from current`;
            })() : '—'}
          </span>
        </div>
      </div>

      {/* Amount Input */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm text-feather-white/60">Order Amount</label>
          <span className="text-xs text-feather-white/40">
            Balance: {balanceData ? parseFloat(formatUnits(balanceData.value, depositTokenDecimals)).toFixed(4) : '...'} {depositTokenSymbol}
          </span>
        </div>
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
              disabled={isBalanceLoading || walletBalance === 0n || isSubmitting}
            >
              {pct}%
            </button>
          ))}
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
          <span>{formatPrice(tickToPrice(selectedTick))} {token1?.symbol ?? ''}</span>
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

      {/* Insufficient balance prompt */}
      {needsWrap && depositTokenSymbol && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="text-amber-500 font-medium">Insufficient balance</p>
              <p className="text-amber-500/80 text-xs mt-1">
                You need more {depositTokenSymbol} to place this order.
              </p>
            </div>
          </div>
          <Link href="/faucet" className="block">
            <Button
              variant="secondary"
              size="sm"
              className="w-full border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
            >
              <span>Go to Faucet</span>
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
