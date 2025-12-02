'use client';

import { useMemo } from 'react';
import { useClient } from 'wagmi';
import { BrowserProvider, JsonRpcProvider } from 'ethers';

export function useEthersProvider() {
  const client = useClient();

  return useMemo(() => {
    if (!client) return undefined;

    const { chain, transport } = client;
    const network = {
      chainId: chain.id,
      name: chain.name,
      ensAddress: chain.contracts?.ensRegistry?.address,
    };

    if (transport.type === 'fallback') {
      const url = (transport.transports as Array<{ value?: { url?: string } }>)[0]?.value?.url;
      if (url) {
        return new JsonRpcProvider(url, network);
      }
    }

    return new BrowserProvider(transport as any, network);
  }, [client]);
}
