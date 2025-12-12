import { createPublicClient, http, parseAbiItem } from 'viem';
import { arbitrumSepolia } from 'viem/chains';

// From v6-arb-sepolia.json (updated 2024-12-11 - limit order bugfix)
const HOOK_ADDRESS = '0x8eE2375234D0b0a50a41458a471cfa8fB490d0c8';
const USER_ADDRESS = '0x60B9be2A29a02F49e8D6ba535303caD1Ddcb9659';
const POOL_ID = '0x943373077c39300e6f34b9d3fa425061d93adec9a115e02a2c7ddfa8a23178fc'; // fheWETH/fheUSDC (new hook)

const client = createPublicClient({
  chain: arbitrumSepolia,
  transport: http('https://sepolia-rollup.arbitrum.io/rpc'),
});

const ABI = [
  {
    type: 'function',
    name: 'positions',
    inputs: [
      { name: '', type: 'bytes32' },
      { name: '', type: 'address' },
      { name: '', type: 'int24' },
      { name: '', type: 'uint8' }
    ],
    outputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'proceedsPerShareSnapshot', type: 'uint256' },
      { name: 'filledPerShareSnapshot', type: 'uint256' },
      { name: 'realizedProceeds', type: 'uint256' }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'buckets',
    inputs: [
      { name: '', type: 'bytes32' },
      { name: '', type: 'int24' },
      { name: '', type: 'uint8' }
    ],
    outputs: [
      { name: 'totalShares', type: 'uint256' },
      { name: 'liquidity', type: 'uint256' },
      { name: 'proceedsPerShare', type: 'uint256' },
      { name: 'filledPerShare', type: 'uint256' },
      { name: 'initialized', type: 'bool' }
    ],
    stateMutability: 'view'
  }
];

async function main() {
  console.log('=== Checking Claims ===\n');
  console.log('Hook:', HOOK_ADDRESS);
  console.log('User:', USER_ADDRESS);
  console.log('Pool:', POOL_ID, '(fheWETH/fheUSDC)');
  console.log('');

  // Query Deposit events
  const DEPOSIT_SIG = '0xe227a6e7d62472606934cff09bd5338bef8353353f2e4cd5f33663baadbc64e8';
  const currentBlock = await client.getBlockNumber();
  const fromBlock = currentBlock - 200000n; // ~14 hours

  console.log('Querying Deposit events from block', fromBlock.toString(), 'to', currentBlock.toString());

  const userTopic = '0x000000000000000000000000' + USER_ADDRESS.slice(2).toLowerCase();

  const depositLogs = await client.request({
    method: 'eth_getLogs',
    params: [{
      address: HOOK_ADDRESS,
      topics: [
        DEPOSIT_SIG,
        POOL_ID,
        userTopic,
        null
      ],
      fromBlock: '0x' + fromBlock.toString(16),
      toBlock: 'latest'
    }]
  });

  console.log('\nFound', depositLogs.length, 'Deposit events\n');

  // Parse deposits
  const positions = new Map();
  for (const log of depositLogs) {
    const tickHex = log.topics[3];
    let tick = parseInt(tickHex, 16);
    if (tick > 0x7FFFFF) tick = tick - 0x1000000;
    const side = parseInt(log.data.slice(2, 66), 16);
    positions.set(tick + ':' + side, { tick, side });
  }

  console.log('Unique positions:', positions.size);

  // Check each position
  for (const [key, { tick, side }] of positions) {
    console.log('\n--- Position: tick=' + tick + ', side=' + side + ' (' + (side === 0 ? 'BUY' : 'SELL') + ') ---');

    const position = await client.readContract({
      address: HOOK_ADDRESS,
      abi: ABI,
      functionName: 'positions',
      args: [POOL_ID, USER_ADDRESS, tick, side]
    });

    console.log('Position:');
    console.log('  shares:', position[0].toString());
    console.log('  proceedsPerShareSnapshot:', position[1].toString());
    console.log('  filledPerShareSnapshot:', position[2].toString());
    console.log('  realizedProceeds:', position[3].toString());

    const bucket = await client.readContract({
      address: HOOK_ADDRESS,
      abi: ABI,
      functionName: 'buckets',
      args: [POOL_ID, tick, side]
    });

    console.log('Bucket:');
    console.log('  totalShares:', bucket[0].toString());
    console.log('  liquidity:', bucket[1].toString());
    console.log('  proceedsPerShare:', bucket[2].toString());
    console.log('  filledPerShare:', bucket[3].toString());
    console.log('  initialized:', bucket[4]);

    const hasShares = position[0] > 0n;
    const hasRealizedProceeds = position[3] > 0n;
    const bucketHasNewProceeds = bucket[2] > position[1];

    console.log('\n  => Has shares:', hasShares);
    console.log('  => Has realizedProceeds:', hasRealizedProceeds);
    console.log('  => Bucket has new proceeds:', bucketHasNewProceeds);
    console.log('  => CLAIMABLE:', hasRealizedProceeds || bucketHasNewProceeds);
  }

  // BucketFilled events
  console.log('\n=== BucketFilled Events ===');
  const filledLogs = await client.getLogs({
    address: HOOK_ADDRESS,
    event: parseAbiItem('event BucketFilled(bytes32 indexed poolId, int24 indexed tick, uint8 side)'),
    args: { poolId: POOL_ID },
    fromBlock: fromBlock,
    toBlock: 'latest'
  });
  console.log('Found', filledLogs.length, 'BucketFilled events');
  for (const log of filledLogs) {
    console.log('  tick=' + log.args.tick + ', side=' + log.args.side);
  }
}

main().catch(console.error);

// Also check current tick
async function checkCurrentTick() {
  const currentTickABI = [{
    type: 'function',
    name: 'currentTick',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'int24' }],
    stateMutability: 'view'
  }];
  
  try {
    const tick = await client.readContract({
      address: HOOK_ADDRESS,
      abi: currentTickABI,
      functionName: 'currentTick',
      args: [POOL_ID]
    });
    console.log('\n=== Current Market ===');
    console.log('Current tick:', tick);
    console.log('Your SELL orders at: 69000, 69060');
    console.log('Gap:', tick < 69000 ? 'Price needs to rise ' + (69000 - tick) + ' ticks to hit your first order' : 'Price is at or above your orders');
  } catch (e) {
    console.log('Could not fetch current tick:', e.message);
  }
}

checkCurrentTick();
