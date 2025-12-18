'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount, useBalance, useChainId, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { Wallet, Lock, Loader2, Droplets, Copy, Check } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { getFaucetTokens, type FaucetToken } from '@/lib/faucetTokens';
import { useFaucet } from '@/hooks/useFaucet';
import { useAggregatedBalanceReveal } from '@/hooks/useAggregatedBalanceReveal';
import { useAllTokens, usePoolStore } from '@/stores/poolStore';
import { useFheSession } from '@/hooks/useFheSession';
import { useFheStore } from '@/stores/fheStore';
import { FHERC20_ABI } from '@/lib/contracts/fherc20Abi';
import { FHE_RETRY_ATTEMPTS } from '@/lib/constants';
import type { Token } from '@/types/pool';

// Token type styling
const TOKEN_STYLES: Record<string, { gradient: string; badge?: string; badgeVariant?: 'info' | 'warning' | 'success' }> = {
  ETH: { gradient: 'from-blue-500 to-indigo-600' },
  WETH: { gradient: 'from-cyan-400 to-blue-500', badge: 'ERC20', badgeVariant: 'info' },
  USDC: { gradient: 'from-emerald-400 to-green-500', badge: 'ERC20', badgeVariant: 'info' },
  fheWETH: { gradient: 'from-violet-500 to-purple-600', badge: 'FHE', badgeVariant: 'warning' },
  fheUSDC: { gradient: 'from-fuchsia-500 to-pink-600', badge: 'FHE', badgeVariant: 'warning' },
};

interface WalletTokenProps {
  symbol: string;
  name: string;
  decimals: number;
  tokenAddress?: `0x${string}`;
  isNative?: boolean;
}

