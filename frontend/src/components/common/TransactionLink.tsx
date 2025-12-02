'use client';

import { useChainId } from 'wagmi';
import { getExplorerTxUrl } from '@/lib/explorer';
import { shortenAddress } from '@/lib/utils';

interface TransactionLinkProps {
  hash: `0x${string}`;
  label?: string;
  className?: string;
}

export function TransactionLink({ hash, label, className }: TransactionLinkProps) {
  const chainId = useChainId();
  const url = getExplorerTxUrl(chainId, hash);

  const displayText = label || shortenAddress(hash, 6);

  if (!url) {
    return <span className={className}>{displayText}</span>;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`text-phoenix-ember hover:underline inline-flex items-center gap-1 ${className}`}
    >
      {displayText}
      <svg
        className="w-3 h-3"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
        />
      </svg>
    </a>
  );
}
