interface TokenPayload {
  sub: string;
  roles: string[];
  orgId?: string;
  exp: number;
  iat: number;
}

export function decodeToken(token: string): TokenPayload | null {
  try {
    const [, payloadB64] = token.split('.');
    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as TokenPayload;
  } catch {
    return null;
  }
}

export function isTokenExpiringSoon(token: string, bufferSeconds = 60): boolean {
  const payload = decodeToken(token);
  if (!payload?.exp) return true;
  return payload.exp * 1000 < Date.now() + bufferSeconds * 1000;
}
