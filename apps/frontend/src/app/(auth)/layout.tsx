import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { default: 'Sign in', template: '%s | WorkflowPlatform' },
};

/**
 * Auth route group layout — stripped shell.
 * No nav, no sidebar. Just the centered auth card against the grid background.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-page animate-fade-in">
      {children}
    </div>
  );
}
