'use client';

import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export default function LaunchpadPage() {
  return (
    <div className="max-w-4xl mx-auto py-8">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-heading-2">Launchpad</h1>
          <Badge variant="warning">Coming Soon</Badge>
        </div>
        <p className="text-feather-white/60">
          Fair token launches with encrypted contributions for equal opportunities.
        </p>
      </div>

      <Card>
        <CardContent className="py-16 text-center">
          <span className="text-6xl mb-6 block">&#x1F680;</span>
          <h2 className="text-xl font-semibold mb-4">Under Construction</h2>
          <p className="text-feather-white/60 max-w-md mx-auto">
            The FheatherX Launchpad will enable fair token launches where
            contribution amounts are encrypted, preventing whales from gaming
            allocation systems.
          </p>
          <div className="mt-8 p-4 bg-ash-gray rounded-lg max-w-sm mx-auto">
            <p className="text-sm text-feather-white/60">Planned Features:</p>
            <ul className="text-sm text-feather-white/80 mt-2 space-y-1">
              <li>&#x2022; Fair launch mechanics</li>
              <li>&#x2022; Private contribution amounts</li>
              <li>&#x2022; Anti-bot protection</li>
              <li>&#x2022; Vesting schedules</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
