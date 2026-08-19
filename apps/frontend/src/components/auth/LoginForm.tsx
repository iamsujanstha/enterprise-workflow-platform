'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PasswordInput } from './PasswordInput';
import { OAuthButtons } from './OAuthButtons';
import { AuthDivider } from './AuthDivider';
import { MfaVerifyDialog } from './MfaVerifyDialog';
import { useAuth } from '@/hooks/use-auth';
import { AlertCircle, Loader2 } from 'lucide-react';

export function LoginForm() {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [rememberMe, setRememberMe] = React.useState(false);
  const [error, setError] = React.useState('');
  const [showMfa, setShowMfa] = React.useState(false);

  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo');
  const { login, status } = useAuth();
  const isLoading = status === 'loading';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const result = await login(email.toLowerCase().trim(), password, returnTo || undefined);
      if (result.mfaRequired) {
        setShowMfa(true);
        return;
      }
      toast.success('Signed in');
    } catch (err: any) {
      setError(
        err?.error === 'INVALID_CREDENTIALS' ? 'Invalid email or password' :
        err?.error === 'ACCOUNT_DEACTIVATED'  ? 'Your account has been deactivated' :
        err?.error === 'EMAIL_NOT_VERIFIED'   ? 'Please verify your email first' :
        'Sign in failed. Please try again.'
      );
    }
  };

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
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground hover:text-primary transition-colors"
              tabIndex={isLoading ? -1 : 0}
            >
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={isLoading}
            className="h-10"
            required
          />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="remember"
            checked={rememberMe}
            onCheckedChange={(v) => setRememberMe(!!v)}
            disabled={isLoading}
          />
          <Label htmlFor="remember" className="text-sm text-muted-foreground font-normal cursor-pointer">
            Remember me for 30 days
          </Label>
        </div>

        <Button
          type="submit"
          className="w-full h-10 font-medium"
          disabled={isLoading || !email.trim() || !password}
        >
          {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
          Sign in
        </Button>
      </form>

      <MfaVerifyDialog
        open={showMfa}
        onClose={() => setShowMfa(false)}
        returnTo={returnTo || undefined}
      />
    </>
  );
}
