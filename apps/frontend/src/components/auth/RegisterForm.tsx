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
import { AlertCircle, Loader2, CheckCircle } from 'lucide-react';

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
  const isPasswordStrong = passwordStrength.score >= 3;
  const canSubmit = email.trim() && passwordsMatch && isPasswordStrong && !isLoading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!email.trim() || !password || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }
    
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
    if (!isPasswordStrong) {
      setError('Please create a stronger password');
      return;
    }

    try {
      await register(email.toLowerCase().trim(), password);
      setSuccess(true);
      toast.success('Account created! Check your email to verify your account.');
    } catch (err: any) {
      const message = err?.error === 'EMAIL_ALREADY_EXISTS'
        ? 'An account with this email already exists'
        : err?.error === 'PASSWORD_FOUND_IN_BREACH'
        ? 'This password has been found in a data breach. Please choose a different one.'
        : 'Registration failed. Please try again.';
      setError(message);
    }
  };

  if (success) {
    return (
      <div className="space-y-4">
        <Alert className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30">
          <CheckCircle className="size-4 text-green-600" />
          <AlertDescription className="text-green-700 dark:text-green-300">
            Account created successfully! We've sent a verification email to{' '}
            <span className="font-medium">{email}</span>. Please check your inbox and click the 
            verification link to complete your registration.
          </AlertDescription>
        </Alert>
        
        <div className="flex gap-3">
          <Button asChild variant="outline" className="flex-1">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button 
            variant="ghost" 
            onClick={() => setSuccess(false)}
            className="flex-1"
          >
            Register another
          </Button>
        </div>
      </div>
    );
  }

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
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Create a strong password"
            autoComplete="new-password"
            disabled={isLoading}
            required
          />
          <PasswordStrengthBar password={password} />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirm password</Label>
          <PasswordInput
            id="confirm-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm your password"
            autoComplete="new-password"
            disabled={isLoading}
            aria-invalid={confirmPassword && !passwordsMatch ? 'true' : 'false'}
            required
          />
          {confirmPassword && !passwordsMatch && (
            <p className="text-xs text-red-600">Passwords do not match</p>
          )}
        </div>
        
        <Button 
          type="submit" 
          className="w-full h-11"
          disabled={!canSubmit}
        >
          {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
          Create account
        </Button>
      </form>
      
      <AuthDivider />
      <OAuthButtons />
      
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}