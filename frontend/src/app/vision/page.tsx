'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

const visionSections = [
  {
    title: 'The Problem',
    icon: (
      <svg className="w-8 h-8 text-deep-magenta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
    content: `Every trade you make on a traditional DEX is publicly visible. Your order size, direction, and timing are broadcast to the entire network before execution. This transparency enables:

- **Front-running**: Bots detect your pending transaction and trade ahead of you
- **Sandwich attacks**: MEV extractors place orders around yours, extracting value
- **Information leakage**: Competitors analyze your strategies in real-time
- **Market manipulation**: Large orders signal intent, moving prices against you

The result? You consistently get worse prices than you should.`,
  },
  {
    title: 'Our Solution',
    icon: (
      <svg className="w-8 h-8 text-phoenix-ember" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    content: `FheatherX encrypts your trading activity using Fully Homomorphic Encryption (FHE). With FHE, computations happen on encrypted data without ever revealing the underlying values.

- **Encrypted Order Amounts**: No one sees how much you're trading
- **Hidden Balances**: Your positions remain confidential on-chain
- **Private Limit Orders**: Place orders at specific prices without revealing size
- **MEV Protection**: Validators can't extract value from what they can't see

The blockchain verifies correctness without learning your secrets.`,
  },
  {
    title: 'How It Works',
    icon: (
      <svg className="w-8 h-8 text-electric-teal" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    content: `FheatherX is a Uniswap v4 Hook implementing an encrypted limit order book:

1. **Place Order**: Choose a price level and submit your encrypted limit order
2. **Order Aggregation**: Orders at each price level are pooled in "buckets"
3. **Auto-Fill**: When market swaps cross your price, orders fill automatically
4. **Fair Distribution**: Proceeds-per-share model ensures equal fills for all orders in a bucket
5. **Claim or Cancel**: Collect filled proceeds or cancel unfilled orders anytime

Your order amounts remain encrypted throughout - no one sees your position sizes.`,
  },
  {
    title: 'The Technology',
    icon: (
      <svg className="w-8 h-8 text-iridescent-violet" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
      </svg>
    ),
    content: `Built on cutting-edge cryptographic infrastructure:

**Fhenix CoFHE**
- euint128 encrypted integers for all balances and amounts
- Client-side encryption before submission
- ACL-based permission system for secure operations

**Uniswap v4 Hooks**
- Native integration with v4's modular architecture
- afterSwap callbacks for order matching
- PoolManager integration for liquidity

**FHERC20 Tokens**
- ERC20 tokens with fully encrypted balances
- Seamless integration with existing DeFi`,
  },
];

export default function VisionPage() {
  return (
    <div className="max-w-4xl mx-auto py-8">
      {/* Hero */}
      <div className="text-center mb-16">
        <h1 className="text-display-2 md:text-display-1 mb-6">
          <span className="text-phoenix-ember">Trade in Silence</span>
        </h1>
        <p className="text-xl text-feather-white/70 max-w-2xl mx-auto">
          FheatherX brings true privacy to decentralized trading through
          Fully Homomorphic Encryption. Your orders, your secret.
        </p>
      </div>

      {/* Vision Sections */}
      <div className="space-y-12">
        {visionSections.map((section, index) => (
          <Card key={index}>
            <CardContent className="py-8">
              <div className="flex items-start gap-4 mb-4">
                {section.icon}
                <h2 className="text-2xl font-bold text-feather-white">
                  {section.title}
                </h2>
              </div>
              <div className="text-feather-white/70 whitespace-pre-line leading-relaxed pl-12">
                {section.content}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* CTA */}
      <div className="mt-16 text-center">
        <Card className="border-phoenix-ember/30 p-8">
          <h2 className="text-heading-2 mb-4">Ready to trade privately?</h2>
          <p className="text-feather-white/70 mb-6 max-w-xl mx-auto">
            Connect your wallet and experience the future of confidential DeFi.
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/portfolio">
              <Button size="lg">Launch dApp</Button>
            </Link>
            <Link href="/faq">
              <Button variant="secondary" size="lg">Read FAQ</Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
