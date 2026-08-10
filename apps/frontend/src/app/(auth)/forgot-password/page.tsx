import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { Card } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Forgot password',
  description: 'Reset your password',
};

export default function ForgotPasswordPage() {
  return (
    <Card className="w-full max-w-md p-8 animate-slide-up">
      <div className="space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Forgot password?</h1>
          <p className="text-sm text-muted-foreground">
            Enter your email and we'll send you a reset link
          </p>
        </div>
        
        <Suspense>
          <ForgotPasswordForm />
        </Suspense>
      </div>
    </Card>
  );
}