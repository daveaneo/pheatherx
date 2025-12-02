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
import { useDeposit } from '@/hooks/useDeposit';
import { depositFormSchema, type DepositFormValues } from '@/lib/validation/depositSchema';
import { TOKEN_LIST } from '@/lib/tokens';
import { useChainId } from 'wagmi';

export function DepositForm() {
  const chainId = useChainId();
  const tokens = TOKEN_LIST[chainId] || [];
  const [selectedToken, setSelectedToken] = useState(tokens[0]?.symbol || '');

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset: resetForm,
  } = useForm<DepositFormValues>({
    resolver: zodResolver(depositFormSchema),
    defaultValues: {
      amount: '',
      isToken0: true,
    },
  });

  const {
    approveAndDeposit,
    step,
    isApproving,
    isDepositing,
    depositHash,
    error,
    reset: resetDeposit,
  } = useDeposit();

  const tokenOptions = tokens.map((token, index) => ({
    value: token.symbol,
    label: `${token.symbol} - ${token.name}`,
  }));

  const onSubmit = async (data: DepositFormValues) => {
    const token = tokens.find(t => t.symbol === selectedToken);
    if (!token) return;

    const isToken0 = tokens.indexOf(token) === 0;
    const amount = parseUnits(data.amount, token.decimals);

    await approveAndDeposit(isToken0, amount);
  };

  const handleReset = () => {
    resetForm();
    resetDeposit();
  };

  const isLoading = step === 'checking' || isApproving || isDepositing;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deposit</CardTitle>
        <p className="text-sm text-feather-white/60">
          Add tokens to your private balance
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

          {step === 'complete' && depositHash && (
            <div className="p-3 bg-electric-teal/10 border border-electric-teal/30 rounded-lg">
              <p className="text-electric-teal text-sm mb-1">Deposit successful!</p>
              <TransactionLink hash={depositHash} label="View transaction" />
            </div>
          )}

          <div className="flex gap-2">
            <Button
              type="submit"
              loading={isLoading}
              disabled={step === 'complete'}
              className="flex-1"
            >
              {step === 'checking' && 'Checking allowance...'}
              {isApproving && 'Approving...'}
              {isDepositing && 'Depositing...'}
              {step === 'idle' && 'Deposit'}
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
