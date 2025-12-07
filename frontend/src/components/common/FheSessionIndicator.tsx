'use client';

import { Lock, Unlock, Loader2 } from 'lucide-react';
import { useFheSession } from '@/hooks/useFheSession';
import { useAccount } from 'wagmi';
import { cn } from '@/lib/utils';

/**
 * Global FHE session status indicator for the header
 * Shows whether the user has an active FHE session for encrypted operations
 */
export function FheSessionIndicator() {
  const { isConnected } = useAccount();
  const { status, isReady, isInitializing, initialize } = useFheSession();

  // Don't show if wallet not connected
  if (!isConnected) {
    return null;
  }

  // Session is ready - show locked/active state
  if (isReady) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-electric-teal/10 border border-electric-teal/30">
        <Lock className="w-3.5 h-3.5 text-electric-teal" />
        <span className="text-xs font-medium text-electric-teal">FHE Active</span>
      </div>
    );
  }

  // Session is initializing
  if (isInitializing) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-feather-gold/10 border border-feather-gold/30">
        <Loader2 className="w-3.5 h-3.5 text-feather-gold animate-spin" />
        <span className="text-xs font-medium text-feather-gold">Initializing...</span>
      </div>
    );
  }

  // Session not initialized - show warning with click to init
  return (
    <button
      onClick={initialize}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors",
        "bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20"
      )}
    >
      <Unlock className="w-3.5 h-3.5 text-amber-400" />
      <span className="text-xs font-medium text-amber-400">Init FHE</span>
    </button>
  );
}
