'use client';

import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract, useSwitchChain, useChainId } from 'wagmi';
import { useEthersSigner } from '@/hooks/useEthersSigner';
import { useEthersProvider } from '@/hooks/useEthersProvider';

const FHERC20_ABI = [
  { type: 'function', name: 'faucet', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'balanceOfEncrypted', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'hasEncryptedBalance', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' },
] as const;

// fheUSDC on Arb Sepolia
const TOKEN_ADDRESS = '0x43AcAe0A089f3cd188f9fB0731059Eb7bC27D3Aa';
const ARB_SEPOLIA_CHAIN_ID = 421614;

/**
 * Test page for cofhejs/web in browser
 * Check if WASM initialization works
 */
export default function TestCofhejsWebPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const provider = useEthersProvider();
  const signer = useEthersSigner();
  const { switchChain } = useSwitchChain();

  const [status, setStatus] = useState<string>('idle');
  const [result, setResult] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isCorrectNetwork = chainId === ARB_SEPOLIA_CHAIN_ID;

  // Faucet transaction
  const { writeContract, data: txHash, isPending: isFaucetPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  // Read encrypted balance
  const { data: encryptedBalance, refetch: refetchBalance } = useReadContract({
    address: TOKEN_ADDRESS,
    abi: FHERC20_ABI,
    functionName: 'balanceOfEncrypted',
    args: address ? [address] : undefined,
    query: { enabled: !!address && isCorrectNetwork },
  });

  const handleSwitchNetwork = () => {
    switchChain({ chainId: ARB_SEPOLIA_CHAIN_ID });
  };

  const callFaucet = async () => {
    writeContract({
      address: TOKEN_ADDRESS,
      abi: FHERC20_ABI,
      functionName: 'faucet',
    });
  };

  const testCofhejsWeb = async () => {
    setStatus('loading');
    setError(null);
    setResult(null);

    try {
      // Refetch balance first
      const { data: freshBalance } = await refetchBalance();

      // Step 1: Dynamic import cofhejs/web
      setStatus('Importing cofhejs/web...');
      const { cofhejs, FheTypes } = await import('cofhejs/web');
      setResult(prev => ({ ...prev, step1: 'cofhejs/web imported successfully' }));

      // Step 2: Check if provider/signer available
      if (!provider || !signer) {
        throw new Error('Provider or signer not available. Connect wallet first.');
      }
      setResult(prev => ({ ...prev, step2: 'Provider and signer available' }));

      // Step 3: Initialize with user's wallet
      setStatus('Initializing cofhejs with user wallet...');
      const initResult = await cofhejs.initializeWithEthers({
        ethersProvider: provider,
        ethersSigner: signer,
        environment: 'TESTNET',
        generatePermit: true,
      });

      if (!initResult.success) {
        throw new Error(`Init failed: ${JSON.stringify(initResult.error)}`);
      }
      setResult(prev => ({
        ...prev,
        step3: 'Initialized successfully',
        permitIssuer: initResult.data?.issuer,
      }));

      // Step 4: Get permit info
      const permitResult = cofhejs.getPermit();
      if ('error' in permitResult && permitResult.error) {
        throw new Error(`Get permit failed: ${JSON.stringify(permitResult.error)}`);
      }
      const permit = 'data' in permitResult ? permitResult.data : permitResult;
      setResult(prev => ({
        ...prev,
        step4: 'Got permit',
        permit: {
          issuer: permit.issuer,
          type: permit.type,
          hasPrivateKey: !!permit.sealingPair?.privateKey,
        }
      }));

      // Step 5: Get current encrypted balance
      const balance = freshBalance || encryptedBalance;
      if (!balance || balance === 0n) {
        setResult(prev => ({
          ...prev,
          step5: 'No encrypted balance found. Call faucet first!',
          encryptedBalance: balance?.toString() || '0',
        }));
        setStatus('complete');
        return;
      }

      setResult(prev => ({
        ...prev,
        step5: 'Found encrypted balance',
        encryptedBalance: balance.toString(),
        encryptedBalanceHex: '0x' + balance.toString(16),
      }));

      // Step 6: Try to unseal
      setStatus('Attempting unseal...');
      const unsealResult = await cofhejs.unseal(balance, FheTypes.Uint128);

      if ('error' in unsealResult && unsealResult.error) {
        setResult(prev => ({
          ...prev,
          step6: 'Unseal FAILED',
          unsealError: unsealResult.error,
        }));
      } else {
        const value = 'data' in unsealResult ? unsealResult.data : unsealResult;
        setResult(prev => ({
          ...prev,
          step6: 'Unseal SUCCESS!',
          unsealedValue: value.toString(),
          humanReadable: `${Number(value) / 1e6} fheUSDC`,
        }));
      }

      setStatus('complete');
    } catch (err: any) {
      setError(err.message || String(err));
      setStatus('error');
    }
  };

  return (
    <div className="container mx-auto p-8 max-w-2xl bg-white min-h-screen">
      <h1 className="text-2xl font-bold mb-4 text-black">Test cofhejs/web in Browser</h1>

      <div className="mb-4 p-4 bg-gray-100 rounded border border-gray-300">
        <p className="text-black"><strong>Connected:</strong> {isConnected ? 'Yes' : 'No'}</p>
        <p className="text-black"><strong>Address:</strong> {address || 'Not connected'}</p>
        <p className="text-black"><strong>Chain ID:</strong> {chainId} {isCorrectNetwork ? '✅ Arb Sepolia' : '❌ Wrong network'}</p>
        <p className="text-black"><strong>Token:</strong> fheUSDC ({TOKEN_ADDRESS.slice(0, 10)}...)</p>
        <p className="text-black"><strong>Current Balance Handle:</strong> {isCorrectNetwork ? (encryptedBalance?.toString() || 'Loading...') : 'Switch network first'}</p>
      </div>

      {!isCorrectNetwork && (
        <div className="mb-4 p-4 bg-yellow-100 border border-yellow-400 rounded">
          <p className="text-yellow-800 font-semibold mb-2">Wrong Network!</p>
          <p className="text-yellow-700 mb-3">You need to be on Arbitrum Sepolia (421614) to test fheUSDC.</p>
          <button
            onClick={handleSwitchNetwork}
            className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600"
          >
            Switch to Arb Sepolia
          </button>
        </div>
      )}

      <div className="flex gap-4 mb-4">
        <button
          onClick={callFaucet}
          disabled={isFaucetPending || isConfirming || !isConnected || !isCorrectNetwork}
          className="px-4 py-2 bg-green-500 text-white rounded disabled:bg-gray-400"
        >
          {isFaucetPending ? 'Confirming...' : isConfirming ? 'Waiting...' : 'Call Faucet (Get 100 fheUSDC)'}
        </button>

        <button
          onClick={testCofhejsWeb}
          disabled={status === 'loading' || !isConnected || !isCorrectNetwork}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-400"
        >
          {status === 'loading' ? 'Testing...' : 'Test Unseal'}
        </button>
      </div>

      {isConfirmed && txHash && (
        <div className="mb-4 p-3 bg-green-100 border border-green-400 rounded">
          <p className="text-green-800">Faucet called! TX: {txHash.slice(0, 20)}...</p>
          <p className="text-green-700 text-sm">Refresh balance and try unseal again.</p>
        </div>
      )}

      {status !== 'idle' && (
        <div className="mt-4">
          <p className="font-semibold text-black">Status: {status}</p>
        </div>
      )}

      {error && (
        <div className="mt-4 p-4 bg-red-100 border border-red-400 rounded">
          <p className="text-red-800 font-semibold">Error:</p>
          <pre className="text-red-700 text-sm whitespace-pre-wrap">{error}</pre>
        </div>
      )}

      {result && (
        <div className="mt-4 p-4 bg-blue-100 border border-blue-400 rounded">
          <p className="text-blue-800 font-semibold">Results:</p>
          <pre className="text-blue-900 text-sm whitespace-pre-wrap">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
