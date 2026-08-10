'use client';

import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/lib/auth/auth-store';
import { authClient } from '@/lib/auth/auth-client';

/**
 * Fires once on mount to restore session from the httpOnly refresh token cookie.
 * Renders nothing — pure side-effect.
 */
export function SessionInitializer() {
  const initialized = useRef(false);
  const { setTokens, clearAuth, setStatus } = useAuthStore();

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setStatus('loading');
    authClient
      .refresh()
      .then(({ accessToken, user }) => setTokens(accessToken, user))
      .catch(() => clearAuth());
  }, [setTokens, clearAuth, setStatus]);

  return null;
}
