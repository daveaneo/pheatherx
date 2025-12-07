'use client';

import { useAccount, useBalance } from 'wagmi';
import { formatUnits } from 'viem';
import { Wallet } from 'lucide-react';

interface WalletBalanceCardProps {
  tokenAddress: `0x${string}`;
  tokenSymbol: string;
  tokenName: string;
  decimals: number;
}

/**
 * Displays the user's ERC20 wallet balance for a token
 * This is the plain wallet balance, NOT the encrypted FheatherX order balance
 */
export function WalletBalanceCard({
  tokenAddress,
  tokenSymbol,
  tokenName,
  decimals,
}: WalletBalanceCardProps) {
  const { address } = useAccount();
  const { data: balance, isLoading } = useBalance({
    address,
    token: tokenAddress,
  });

  const formattedBalance = balance
    ? Number(formatUnits(balance.value, decimals)).toLocaleString(undefined, {
        maximumFractionDigits: 4,
      })
    : '0';

  return (
    <div className="flex items-center justify-between p-3 bg-ash-gray/30 rounded-lg">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
          <Wallet className="w-4 h-4 text-white" />
        </div>
        <div>
          <span className="font-medium text-feather-white">{tokenSymbol}</span>
          <p className="text-xs text-feather-white/50">{tokenName}</p>
        </div>
      </div>
      <div className="text-right">
        {isLoading ? (
          <div className="h-5 w-16 bg-ash-gray animate-pulse rounded" />
        ) : (
          <span className="font-mono text-feather-white">{formattedBalance}</span>
        )}
      </div>
    </div>
  );
}
