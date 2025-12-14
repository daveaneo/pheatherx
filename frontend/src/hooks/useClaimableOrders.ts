'use client';

/**
 * useClaimableOrders - Hook to fetch orders with claimable proceeds
 *
 * Supports both v6 and v8 contracts:
 *
 * v6 (legacy): Orders become claimable when:
 * 1. User has placed a deposit (Deposit event with amountHash)
 * 2. The bucket has been filled (BucketFilled event matching tick/side)
 * 3. User hasn't claimed yet (no Claim event for that position)
 *
 * v8 (current): Orders become claimable when:
 * - Maker orders: Price crossed through their tick
 * - Taker orders: MomentumActivated event covers their tick range
 * - Confirmation: positions() shows realizedProceeds > 0
 *
 * Native (ERC:ERC) pools: No limit orders available
 *
 * The claim() function retrieves filled proceeds without requiring encrypted amount.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAccount, usePublicClient, useReadContract } from 'wagmi';
import { BucketSide, type BucketSideType } from '@/lib/contracts/fheatherXv6Abi';
import { FHEATHERX_V8_FHE_ABI } from '@/lib/contracts/fheatherXv8FHE-abi';
import { FHEATHERX_V8_MIXED_ABI } from '@/lib/contracts/fheatherXv8Mixed-abi';
import { useSelectedPool, determineContractType } from '@/stores/poolStore';
import { parseAbiItem } from 'viem';
import type { ContractType } from '@/types/pool';

export interface ClaimableOrder {
  poolId: `0x${string}`;
  tick: number;
  side: BucketSideType;
  sideLabel: 'Buy' | 'Sell';
  /** Order type: 'maker' (traditional limit) or 'taker' (momentum/stop-loss) */
  orderType: 'maker' | 'taker';
  /** Approximate trigger price based on tick */
  price: number;
  /** Block number when deposit was made */
  depositBlock: bigint;
  /** Block number when bucket was filled/triggered */
  filledBlock: bigint;
  /** Unique key for this position */
  key: string;
}

