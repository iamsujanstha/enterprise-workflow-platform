'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/use-auth';
import { AlertCircle, Loader2, Shield } from 'lucide-react';

interface MfaVerifyDialogProps {
  open: boolean;
  onClose: () => void;
  returnTo?: string;
}

export function MfaVerifyDialog({ open, onClose, returnTo }: MfaVerifyDialogProps) {
  const [totpCode, setTotpCode] = React.useState('');
  const [recoveryCode, setRecoveryCode] = React.useState('');
  const [error, setError] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const { verifyMfa } = useAuth();

  const handleTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totpCode.length !== 6) {
      setError('Please enter a 6-digit code');
      return;
    }
    
    setIsLoading(true);
    setError('');
    
    try {
      await verifyMfa(totpCode, returnTo);
      toast.success('Signed in successfully');
      onClose();
    } catch (err: any) {
      setError(err?.error === 'INVALID_MFA_TOKEN' 
        ? 'Invalid code. Please try again.'
        : 'Verification failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // This would call a different API endpoint for recovery codes
    setError('Recovery code verification not yet implemented');
  };

  React.useEffect(() => {
    if (open) {
      setTotpCode('');
      setRecoveryCode('');
      setError('');
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Shield className="size-5 text-primary" />
            <DialogTitle>Two-factor authentication</DialogTitle>
          </div>
          <DialogDescription>
            Enter the 6-digit code from your authenticator app or use a recovery code.
          </DialogDescription>
        </DialogHeader>
        
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        <Tabs defaultValue="totp" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="totp">Authenticator</TabsTrigger>
            <TabsTrigger value="recovery">Recovery code</TabsTrigger>
          </TabsList>
          
          <TabsContent value="totp" className="space-y-4">
            <form onSubmit={handleTotpSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="totp-code">Authentication code</Label>
                <Input
                  id="totp-code"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="text-center text-lg tracking-widest font-mono"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  disabled={isLoading}
                />
                <p className="text-xs text-muted-foreground">
                  Enter the 6-digit code from your authenticator app
                </p>
              </div>
              
              <Button 
                type="submit" 
                className="w-full"
                disabled={totpCode.length !== 6 || isLoading}
              >
                {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
                Verify
              </Button>
            </form>
          </TabsContent>
          
          <TabsContent value="recovery" className="space-y-4">
            <form onSubmit={handleRecoverySubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="recovery-code">Recovery code</Label>
                <Input
                  id="recovery-code"
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  placeholder="XXXXXXXX"
                  className="text-center text-lg tracking-widest font-mono"
                  maxLength={8}
                  disabled={isLoading}
                />
                <p className="text-xs text-muted-foreground">
                  Use one of your single-use recovery codes
                </p>
              </div>
              
              <Button 
                type="submit" 
                className="w-full"
                disabled={recoveryCode.length < 8 || isLoading}
              >
                {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
                Use recovery code
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}