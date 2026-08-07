export enum AuthEvents {
  USER_REGISTERED          = 'auth.user.registered',
  LOGIN_SUCCESS            = 'auth.login.success',
  LOGIN_FAILED             = 'auth.login.failed',
  LOGOUT                   = 'auth.logout',
  PASSWORD_RESET_REQUESTED = 'auth.password.reset.requested',
  PASSWORD_RESET_COMPLETE  = 'auth.password.reset.complete',
  EMAIL_VERIFIED           = 'auth.email.verified',
  MFA_ENABLED              = 'auth.mfa.enabled',
  MFA_DISABLED             = 'auth.mfa.disabled',
  MFA_FAILED               = 'auth.mfa.failed',
  RECOVERY_CODE_USED       = 'auth.recovery_code.used',
  SESSION_REVOKED          = 'auth.session.revoked',
  TOKEN_THEFT_DETECTED     = 'auth.token.theft',
  SUSPICIOUS_LOGIN         = 'auth.login.suspicious',
  ACCOUNT_LOCKED           = 'auth.account.locked',
  ROLES_CHANGED            = 'auth.roles.changed',
  OAUTH_LINKED             = 'auth.oauth.linked',
}

export interface LoginSuccessEvent {
  userId: string;
  orgId: string;
  ip: string;
  userAgent: string;
  mfaUsed: boolean;
  suspicious: boolean;
  sessionId: string;
}

export interface TokenTheftEvent {
  userId: string;
  familyId: string;
  ip: string;
}

export interface SuspiciousLoginEvent {
  userId: string;
  ip: string;
  userAgent: string;
  country?: string;
}
