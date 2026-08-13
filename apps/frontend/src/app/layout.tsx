import type { Metadata } from 'next';
import './globals.css';
import { SessionInitializer } from '@/components/auth/SessionInitializer';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

export const metadata: Metadata = {
  title: { default: 'WorkflowPlatform', template: '%s | WorkflowPlatform' },
  description: 'Enterprise workflow platform',
  robots: { index: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <TooltipProvider delay={300}>
          <SessionInitializer />
          {children}
          <Toaster position="top-right" richColors closeButton />
        </TooltipProvider>
      </body>
    </html>
  );
}
