import { z } from 'zod';
import type { OrderType } from '@/lib/orders';

export const ORDER_TYPES = ['limit-buy', 'limit-sell', 'stop-loss', 'stop-buy'] as const;

export const orderFormSchema = z.object({
  orderType: z.enum(ORDER_TYPES, {
    message: 'Select an order type',
  }),

  triggerPrice: z
    .string()
    .min(1, 'Enter trigger price')
    .refine(
      (v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0,
      'Price must be greater than 0'
    ),

  amount: z
    .string()
    .min(1, 'Enter amount')
    .refine(
      (v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0,
      'Amount must be greater than 0'
    ),

  slippage: z
    .number()
    .min(0.01, 'Min slippage is 0.01%')
    .max(50, 'Max slippage is 50%'),
});

export type OrderFormValues = z.infer<typeof orderFormSchema>;

/**
 * Validate trigger price against current price based on order type
 */
export function validateTriggerPrice(
  orderType: OrderType,
  triggerPrice: number,
  currentPrice: number
): { valid: boolean; error?: string } {
  if (triggerPrice <= 0) {
    return { valid: false, error: 'Trigger price must be greater than 0' };
  }

  // Maker orders allow current price (zero slippage execution)
  // Taker orders require strictly above/below (momentum orders)
  switch (orderType) {
    case 'limit-buy':
      // Maker: allow at or below current price
      if (triggerPrice > currentPrice) {
        return {
          valid: false,
          error: `Limit buy trigger must be at or below current price (${currentPrice.toFixed(4)})`,
        };
      }
      break;

    case 'limit-sell':
      // Maker: allow at or above current price
      if (triggerPrice < currentPrice) {
        return {
          valid: false,
          error: `Limit sell trigger must be at or above current price (${currentPrice.toFixed(4)})`,
        };
      }
      break;

    case 'stop-loss':
      // Taker: strictly below current (use Market Swap at current price)
      if (triggerPrice >= currentPrice) {
        return {
          valid: false,
          error: `Stop-loss must be below current price. At current price, use Market Swap.`,
        };
      }
      break;

    case 'stop-buy':
      // Taker: strictly above current (use Market Swap at current price)
      if (triggerPrice <= currentPrice) {
        return {
          valid: false,
          error: `Stop-buy must be above current price. At current price, use Market Swap.`,
        };
      }
      break;
  }

  return { valid: true };
}

/**
 * Combined validation for the full form
 */
export function validateOrderForm(
  values: OrderFormValues,
  currentPrice: number
): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  const result = orderFormSchema.safeParse(values);
  if (!result.success) {
    // Zod v4 uses .issues instead of .errors
    result.error.issues.forEach((err) => {
      const path = err.path.join('.');
      errors[path] = err.message;
    });
    return { valid: false, errors };
  }

  const triggerValidation = validateTriggerPrice(
    values.orderType as OrderType,
    parseFloat(values.triggerPrice),
    currentPrice
  );

  if (!triggerValidation.valid) {
    errors.triggerPrice = triggerValidation.error!;
    return { valid: false, errors };
  }

  return { valid: true, errors: {} };
}
