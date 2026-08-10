'use client';

import { Progress } from '@/components/ui/progress';
import { usePasswordStrength } from '@/hooks/use-password-strength';
import { cn } from '@/lib/utils';

interface PasswordStrengthBarProps {
  password: string;
  className?: string;
}

export function PasswordStrengthBar({ password, className }: PasswordStrengthBarProps) {
  const strength = usePasswordStrength(password);

  if (!password) return null;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Password strength</span>
        {strength.label && (
          <span className={cn(
            'text-xs font-medium',
            strength.score === 1 && 'text-red-600',
            strength.score === 2 && 'text-yellow-600',
            strength.score === 3 && 'text-blue-600',
            strength.score === 4 && 'text-green-600',
          )}>
            {strength.label}
          </span>
        )}
      </div>
      
      <Progress value={strength.percent} className="h-1.5" />
      
      <ul className="space-y-1 text-xs text-muted-foreground">
        <li className={cn('flex items-center gap-1.5', strength.checks.length && 'text-green-600')}>
          <div className={cn('size-1 rounded-full', strength.checks.length ? 'bg-green-500' : 'bg-muted-foreground')} />
          At least 8 characters
        </li>
        <li className={cn('flex items-center gap-1.5', strength.checks.uppercase && 'text-green-600')}>
          <div className={cn('size-1 rounded-full', strength.checks.uppercase ? 'bg-green-500' : 'bg-muted-foreground')} />
          One uppercase letter
        </li>
        <li className={cn('flex items-center gap-1.5', strength.checks.digit && 'text-green-600')}>
          <div className={cn('size-1 rounded-full', strength.checks.digit ? 'bg-green-500' : 'bg-muted-foreground')} />
          One number
        </li>
        <li className={cn('flex items-center gap-1.5', strength.checks.special && 'text-green-600')}>
          <div className={cn('size-1 rounded-full', strength.checks.special ? 'bg-green-500' : 'bg-muted-foreground')} />
          One special character
        </li>
      </ul>
    </div>
  );
}