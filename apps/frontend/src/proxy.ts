import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify, importSPKI, createRemoteJWKSet, jwtDecrypt } from 'jose';

// Routes that don't require authentication
const PUBLIC_ROUTES = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/oauth',
];

// Auth routes — redirect to dashboard if already authenticated
const AUTH_ONLY_ROUTES = ['/login', '/register'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_ROUTES.some((r) => pathname.startsWith(r));

  // Read the short-lived access token cookie (set alongside the httpOnly refresh token)
  // This is a separate, edge-readable cookie — NOT the httpOnly refresh token
  const accessToken = request.cookies.get('at')?.value;
  const isAuthenticated = accessToken ? await isTokenValid(accessToken) : false;

  // Authenticated users visiting auth pages → redirect to dashboard
  if (isAuthenticated && AUTH_ONLY_ROUTES.some((r) => pathname.startsWith(r))) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Unauthenticated users visiting protected pages → redirect to login
  if (!isAuthenticated && !isPublic) {
    const loginUrl = new URL('/login', request.url);
    // Preserve return destination so we redirect back after login
    loginUrl.searchParams.set('returnTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Match all paths except Next.js internals and static files
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)'],
};

async function isTokenValid(token: string): Promise<boolean> {
  try {
    // Decode header to get algorithm — no verification needed here just to check exp
    const [headerB64] = token.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());

    // For HS256 (dev) just check exp claim without verification
    // Full signature verification would require the secret in edge env
    const [, payloadB64] = token.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

    if (!payload.exp) return false;
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}
