'use client';

import { useState, useCallback } from 'react';
import { useAccount, useChainId } from 'wagmi';

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum Mainnet',
  11155111: 'Ethereum Sepolia',
  421614: 'Arbitrum Sepolia',
  42161: 'Arbitrum One',
};

const SUPPORTED_FHE_CHAINS = [11155111, 421614];

type LogEntry = { msg: string; isError: boolean; isSuccess?: boolean };

type TestResult = {
  chainId: number;
  chainName: string;
  success: boolean;
  elapsed?: number;
  wallet?: string;
  error?: any;
};

export default function TestFhePage() {
  const { isConnected } = useAccount();
  const chainId = useChainId();

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<TestResult[] | null>(null);

  const log = useCallback((msg: string, isError = false, isSuccess = false) => {
    setLogs((prev) => [...prev, { msg, isError, isSuccess }]);
  }, []);

  const clearLogs = () => {
    setLogs([]);
    setResults(null);
  };

  // Run server-side tests via API
  const runServerTests = async () => {
    setIsLoading(true);
    clearLogs();

    log('═══════════════════════════════════════════════════════════');
    log('   cofhejs SERVER-SIDE TEST (via API route)');
    log('═══════════════════════════════════════════════════════════');
    log('');
    log('This runs cofhejs/node on the server where WASM works correctly.');
    log('');

    try {
      const response = await fetch('/api/test-cofhe');
      const data = await response.json();

      log(`Timestamp: ${data.timestamp}`);
      log('');

      for (const result of data.results) {
        log(`▓▓▓ ${result.chainName} (${result.chainId}) ▓▓▓`);

        if (result.success) {
          log(`✓ SUCCESS in ${result.elapsed}ms`, false, true);
          log(`  Wallet: ${result.wallet}`);
        } else {
          log(`✗ FAILED: ${JSON.stringify(result.error)}`, true);
        }
        log('');
      }

      log('═══════════════════════════════════════════════════════════');
      if (data.summary === 'ALL TESTS PASSED') {
        log(`✓ ${data.summary}`, false, true);
      } else {
        log(`✗ ${data.summary}`, true);
      }
      log('═══════════════════════════════════════════════════════════');

      setResults(data.results);
    } catch (error: any) {
      log(`✗ API Error: ${error.message}`, true);
    }

    setIsLoading(false);
  };

  // Test specific chain via POST
  const runChainTest = async (testChainId: number, variation: number = 1) => {
    setIsLoading(true);
    clearLogs();

    const chainName = CHAIN_NAMES[testChainId] || 'Unknown';
    log(`Testing ${chainName} (${testChainId}) with variation ${variation}...`);

    try {
      const response = await fetch('/api/test-cofhe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chainId: testChainId, variation }),
      });
      const data = await response.json();

      if (data.success) {
        log(`✓ SUCCESS in ${data.elapsed}ms`, false, true);
        log(`  Chain: ${data.chainName}`);
        log(`  Variation: ${data.variation}`);
        log(`  Wallet: ${data.wallet}`);
        log(`  Issuer: ${data.data?.issuer}`);
        log(`  Contract: ${data.data?.verifyingContract}`);
      } else {
        log(`✗ FAILED`, true);
        log(`  Error: ${JSON.stringify(data.error)}`, true);
      }
    } catch (error: any) {
      log(`✗ API Error: ${error.message}`, true);
    }

    setIsLoading(false);
  };

  const isFheSupported = SUPPORTED_FHE_CHAINS.includes(chainId);

  return (
    <div className="min-h-screen bg-gray-900 text-green-400 p-6 font-mono">
      <h1 className="text-2xl font-bold text-white mb-4">
        cofhejs Test Suite
      </h1>
      <p className="text-gray-400 mb-4">
        Tests cofhejs initialization using server-side API (Node.js) where WASM works correctly.
      </p>

      {/* Status Badges */}
      <div className="bg-gray-800 p-4 rounded mb-4 flex flex-wrap items-center gap-4">
        <span className="text-white font-bold">Your Network:</span>
        <span>{CHAIN_NAMES[chainId] || `Unknown (${chainId})`}</span>
        <span
          className={`px-2 py-1 rounded text-sm ${
            isFheSupported ? 'bg-green-500 text-black' : 'bg-red-500 text-white'
          }`}
        >
          {isFheSupported ? 'FHE Supported' : 'FHE Not Supported'}
        </span>
        {results && (
          <span
            className={`px-2 py-1 rounded text-sm ${
              results.every((r) => r.success)
                ? 'bg-green-500 text-black'
                : 'bg-red-500 text-white'
            }`}
          >
            {results.every((r) => r.success) ? 'All Tests Passed' : 'Tests Failed'}
          </span>
        )}
      </div>

      {/* Buttons */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={runServerTests}
          disabled={isLoading}
          className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 font-bold"
        >
          {isLoading ? '⏳ Running...' : '🚀 Run All Server Tests'}
        </button>
        <button
          onClick={() => runChainTest(11155111)}
          disabled={isLoading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          Test ETH Sepolia
        </button>
        <button
          onClick={() => runChainTest(421614)}
          disabled={isLoading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          Test Arb Sepolia
        </button>
        <button
          onClick={clearLogs}
          className="px-4 py-2 bg-red-700 text-white rounded hover:bg-red-600"
        >
          Clear
        </button>
      </div>

      {/* Info Box */}
      <div className="bg-blue-900 text-blue-200 p-4 rounded mb-4 text-sm">
        <strong>Note:</strong> These tests run on the server (Node.js) via API routes because
        cofhejs/web has WASM initialization issues in browsers. The server-side cofhejs/node
        works correctly on both ETH Sepolia and Arbitrum Sepolia.
      </div>

      {/* Results Summary */}
      {results && (
        <div className="bg-gray-800 p-4 rounded mb-4">
          <h3 className="text-white font-bold mb-2">Results Summary</h3>
          <div className="grid grid-cols-2 gap-4">
            {results.map((r) => (
              <div
                key={r.chainId}
                className={`p-3 rounded ${
                  r.success ? 'bg-green-900' : 'bg-red-900'
                }`}
              >
                <div className="font-bold">{r.chainName}</div>
                <div className="text-sm">
                  {r.success ? `✓ ${r.elapsed}ms` : `✗ Failed`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Log Output */}
      <div className="bg-black p-4 rounded border border-gray-700 max-h-[400px] overflow-auto">
        {logs.length === 0 ? (
          <span className="text-gray-500">
            Click &quot;Run All Server Tests&quot; to test cofhejs initialization...
          </span>
        ) : (
          logs.map((entry, i) => (
            <pre
              key={i}
              className={`whitespace-pre-wrap ${
                entry.isSuccess
                  ? 'text-green-400 font-bold'
                  : entry.isError
                  ? 'text-red-400'
                  : 'text-green-400'
              }`}
            >
              {entry.msg}
            </pre>
          ))
        )}
      </div>
    </div>
  );
}
