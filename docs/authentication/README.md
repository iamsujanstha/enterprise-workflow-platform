# Authentication System

## 1. Why does this feature exist?

Enterprise teams need a secure identity layer that:

1. Prevents unauthorized access to sensitive workflow data
2. Supports the identity providers their employees already use (Google Workspace, GitHub, Microsoft 365)
3. Enforces least-privilege access through roles
4. Gives security teams the audit trail and controls required for compliance (SOC 2, ISO 27001 readiness)
5. Scales from 100 alpha users to 1M+ without re-architecture

Without this, the platform cannot be sold to enterprise buyers, cannot protect user data, and cannot
serve as the trusted foundation for every other feature on the roadmap.

---

## 2. Who are the users?

### Alex — the Platform Admin
Senior IT administrator at a 500-person company. Responsible for onboarding all employees and
managing access. Needs SSO via Google Workspace, ability to assign roles, and confidence that
terminated employees lose access immediately.

### Jordan — the Knowledge Worker
Project manager who uses the platform daily to run workflows. Wants frictionless login (OAuth,
remembered sessions), hates being asked to re-authenticate mid-task. Wants MFA as an option, not
a surprise.

### Sam — the Security-Conscious Engineer
Leads security review before enterprise procurement. Checks: token lifetimes, password policies,
audit logs, MFA enforcement, and rate limiting. Will reject a platform that stores tokens in
localStorage without justification.

---

## 3. What problems does it solve?

| Problem | Impact |
|---|---|
| Unauthorized access to workflow data | Data breach, loss of enterprise trust |
| No SSO support | Enterprise buyers cannot adopt the platform |
| Missing audit trail | Blocks SOC 2 / ISO 27001 compliance |
| Weak credential policies | Account takeover at scale |
| No MFA | Single factor is insufficient for enterprise security |
| Terminated employees retaining access | Insider threat, compliance violation |
| Credential stuffing at scale | Mass account compromise |
| Token theft / session hijacking | Persistent unauthorized access |

---

## 4. Functional Requirements

### User Registration
- Register with email and password; password hashed with bcrypt (cost 12)
- Reject duplicate emails (HTTP 409 `EMAIL_ALREADY_EXISTS`)
- Enforce password policy: min 8 chars, 1 uppercase, 1 digit, 1 special character
- Emit `UserRegistered` event to trigger welcome and verification email
- Default role: `member`

### Email Verification
- Send verification token on registration (expires 24h)
- Verify token → set `emailVerified: true`
- Block access to protected resources until verified (HTTP 403 `EMAIL_NOT_VERIFIED`)
- Allow resend; invalidate prior token on resend

### Login (Email + Password)
- Return Access_Token (15 min) + Refresh_Token in httpOnly cookie on success
- Return HTTP 401 `INVALID_CREDENTIALS` for wrong email or password (no field distinction)
- Return HTTP 200 `MFA_REQUIRED` if MFA enabled before issuing tokens
- Return HTTP 403 `ACCOUNT_DEACTIVATED` for deactivated accounts
- Create Session in Redis on success (userId, IP, user-agent, TTL 7 days)
- Emit `UserLoggedIn` event
- Rate limit: 5 failed attempts per 15-minute window per IP → HTTP 429

### Multi-Factor Authentication (TOTP)
- Generate TOTP secret + QR code URI (RFC 6238) on setup; store encrypted
- Activate MFA only after User confirms with valid TOTP token
- Require valid password to disable MFA
- Generate 10 Recovery_Codes at enrollment (bcrypt-hashed, single-use)
- Accept ±30s clock drift on TOTP validation
- Lock MFA_Challenge for 15 min after 5 consecutive failed TOTP attempts
- Emit `MFAChanged`, `RecoveryCodeUsed`, `MFABruteForceDetected` events

### OAuth2 Login (Google, GitHub)
- Exchange authorization code → locate or create User by email
- New OAuth users: `emailVerified: true`
- Link new provider to existing account when email matches; require consent if collision
- Retry code exchange up to 2 times (exponential backoff) on provider 5xx/timeout
- Preserve User record if OAuth provider account is deleted
- Reject callbacks with invalid/missing state parameter (`OAUTH_STATE_MISMATCH`)
- Microsoft OAuth: enforce Azure AD tenant restriction on `tid` claim (Phase 4)

### Token Refresh
- Valid Refresh_Token cookie → new Access_Token + rotated Refresh_Token
- Invalidate previous Refresh_Token on rotation
- Token_Family tracking: reuse of rotated token → invalidate all family sessions (`TOKEN_REUSE_DETECTED`)
- Device_Fingerprint mismatch on refresh → require re-authentication (`DEVICE_MISMATCH`)
- Validate Access_Token signature in <200ms p99 (stateless, no Redis call)

### Logout
- Delete Session from Redis, clear Refresh_Token cookie
- Return HTTP 200 regardless of Session existence (prevent enumeration)
- "Logout from all devices" → delete all Sessions for the User