function WalletToken({ symbol, name, decimals, tokenAddress, isNative }: WalletTokenProps) {
  const { address } = useAccount();
  const [copied, setCopied] = useState(false);
  const { data: balance, isLoading } = useBalance({
    address,
    token: isNative ? undefined : tokenAddress,
  });

  const style = TOKEN_STYLES[symbol] || { gradient: 'from-gray-500 to-gray-600' };
  const formattedBalance = balance
    ? Number(formatUnits(balance.value, balance.decimals)).toLocaleString(undefined, {
        maximumFractionDigits: symbol.includes('USDC') ? 2 : 4,
      })
    : '0';

  const handleCopyAddress = useCallback(async () => {
    if (!tokenAddress) return;
    try {
      await navigator.clipboard.writeText(tokenAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  }, [tokenAddress]);

  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${style.gradient} flex items-center justify-center shadow-lg`}>
          <span className="text-white text-sm font-bold">
            {symbol === 'ETH' ? 'Ξ' : symbol.charAt(0)}
          </span>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-feather-white">{symbol}</span>
            {style.badge && (
              <Badge variant={style.badgeVariant} className="text-[10px] px-1.5 py-0">
                {style.badge}
              </Badge>
            )}
            {tokenAddress && (
              <button
                onClick={handleCopyAddress}
                className="p-1 rounded hover:bg-feather-white/10 transition-colors"
                title={`Copy ${symbol} address`}
              >
                {copied ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3 text-feather-white/40 hover:text-feather-white/70" />
                )}
              </button>
            )}
          </div>
          <p className="text-xs text-feather-white/40">{name}</p>
        </div>
      </div>
      <div className="text-right">
        {isLoading ? (
          <div className="h-5 w-20 bg-ash-gray/50 animate-pulse rounded" />
        ) : (
          <span className="font-mono text-feather-white font-medium">{formattedBalance}</span>
        )}
      </div>
    </div>
  );
}

/**
 * FHERC20 wallet token with encrypted balance reveal
 * For fheWETH, fheUSDC etc - reads balanceOfEncrypted from token contract
 */
interface WalletFherc20TokenProps {
  token: FaucetToken;
}

function WalletFherc20Token({ token }: WalletFherc20TokenProps) {
  const { address } = useAccount();
  const chainId = useChainId();
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<'idle' | 'revealing' | 'revealed' | 'error'>('idle');
  const [revealedBalance, setRevealedBalance] = useState<bigint | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Track if auto-reveal has been attempted to prevent loops
  const hasAttemptedAutoReveal = useRef(false);

  const { unseal, isReady, isMock } = useFheSession();
  const { cacheBalance, getCachedBalance } = useFheStore();

  const style = TOKEN_STYLES[token.symbol] || { gradient: 'from-gray-500 to-gray-600' };
  const cacheKey = `wallet-${address}-${chainId}-${token.address}`;

  // Read encrypted balance from token contract
  const { refetch: refetchEncryptedBalance } = useReadContract({
    address: token.address,
    abi: FHERC20_ABI,
    functionName: 'balanceOfEncrypted',
    args: address ? [address] : undefined,
    query: { enabled: false },
  });

  const handleCopyAddress = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(token.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  }, [token.address]);

  const reveal = useCallback(async () => {
    if (!address) {
      setError('Wallet not connected');
      setStatus('error');
      return;
    }

    // Check cache first
    const cached = getCachedBalance(cacheKey);
    if (cached) {
      setRevealedBalance(cached.value);
      setStatus('revealed');
      setProgress(100);
      return;
    }

    try {
      setError(null);
      setStatus('revealing');
      setProgress(10);

      // Mock mode
      if (isMock) {
        await new Promise(r => setTimeout(r, 800));
        setProgress(50);
        await new Promise(r => setTimeout(r, 700));
        const mockValue = BigInt(100) * BigInt(10 ** token.decimals);
        setRevealedBalance(mockValue);
        cacheBalance(cacheKey, mockValue);
        setStatus('revealed');
        setProgress(100);
        return;
      }

      // Real FHE mode
      if (!unseal || !isReady) {
        throw new Error('FHE session not ready. Please initialize first.');
      }

      // Fetch encrypted balance handle
      const { data: encrypted } = await refetchEncryptedBalance();
      setProgress(30);

      if (encrypted === undefined || encrypted === null) {
        throw new Error('Failed to fetch encrypted balance');
      }

      const encryptedBigInt = typeof encrypted === 'bigint' ? encrypted : BigInt(String(encrypted));
      if (encryptedBigInt === 0n) {
        setRevealedBalance(0n);
        cacheBalance(cacheKey, 0n);
        setStatus('revealed');
        setProgress(100);
        return;
      }

      // Progress simulation
      const progressInterval = setInterval(() => {
        setProgress(p => Math.min(p + 5, 90));
      }, 500);

      // Unseal (decrypt)
      const encryptedHex = `0x${encryptedBigInt.toString(16)}`;
      const decrypted = await unseal(encryptedHex, FHE_RETRY_ATTEMPTS);

      clearInterval(progressInterval);
      setProgress(100);

      setRevealedBalance(decrypted);
      cacheBalance(cacheKey, decrypted);
      setStatus('revealed');
    } catch (err) {
      console.error('Wallet balance reveal failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to reveal');
      setStatus('error');
      setProgress(0);
    }
  }, [address, cacheKey, getCachedBalance, cacheBalance, isMock, unseal, isReady, refetchEncryptedBalance, token.decimals]);

  const hide = useCallback(() => {
    setRevealedBalance(null);
    setStatus('idle');
    setProgress(0);
    setError(null);
  }, []);

  // Auto-reveal when FHE session becomes ready
  useEffect(() => {
    if (status !== 'idle') return; // Already revealing or revealed
    if (hasAttemptedAutoReveal.current) return; // Already attempted
    if (!isReady && !isMock) return; // Session not ready

    // Trigger auto-reveal
    hasAttemptedAutoReveal.current = true;
    reveal();
  }, [status, isReady, isMock]); // reveal intentionally not in deps to avoid loops

  const formattedBalance = revealedBalance !== null
    ? Number(formatUnits(revealedBalance, token.decimals)).toLocaleString(undefined, {
        maximumFractionDigits: token.symbol.includes('USDC') ? 2 : 4,
      })
    : null;

  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${style.gradient} flex items-center justify-center shadow-lg relative`}>
          <span className="text-white text-sm font-bold">{token.symbol.charAt(0)}</span>
          <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-iridescent-violet rounded-full flex items-center justify-center">
            <Lock className="w-2.5 h-2.5 text-white" />
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-feather-white">{token.symbol}</span>
            {style.badge && (
              <Badge variant={style.badgeVariant} className="text-[10px] px-1.5 py-0">
                {style.badge}
              </Badge>
            )}
            <button
              onClick={handleCopyAddress}
              className="p-1 rounded hover:bg-feather-white/10 transition-colors"
              title={`Copy ${token.symbol} address`}
            >
              {copied ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3 text-feather-white/40 hover:text-feather-white/70" />
              )}
            </button>
          </div>
          <p className="text-xs text-feather-white/40">{token.name}</p>
        </div>
      </div>
      <div className="text-right">
        {status === 'error' && (
          <div className="text-deep-magenta text-xs">
            {error}
            <button onClick={reveal} className="ml-2 underline">Retry</button>
          </div>
        )}

        {status === 'revealing' && (
          <div className="space-y-1 w-20">
            <span className="text-feather-white/60 text-xs">Decrypting...</span>
            <Progress value={progress} className="h-1" />
          </div>
        )}

        {status === 'revealed' && formattedBalance !== null && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-feather-white font-medium">{formattedBalance}</span>
            <button onClick={hide} className="text-xs text-iridescent-violet hover:underline">Hide</button>
          </div>
        )}

        {status === 'idle' && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-iridescent-violet">******</span>
            <button onClick={reveal} className="text-xs text-phoenix-ember hover:underline">Reveal</button>
          </div>
        )}
      </div>
    </div>
  );
}

