'use client';

import { useEffect, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';

interface VolumeChartProps {
  data?: { time: string; value: number }[];
  isLoading?: boolean;
}

export function VolumeChart({ data, isLoading }: VolumeChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current || !data || data.length === 0) return;

    // In production, use lightweight-charts here
    // For now, we'll show a placeholder

    const container = chartRef.current;
    container.innerHTML = '';

    // Create simple bar chart placeholder
    const maxValue = Math.max(...data.map(d => d.value));
    const barWidth = 100 / data.length;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', '0 0 100 50');
    svg.setAttribute('preserveAspectRatio', 'none');

    data.forEach((d, i) => {
      const height = (d.value / maxValue) * 45;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(i * barWidth));
      rect.setAttribute('y', String(50 - height));
      rect.setAttribute('width', String(barWidth * 0.8));
      rect.setAttribute('height', String(height));
      rect.setAttribute('fill', '#FF6A3D');
      rect.setAttribute('opacity', '0.8');
      svg.appendChild(rect);
    });

    container.appendChild(svg);
  }, [data]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Volume</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Volume (24h)</CardTitle>
      </CardHeader>
      <CardContent>
        <div ref={chartRef} className="h-48 w-full" />
        {(!data || data.length === 0) && (
          <div className="flex items-center justify-center h-48 text-feather-white/40">
            No data available
          </div>
        )}
      </CardContent>
    </Card>
  );
}
