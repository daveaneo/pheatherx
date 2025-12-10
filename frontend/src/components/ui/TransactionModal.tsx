'use client';

import { Fragment, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { CheckCircle, XCircle, Loader2, ExternalLink, Copy, AlertTriangle } from 'lucide-react';
import { Button } from './Button';
import { cn } from '@/lib/utils';
import { useChainId } from 'wagmi';

export type TransactionModalState = 'idle' | 'pending' | 'success' | 'error';

export interface TransactionModalData {
  state: TransactionModalState;
  title?: string;
  description?: string;
  hash?: `0x${string}`;
  error?: string;
  txType?: string;
  details?: {
    label: string;
    value: string;
  }[];
}

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: TransactionModalData;
}

// Get block explorer URL based on chain
function getExplorerUrl(chainId: number, hash: string): string {
  switch (chainId) {
    case 11155111: // Ethereum Sepolia
      return `https://sepolia.etherscan.io/tx/${hash}`;
    case 421614: // Arbitrum Sepolia
      return `https://sepolia.arbiscan.io/tx/${hash}`;
    case 31337: // Local Anvil
      return `#`;
    default:
      return `https://etherscan.io/tx/${hash}`;
  }
}

function truncateHash(hash: string): string {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

export function TransactionModal({ isOpen, onClose, data }: TransactionModalProps) {
  const chainId = useChainId();
  const { state, title, description, hash, error, txType, details } = data;

  // Auto-close on success after 5 seconds
  useEffect(() => {
    if (state === 'success' && isOpen) {
      const timer = setTimeout(() => {
        onClose();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [state, isOpen, onClose]);

  const copyHash = () => {
    if (hash) {
      navigator.clipboard.writeText(hash);
    }
  };

  const getIcon = () => {
    switch (state) {
      case 'pending':
        return <Loader2 className="w-12 h-12 text-phoenix-ember animate-spin" />;
      case 'success':
        return <CheckCircle className="w-12 h-12 text-green-500" />;
      case 'error':
        return <XCircle className="w-12 h-12 text-red-500" />;
      default:
        return null;
    }
  };

  const getTitle = () => {
    if (title) return title;
    switch (state) {
      case 'pending':
        return 'Transaction Pending';
      case 'success':
        return 'Transaction Successful';
      case 'error':
        return 'Transaction Failed';
      default:
        return '';
    }
  };

  const getDescription = () => {
    if (description) return description;
    switch (state) {
      case 'pending':
        return 'Please wait while your transaction is being confirmed...';
      case 'success':
        return 'Your transaction has been confirmed on the blockchain.';
      case 'error':
        return error || 'An error occurred while processing your transaction.';
      default:
        return '';
    }
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={state === 'pending' ? () => {} : onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-obsidian-black/80 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-sm transform overflow-hidden rounded-xl bg-carbon-gray p-6 shadow-xl transition-all">
                <div className="flex flex-col items-center text-center">
                  {/* Icon */}
                  <div className="mb-4">
                    {getIcon()}
                  </div>

                  {/* Title */}
                  <Dialog.Title className="text-lg font-semibold mb-2">
                    {getTitle()}
                  </Dialog.Title>

                  {/* Transaction Type Badge */}
                  {txType && (
                    <span className="px-2 py-1 text-xs bg-ash-gray rounded-full text-feather-white/60 mb-3">
                      {txType}
                    </span>
                  )}

                  {/* Description */}
                  <p className={cn(
                    "text-sm mb-4",
                    state === 'error' ? 'text-red-400' : 'text-feather-white/60'
                  )}>
                    {getDescription()}
                  </p>

                  {/* Transaction Details */}
                  {details && details.length > 0 && (
                    <div className="w-full bg-ash-gray/50 rounded-lg p-3 mb-4 space-y-2">
                      {details.map((detail, idx) => (
                        <div key={idx} className="flex justify-between text-sm">
                          <span className="text-feather-white/60">{detail.label}</span>
                          <span className="font-medium">{detail.value}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Transaction Hash */}
                  {hash && (
                    <div className="w-full bg-ash-gray/50 rounded-lg p-3 mb-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-feather-white/60">Transaction Hash</span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={copyHash}
                            className="p-1 hover:bg-carbon-gray rounded transition-colors"
                            title="Copy hash"
                          >
                            <Copy className="w-3.5 h-3.5 text-feather-white/60" />
                          </button>
                          <a
                            href={getExplorerUrl(chainId, hash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 hover:bg-carbon-gray rounded transition-colors"
                            title="View on explorer"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-feather-white/60" />
                          </a>
                        </div>
                      </div>
                      <code className="text-xs font-mono text-phoenix-ember">
                        {truncateHash(hash)}
                      </code>
                    </div>
                  )}

                  {/* Error Details */}
                  {state === 'error' && error && error.length > 100 && (
                    <div className="w-full bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                        <pre className="text-xs text-red-400 whitespace-pre-wrap break-all text-left overflow-auto max-h-32">
                          {error}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="w-full flex gap-2">
                    {state === 'pending' ? (
                      <Button disabled className="flex-1" variant="secondary">
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Confirming...
                      </Button>
                    ) : (
                      <>
                        {hash && state === 'success' && (
                          <Button
                            variant="secondary"
                            className="flex-1"
                            onClick={() => window.open(getExplorerUrl(chainId, hash), '_blank')}
                          >
                            <ExternalLink className="w-4 h-4 mr-2" />
                            View
                          </Button>
                        )}
                        <Button
                          className="flex-1"
                          onClick={onClose}
                        >
                          {state === 'success' ? 'Done' : 'Close'}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
