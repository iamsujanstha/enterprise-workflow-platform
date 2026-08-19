/**
 * Typed wrappers around every auth API endpoint.
 * All public (unauthenticated) endpoints use plain fetch.
 * Protected endpoints use authClient.fetch.
 */

// NEXT_PUBLIC_API_URL = bare origin, e.g. http://localhost:3010 (dev) or https://api.example.com (prod)
// It is baked into the bundle at build time by Next.js.
// Paths in this file always start with /api/v1/... — never include a path prefix here.
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3010';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw data; // throw the backend error shape { error, message }
  return data as T;
}

// ── Types ─────────────────────────────────────────────────────────────

export interface LoginPayload { email: string; password: string }
export interface LoginResponse {
  status: 'ok' | 'MFA_REQUIRED';
  accessToken?: string;
  user?: import('./auth-store').PublicUser;
  mfaChallenge?: string;
}

export interface RegisterPayload { email: string; password: string; name?: string }
export interface RegisterResponse { id: string; email: string }

export interface MfaVerifyPayload { challengeId: string; token: string }
export interface RecoveryCodePayload { challengeId: string; code: string }

export interface ForgotPasswordPayload { email: string }
export interface ResetPasswordPayload { token: string; password: string }

// ── Endpoints ─────────────────────────────────────────────────────────

export const authApi = {
  login: (p: LoginPayload) =>
    post<LoginResponse>('/api/v1/auth/login', p),

  register: (p: RegisterPayload) =>
    post<RegisterResponse>('/api/v1/auth/register', p),

  mfaVerify: (p: MfaVerifyPayload) =>
    post<{ accessToken: string; user: import('./auth-store').PublicUser }>(
      '/api/v1/auth/mfa/verify', p,
    ),

  mfaRecovery: (p: RecoveryCodePayload) =>
    post<{ accessToken: string; user: import('./auth-store').PublicUser }>(
      '/api/v1/auth/mfa/recovery', p,
    ),

  forgotPassword: (p: ForgotPasswordPayload) =>
    post<void>('/api/v1/auth/forgot-password', p),

  resetPassword: (p: ResetPasswordPayload) =>
    post<void>('/api/v1/auth/reset-password', p),

  logout: () =>
    fetch(`${API}/api/v1/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    }),

  oauthUrl: (provider: 'google' | 'github') =>
    `${API}/api/v1/auth/oauth/${provider}`,
};
