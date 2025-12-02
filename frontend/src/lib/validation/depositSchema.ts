import { z } from 'zod';

export const depositFormSchema = z.object({
  amount: z
    .string()
    .min(1, 'Enter amount')
    .refine(
      (v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0,
      'Amount must be greater than 0'
    ),
  isToken0: z.boolean(),
});

export type DepositFormValues = z.infer<typeof depositFormSchema>;

export const withdrawFormSchema = z.object({
  amount: z
    .string()
    .min(1, 'Enter amount')
    .refine(
      (v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0,
      'Amount must be greater than 0'
    ),
  isToken0: z.boolean(),
});

export type WithdrawFormValues = z.infer<typeof withdrawFormSchema>;
