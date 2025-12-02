'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { parseUnits } from 'viem';
import { useChainId } from 'wagmi';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { TransactionLink } from '@/components/common/TransactionLink';
import { usePlaceOrder } from '@/hooks/usePlaceOrder';
import { orderFormSchema, type OrderFormValues, validateTriggerPrice } from '@/lib/validation/orderSchema';
import { ORDER_TYPES, ORDER_TYPE_INFO, type OrderType } from '@/lib/orders';
import { TOKEN_LIST } from '@/lib/tokens';
import { useUiStore } from '@/stores/uiStore';

// Helper to convert price to tick (simplified)
function priceToTick(price: number): number {
  // tick = log(price) / log(1.0001)
  return Math.floor(Math.log(price) / Math.log(1.0001));
}

export function OrderForm() {
  const chainId = useChainId();
  const tokens = TOKEN_LIST[chainId] || [];
  const slippage = useUiStore(state => state.slippageTolerance);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    reset: resetForm,
    setError,
  } = useForm<OrderFormValues>({
    resolver: zodResolver(orderFormSchema),
    defaultValues: {
      orderType: 'limit-buy',
      triggerPrice: '',
      amount: '',
      slippage,
    },
  });

  const {
    placeOrder,
    step,
    isSubmitting,
    orderHash,
    error,
    reset: resetOrder,
  } = usePlaceOrder();

  const selectedOrderType = watch('orderType') as OrderType;
  const orderTypeInfo = ORDER_TYPE_INFO[selectedOrderType];

  const orderTypeOptions = ORDER_TYPES.map(type => ({
    value: type,
    label: ORDER_TYPE_INFO[type].label,
  }));

  // Mock current price for demo
  const currentPrice = 1.0;

  const onSubmit = async (data: OrderFormValues) => {
    // Validate trigger price against current price
    const triggerPrice = parseFloat(data.triggerPrice);
    const validation = validateTriggerPrice(
      data.orderType as OrderType,
      triggerPrice,
      currentPrice
    );

    if (!validation.valid) {
      setError('triggerPrice', { message: validation.error });
      return;
    }

    const triggerTick = priceToTick(triggerPrice);
    const token = tokens[0]; // Using token0 for orders
    const amount = parseUnits(data.amount, token?.decimals || 18);
    const slippageBps = Math.round(data.slippage * 100);

    await placeOrder(data.orderType as OrderType, triggerTick, amount, slippageBps);
  };

  const handleReset = () => {
    resetForm();
    resetOrder();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Place Order</CardTitle>
        <p className="text-sm text-feather-white/60">
          Create a new limit or stop order
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Order Type */}
          <div>
            <label className="block text-sm font-medium mb-2">Order Type</label>
            <select
              {...register('orderType')}
              className="input-field"
            >
              {orderTypeOptions.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {orderTypeInfo && (
              <p className="text-sm text-feather-white/60 mt-1">
                {orderTypeInfo.description}
              </p>
            )}
          </div>

          {/* Trigger Price */}
          <div>
            <label className="block text-sm font-medium mb-2">Trigger Price</label>
            <Input
              {...register('triggerPrice')}
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              error={!!errors.triggerPrice}
            />
            {errors.triggerPrice && (
              <p className="text-deep-magenta text-sm mt-1">{errors.triggerPrice.message}</p>
            )}
            <p className="text-sm text-feather-white/40 mt-1">
              Current price: {currentPrice.toFixed(4)}
            </p>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-medium mb-2">Amount</label>
            <Input
              {...register('amount')}
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              error={!!errors.amount}
            />
            {errors.amount && (
              <p className="text-deep-magenta text-sm mt-1">{errors.amount.message}</p>
            )}
          </div>

          {/* Slippage */}
          <div>
            <label className="block text-sm font-medium mb-2">Slippage Tolerance (%)</label>
            <Input
              {...register('slippage', { valueAsNumber: true })}
              type="number"
              step="0.1"
              min="0.01"
              max="50"
              placeholder="0.5"
              error={!!errors.slippage}
            />
            {errors.slippage && (
              <p className="text-deep-magenta text-sm mt-1">{errors.slippage.message}</p>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 bg-deep-magenta/10 border border-deep-magenta/30 rounded-lg">
              <p className="text-deep-magenta text-sm">{error}</p>
            </div>
          )}

          {/* Success */}
          {step === 'complete' && orderHash && (
            <div className="p-3 bg-electric-teal/10 border border-electric-teal/30 rounded-lg">
              <p className="text-electric-teal text-sm mb-1">Order placed!</p>
              <TransactionLink hash={orderHash} label="View transaction" />
            </div>
          )}

          {/* Submit Button */}
          <div className="flex gap-2">
            <Button
              type="submit"
              loading={isSubmitting}
              disabled={step === 'complete'}
              className="flex-1"
            >
              {step === 'encrypting' && 'Encrypting...'}
              {step === 'submitting' && 'Submitting...'}
              {step === 'complete' && 'Order Placed'}
              {step === 'error' && 'Try Again'}
              {step === 'idle' && 'Place Order'}
            </Button>

            {(step === 'complete' || step === 'error') && (
              <Button type="button" variant="secondary" onClick={handleReset}>
                New Order
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
