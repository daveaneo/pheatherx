'use client';

import { ReactNode, useEffect, useState } from 'react';

interface AppLoaderProps {
  children: ReactNode;
}

export function AppLoader({ children }: AppLoaderProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-obsidian-black">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-4 border-carbon-gray border-t-phoenix-ember animate-spin" />
          </div>
          <span className="text-feather-white/60 text-sm">Loading PheatherX...</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
