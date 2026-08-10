'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PasswordInputProps extends React.ComponentProps<'input'> {
  className?: string;
}

export function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [show, setShow] = React.useState(false);

  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        className={cn('pr-10', className)}
        autoComplete={props.autoComplete ?? 'current-password'}
        {...props}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Hide password' : 'Show password'}
        tabIndex={-1}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </Button>
    </div>
  );
}