interface UseClaimableOrdersResult {
  claimableOrders: ClaimableOrder[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// v6 Event signatures (with amountHash)
const V6DepositEvent = parseAbiItem('event Deposit(bytes32 indexed poolId, address indexed user, int24 indexed tick, uint8 side, bytes32 amountHash)');
const V6BucketFilledEvent = parseAbiItem('event BucketFilled(bytes32 indexed poolId, int24 indexed tick, uint8 side)');
const V6ClaimEvent = parseAbiItem('event Claim(bytes32 indexed poolId, address indexed user, int24 indexed tick, uint8 side, bytes32 amountHash)');
const V6WithdrawEvent = parseAbiItem('event Withdraw(bytes32 indexed poolId, address indexed user, int24 indexed tick, uint8 side, bytes32 amountHash)');

// v8 Event signatures (NO amountHash)
const V8DepositEvent = parseAbiItem('event Deposit(bytes32 indexed poolId, address indexed user, int24 tick, uint8 side)');
const V8ClaimEvent = parseAbiItem('event Claim(bytes32 indexed poolId, address indexed user, int24 tick, uint8 side)');
const V8WithdrawEvent = parseAbiItem('event Withdraw(bytes32 indexed poolId, address indexed user, int24 tick, uint8 side)');
// MomentumActivated tracks when taker orders are triggered
const V8MomentumActivatedEvent = parseAbiItem('event MomentumActivated(bytes32 indexed poolId, int24 fromTick, int24 toTick, uint8 bucketsActivated)');

/**
 * Classify an order as maker or taker based on tick vs current tick
 * Called at deposit time to determine order intent
 */
function classifyOrder(side: BucketSideType, orderTick: number, currentTick: number): 'maker' | 'taker' {
  const orderAbovePrice = orderTick > currentTick;

  if (side === BucketSide.SELL) {
    // SELL above = maker (limit sell), SELL below = taker (stop-loss)
    return orderAbovePrice ? 'maker' : 'taker';
  } else {
    // BUY below = maker (limit buy), BUY above = taker (momentum buy)
    return orderAbovePrice ? 'taker' : 'maker';
  }
}

export function useClaimableOrders(): UseClaimableOrdersResult {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { hookAddress, pool } = useSelectedPool();

  // Determine contract type for event selection
  const contractType = determineContractType(pool);
  const isV8 = contractType === 'v8fhe' || contractType === 'v8mixed';

  const [claimableOrders, setClaimableOrders] = useState<ClaimableOrder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchClaimableOrders = useCallback(async () => {
    // Native pools don't have limit orders
    if (contractType === 'native') {
      setClaimableOrders([]);
      return;
    }

    if (!address || !hookAddress || !publicClient) {
      setClaimableOrders([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Look back a reasonable number of blocks (e.g., ~7 days on mainnet)
      const currentBlock = await publicClient.getBlockNumber();
      const fromBlock = currentBlock > 50000n ? currentBlock - 50000n : 0n;

      // Select events based on contract version
      const DepositEvent = isV8 ? V8DepositEvent : V6DepositEvent;
      const ClaimEvent = isV8 ? V8ClaimEvent : V6ClaimEvent;
      const WithdrawEvent = isV8 ? V8WithdrawEvent : V6WithdrawEvent;

      // Fetch all relevant events in parallel
      const eventPromises: Promise<unknown[]>[] = [
        // User's deposits
        publicClient.getLogs({
          address: hookAddress,
          event: DepositEvent,
          args: { user: address },
          fromBlock,
          toBlock: 'latest',
        }),
        // User's claims
        publicClient.getLogs({
          address: hookAddress,
          event: ClaimEvent,
          args: { user: address },
          fromBlock,
          toBlock: 'latest',
        }),
        // User's withdrawals
        publicClient.getLogs({
          address: hookAddress,
          event: WithdrawEvent,
          args: { user: address },
          fromBlock,
          toBlock: 'latest',
        }),
      ];

      // v6 uses BucketFilled, v8 uses MomentumActivated
      if (isV8) {
        eventPromises.push(
          publicClient.getLogs({
            address: hookAddress,
            event: V8MomentumActivatedEvent,
            fromBlock,
            toBlock: 'latest',
          })
        );
      } else {
        eventPromises.push(
          publicClient.getLogs({
            address: hookAddress,
            event: V6BucketFilledEvent,
            fromBlock,
            toBlock: 'latest',
          })
        );
      }

      const [depositLogs, claimLogs, withdrawLogs, filledOrMomentumLogs] = await Promise.all(eventPromises) as [
        Awaited<ReturnType<typeof publicClient.getLogs>>,
        Awaited<ReturnType<typeof publicClient.getLogs>>,
        Awaited<ReturnType<typeof publicClient.getLogs>>,
        Awaited<ReturnType<typeof publicClient.getLogs>>
      ];

      // Build a set of already claimed/withdrawn positions (poolId:tick:side)
      const claimedPositions = new Set<string>();
      for (const log of claimLogs) {
        const args = (log as { args: Record<string, unknown> }).args;
        const poolId = args.poolId;
        const tick = args.tick;
        const side = args.side;
        if (poolId === undefined || tick === undefined || side === undefined) continue;
        claimedPositions.add(`${poolId}:${tick}:${side}`);
      }
      for (const log of withdrawLogs) {
        const args = (log as { args: Record<string, unknown> }).args;
        const poolId = args.poolId;
        const tick = args.tick;
        const side = args.side;
        if (poolId === undefined || tick === undefined || side === undefined) continue;
        claimedPositions.add(`${poolId}:${tick}:${side}`);
      }

      // Find claimable orders based on version
      const claimable: ClaimableOrder[] = [];
      const seenPositions = new Set<string>();

      if (isV8) {
        // v8: Build momentum activation ranges for taker order detection
        // MomentumActivated(poolId, fromTick, toTick, bucketsActivated)
        interface MomentumRange {
          fromTick: number;
          toTick: number;
          blockNumber: bigint;
        }
        const momentumRanges = new Map<string, MomentumRange[]>(); // poolId -> ranges

        for (const log of filledOrMomentumLogs) {
          const args = (log as { args: Record<string, unknown> }).args;
          const poolId = args.poolId as `0x${string}` | undefined;
          const fromTick = args.fromTick as number | undefined;
          const toTick = args.toTick as number | undefined;
          if (poolId === undefined || fromTick === undefined || toTick === undefined) continue;

          const ranges = momentumRanges.get(poolId) || [];
          ranges.push({
            fromTick: Number(fromTick),
            toTick: Number(toTick),
            blockNumber: log.blockNumber || 0n,
          });
          momentumRanges.set(poolId, ranges);
        }

        // For v8, we need to read positions() to check realizedProceeds
        // This works for both maker AND taker orders
        // MomentumActivated is just an optimization hint for taker orders

        // Get the correct ABI for reading positions
        const positionsAbi = contractType === 'v8fhe' ? FHEATHERX_V8_FHE_ABI : FHEATHERX_V8_MIXED_ABI;

        for (const log of depositLogs) {
          const args = (log as { args: Record<string, unknown> }).args;
          const poolId = args.poolId as `0x${string}` | undefined;
          const tick = args.tick;
          const side = args.side;
          if (poolId === undefined || tick === undefined || side === undefined) continue;

          const tickNum = Number(tick);
          const sideNum = side as BucketSideType;
          const positionKey = `${poolId}:${tickNum}:${sideNum}`;

          // Skip if already processed or claimed
          if (seenPositions.has(positionKey)) continue;
          if (claimedPositions.has(positionKey)) continue;
          seenPositions.add(positionKey);

          try {
            // Read positions() to check if there are claimable proceeds
            // positions(poolId, user, tick, side) returns UserPosition struct
            const position = await publicClient.readContract({
              address: hookAddress,
              abi: positionsAbi,
              functionName: 'positions',
              args: [poolId, address, tickNum, sideNum],
            }) as [bigint, bigint, bigint, bigint]; // [shares, proceedsPerShareSnapshot, realizedProceeds, ...]

            const sharesHandle = position[0];
            const realizedProceedsHandle = position[2]; // Index may vary - check contract

            // Order is claimable if realizedProceeds > 0
            const hasClaimableProceeds = realizedProceedsHandle > 0n;
            // Order is active if it has shares (unfilled) or claimable proceeds
            const isActive = sharesHandle > 0n || hasClaimableProceeds;

            if (hasClaimableProceeds) {
              // Determine if this was a maker or taker order using MomentumActivated
              const ranges = momentumRanges.get(poolId) || [];
              let isTaker = false;
              let triggeredBlock: bigint | undefined;

              for (const range of ranges) {
                const tickInRange = (tickNum >= Math.min(range.fromTick, range.toTick)) &&
                                   (tickNum <= Math.max(range.fromTick, range.toTick));
                if (tickInRange) {
                  isTaker = true;
                  if (!triggeredBlock || range.blockNumber > triggeredBlock) {
                    triggeredBlock = range.blockNumber;
                  }
                }
              }

              const price = Math.pow(1.0001, tickNum);
              claimable.push({
                poolId,
                tick: tickNum,
                side: sideNum,
                sideLabel: sideNum === BucketSide.BUY ? 'Buy' : 'Sell',
                orderType: isTaker ? 'taker' : 'maker',
                price,
                depositBlock: log.blockNumber || 0n,
                filledBlock: triggeredBlock || log.blockNumber || 0n,
                key: positionKey,
              });
            }
          } catch (err) {
            console.warn(`[useClaimableOrders] Failed to read position at tick ${tickNum}:`, err);
          }
        }
      } else {
        // v6: Build filled buckets map (poolId:tick:side)
        const filledBuckets = new Map<string, bigint>();
        for (const log of filledOrMomentumLogs) {
          const args = (log as { args: Record<string, unknown> }).args;
          const poolId = args.poolId;
          const tick = args.tick;
          const side = args.side;
          if (poolId === undefined || tick === undefined || side === undefined) continue;

          const key = `${poolId}:${tick}:${side}`;
          // Track the block when it was filled
          if (!filledBuckets.has(key) || (log.blockNumber && log.blockNumber < filledBuckets.get(key)!)) {
            filledBuckets.set(key, log.blockNumber || 0n);
          }
        }

        // Find deposits that are in filled buckets but not yet claimed
        for (const log of depositLogs) {
          const args = (log as { args: Record<string, unknown> }).args;
          const poolId = args.poolId;
          const tick = args.tick;
          const side = args.side;
          if (poolId === undefined || tick === undefined || side === undefined) continue;

          const bucketKey = `${poolId}:${tick}:${side}`;
          const positionKey = bucketKey;

          // Skip if already processed this position
          if (seenPositions.has(positionKey)) continue;
          seenPositions.add(positionKey);

          // Check if bucket is filled and not yet claimed
          if (filledBuckets.has(bucketKey) && !claimedPositions.has(positionKey)) {
            const tickNum = Number(tick);
            const sideNum = side as BucketSideType;
            const price = Math.pow(1.0001, tickNum);

            claimable.push({
              poolId: poolId as `0x${string}`,
              tick: tickNum,
              side: sideNum,
              sideLabel: sideNum === BucketSide.BUY ? 'Buy' : 'Sell',
              orderType: 'maker', // v6 doesn't distinguish, default to maker
              price,
              depositBlock: log.blockNumber || 0n,
              filledBlock: filledBuckets.get(bucketKey) || 0n,
              key: positionKey,
            });
          }
        }
      }

      // Sort by filled block (most recent first)
      claimable.sort((a, b) => Number(b.filledBlock - a.filledBlock));

      setClaimableOrders(claimable);
    } catch (err) {
      console.error('[useClaimableOrders] Error fetching orders:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch claimable orders');
      setClaimableOrders([]);
    } finally {
      setIsLoading(false);
    }
  }, [address, hookAddress, publicClient, contractType, isV8]);

  // Fetch on mount and when dependencies change
  useEffect(() => {
    fetchClaimableOrders();
  }, [fetchClaimableOrders]);

  return {
    claimableOrders,
    isLoading,
    error,
    refetch: fetchClaimableOrders,
  };
}

/**
 * Hook to get count of claimable orders (for badges/notifications)
 */
export function useClaimableOrdersCount(): number {
  const { claimableOrders } = useClaimableOrders();
  return claimableOrders.length;
}
