'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { parseUnits } from 'viem';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { TransactionLink } from '@/components/common/TransactionLink';
import { useWithdraw } from '@/hooks/useWithdraw';
import { withdrawFormSchema, type WithdrawFormValues } from '@/lib/validation/depositSchema';
import { TOKEN_LIST } from '@/lib/tokens';
import { useChainId } from 'wagmi';

export function WithdrawForm() {
  const chainId = useChainId();
  const tokens = TOKEN_LIST[chainId] || [];
  const [selectedToken, setSelectedToken] = useState(tokens[0]?.symbol || '');

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset: resetForm,
  } = useForm<WithdrawFormValues>({
    resolver: zodResolver(withdrawFormSchema),
    defaultValues: {
      amount: '',
      isToken0: true,
    },
  });

  const {
    withdraw,
    step,
    isWithdrawing,
    withdrawHash,
    error,
    reset: resetWithdraw,
  } = useWithdraw();

  const tokenOptions = tokens.map((token, index) => ({
    value: token.symbol,
    label: `${token.symbol} - ${token.name}`,
  }));

  const onSubmit = async (data: WithdrawFormValues) => {
    const token = tokens.find(t => t.symbol === selectedToken);
    if (!token) return;

    const isToken0 = tokens.indexOf(token) === 0;
    const amount = parseUnits(data.amount, token.decimals);

    await withdraw(isToken0, amount);
  };

  const handleReset = () => {
    resetForm();
    resetWithdraw();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Withdraw</CardTitle>
        <p className="text-sm text-feather-white/60">
          Withdraw tokens from your private balance
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Token</label>
            <Select
              value={selectedToken}
              onChange={setSelectedToken}
              options={tokenOptions}
              placeholder="Select token"
            />
          </div>

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

          {error && (
            <div className="p-3 bg-deep-magenta/10 border border-deep-magenta/30 rounded-lg">
              <p className="text-deep-magenta text-sm">{error}</p>
            </div>
          )}

          {step === 'complete' && withdrawHash && (
            <div className="p-3 bg-electric-teal/10 border border-electric-teal/30 rounded-lg">
              <p className="text-electric-teal text-sm mb-1">Withdrawal successful!</p>
              <TransactionLink hash={withdrawHash} label="View transaction" />
            </div>
          )}

          <div className="flex gap-2">
            <Button
              type="submit"
              loading={isWithdrawing}
              disabled={step === 'complete'}
              className="flex-1"
            >
              {step === 'withdrawing' && 'Withdrawing...'}
              {step === 'idle' && 'Withdraw'}
              {step === 'complete' && 'Done'}
              {step === 'error' && 'Try Again'}
            </Button>

            {(step === 'complete' || step === 'error') && (
              <Button type="button" variant="secondary" onClick={handleReset}>
                Reset
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
