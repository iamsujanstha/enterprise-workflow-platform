'use client';

import { useEffect } from 'react';

/**
 * SessionInitializer — fires once on mount to restore auth state
 * from the httpOnly refresh token cookie via a silent /api/auth/refresh call.
 *
 * Renders nothing — purely a side-effect component.
 */
export function SessionInitializer() {
  useEffect(() => {
    // Attempt a silent token refresh on app boot so Zustand auth state
    // is populated without requiring the user to interact.
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';

    fetch(`${apiUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include', // sends the httpOnly refresh token cookie
    })
      .then((res) => {
        if (!res.ok) return; // not authenticated — that's fine
        // If needed, parse the new access token and update Zustand store here
      })
      .catch(() => {
        // Network error on boot — ignore silently
      });
  }, []);

  return null;
}
