import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default function LoginPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Welcome back
        </h1>
        <p className="text-sm text-muted-foreground">
          Sign in to your account to continue
        </p>
      </div>

      <Suspense fallback={<FormSkeleton rows={3} />}>
        <LoginForm />
      </Suspense>

      <p className="text-center text-sm text-muted-foreground">
        New here?{' '}
        <Link href="/register" className="font-medium text-primary hover:underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </div>
  );
}

function FormSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-4 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <div className="h-3.5 w-14 bg-muted rounded" />
          <div className="h-10 bg-muted rounded-lg" />
        </div>
      ))}
      <div className="h-10 bg-muted rounded-lg" />
    </div>
  );
}
