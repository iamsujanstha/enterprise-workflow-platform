import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/LoginForm';
import { Card } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your account',
};

export default function LoginPage() {
  return (
    <Card className="w-full max-w-md p-8 animate-slide-up">
      <div className="space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="text-sm text-muted-foreground">
            Enter your credentials to access your account
          </p>
        </div>
        
        <Suspense fallback={<LoginFormSkeleton />}>
          <LoginForm />
        </Suspense>
      </div>
    </Card>
  );
}

function LoginFormSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="h-4 w-12 bg-muted animate-pulse rounded" />
        <div className="h-10 bg-muted animate-pulse rounded-md" />
      </div>
      <div className="space-y-2">
        <div className="h-4 w-16 bg-muted animate-pulse rounded" />
        <div className="h-10 bg-muted animate-pulse rounded-md" />
      </div>
      <div className="h-10 bg-muted animate-pulse rounded-md" />
    </div>
  );
}