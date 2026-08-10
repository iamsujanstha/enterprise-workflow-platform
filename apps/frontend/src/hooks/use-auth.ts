'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuthStore, useAuthStatus, useUser, useIsAuthenticated } from '@/lib/auth/auth-store';
import { authApi } from '@/lib/auth/api';

export function useAuth() {
  const router = useRouter();
  const store = useAuthStore();
  const status = useAuthStatus();
  const user = useUser();
  const isAuthenticated = useIsAuthenticated();

  const login = useCallback(
    async (email: string, password: string, returnTo?: string) => {
      store.setStatus('loading');
      try {
        const res = await authApi.login({ email, password });
        if (res.status === 'MFA_REQUIRED' && res.mfaChallenge) {
          store.setMfaRequired(res.mfaChallenge);
          return { mfaRequired: true };
        }
        store.setTokens(res.accessToken!, res.user!);
        router.push(returnTo ?? '/dashboard');
        return { mfaRequired: false };
      } catch (err: unknown) {
        store.setStatus('unauthenticated');
        throw err;
      }
    },
    [store, router],
  );

  const register = useCallback(
    async (email: string, password: string) => {
      store.setStatus('loading');
      try {
        const res = await authApi.register({ email, password });
        store.setStatus('unauthenticated');
        return res;
      } catch (err) {
        store.setStatus('unauthenticated');
        throw err;
      }
    },
    [store],
  );

  const verifyMfa = useCallback(
    async (token: string, returnTo?: string) => {
      const challengeId = store.mfaChallengeId;
      if (!challengeId) throw new Error('No MFA challenge');
      const res = await authApi.mfaVerify({ challengeId, token });
      store.setTokens(res.accessToken, res.user);
      router.push(returnTo ?? '/dashboard');
    },
    [store, router],
  );

  const logout = useCallback(async () => {
    await authApi.logout();
    store.clearAuth();
    router.push('/login');
    toast.success('Signed out successfully');
  }, [store, router]);

  return { login, register, verifyMfa, logout, status, user, isAuthenticated };
}
