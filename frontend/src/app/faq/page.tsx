'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

interface FAQItem {
  question: string;
  answer: string;
  category: 'privacy' | 'security' | 'technical' | 'usage';
}

const faqItems: FAQItem[] = [
  // Privacy
  {
    category: 'privacy',
    question: 'What exactly is encrypted?',
    answer: `All order amounts are encrypted using FHE (Fully Homomorphic Encryption). This includes:
- Your limit order sizes at each price level
- Filled proceeds from matched orders
- Your position sizes in each bucket

The only public information is the existence of activity at a price level, not the amounts involved.`,
  },
  {
    category: 'privacy',
    question: 'Can validators see my orders?',
    answer: `No. Validators process encrypted data without being able to decrypt it. They can verify that operations are valid but cannot see the actual order amounts. This eliminates the possibility of front-running or MEV extraction based on your order size.`,
  },
  {
    category: 'privacy',
    question: 'What can others see about my activity?',
    answer: `Others can see:
- That you interacted with the FheatherX contract
- The transaction hash and gas costs
- Which price levels have orders (but not amounts)

Others cannot see:
- Your order sizes
- How much of your order has been filled
- Your trading strategy or patterns`,
  },
  // Security
  {
    category: 'security',
    question: 'Is FHE secure?',
    answer: `Yes. Fully Homomorphic Encryption is based on well-studied lattice-based cryptography problems that are believed to be secure even against quantum computers. FheatherX uses Fhenix's CoFHE implementation, which has been audited and battle-tested in production environments.`,
  },
  {
    category: 'security',
    question: 'What if the FHE system is compromised?',
    answer: `FheatherX uses a threshold decryption system where multiple parties must cooperate to decrypt any value. No single party (including the FheatherX team) can unilaterally decrypt user data. Additionally, the underlying ERC20 tokens in the pools remain secure even if FHE were compromised - only the encrypted accounting layer would be affected.`,
  },
  {
    category: 'security',
    question: 'Are smart contracts audited?',
    answer: `FheatherX contracts inherit security from battle-tested foundations:
- Uniswap v4's PoolManager (extensively audited)
- OpenZeppelin's security primitives (Ownable, Pausable, ReentrancyGuard)
- Fhenix's FHE library (audited by multiple firms)

The hook-specific logic follows established patterns from FheatherXv3 which has been reviewed and tested.`,
  },
  // Technical
  {
    category: 'technical',
    question: 'How does the bucketed order system work?',
    answer: `Orders are placed at specific price levels called "ticks" (multiples of 60). Each tick has two buckets:
- SELL bucket: Orders to sell token0 for token1
- BUY bucket: Orders to buy token0 with token1

When a swap moves the price through these ticks, orders in the buckets are matched. All LPs in a bucket share fills proportionally using a proceeds-per-share accumulator model.`,
  },
  {
    category: 'technical',
    question: 'What is an FHE session?',
    answer: `Before performing encrypted operations, you must initialize an FHE session. This creates a secure channel between your browser and the FHE coprocessor, allowing you to:
- Encrypt amounts client-side before submission
- Decrypt your balances when viewing your portfolio
- Authorize operations on your encrypted values

Sessions are tied to your wallet address and the connected chain.`,
  },
  {
    category: 'technical',
    question: 'Why is gas higher than regular DEXs?',
    answer: `FHE operations are computationally intensive. Each encrypted addition, comparison, or transfer requires cryptographic operations that cost more gas than plaintext alternatives. However, this is the cost of privacy - you're paying for the assurance that no one can see your order sizes.

Typical gas costs:
- Place Order: ~500k-800k gas
- Market Swap: ~200k-400k gas
- Cancel/Claim: ~400k-600k gas`,
  },
  // Usage
  {
    category: 'usage',
    question: 'How do I get started?',
    answer: `1. Connect your wallet to a supported network (Ethereum Sepolia, Arbitrum Sepolia)
2. Get test tokens from the Faucet page
3. Click "Initialize FHE Session" to set up encryption
4. Go to the Trade page and place a limit order at your target price
5. Your order will fill automatically when the market price crosses your level`,
  },
  {
    category: 'usage',
    question: 'How do limit orders work?',
    answer: `When you place a limit order, you choose a price level and the amount you want to trade. Your tokens are locked in a "bucket" at that price level with an encrypted amount. When market swaps move the price through your level, your order fills automatically and you receive the counter-token. This enables:
- Hidden order sizes (no one sees how much you're trading)
- Fair pro-rata fills when multiple orders exist at the same price
- Automatic execution without monitoring`,
  },
  {
    category: 'usage',
    question: 'How do I see my orders?',
    answer: `Go to the Portfolio page and click "Initialize FHE Session" if you haven't already. This establishes a secure connection that allows you to decrypt and view your order sizes. The decryption happens client-side - your order amounts are never revealed to the network.`,
  },
];

const categories = [
  { id: 'all', label: 'All' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'security', label: 'Security' },
  { id: 'technical', label: 'Technical' },
  { id: 'usage', label: 'Usage' },
];

export default function FAQPage() {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  const filteredItems = selectedCategory === 'all'
    ? faqItems
    : faqItems.filter(item => item.category === selectedCategory);

  const toggleItem = (index: number) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedItems(newExpanded);
  };

  return (
    <div className="max-w-4xl mx-auto py-8">
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-display-2 md:text-display-1 mb-4">
          Frequently Asked <span className="text-phoenix-ember">Questions</span>
        </h1>
        <p className="text-xl text-feather-white/70 max-w-2xl mx-auto">
          Everything you need to know about private trading on FheatherX
        </p>
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2 justify-center mb-8">
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              selectedCategory === cat.id
                ? 'bg-phoenix-ember text-feather-white'
                : 'bg-carbon-gray text-feather-white/70 hover:bg-carbon-gray/80'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* FAQ Items */}
      <div className="space-y-4">
        {filteredItems.map((item, index) => {
          const isExpanded = expandedItems.has(index);
          return (
            <Card key={index} className="overflow-hidden">
              <button
                onClick={() => toggleItem(index)}
                className="w-full text-left p-6 flex items-start justify-between gap-4"
              >
                <span className="font-semibold text-feather-white">
                  {item.question}
                </span>
                <svg
                  className={`w-5 h-5 text-phoenix-ember flex-shrink-0 transition-transform ${
                    isExpanded ? 'rotate-180' : ''
                  }`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {isExpanded && (
                <CardContent className="pt-0 pb-6">
                  <div className="text-feather-white/70 whitespace-pre-line leading-relaxed border-t border-carbon-gray/50 pt-4">
                    {item.answer}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {/* CTA */}
      <div className="mt-16 text-center">
        <Card className="border-phoenix-ember/30 p-8">
          <h2 className="text-heading-2 mb-4">Still have questions?</h2>
          <p className="text-feather-white/70 mb-6">
            Check out our Vision page for a deeper dive into how FheatherX works.
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/vision">
              <Button variant="secondary" size="lg">Read Vision</Button>
            </Link>
            <Link href="/portfolio">
              <Button size="lg">Try It Now</Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
