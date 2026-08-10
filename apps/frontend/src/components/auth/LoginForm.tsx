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
    
    if (!email.trim() || !password) {
      setError('Please fill in all fields');
      return;
    }

    try {
      const result = await login(email.toLowerCase().trim(), password, returnTo || undefined);
      if (result.mfaRequired) {
        setShowMfa(true);
        return;
      }
      toast.success('Signed in successfully');
    } catch (err: any) {
      const message = err?.error === 'INVALID_CREDENTIALS' 
        ? 'Invalid email or password'
        : err?.error === 'ACCOUNT_DEACTIVATED'
        ? 'Your account has been deactivated'
        : err?.error === 'EMAIL_NOT_VERIFIED'
        ? 'Please verify your email address first'
        : 'Sign in failed. Please try again.';
      setError(message);
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <Alert variant="destructive" className="animate-shake">
            <AlertCircle className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        <div className="space-y-2">
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
            required
          />
        </div>
        
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link 
              href="/forgot-password" 
              className="text-sm text-primary hover:underline"
              tabIndex={isLoading ? -1 : 0}
            >
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            disabled={isLoading}
            required
          />
        </div>
        
        <div className="flex items-center space-x-2">
          <Checkbox 
            id="remember"
            checked={rememberMe}
            onCheckedChange={(checked) => setRememberMe(!!checked)}
            disabled={isLoading}
          />
          <Label htmlFor="remember" className="text-sm text-muted-foreground">
            Remember me for 30 days
          </Label>
        </div>
        
        <Button 
          type="submit" 
          className="w-full h-11"
          disabled={isLoading || !email.trim() || !password}
        >
          {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
          Sign in
        </Button>
      </form>
      
      <AuthDivider />
      <OAuthButtons />
      
      <p className="text-center text-sm text-muted-foreground">
        Don't have an account?{' '}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Sign up
        </Link>
      </p>

      <MfaVerifyDialog 
        open={showMfa} 
        onClose={() => setShowMfa(false)}
        returnTo={returnTo || undefined}
      />
    </>
  );
}