'use client';

import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export default function AuctionsPage() {
  return (
    <div className="max-w-4xl mx-auto py-8">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-heading-2">Private Auctions</h1>
          <Badge variant="warning">Coming Soon</Badge>
        </div>
        <p className="text-feather-white/60">
          Sealed-bid auctions with FHE encryption for fair, private bidding.
        </p>
      </div>

      <Card>
        <CardContent className="py-16 text-center">
          <span className="text-6xl mb-6 block">&#x1F528;</span>
          <h2 className="text-xl font-semibold mb-4">Under Construction</h2>
          <p className="text-feather-white/60 max-w-md mx-auto">
            Private auctions are coming soon. With FHE-encrypted bids, participants
            can compete fairly without revealing their maximum bid to others.
          </p>
          <div className="mt-8 p-4 bg-ash-gray rounded-lg max-w-sm mx-auto">
            <p className="text-sm text-feather-white/60">Planned Features:</p>
            <ul className="text-sm text-feather-white/80 mt-2 space-y-1">
              <li>&#x2022; Sealed-bid auctions</li>
              <li>&#x2022; Dutch auctions</li>
              <li>&#x2022; NFT auctions</li>
              <li>&#x2022; Token launches</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