interface FheatherXTokenProps {
  token: Token;
}

function FheatherXToken({ token }: FheatherXTokenProps) {
  const [copied, setCopied] = useState(false);
  const style = TOKEN_STYLES[token.symbol] || { gradient: 'from-gray-500 to-gray-600' };
  const {
    status,
    totalBalance,
    error,
    progress,
    reveal,
    hide,
    isRevealing,
    isRevealed,
  } = useAggregatedBalanceReveal(token.address, { autoReveal: true });

  const formattedBalance = totalBalance !== null
    ? Number(formatUnits(totalBalance, token.decimals)).toLocaleString(undefined, {
        maximumFractionDigits: token.symbol.includes('USDC') ? 2 : 4,
      })
    : null;

  const handleCopyAddress = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(token.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  }, [token.address]);

  return (
    <div className="flex items-center justify-between p-3 bg-gradient-to-r from-iridescent-violet/5 to-transparent border border-iridescent-violet/20 rounded-xl">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${style.gradient} flex items-center justify-center shadow-lg relative`}>
          <span className="text-white text-sm font-bold">{token.symbol.charAt(0)}</span>
          <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-iridescent-violet rounded-full flex items-center justify-center">
            <Lock className="w-2.5 h-2.5 text-white" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-feather-white">{token.symbol}</span>
          {style.badge && (
            <Badge variant={style.badgeVariant} className="text-[10px] px-1.5 py-0">
              {style.badge}
            </Badge>
          )}
          <button
            onClick={handleCopyAddress}
            className="p-1 rounded hover:bg-feather-white/10 transition-colors"
            title={`Copy ${token.symbol} address`}
          >
            {copied ? (
              <Check className="w-3 h-3 text-emerald-400" />
            ) : (
              <Copy className="w-3 h-3 text-feather-white/40 hover:text-feather-white/70" />
            )}
          </button>
        </div>
      </div>

      {/* Balance display with reveal functionality */}
      <div className="text-right">
        {status === 'error' && (
          <div className="text-deep-magenta text-sm">
            {error}
            <button onClick={reveal} className="ml-2 underline">
              Retry
            </button>
          </div>
        )}

        {isRevealing && (
          <div className="space-y-1 w-24">
            <span className="text-feather-white/60 text-sm">Decrypting...</span>
            <Progress value={progress} className="h-1" />
          </div>
        )}

        {isRevealed && formattedBalance !== null && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-feather-white font-medium">
              {formattedBalance}
            </span>
            <button
              onClick={hide}
              className="text-xs text-iridescent-violet hover:underline"
            >
              Hide
            </button>
          </div>
        )}

        {status === 'idle' && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-iridescent-violet">******</span>
            <button
              onClick={reveal}
              className="text-xs text-phoenix-ember hover:underline"
            >
              Reveal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Modern portfolio balance display
 * Two-column layout: Wallet | FheatherX positions
 *
 * Dynamically shows all tokens from discovered pools
 */
export function TokenBalanceTable() {
  const chainId = useChainId();
  const { address } = useAccount();
  const faucetTokens = getFaucetTokens(chainId);
  const { requestAllTokens, isRequesting } = useFaucet();
  const [isRequestingAll, setIsRequestingAll] = useState(false);

  // Get all unique tokens from discovered pools
  const poolTokens = useAllTokens();
  const isLoadingPools = usePoolStore(state => state.isLoadingPools);
  const poolsLoaded = usePoolStore(state => state.poolsLoaded);

  const handleGetAllTokens = useCallback(async () => {
    if (faucetTokens.length === 0) return;
    setIsRequestingAll(true);
    try {
      await requestAllTokens(faucetTokens);
    } finally {
      setIsRequestingAll(false);
    }
  }, [faucetTokens, requestAllTokens]);

  return (
    <div className="space-y-4">
      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Wallet Balances */}
        <Card className="overflow-hidden">
          <div className="p-4 border-b border-carbon-gray/30 bg-gradient-to-r from-emerald-500/10 to-transparent">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <Wallet className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <h3 className="font-semibold text-feather-white">Wallet</h3>
                <p className="text-xs text-feather-white/50">Your token balances</p>
              </div>
            </div>
          </div>
          <CardContent className="p-4 space-y-1">
            {/* ETH */}
            <WalletToken symbol="ETH" name="Ether" decimals={18} isNative />

            {/* Divider */}
            <div className="border-t border-carbon-gray/20 my-2" />

            {/* Faucet/Pool Tokens */}
            {faucetTokens.length > 0 ? (
              faucetTokens.map((token) => (
                token.type === 'fheerc20' ? (
                  <WalletFherc20Token key={token.address} token={token} />
                ) : (
                  <WalletToken
                    key={token.address}
                    symbol={token.symbol}
                    name={token.name}
                    decimals={token.decimals}
                    tokenAddress={token.address}
                  />
                )
              ))
            ) : (
              poolTokens.map((token) => (
                <WalletToken
                  key={token.address}
                  symbol={token.symbol}
                  name={token.name}
                  decimals={token.decimals}
                  tokenAddress={token.address}
                />
              ))
            )}
          </CardContent>
        </Card>

        {/* FheatherX Positions */}
        <Card className="overflow-hidden">
          <div className="p-4 border-b border-carbon-gray/30 bg-gradient-to-r from-iridescent-violet/10 to-transparent">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-iridescent-violet/20 flex items-center justify-center">
                <Lock className="w-4 h-4 text-iridescent-violet" />
              </div>
              <div>
                <h3 className="font-semibold text-feather-white">In FheatherX</h3>
                <p className="text-xs text-feather-white/50">Encrypted order balances</p>
              </div>
            </div>
          </div>
          <CardContent className="p-4 space-y-3">
            {isLoadingPools ? (
              <div className="text-center py-6 text-feather-white/40">
                <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin opacity-50" />
                <p className="text-sm">Loading pools...</p>
              </div>
            ) : poolTokens.length > 0 ? (
              poolTokens.map((token) => (
                <FheatherXToken
                  key={token.address}
                  token={token}
                />
              ))
            ) : (
              <div className="text-center py-6 text-feather-white/40">
                <Lock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No pools discovered</p>
                <p className="text-xs mt-1">Connect wallet to discover available pools</p>
              </div>
            )}

            {/* Info text */}
            {poolTokens.length > 0 && (
              <p className="text-xs text-feather-white/30 text-center pt-2">
                Balances aggregated across all pools
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Faucet Bar */}
      {faucetTokens.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 rounded-xl bg-gradient-to-r from-phoenix-ember/10 via-feather-gold/10 to-phoenix-ember/10 border border-phoenix-ember/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-phoenix-ember to-feather-gold flex items-center justify-center">
              <Droplets className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-medium text-feather-white">Testnet Faucet</p>
              <p className="text-xs text-feather-white/50">Get 100 of each token • 1hr cooldown</p>
            </div>
          </div>
          <Button
            onClick={handleGetAllTokens}
            disabled={isRequesting || isRequestingAll}
            className="w-full sm:w-auto"
          >
            {isRequestingAll ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Requesting...
              </>
            ) : (
              'Get All Tokens'
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
