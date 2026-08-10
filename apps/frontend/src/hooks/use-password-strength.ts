'use client';

import { useMemo } from 'react';

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  color: string;
  percent: number;
  checks: {
    length: boolean;
    uppercase: boolean;
    digit: boolean;
    special: boolean;
  };
}

export function usePasswordStrength(password: string): PasswordStrength {
  return useMemo(() => {
    const checks = {
      length:    password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      digit:     /\d/.test(password),
      special:   /[^A-Za-z0-9]/.test(password),
    };

    const passed = Object.values(checks).filter(Boolean).length as 0 | 1 | 2 | 3 | 4;

    const meta: Record<number, { label: string; color: string }> = {
      0: { label: '',         color: 'bg-muted' },
      1: { label: 'Weak',     color: 'bg-destructive' },
      2: { label: 'Fair',     color: 'bg-yellow-500' },
      3: { label: 'Good',     color: 'bg-blue-500' },
      4: { label: 'Strong',   color: 'bg-green-500' },
    };

    return { score: passed, percent: passed * 25, checks, ...meta[passed] };
  }, [password]);
}
