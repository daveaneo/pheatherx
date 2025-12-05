/**
 * Server-side API route for FHE operations
 * Runs cofhejs/node on the server where WASM works correctly
 */

import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';

const RPC_URLS: Record<number, string> = {
  11155111: 'https://ethereum-sepolia-rpc.publicnode.com',
  421614: 'https://sepolia-rollup.arbitrum.io/rpc',
};

// Cache for initialized cofhejs instances per session
const sessionCache = new Map<string, {
  cofhejs: any;
  permit: any;
  expiresAt: number;
}>();

// Clean expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessionCache.entries()) {
    if (session.expiresAt < now) {
      sessionCache.delete(key);
    }
  }
}, 60000); // Clean every minute

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, chainId, userAddress, signature, data } = body;

    // Only validate chainId for actions that need it (initialize)
    // encrypt/unseal use the cached session which already has the chain context
    if (action === 'initialize') {
      if (!chainId || !RPC_URLS[chainId]) {
        return NextResponse.json(
          { success: false, error: `Unsupported chain ID: ${chainId}` },
          { status: 400 }
        );
      }
    }

    const rpcUrl = chainId ? RPC_URLS[chainId] : null;

    switch (action) {
      case 'initialize': {
        // Initialize a new FHE session
        const provider = new ethers.JsonRpcProvider(rpcUrl!);

        // For server-side, we create a session key that the client can use
        const sessionWallet = ethers.Wallet.createRandom().connect(provider);
        const sessionId = `${chainId}-${userAddress}-${Date.now()}`;

        const { cofhejs } = await import('cofhejs/node');

        const result = await cofhejs.initializeWithEthers({
          ethersProvider: provider,
          ethersSigner: sessionWallet,
          environment: 'TESTNET',
          generatePermit: true,
        });

        if (!result.success) {
          return NextResponse.json({
            success: false,
            error: result.error,
          });
        }

        // Cache the session
        const SESSION_DURATION = 30 * 60 * 1000; // 30 minutes
        sessionCache.set(sessionId, {
          cofhejs,
          permit: result.data,
          expiresAt: Date.now() + SESSION_DURATION,
        });

        return NextResponse.json({
          success: true,
          sessionId,
          permit: {
            issuer: result.data?.issuer,
            chainId: result.data?._signedDomain?.chainId,
            verifyingContract: result.data?._signedDomain?.verifyingContract,
            publicKey: result.data?.sealingPair?.publicKey,
          },
          expiresAt: Date.now() + SESSION_DURATION,
        });
      }

      case 'encrypt': {
        // Encrypt a value
        const { sessionId, value, type = 'uint128' } = data;

        const session = sessionCache.get(sessionId);
        if (!session) {
          return NextResponse.json({
            success: false,
            error: 'Session not found or expired. Please reinitialize.',
          }, { status: 401 });
        }

        const { cofhejs } = session;

        // Import Encryptable
        const { Encryptable } = await import('cofhejs/node');

        let encryptable;
        switch (type) {
          case 'uint128':
            encryptable = Encryptable.uint128(BigInt(value));
            break;
          case 'bool':
            encryptable = Encryptable.bool(value === true || value === 'true');
            break;
          default:
            return NextResponse.json({
              success: false,
              error: `Unknown type: ${type}`,
            }, { status: 400 });
        }

        const result = await cofhejs.encrypt([encryptable]);

        if ('error' in result && result.error) {
          return NextResponse.json({
            success: false,
            error: result.error,
          });
        }

        const encrypted = 'data' in result ? result.data : result;
        const ctHash = encrypted[0].ctHash.toString();

        return NextResponse.json({
          success: true,
          ciphertext: ctHash,
        });
      }

      case 'unseal': {
        // Decrypt/unseal a ciphertext
        const { sessionId, ciphertext, type = 'uint128' } = data;

        const session = sessionCache.get(sessionId);
        if (!session) {
          return NextResponse.json({
            success: false,
            error: 'Session not found or expired. Please reinitialize.',
          }, { status: 401 });
        }

        const { cofhejs } = session;
        const { FheTypes } = await import('cofhejs/node');

        let fheType;
        switch (type) {
          case 'uint128':
            fheType = FheTypes.Uint128;
            break;
          case 'bool':
            fheType = FheTypes.Bool;
            break;
          default:
            return NextResponse.json({
              success: false,
              error: `Unknown type: ${type}`,
            }, { status: 400 });
        }

        const ctHash = BigInt(ciphertext);
        const result = await cofhejs.unseal(ctHash, fheType);

        if ('error' in result && result.error) {
          return NextResponse.json({
            success: false,
            error: result.error,
          });
        }

        const unsealed = 'data' in result ? result.data : result;

        return NextResponse.json({
          success: true,
          value: unsealed.toString(),
        });
      }

      case 'getSession': {
        // Check if a session is still valid
        const { sessionId } = data;
        const session = sessionCache.get(sessionId);

        if (!session) {
          return NextResponse.json({
            success: false,
            valid: false,
            error: 'Session not found',
          });
        }

        if (session.expiresAt < Date.now()) {
          sessionCache.delete(sessionId);
          return NextResponse.json({
            success: false,
            valid: false,
            error: 'Session expired',
          });
        }

        return NextResponse.json({
          success: true,
          valid: true,
          expiresAt: session.expiresAt,
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error: any) {
    console.error('[FHE API Error]', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
