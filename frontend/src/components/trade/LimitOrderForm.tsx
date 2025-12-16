'use client';

import { useState, useMemo, useEffect } from 'react';
import { Button, Input, Select, Badge, TransactionModal } from '@/components/ui';
import { Loader2, Lock, AlertTriangle, ArrowRight, Ban, ChevronUp, ChevronDown } from 'lucide-react';
import { usePlaceOrder } from '@/hooks/usePlaceOrder';
import { useSelectedPool } from '@/stores/poolStore';
import { parseUnits, formatUnits } from 'viem';
import { BucketSide, OrderType, OrderMode, ORDER_TYPE_CONFIG } from '@/types/bucket';
import { TICK_SPACING, tickToPrice, priceToTick, formatPrice, isValidTick, MIN_TICK, MAX_TICK } from '@/lib/constants';
import { getLimitOrderAvailability } from '@/lib/validation/privacyRules';
import type { CurrentPrice } from '@/types/bucket';
import { useAccount } from 'wagmi';
import Link from 'next/link';
import { useTransactionModal } from '@/hooks/useTransactionModal';
import { useFherc20Balance } from '@/hooks/useFherc20Balance';

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
  // Order mode: maker (exact price) or taker (can have slippage)
  const [orderMode, setOrderMode] = useState<OrderMode>('maker');
  // Default order type based on mode and direction
  const [orderType, setOrderType] = useState<OrderType>(zeroForOne ? 'limit-sell' : 'limit-buy');
  const [amount, setAmount] = useState('');
  const [targetTick, setTargetTick] = useState<string>('');
  const [priceInput, setPriceInput] = useState<string>('');
  const [hasInitialized, setHasInitialized] = useState(false);

  const { placeOrder, step, isSubmitting, error, reset } = usePlaceOrder();
  const { address } = useAccount();
  const { token0, token1 } = useSelectedPool();
  const txModal = useTransactionModal();

  // Helper to reset target price to current market price (direction-aware)
  const resetToCurrentPrice = (direction: boolean) => {
    const normalizedTick = Math.round(currentTick / TICK_SPACING) * TICK_SPACING;
    if (isValidTick(normalizedTick)) {
      setTargetTick(normalizedTick.toString());
      // Display price based on direction
      const rawPrice = Number(tickToPrice(normalizedTick)) / 1e18;
      const displayPrice = direction ? rawPrice : (rawPrice > 0 ? 1 / rawPrice : 0);
      setPriceInput(displayPrice.toFixed(4));
    }
  };

  // Update order type AND reset price when global direction changes
  useEffect(() => {
    setOrderType(zeroForOne ? 'limit-sell' : 'limit-buy');
    setAmount(''); // Clear amount when direction changes
    // Only reset price if already initialized (i.e., user flipped direction)
    if (hasInitialized) {
      resetToCurrentPrice(zeroForOne);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zeroForOne]); // Only trigger on direction change, not currentTick

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

  // Get encrypted balance for the deposit token (limit orders always use FHERC20)
  const { balance: encryptedBalance, isLoading: isBalanceLoading, isRevealed, error: balanceError } = useFherc20Balance(
    depositToken,
    address
  );

  // Debug: log balance state
  console.log('[LimitOrderForm] Balance state:', {
    depositToken: depositToken?.symbol,
    encryptedBalance: encryptedBalance?.toString(),
    isLoading: isBalanceLoading,
    isRevealed,
    error: balanceError,
  });

  // Check if user has sufficient encrypted FHERC20 balance
  const amountBigInt = amount ? parseUnits(amount, depositTokenDecimals) : BigInt(0);
  const walletBalance = encryptedBalance ?? 0n;
  const hasInsufficientBalance = amountBigInt > 0n && amountBigInt > walletBalance;

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

  // Adjust tick by delta (for up/down buttons) - also updates price display (direction-aware)
  const adjustTick = (delta: number) => {
    const current = parseInt(targetTick) || 0;
    const newTick = current + delta;
    if (isValidTick(newTick)) {
      setTargetTick(newTick.toString());
      const rawPrice = Number(tickToPrice(newTick)) / 1e18;
      const displayPrice = zeroForOne ? rawPrice : (rawPrice > 0 ? 1 / rawPrice : 0);
      setPriceInput(displayPrice.toFixed(4));
    }
  };

  // Handle price input blur - snap to nearest valid tick (direction-aware)
  const handlePriceBlur = () => {
    if (!priceInput) return;
    const displayPriceNum = parseFloat(priceInput);
    if (isNaN(displayPriceNum) || displayPriceNum <= 0) return;

    // Convert display price back to raw price (token0/token1)
    const rawPrice = zeroForOne ? displayPriceNum : (1 / displayPriceNum);

    // Convert to 1e18 scaled bigint and get nearest tick
    const priceBigInt = BigInt(Math.floor(rawPrice * 1e18));
    const tick = priceToTick(priceBigInt);
    const clampedTick = Math.max(MIN_TICK, Math.min(MAX_TICK, tick));

    setTargetTick(clampedTick.toString());
    // Update price input to show the actual tick price (in display direction)
    const actualRawPrice = Number(tickToPrice(clampedTick)) / 1e18;
    const actualDisplayPrice = zeroForOne ? actualRawPrice : (actualRawPrice > 0 ? 1 / actualRawPrice : 0);
    setPriceInput(actualDisplayPrice.toFixed(4));
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

  // Generate order type options for select, filtering by mode and availability
  // Maker mode: limit-buy, limit-sell (exact price, no slippage)
  // Taker mode: stop-loss, take-profit (execute as swaps, can have slippage)
  const orderTypeOptions = useMemo(() => {
    const options = [];

    if (orderMode === 'maker') {
      // Maker orders: limit-buy and limit-sell
      if (limitOrderAvailability.buyEnabled) {
        options.push({ value: 'limit-buy', label: 'Limit Buy' });
      }
      if (limitOrderAvailability.sellEnabled) {
        options.push({ value: 'limit-sell', label: 'Limit Sell' });
      }
    } else {
      // Taker orders: stop-loss and take-profit (both deposit token0 = sell side)
      if (limitOrderAvailability.sellEnabled) {
        options.push(
          { value: 'stop-loss', label: 'Stop Loss' },
          { value: 'take-profit', label: 'Take Profit' }
        );
      }
    }

    return options;
  }, [orderMode, limitOrderAvailability.buyEnabled, limitOrderAvailability.sellEnabled]);

  // Auto-select appropriate order type when mode changes
  useEffect(() => {
    if (orderMode === 'maker') {
      // Default to limit-sell if selling, limit-buy if buying
      setOrderType(zeroForOne ? 'limit-sell' : 'limit-buy');
    } else {
      // Taker mode: default to stop-loss
      setOrderType('stop-loss');
    }
  }, [orderMode, zeroForOne]);

  // Auto-select first available order type when availability changes
  useEffect(() => {
    if (orderTypeOptions.length > 0) {
      const currentTypeAvailable = orderTypeOptions.some(opt => opt.value === orderType);
      if (!currentTypeAvailable) {
        setOrderType(orderTypeOptions[0].value as OrderType);
      }
    }
  }, [orderTypeOptions, orderType]);

  // Initialize target price on first valid currentTick (only once)
  useEffect(() => {
    // Only initialize once, skip if we have a prefill, or if already initialized
    if (hasInitialized || prefill) return;
    if (currentTick === 0) return; // Wait for valid tick data

    resetToCurrentPrice(zeroForOne);
    setHasInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTick, prefill, hasInitialized, zeroForOne]); // resetToCurrentPrice intentionally excluded

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
      {/* Maker/Taker Toggle */}
      <div className="flex gap-1 p-1 bg-ash-gray/30 rounded-lg">
        <button
          type="button"
          onClick={() => setOrderMode('maker')}
          className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            orderMode === 'maker'
              ? 'bg-carbon-gray text-feather-white'
              : 'text-feather-white/60 hover:text-feather-white'
          }`}
          data-testid="maker-toggle"
        >
          Maker
        </button>
        <button
          type="button"
          onClick={() => setOrderMode('taker')}
          className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            orderMode === 'taker'
              ? 'bg-carbon-gray text-feather-white'
              : 'text-feather-white/60 hover:text-feather-white'
          }`}
          data-testid="taker-toggle"
        >
          Taker
        </button>
      </div>

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
            <Lock className="inline w-3 h-3 mr-1" />
            Encrypted Balance: {
              isBalanceLoading ? 'Loading...' :
              balanceError ? `Error: ${balanceError}` :
              !isRevealed ? 'Revealing...' :
              encryptedBalance !== null ? parseFloat(formatUnits(encryptedBalance, depositTokenDecimals)).toFixed(4) : '0'
            } {!balanceError && depositTokenSymbol}
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
      <div className="p-3 bg-ash-gray/30 rounded-lg text-sm space-y-2">
        {/* Price Behavior - different for Maker vs Taker */}
        <div className="flex justify-between items-center">
          <span className="text-feather-white/60">Price</span>
          {orderMode === 'maker' ? (
            <span className="text-green-400">EXACT (no slippage)</span>
          ) : (
            <span className="text-red-500 font-medium">MARKET (executes as swap)</span>
          )}
        </div>

        {/* Slippage Warning - only for Taker mode */}
        {orderMode === 'taker' && (
          <div className="flex justify-between items-center">
            <span className="text-feather-white/60">Slippage</span>
            <span className="text-red-500 font-bold">UP TO 100%</span>
          </div>
        )}

        {/* Fee Display */}
        <div className="flex justify-between items-center">
          <span className="text-feather-white/60">Fee</span>
          <span>~0.35% (swap + protocol)</span>
        </div>

        <div className="border-t border-ash-gray/50 my-2" />

        <div className="flex justify-between">
          <span className="text-feather-white/60">Order Size</span>
          <span>{amount || '0'} {depositTokenSymbol}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-feather-white/60">{orderMode === 'maker' ? 'Receive (when filled)' : 'Min Receive'}</span>
          <span>{receiveAmount} {receiveTokenSymbol}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-feather-white/60">{orderMode === 'maker' ? 'Target Price' : 'Trigger Price'}</span>
          <span>
            {(() => {
              const rawPrice = Number(tickToPrice(selectedTick)) / 1e18;
              const displayPrice = zeroForOne ? rawPrice : (rawPrice > 0 ? 1 / rawPrice : 0);
              const quoteToken = zeroForOne ? token1 : token0;
              const baseToken = zeroForOne ? token0 : token1;
              return `${displayPrice.toFixed(4)} ${quoteToken?.symbol ?? ''} per ${baseToken?.symbol ?? ''}`;
            })()}
          </span>
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
          `Place ${orderMode === 'maker' ? 'Maker' : 'Taker'} Order`
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
