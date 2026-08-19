'use client';

import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PasswordInput } from './PasswordInput';
import { PasswordStrengthBar } from './PasswordStrengthBar';
import { OAuthButtons } from './OAuthButtons';
import { AuthDivider } from './AuthDivider';
import { useAuth } from '@/hooks/use-auth';
import { usePasswordStrength } from '@/hooks/use-password-strength';
import { AlertCircle, CheckCircle, Loader2 } from 'lucide-react';

export function RegisterForm() {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState(false);

  const { register, status } = useAuth();
  const passwordStrength = usePasswordStrength(password);
  const isLoading = status === 'loading';
  const passwordsMatch = password && confirmPassword && password === confirmPassword;
  const canSubmit = email.trim() && passwordsMatch && passwordStrength.score >= 3 && !isLoading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    if (passwordStrength.score < 3) { setError('Please create a stronger password'); return; }
    try {
      await register(email.toLowerCase().trim(), password);
      setSuccess(true);
      toast.success('Account created! Check your email to verify.');
    } catch (err: any) {
      setError(
        err?.error === 'EMAIL_ALREADY_EXISTS'   ? 'An account with this email already exists' :
        err?.error === 'PASSWORD_FOUND_IN_BREACH'? 'This password appeared in a data breach. Choose another.' :
        'Registration failed. Please try again.'
      );
    }
  };

  if (success) {
    return (
      <div className="space-y-5 text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-green-50 dark:bg-green-950/40 flex items-center justify-center border border-green-100 dark:border-green-900">
          <CheckCircle className="size-7 text-green-600 dark:text-green-400" />
        </div>
        <div className="space-y-1">
          <p className="font-medium text-foreground">Verify your email</p>
          <p className="text-sm text-muted-foreground">
            We sent a verification link to <span className="font-medium text-foreground">{email}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1 h-10" render={<Link href="/login" />}>
            Sign in
          </Button>
          <Button variant="ghost" className="flex-1 h-10" onClick={() => setSuccess(false)}>
            Register another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <OAuthButtons />
      <AuthDivider />

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <Alert variant="destructive" className="py-2.5">
            <AlertCircle className="size-3.5" />
            <AlertDescription className="text-sm">{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            autoComplete="email"
            autoFocus
            disabled={isLoading}
            className="h-10"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            placeholder="Create a strong password"
            autoComplete="new-password"
            disabled={isLoading}
            className="h-10"
            required
          />
          {password && <PasswordStrengthBar password={password} />}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">Confirm password</Label>
          <PasswordInput
            id="confirm-password"
            value={confirmPassword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmPassword(e.target.value)}
            placeholder="Repeat your password"
            autoComplete="new-password"
            disabled={isLoading}
            className="h-10"
            required
          />
          {confirmPassword && !passwordsMatch && (
            <p className="text-xs text-destructive">Passwords do not match</p>
          )}
        </div>

        <Button type="submit" className="w-full h-10 font-medium" disabled={!canSubmit}>
          {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
          Create account
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          By creating an account you agree to our{' '}
          <a href="#" className="underline underline-offset-4 hover:text-foreground">Terms</a>
          {' '}and{' '}
          <a href="#" className="underline underline-offset-4 hover:text-foreground">Privacy Policy</a>
        </p>
      </form>
    </>
  );
}
