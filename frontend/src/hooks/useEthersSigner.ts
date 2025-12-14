'use client';

import { useMemo } from 'react';
import { useConnectorClient } from 'wagmi';
import { BrowserProvider, JsonRpcSigner } from 'ethers';

export function useEthersSigner() {
  const { data: client } = useConnectorClient();

  return useMemo(() => {
    if (!client) return undefined;

    const { account, chain, transport } = client;

    // Account may be undefined if wallet is connecting
    if (!account || !chain) return undefined;

    const network = {
      chainId: chain.id,
      name: chain.name,
      ensAddress: chain.contracts?.ensRegistry?.address,
    };

    const provider = new BrowserProvider(transport as any, network);
    return new JsonRpcSigner(provider, account.address);
  }, [client]);
}
