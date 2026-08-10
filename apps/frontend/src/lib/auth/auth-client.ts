import { useAuthStore, type PublicUser } from './auth-store';
import { isTokenExpiringSoon } from './token-utils';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

// Module-level mutex — one refresh in-flight at a time across all concurrent requests
let refreshPromise: Promise<string> | null = null;

async function getValidToken(): Promise<string> {
  const { accessToken } = useAuthStore.getState();
  if (!accessToken || isTokenExpiringSoon(accessToken, 60)) {
    if (!refreshPromise) {
      refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
  }
  return accessToken;
}

async function doRefresh(): Promise<string> {
  const res = await fetch(`${API}/api/v1/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    useAuthStore.getState().clearAuth();
    throw new Error('SESSION_EXPIRED');
  }
  const data: { accessToken: string; user: PublicUser } = await res.json();
  useAuthStore.getState().setTokens(data.accessToken, data.user);
  return data.accessToken;
}

type FetchOptions = RequestInit & { _retry?: boolean };

export const authClient = {
  async fetch(url: string, options: FetchOptions = {}): Promise<Response> {
    const token = await getValidToken();
    const res = await fetch(`${API}${url}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
        Authorization: `Bearer ${token}`,
      },
    });
    // Single retry on 401
    if (res.status === 401 && !options._retry) {
      refreshPromise = null;
      const newToken = await getValidToken();
      return authClient.fetch(url, {
        ...options,
        _retry: true,
        headers: { ...options.headers, Authorization: `Bearer ${newToken}` },
      });
    }
    return res;
  },

  async refresh(): Promise<{ accessToken: string; user: PublicUser }> {
    const res = await fetch(`${API}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) throw new Error('REFRESH_FAILED');
    return res.json();
  },
};
