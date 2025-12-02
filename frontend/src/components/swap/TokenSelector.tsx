'use client';

import { useState } from 'react';
import { useChainId } from 'wagmi';
import { AdaptiveModal } from '@/components/ui/AdaptiveModal';
import { Input } from '@/components/ui/Input';
import { TOKEN_LIST, Token as LegacyToken } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import type { Token } from '@/types/pool';

// Support both the new Token type and legacy Token type
type AnyToken = Token | LegacyToken;

interface TokenSelectorProps {
  selected?: AnyToken;
  onSelect: (token: AnyToken) => void;
  excludeToken?: AnyToken;
  tokens?: AnyToken[];
  className?: string;
}

export function TokenSelector({
  selected,
  onSelect,
  excludeToken,
  tokens: propTokens,
  className,
}: TokenSelectorProps) {
  const chainId = useChainId();
  // Use provided tokens or fall back to legacy TOKEN_LIST
  const tokens = propTokens || TOKEN_LIST[chainId] || [];
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filteredTokens = tokens.filter(token => {
    if (excludeToken && token.address === excludeToken.address) return false;
    if (!search) return true;
    return (
      token.symbol.toLowerCase().includes(search.toLowerCase()) ||
      token.name.toLowerCase().includes(search.toLowerCase())
    );
  });

  const isNativeToken = (token: AnyToken): boolean => {
    return 'isNative' in token && token.isNative === true;
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={cn(
          'flex items-center gap-2 px-3 py-2 bg-ash-gray rounded-lg hover:bg-carbon-gray transition-colors',
          className
        )}
      >
        {selected ? (
          <>
            <span className="text-lg">{isNativeToken(selected) ? '\u039E' : '\uD83D\uDCB0'}</span>
            <span className="font-medium">{selected.symbol}</span>
          </>
        ) : (
          <span className="text-feather-white/60">Select token</span>
        )}
        <svg className="w-4 h-4 ml-1 text-feather-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <AdaptiveModal
        isOpen={isOpen}
        onClose={() => {
          setIsOpen(false);
          setSearch('');
        }}
        title="Select Token"
      >
        <div className="space-y-4">
          <Input
            placeholder="Search by name or symbol"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          <div className="space-y-1 max-h-64 overflow-y-auto">
            {filteredTokens.map(token => (
              <button
                key={token.address}
                onClick={() => {
                  onSelect(token);
                  setIsOpen(false);
                  setSearch('');
                }}
                className={cn(
                  'w-full flex items-center gap-3 p-3 rounded-lg transition-colors',
                  selected?.address === token.address
                    ? 'bg-phoenix-ember/20 text-phoenix-ember'
                    : 'hover:bg-carbon-gray'
                )}
              >
                <span className="text-xl">{isNativeToken(token) ? '\u039E' : '\uD83D\uDCB0'}</span>
                <div className="text-left">
                  <p className="font-medium">{token.symbol}</p>
                  <p className="text-sm text-feather-white/60">{token.name}</p>
                </div>
              </button>
            ))}

            {filteredTokens.length === 0 && (
              <p className="text-center text-feather-white/60 py-4">No tokens found</p>
            )}
          </div>
        </div>
      </AdaptiveModal>
    </>
  );
}
