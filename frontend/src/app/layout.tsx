import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from './providers';
import { LayoutWrapper } from '@/components/layout/LayoutWrapper';
import { NetworkGuard } from '@/components/common/NetworkGuard';
import { AppLoader } from '@/components/common/AppLoader';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { ToastContainer } from '@/components/ui/Toast';
import '@/styles/globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter-tight' });

export const metadata: Metadata = {
  title: 'PheatherX - Private DEX',
  description: 'Private execution layer for DeFi with FHE encryption',
  icons: {
    icon: '/favicon.ico',
  },
};

// Service worker registration script (runs client-side)
const swScript = `
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js').catch(function() {});
  });
}
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: swScript }} />
      </head>
      <body className="min-h-screen bg-obsidian-black">
        <Providers>
          <AppLoader>
            <ErrorBoundary>
              <div className="flex flex-col min-h-screen">
                <LayoutWrapper>
                  <NetworkGuard>
                    <main className="flex-1 container mx-auto px-4 py-6 pb-20 md:pb-6">
                      {children}
                    </main>
                  </NetworkGuard>
                </LayoutWrapper>
              </div>
              <ToastContainer />
            </ErrorBoundary>
          </AppLoader>
        </Providers>
      </body>
    </html>
  );
}
