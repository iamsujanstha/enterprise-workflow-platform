import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { RegisterForm } from '@/components/auth/RegisterForm';

export const metadata: Metadata = {
  title: 'Create account',
};

export default function RegisterPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Create your account
        </h1>
        <p className="text-sm text-muted-foreground">
          Start your free trial — no credit card required
        </p>
      </div>

      <Suspense fallback={<FormSkeleton />}>
        <RegisterForm />
      </Suspense>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <div className="h-3.5 w-14 bg-muted rounded" />
          <div className="h-10 bg-muted rounded-lg" />
        </div>
      ))}
      <div className="h-16 bg-muted rounded-lg" />
      <div className="h-10 bg-muted rounded-lg" />
    </div>
  );
}