### Password Reset
- Send Password_Reset_Token to registered email (expires 1h)
- Non-existent email → HTTP 200 (prevent user enumeration)
- Valid token + strong password → update `passwordHash`, invalidate all Sessions
- Token is single-use; mark consumed immediately
- Emit `PasswordReset` event

### RBAC
- Roles: `admin`, `member` per User (stored as array)
- Admin routes: verify `roles` contains `admin`; else HTTP 403 `INSUFFICIENT_PERMISSIONS`
- Role changes propagate to token validation within 1 minute
- Last-admin protection: cannot remove own admin role if sole admin (HTTP 409 `LAST_ADMIN_PROTECTION`)
- Cross-org role assignment denied (HTTP 403 `CROSS_ORG_ROLE_ASSIGNMENT_DENIED`)
- Admin demotion: invalidate demoted User's tokens within 1 minute
- Emit `RolesChanged` event

### Session Management and Revocation
- Admin deactivates User → delete all Sessions within 5 seconds
- List Sessions per User: IP, user-agent, device type, location, created/last-used
- Per-User Session revocation (single or all devices)
- Max 10 concurrent Sessions per User; oldest evicted on 11th login
- Org deletion → cascade-invalidate all org Sessions within 5 seconds

### Password Policy
- Reject passwords found in HaveIBeenPwned k-anonymity check (`PASSWORD_FOUND_IN_BREACH`)
- Retain last 5 password hashes; reject reuse (`PASSWORD_RECENTLY_USED`)
- Optional org-level rotation policy (30–365 day interval)
- Forced rotation: issue limited-scope token for password change endpoint only
- Voluntary change: require current password

### Account Takeover Detection
- Compute Device_Fingerprint per Session (user-agent, accept-language, platform)
- Unrecognised fingerprint or country → classify as Suspicious_Login
- Send security alert email within 60 seconds (timestamp, location, device, revocation link)
- Unauthenticated one-click Session revocation from alert email
- Suspicious login with MFA disabled → downgrade to read-only session trust

### Credential Stuffing Defense
- Per-account throttle: 5 failed attempts / 15-min window (independent of IP throttle)
- IP reputation check: CAPTCHA required for known proxies/botnets
- >100 failed attempts across distinct accounts from one IP in 5 min → block IP 1 hour
- Per-account throttle responses indistinguishable from `INVALID_CREDENTIALS`
- All throttle counters stored in Redis (shared across service instances)

### JWT Key Rotation
- Embed `kid` (Key_Version) in every JWT header
- Accept previous key version for 15 minutes after rotation (in-flight token grace period)
- Retired key version → HTTP 401 `KEY_VERSION_RETIRED`
- Cache signing keys from AWS Secrets Manager with 5-minute TTL refresh (no restart needed)

### Enterprise Compliance
- Append-only Audit_Log; modification attempt → HTTP 405 + `AuditLogTamperAttempt` event
- Retain Audit_Log entries ≥ 365 days
- GDPR erasure: anonymise PII within 30 days, retain anonymised log entries, invalidate Sessions
- Data residency: store User/Session data in configured region only
- Audit export requires `admin` role; export itself is logged
- Audit_Log fields: event type, UTC timestamp (ms), userId, IP, user-agent, outcome, correlation ID

---

## 5. Non-Functional Requirements

### Performance
- Access_Token validation: <200ms p99 (stateless)
- Login + token issuance: <500ms p95
- Password hashing: async (non-blocking event loop)
- `/health` response: <50ms

### Security
- Refresh_Tokens in httpOnly, Secure, SameSite=Strict cookies only (never localStorage)
- HTTPS enforced; plaintext HTTP → HTTP 301
- Headers: HSTS, Content-Security-Policy, X-Frame-Options
- JWT secrets: ≥256 bits, stored in AWS Secrets Manager
- Structured JSON audit logs for all auth events

### Availability
- 99.9% uptime for login endpoint (monthly)
- Redis unavailable → stateless JWT fallback for Access_Token validation (degraded mode)
- MongoDB primary failure → read from secondary replica
- Circuit_Breaker per external dependency (5 errors / 30s → open; 60s recovery probe)

### Scalability
- Stateless Access_Token validation (any instance handles any request)
- Horizontal scaling to 50+ concurrent service instances
- Redis session sharding by userId prefix beyond 500,000 active sessions

### Resilience (Cascading Failures)
- Email_Service down → queue with backoff (1 min, 5 min, 15 min), HTTP 202 to client
- Email queue >15 min → `EmailDeliveryDegraded` alert + degraded health status
- OAuth_Provider unreachable >30s → Circuit_Breaker open, recommend email/password login
- Redis down during refresh → HTTP 503 `SESSION_STORE_UNAVAILABLE` (no untracked token issuance)
- MongoDB down during login → HTTP 503 `USER_STORE_UNAVAILABLE` (no cached-data fallback)
- IP_Reputation_Service down → proceed without check, log warning (non-blocking)

