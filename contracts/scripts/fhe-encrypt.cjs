#!/usr/bin/env node
/**
 * FFI Helper for Foundry Integration Tests
 *
 * This script encrypts values using cofhejs and outputs ABI-encoded data
 * that Foundry can decode via FFI.
 *
 * Usage:
 *   node scripts/fhe-encrypt.cjs uint128 <value> <wallet_address>
 *   node scripts/fhe-encrypt.cjs bool <value> <wallet_address>
 *
 * Output: ABI-encoded InEuint128 or InEbool struct (hex string)
 *
 * The output can be decoded in Foundry using:
 *   abi.decode(result, (InEuint128))
 */

const { ethers } = require('ethers');
require('dotenv').config();

// Network configuration
const NETWORK = process.env.FFI_NETWORK || 'arb-sepolia';

const NETWORKS = {
  'arb-sepolia': {
    rpc: process.env.ARB_SEPOLIA_RPC || 'https://sepolia-rollup.arbitrum.io/rpc',
  },
  'eth-sepolia': {
    rpc: process.env.ETH_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com',
  },
};

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: node fhe-encrypt.cjs <type> <value>');
    console.error('  type: uint128 or bool');
    console.error('  value: numeric value (for uint128) or true/false (for bool)');
    console.error('');
    console.error('Requires PRIVATE_KEY env var to be set');
    process.exit(1);
  }

  const type = args[0];
  const valueStr = args[1];

  // Get private key from env
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('ERROR: PRIVATE_KEY not set in environment');
    process.exit(1);
  }

  const config = NETWORKS[NETWORK];
  if (!config) {
    console.error(`Unknown network: ${NETWORK}`);
    process.exit(1);
  }

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(config.rpc);
  const wallet = new ethers.Wallet(privateKey, provider);

  // Initialize cofhejs
  const { cofhejs, Encryptable } = require('cofhejs/node');

  const cofheResult = await cofhejs.initializeWithEthers({
    ethersProvider: provider,
    ethersSigner: wallet,
    environment: 'TESTNET',
    generatePermit: true,
  });

  if ('error' in cofheResult && cofheResult.error) {
    console.error('cofhejs init failed:', cofheResult.error);
    process.exit(1);
  }

  // Parse and encrypt value
  let encryptable;
  if (type === 'uint128') {
    const value = BigInt(valueStr);
    encryptable = Encryptable.uint128(value);
  } else if (type === 'bool') {
    const value = valueStr === 'true' || valueStr === '1';
    encryptable = Encryptable.bool(value);
  } else {
    console.error(`Unknown type: ${type}. Use 'uint128' or 'bool'`);
    process.exit(1);
  }

  const encResult = await cofhejs.encrypt([encryptable]);

  if ('error' in encResult && encResult.error) {
    console.error('Encryption failed:', encResult.error);
    process.exit(1);
  }

  const encrypted = 'data' in encResult ? encResult.data : encResult;
  const enc = encrypted[0];

  // ABI encode the InEuint128/InEbool struct
  // struct InEuint128 { uint256 ctHash; uint8 securityZone; uint8 utype; bytes signature; }
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  const encoded = abiCoder.encode(
    ['tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature)'],
    [[
      BigInt(enc.ctHash),
      enc.securityZone,
      enc.utype,
      enc.signature,
    ]]
  );

  // Output just the hex string (Foundry expects raw hex)
  process.stdout.write(encoded);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
