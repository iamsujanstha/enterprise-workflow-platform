'use client';

import { create } from 'zustand';

export interface PublicUser {
  id: string;
  email: string;
  roles: string[];
  emailVerified: boolean;
  orgId?: string;
}

export type AuthStatus =
  | 'idle'
  | 'loading'
  | 'authenticated'
  | 'unauthenticated'
  | 'mfa_required';

interface AuthState {
  /** In memory ONLY — never written to localStorage */
  accessToken: string | null;
  user: PublicUser | null;
  status: AuthStatus;
  mfaChallengeId: string | null;

  setTokens: (accessToken: string, user: PublicUser) => void;
  setMfaRequired: (challengeId: string) => void;
  clearAuth: () => void;
  setStatus: (status: AuthStatus) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  status: 'idle',
  mfaChallengeId: null,

  setTokens: (accessToken, user) =>
    set({ accessToken, user, status: 'authenticated', mfaChallengeId: null }),

  setMfaRequired: (challengeId) =>
    set({ status: 'mfa_required', mfaChallengeId: challengeId }),

  clearAuth: () =>
    set({ accessToken: null, user: null, status: 'unauthenticated', mfaChallengeId: null }),

  setStatus: (status) => set({ status }),
}));

// Fine-grained selectors — prevent unnecessary re-renders
export const useIsAuthenticated = () => useAuthStore((s) => s.status === 'authenticated');
export const useUser = () => useAuthStore((s) => s.user);
export const useAccessToken = () => useAuthStore((s) => s.accessToken);
export const useAuthStatus = () => useAuthStore((s) => s.status);
