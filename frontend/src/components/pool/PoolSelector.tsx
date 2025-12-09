'use client';

import { useState, useRef, useEffect } from 'react';
import { usePoolStore, useSelectedPool, getPoolKey } from '@/stores/poolStore';
import { cn } from '@/lib/utils';
import type { Pool } from '@/types/pool';

interface PoolSelectorProps {
  className?: string;
  compact?: boolean;
}

export function PoolSelector({ className, compact = false }: PoolSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Use selector functions to derive pools from poolsByChain and currentChainId
  // (Zustand getters don't work reactively)
  const currentChainId = usePoolStore(state => state.currentChainId);
  const poolsByChain = usePoolStore(state => state.poolsByChain);
  const poolsLoadedByChain = usePoolStore(state => state.poolsLoadedByChain);
  const selectPool = usePoolStore(state => state.selectPool);
  const isLoading = usePoolStore(state => state.isLoadingPools);

  // Derive pools for current chain
  const pools = currentChainId ? (poolsByChain[currentChainId] || []) : [];
  const poolsLoaded = currentChainId ? (poolsLoadedByChain[currentChainId] || false) : false;

  // Get selected pool from the hook
  const { pool: selectedPool } = useSelectedPool();

  // Stage-by-stage debug logging
  console.log('[PoolSelector] RENDER - isLoading:', isLoading, 'poolsLoaded:', poolsLoaded);
  console.log('[PoolSelector] RENDER - pools.length:', pools.length);
  console.log('[PoolSelector] RENDER - selectedPool:', selectedPool ? `${selectedPool.token0Meta?.symbol}/${selectedPool.token1Meta?.symbol}` : 'null');

  // Log which branch we'll take
  if (isLoading || !poolsLoaded) {
    console.log('[PoolSelector] BRANCH: Showing LOADING state');
  } else if (pools.length === 0) {
    console.log('[PoolSelector] BRANCH: Showing NO POOLS state');
  } else {
    console.log('[PoolSelector] BRANCH: Showing SELECTOR with', pools.length, 'pools');
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter pools by search
  const filteredPools = pools.filter(pool => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      pool.token0Meta.symbol.toLowerCase().includes(searchLower) ||
      pool.token1Meta.symbol.toLowerCase().includes(searchLower) ||
      pool.token0Meta.name.toLowerCase().includes(searchLower) ||
      pool.token1Meta.name.toLowerCase().includes(searchLower)
    );
  });

  const handleSelect = (pool: Pool) => {
    selectPool(getPoolKey(pool));
    setIsOpen(false);
    setSearch('');
  };

  const formatPoolLabel = (pool: Pool) => {
    return `${pool.token0Meta.symbol}/${pool.token1Meta.symbol}`;
  };

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Show loading state while pools are being fetched
  if (isLoading || !poolsLoaded) {
    return (
      <div className={cn('animate-pulse bg-carbon-gray rounded-lg h-10 w-40', className)} />
    );
  }

  // Only show "no pools" after pool discovery has completed
  if (pools.length === 0) {
    return (
      <div className={cn('text-feather-white/50 text-sm px-3 py-2', className)}>
        No pools available
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className={cn('relative', className)} data-testid="pool-selector">
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg transition-all',
          'bg-carbon-gray/50 hover:bg-carbon-gray border border-carbon-gray/50',
          'text-feather-white font-medium',
          isOpen && 'ring-2 ring-phoenix-ember/50'
        )}
        data-testid="pool-selector-button"
      >
        {selectedPool ? (
          <>
            <span className="text-phoenix-ember">{formatPoolLabel(selectedPool)}</span>
            {!compact && (
              <span className="text-feather-white/50 text-xs">
                {truncateAddress(selectedPool.hook)}
              </span>
            )}
          </>
        ) : (
          <span className="text-feather-white/50">Select Pool</span>
        )}
        <svg
          className={cn('w-4 h-4 text-feather-white/50 transition-transform', isOpen && 'rotate-180')}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 top-full left-0 mt-2 w-72 bg-obsidian-black border border-carbon-gray rounded-lg shadow-xl overflow-hidden" data-testid="pool-dropdown">
          {/* Search */}
          <div className="p-2 border-b border-carbon-gray">
            <input
              type="text"
              placeholder="Search by token..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full px-3 py-2 bg-carbon-gray/50 border border-carbon-gray rounded-lg text-feather-white placeholder-feather-white/30 focus:outline-none focus:ring-2 focus:ring-phoenix-ember/50"
              autoFocus
              data-testid="pool-search-input"
            />
          </div>

          {/* Pool List */}
          <div className="max-h-64 overflow-y-auto" data-testid="pool-list">
            {filteredPools.length === 0 ? (
              <div className="p-4 text-center text-feather-white/50">No pools found</div>
            ) : (
              filteredPools.map((pool, index) => {
                const poolKey = getPoolKey(pool);
                const isSelected = selectedPool && getPoolKey(selectedPool) === poolKey;
                return (
                  <button
                    key={poolKey}
                    onClick={() => handleSelect(pool)}
                    className={cn(
                      'w-full px-4 py-3 flex items-center gap-3 hover:bg-carbon-gray/50 transition-colors',
                      isSelected && 'bg-carbon-gray/30'
                    )}
                    data-testid={`pool-option-${index}`}
                  >
                    {/* Token Pair */}
                    <div className="flex-1 text-left">
                      <div className="font-medium text-feather-white">
                        {formatPoolLabel(pool)}
                      </div>
                      <div className="text-xs text-feather-white/50">
                        {truncateAddress(pool.hook)}
                      </div>
                    </div>

                    {/* Active indicator */}
                    {pool.active && (
                      <span className="w-2 h-2 rounded-full bg-green-500" title="Active" />
                    )}

                    {/* Selected indicator */}
                    {isSelected && (
                      <svg className="w-4 h-4 text-phoenix-ember" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
