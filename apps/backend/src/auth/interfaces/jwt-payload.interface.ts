export interface JwtPayload {
  sub: string;       // userId
  roles: string[];
  orgId: string;
  iat?: number;
  exp?: number;
  kid?: string;
}

export interface PublicUser {
  id: string;
  email: string;
  roles: string[];
  orgId: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  createdAt?: Date;
}

export interface RequestContext {
  ip: string;
  userAgent: string;
  correlationId?: string;
}
