'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, Loader2, MailOpen } from 'lucide-react';
import { authApi } from '@/lib/auth/api';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setIsSubmitting(true);
    setError('');
    try {
      await authApi.forgotPassword({ email: email.toLowerCase().trim() });
      setIsSubmitted(true);
    } catch {
      // Always show success to avoid email enumeration
      setIsSubmitted(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="space-y-6 text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-green-50 dark:bg-green-950/40 flex items-center justify-center border border-green-100 dark:border-green-900">
          <MailOpen className="size-7 text-green-600 dark:text-green-400" />
        </div>
        <div className="space-y-1">
          <p className="font-medium text-foreground">Check your inbox</p>
          <p className="text-sm text-muted-foreground">
            We sent a reset link to <span className="font-medium text-foreground">{email}</span>
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Didn't receive it? Check spam, or{' '}
          <button
            type="button"
            onClick={() => { setIsSubmitted(false); setEmail(''); }}
            className="text-primary hover:underline underline-offset-4"
          >
            try again
          </button>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          type="email"
          placeholder="name@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          autoComplete="email"
          required
          disabled={isSubmitting}
          className="h-10"
        />
      </div>

      <Button type="submit" className="w-full h-10" disabled={isSubmitting || !email}>
        {isSubmitting
          ? <><Loader2 className="mr-2 size-4 animate-spin" />Sending…</>
          : 'Send reset link'
        }
      </Button>
    </form>
  );
}
