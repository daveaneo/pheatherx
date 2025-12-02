'use client';

import { usePublicClient } from 'wagmi';
import { formatEther, type Abi } from 'viem';

interface GasEstimateRequest {
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  account?: `0x${string}`;
}

interface GasEstimate {
  gas: bigint;
  gasPrice: bigint;
  estimatedCost: bigint;
  estimatedCostEth: string;
  estimatedCostFormatted: string;
  estimatedCostUsd?: number;
}

export function useGasEstimate() {
  const publicClient = usePublicClient();

  const estimate = async (
    request: GasEstimateRequest,
    ethPriceUsd?: number
  ): Promise<GasEstimate | null> => {
    if (!publicClient) return null;

    try {
      const [gas, gasPrice] = await Promise.all([
        publicClient.estimateContractGas({
          address: request.address,
          abi: request.abi,
          functionName: request.functionName,
          args: request.args,
          value: request.value,
          account: request.account,
        }),
        publicClient.getGasPrice(),
      ]);

      const estimatedCost = gas * gasPrice;
      const estimatedCostEth = formatEther(estimatedCost);

      // Format for display (e.g., "~0.002 ETH")
      const ethValue = parseFloat(estimatedCostEth);
      const estimatedCostFormatted = ethValue < 0.0001
        ? '<0.0001 ETH'
        : `~${ethValue.toFixed(4)} ETH`;

      return {
        gas,
        gasPrice,
        estimatedCost,
        estimatedCostEth,
        estimatedCostFormatted,
        estimatedCostUsd: ethPriceUsd
          ? ethValue * ethPriceUsd
          : undefined,
      };
    } catch (error) {
      console.warn('Gas estimation failed:', error);
      return null; // Estimation failed - tx likely to fail
    }
  };

  /**
   * Estimate gas for multiple operations
   */
  const estimateMultiple = async (
    requests: GasEstimateRequest[],
    ethPriceUsd?: number
  ): Promise<(GasEstimate | null)[]> => {
    return Promise.all(requests.map(req => estimate(req, ethPriceUsd)));
  };

  return { estimate, estimateMultiple };
}
