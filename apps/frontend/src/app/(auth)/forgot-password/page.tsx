import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { ArrowLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Reset password',
};

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="size-3.5" />
          Back to sign in
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Forgot your password?
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter your email and we'll send you a reset link
        </p>
      </div>

      <Suspense>
        <ForgotPasswordForm />
      </Suspense>
    </div>
  );
}
