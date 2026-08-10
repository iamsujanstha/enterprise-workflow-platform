import { Suspense } from 'react';
import type { Metadata } from 'next';
import { RegisterForm } from '@/components/auth/RegisterForm';
import { Card } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Sign up',
  description: 'Create your account',
};

export default function RegisterPage() {
  return (
    <Card className="w-full max-w-md p-8 animate-slide-up">
      <div className="space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
          <p className="text-sm text-muted-foreground">
            Enter your details to get started
          </p>
        </div>
        
        <Suspense fallback={<RegisterFormSkeleton />}>
          <RegisterForm />
        </Suspense>
      </div>
    </Card>
  );
}

function RegisterFormSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <div className="h-4 w-16 bg-muted animate-pulse rounded" />
          <div className="h-10 bg-muted animate-pulse rounded-md" />
        </div>
      ))}
      <div className="h-20 bg-muted animate-pulse rounded-md" />
      <div className="h-10 bg-muted animate-pulse rounded-md" />
    </div>
  );
}