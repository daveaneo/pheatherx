'use client';

import { Card, CardContent } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';

interface StatsCardProps {
  title: string;
  value: string;
  change?: number;
  icon?: string;
  isLoading?: boolean;
}

export function StatsCard({ title, value, change, icon, isLoading }: StatsCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Skeleton className="h-4 w-24 mb-2" />
          <Skeleton className="h-8 w-32" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-feather-white/60">{title}</p>
          {icon && <span className="text-xl">{icon}</span>}
        </div>
        <p className="text-2xl font-semibold mt-2">{value}</p>
        {change !== undefined && (
          <p
            className={cn(
              'text-sm mt-1',
              change >= 0 ? 'text-electric-teal' : 'text-deep-magenta'
            )}
          >
            {change >= 0 ? '+' : ''}
            {change.toFixed(2)}%
          </p>
        )}
      </CardContent>
    </Card>
  );
}