### Mobile
- Token refresh retry: up to 3 retries with exponential backoff (2s, 4s, 8s) on network timeout
- Proactive token refresh when Access_Token within 60s of expiry
- Biometric unlock via platform keystore (no biometric data transmitted to server)
- Offline Refresh_Token valid up to 7-day TTL on reconnect (if Token_Family not invalidated)
- Reject payloads >8KB (HTTP 413)

### Accessibility (WCAG 2.1 AA)
- Text contrast ≥ 4.5:1 on all auth forms (criterion 1.4.3)
- All form fields have `<label>`; errors announced via `aria-live` / `aria-describedby` (1.3.1)
- Full keyboard navigation; visible focus indicator on all interactive elements (2.1.1, 2.4.7)
- Errors communicated via text, not colour alone (1.4.1)
- TOTP QR code has copyable text alternative (TOTP URI) for users who cannot scan
- Session timeout warning ≥20s before expiry with accessible extension mechanism (2.2.1)

---

## 6. Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| Auth response time p95 | < 500ms | CloudWatch Histogram |
| Token validation p99 | < 200ms | CloudWatch Histogram |
| Login failure rate (non-brute-force) | < 0.5% of attempts | CloudWatch Counter |
| Session revocation latency | < 5 seconds | Synthetic monitoring |
| Auth uptime (login endpoint) | ≥ 99.9% monthly | CloudWatch Alarm |
| MFA adoption rate | ≥ 20% of active users at 6 months | Analytics |
| Security incidents (credential breach) | 0 | Incident tracker |
| Brute-force attempts blocked | 100% over threshold | Rate limiter metrics |
| Token theft detections (reuse after rotation) | 100% detection rate | Synthetic attack simulation |
| Suspicious login alert delivery | < 60s at p95 | CloudWatch Timer |
| Credential stuffing blocks | 100% of attacks exceeding threshold | Rate limiter counter |
| WCAG 2.1 AA compliance (auth flows) | 100% of applicable criteria | Manual audit + tooling |
| Recovery code usage rate | < 5% of MFA logins | Analytics counter |
| JWT key rotation downtime | 0 seconds | Synthetic monitoring during rotation |
| GDPR erasure completion | < 30 days at p100 | Compliance tracker |
| Audit log integrity | 0 successful tamper attempts | Security monitoring |
| Mobile token refresh retry success | ≥ 95% after 3 retries | Client SDK telemetry |
| Last-admin protection blocks | 100% of self-demotion attempts | Application counter |

---

## 7. Constraints

1. MongoDB as User_Repository (ADR-001)
2. Redis as Session_Store (ADR-002)
3. JWT + Refresh Token architecture — no pure session-cookie or JWT-only alternatives
4. bcrypt cost factor 12 for password hashing
5. Refresh_Tokens must never be stored in client-accessible storage
6. Access_Token lifetime ≤ 15 minutes
7. Refresh_Token lifetime ≤ 7 days
8. Phase 1 scope: email/password + Google + GitHub OAuth + TOTP MFA
9. Microsoft OAuth and SSO/SAML are Phase 4 deliverables
10. JWT signing keys in AWS Secrets Manager with `kid` header claim for key rotation
11. Pwned_Password_Check via k-anonymity prefix only (no plaintext password transmission)
12. Password_History covers last 5 hashes per User
13. Audit_Log append-only, retained ≥ 365 days
14. Per-account rate limit counters in Redis (shared, independent of per-IP counters)
15. Max 10 concurrent Sessions per User; oldest evicted on overflow
16. No code generated before architecture review is complete (AGENTS.md)

---

## 8. Assumptions

1. Email delivery service (AWS SES or equivalent) is available
2. Google and GitHub OAuth2 apps registered; credentials in AWS Secrets Manager
3. All clients communicate over HTTPS exclusively
4. Single-region deployment for Phase 1; multi-region is Phase 4
5. TOTP sufficient for Phase 1 MFA; FIDO2/WebAuthn is a future consideration
6. User deactivation performed by org Admins, not a platform superadmin
7. Frontend: React + Zustand (auth state) + React Query (data fetching)
8. Nginx rate limiting (100 req/min per IP) supplements app-level throttling
9. IP_Reputation_Service available via HTTP API; degraded operation without it is acceptable
10. HaveIBeenPwned k-anonymity API available; skip with warning log if unavailable
11. Mobile clients integrate client SDK for biometric unlock; server receives no biometric data
12. GDPR data residency configured at org level by platform operators (not auto-detected)
13. Recovery_Codes displayed once at enrollment; platform not responsible for offline storage

---

## Related Docs

- [Architecture](./architecture.md)
- [Implementation Guide](./implementation.md)
- [Production Guide](./production.md)
- [ADR-001: MongoDB](../../ADR/001-mongodb.md)
- [ADR-002: Redis](../../ADR/002-redis.md)
