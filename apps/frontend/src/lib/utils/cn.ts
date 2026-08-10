import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * cn — class name utility
 * Combines clsx (conditional logic) + tailwind-merge (dedup conflicting classes).
 * Usage: cn('px-4 py-2', isActive && 'bg-brand-600', className)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
