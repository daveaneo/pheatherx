'use client';

/**
 * DevWalletPanel - Debug panel that shows when Dev Wallet is connected
 *
 * Displays:
 * - Connected wallet address
 * - Network info
 * - Last transaction status
 * - Console log prompt
 */

import { useAccount, useBalance, useChainId } from 'wagmi';
import { formatUnits } from 'viem';

export function DevWalletPanel() {
  const { connector, address, isConnected } = useAccount();
  const chainId = useChainId();
  const { data: ethBalance } = useBalance({ address });

  // Only show for dev wallet
  const isDevWallet = connector?.id === 'devWallet';

  if (!isConnected || !isDevWallet) {
    return null;
  }

  const chainNames: Record<number, string> = {
    31337: 'Anvil',
    11155111: 'Eth Sepolia',
    421614: 'Arb Sepolia',
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-amber-900/95 border border-amber-600 rounded-lg p-3 shadow-xl max-w-xs font-mono text-xs">
      <div className="flex items-center gap-2 text-amber-200 font-bold mb-2">
        <span className="text-lg">D</span>
        <span>DEV WALLET</span>
      </div>

      <div className="space-y-1 text-amber-100/80">
        <div className="flex justify-between">
          <span className="text-amber-400">Address:</span>
          <span>{address?.slice(0, 6)}...{address?.slice(-4)}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-amber-400">Network:</span>
          <span>{chainNames[chainId] || `Chain ${chainId}`}</span>
        </div>

        {ethBalance && (
          <div className="flex justify-between">
            <span className="text-amber-400">ETH:</span>
            <span>{parseFloat(formatUnits(ethBalance.value, 18)).toFixed(4)}</span>
          </div>
        )}
      </div>

      <div className="mt-2 pt-2 border-t border-amber-700 text-amber-300/70 text-[10px]">
        Check browser console (F12) for detailed logs
      </div>
    </div>
  );
}
