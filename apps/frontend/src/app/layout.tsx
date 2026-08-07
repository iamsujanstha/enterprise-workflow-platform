import type { Metadata } from 'next';
import './globals.css';
import { SessionInitializer } from '@/components/auth/SessionInitializer';

export const metadata: Metadata = {
  title: { default: 'WorkflowPlatform', template: '%s | WorkflowPlatform' },
  description: 'Enterprise workflow platform',
  robots: { index: false }, // auth app — not for public indexing
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {/* SessionInitializer fires once on boot to restore auth state from refresh token cookie */}
        <SessionInitializer />
        {children}
      </body>
    </html>
  );
}
