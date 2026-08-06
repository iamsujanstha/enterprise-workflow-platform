# Requirements Document

## Introduction

Enterprise workflow platforms operate in high-trust, high-accountability environments. Teams depend on
the platform to manage sensitive projects, coordinate across organizations, and control who can do what.
Authentication is the first and most critical gate in that trust chain.

This document defines requirements for the Authentication System — the subsystem responsible for
verifying user identity, managing sessions, enforcing role-based access, and supporting multiple
identity providers. It is grounded in the existing architecture decisions (JWT + Redis sessions,
MongoDB user store, bcrypt hashing) documented in `docs/authentication/architecture.md` and the
ADRs for MongoDB (ADR-001) and Redis (ADR-002).

The WHY before the HOW:

- Enterprise buyers will not adopt a platform they cannot trust to protect their data
- Security incidents destroy reputation faster than any feature can build it
- Auth is the foundation every other feature (workflows, comments, notifications) depends on
- Getting auth wrong at Phase 1 means costly refactors during Phase 4 scale

---

## Glossary

- **Auth_System**: The authentication and authorization subsystem of the enterprise workflow platform
- **User**: A person who has registered an account on the platform
- **Admin**: A User with the `admin` role within an organization
- **Member**: A User with the `member` role within an organization
- **Organization**: A tenant-level grouping of Users on the platform
- **JWT**: JSON Web Token — a signed, stateless bearer token used for API authorization
- **Access_Token**: A short-lived JWT (15 minutes) used to authorize API requests
- **Refresh_Token**: A long-lived token (7 days) stored in an httpOnly cookie, used to obtain new Access Tokens
- **Session**: A record in Redis linking a Refresh_Token to a User, with metadata (IP, user agent)
- **MFA**: Multi-Factor Authentication using a time-based one-time password (TOTP)
- **RBAC**: Role-Based Access Control — authorization model based on assigned roles
- **OAuth_Provider**: A third-party identity provider (Google, GitHub, Microsoft) supporting OAuth2
- **Password_Reset_Token**: A short-lived, single-use token sent via email to authorize a password change
- **Email_Verification_Token**: A short-lived token sent via email to confirm a User's email address
- **Rate_Limiter**: The component that tracks and enforces request-rate thresholds per IP
- **Session_Store**: The Redis-backed store for active Sessions
- **User_Repository**: The MongoDB-backed store for User records
- **Device_Fingerprint**: A stable, pseudonymous identifier derived from user-agent, language, and platform characteristics, stored per Session
- **Token_Family**: The chain of Refresh_Tokens issued from a single login event, used to detect token theft via reuse-after-rotation
- **Recovery_Code**: A single-use alphanumeric code generated at MFA enrollment time, usable in place of a TOTP token when the authenticator device is unavailable
- **MFA_Challenge**: The intermediate authentication state after password validation but before TOTP/recovery code verification
- **Suspicious_Login**: A login from an unrecognised Device_Fingerprint, country, or IP range relative to a User's prior Session history
- **Audit_Log**: An immutable, append-only record of security-relevant events retained for compliance purposes
- **GDPR_Erasure_Request**: A verified request by a User to delete all personal data held about them, per GDPR Article 17
- **IP_Reputation_Service**: An external or internal service that scores an IP address for known malicious activity (proxies, botnets, credential stuffing sources)
- **Credential_Stuffing**: An automated attack using leaked username/password pairs from third-party breaches against the platform login endpoint
- **Pwned_Password_Check**: A query against the HaveIBeenPwned k-anonymity API to determine whether a candidate password appears in known breach datasets
- **Password_History**: The list of a User's previously used password hashes, retained to prevent immediate password reuse
- **JWT_Signing_Key**: The secret (HMAC-SHA256) or private key (RS256) used to sign JWTs, stored in AWS Secrets Manager and rotatable without service restart
- **Key_Version**: A numeric identifier embedded in JWT headers (`kid` claim) that maps to a specific JWT_Signing_Key version, enabling zero-downtime key rotation
- **Email_Service**: The external transactional email provider (e.g., AWS SES) used to deliver verification, reset, and security-alert emails
- **Circuit_Breaker**: A stability pattern that stops calls to a failing dependency after a configurable error threshold and resumes after a recovery interval

---

## Business Problem

### Why this exists

Enterprise teams need a secure identity layer that:

1. Prevents unauthorized access to sensitive workflow data
2. Supports the identity providers their employees already use (Google Workspace, GitHub, Microsoft 365)
3. Enforces least-privilege access through roles
4. Gives security teams the audit trail and controls required for compliance (SOC 2, ISO 27001 readiness)
5. Scales from 100 alpha users to 1M+ without re-architecture

Without this, the platform cannot be sold to enterprise buyers, cannot protect user data, and cannot
serve as the trusted foundation for every other feature on the roadmap.

---


## User Personas

### Persona 1 — Alex, the Platform Admin
Senior IT administrator at a 500-person company. Responsible for onboarding all employees and
managing access. Needs SSO via Google Workspace, ability to assign roles, and confidence that
terminated employees lose access immediately.

### Persona 2 — Jordan, the Knowledge Worker
Project manager who uses the platform daily to run workflows. Wants frictionless login (OAuth,
remembered sessions), hates being asked to re-authenticate mid-task. Wants MFA as an option, not
a surprise.

### Persona 3 — Sam, the Security-Conscious Engineer
Leads security review before enterprise procurement. Checks: token lifetimes, password policies,
audit logs, MFA enforcement, and rate limiting. Will reject a platform that stores tokens in
localStorage without justification.

---

## User Journeys

### Journey 1 — First-time registration and email verification
1. User submits email + password via registration form
2. System creates account, sends verification email
3. User clicks link, email verified, redirected to platform
4. User completes onboarding

### Journey 2 — Returning login with MFA
1. User submits credentials
2. System validates password, detects MFA enabled
3. User enters TOTP code from authenticator app
4. System issues Access Token + Refresh Token
5. User lands on dashboard

### Journey 3 — OAuth login (Google)
1. User clicks "Continue with Google"
2. OAuth2 authorization code flow completes
3. System finds or creates User record, issues tokens
4. User lands on dashboard

### Journey 4 — Silent token refresh (background)
1. Frontend detects Access Token expiry approaching
2. Frontend silently calls `/auth/refresh` with Refresh Token cookie
3. System issues new Access Token
4. User never sees a login prompt

### Journey 5 — Password reset
1. User requests password reset for their email
2. System sends time-limited reset link
3. User submits new password via link
4. System invalidates all active Sessions for that User
5. User logs in with new credentials

### Journey 6 — Admin removes a user
1. Admin deactivates a User in organization settings
2. System immediately invalidates all Sessions for that User
3. User's next API request returns 401

---

## Requirements

---

### Requirement 1: User Registration

**User Story:** As a new user, I want to register with my email and password, so that I can access
the platform with a personal account.

#### Acceptance Criteria

1. WHEN a registration request is received with a valid email and password, THE Auth_System SHALL
   create a User record in the User_Repository with the password hashed using bcrypt at cost factor 12.

2. WHEN a registration request is received with an email that already exists in the User_Repository,
   THE Auth_System SHALL return HTTP 409 with error code `EMAIL_ALREADY_EXISTS`.

3. WHEN a registration request is received with a password shorter than 8 characters or lacking at
   least one uppercase letter, one digit, and one special character, THE Auth_System SHALL return
   HTTP 400 with a descriptive validation error.

4. WHEN a new User record is created, THE Auth_System SHALL emit a `UserRegistered` event to trigger
   a welcome email and email verification flow.

5. WHEN a registration request is received, THE Auth_System SHALL assign the default role of
   `member` to the new User.

6. THE Auth_System SHALL store all User records with the fields defined in the `users` collection
   schema: `email`, `passwordHash`, `roles`, `orgId`, `mfaEnabled`, `emailVerified`, `createdAt`, `updatedAt`.

---

### Requirement 2: Email Verification

**User Story:** As a registered user, I want to verify my email address, so that the platform can
confirm I own the account and send me notifications.

#### Acceptance Criteria

1. WHEN a `UserRegistered` event is received, THE Auth_System SHALL send an email containing a
   unique Email_Verification_Token that expires in 24 hours.

2. WHEN an email verification request is received with a valid, unexpired Email_Verification_Token,
   THE Auth_System SHALL set `emailVerified: true` on the corresponding User record.

3. WHEN an email verification request is received with an expired or invalid Email_Verification_Token,
   THE Auth_System SHALL return HTTP 400 with error code `INVALID_OR_EXPIRED_TOKEN`.

4. WHEN a User with `emailVerified: false` attempts to access protected resources, THE Auth_System
   SHALL return HTTP 403 with error code `EMAIL_NOT_VERIFIED`.

5. WHEN a User requests a new verification email, THE Auth_System SHALL invalidate any previously
   issued Email_Verification_Token for that User and issue a new one.

---

### Requirement 3: Login with Email and Password

**User Story:** As a registered user, I want to log in with my email and password, so that I can
access my workflows and tasks.

#### Acceptance Criteria

1. WHEN a login request is received with a valid email and correct password, THE Auth_System SHALL
   return an Access_Token (15-minute expiry) and store a Refresh_Token in an httpOnly, Secure,
   SameSite=Strict cookie.

2. WHEN a login request is received with an email that does not exist or an incorrect password,
   THE Auth_System SHALL return HTTP 401 with error code `INVALID_CREDENTIALS`, without
   distinguishing which field was wrong.

3. WHEN a login request is received and the corresponding User has `mfaEnabled: true`, THE
   Auth_System SHALL return HTTP 200 with status `MFA_REQUIRED` before issuing tokens.

4. WHEN a login request is received and the User account has been deactivated, THE Auth_System
   SHALL return HTTP 403 with error code `ACCOUNT_DEACTIVATED`.

5. WHEN a successful login occurs, THE Auth_System SHALL create a Session in the Session_Store
   containing the Refresh_Token, userId, IP address, and user agent, with a TTL of 7 days.

6. WHEN a successful login occurs, THE Auth_System SHALL emit a `UserLoggedIn` event for audit logging.

7. WHILE a User has exceeded 5 failed login attempts within a 15-minute window for a given IP
   address, THE Rate_Limiter SHALL return HTTP 429 with a `Retry-After` header indicating when
   the window resets.

---

### Requirement 4: Multi-Factor Authentication (TOTP)

**User Story:** As a security-conscious user, I want to enable TOTP-based MFA on my account, so
that a compromised password alone cannot grant access.

#### Acceptance Criteria

1. WHEN a User requests MFA setup, THE Auth_System SHALL generate a TOTP secret, return a QR code
   URI compatible with RFC 6238, and store the secret encrypted in the User record.

2. WHEN a User submits a TOTP token during MFA setup confirmation, THE Auth_System SHALL verify the
   token against the generated secret and only activate MFA if the token is valid.

3. WHEN a login request is received for a User with `mfaEnabled: true` and a valid TOTP token is
   provided, THE Auth_System SHALL proceed to issue tokens as per Requirement 3.

4. WHEN a login request is received for a User with `mfaEnabled: true` and the TOTP token is
   invalid or missing, THE Auth_System SHALL return HTTP 401 with error code `INVALID_MFA_TOKEN`.

5. WHEN a User disables MFA, THE Auth_System SHALL require re-authentication (valid password) before
   removing the MFA configuration.

6. WHEN MFA is enabled or disabled on a User account, THE Auth_System SHALL emit an `MFAChanged`
   event for audit logging.

---

### Requirement 5: OAuth2 Login

**User Story:** As a user, I want to log in with my Google, GitHub, or Microsoft account, so that I
can access the platform without managing a separate password.

#### Acceptance Criteria

1. WHEN an OAuth2 authorization code callback is received from a configured OAuth_Provider, THE
   Auth_System SHALL exchange the code for a profile, then locate or create a matching User record
   by email.

2. WHEN a new User is created via OAuth2 login, THE Auth_System SHALL set `emailVerified: true`
   because ownership was confirmed by the OAuth_Provider.

3. WHEN an OAuth2 login completes successfully, THE Auth_System SHALL issue tokens using the same
   session model as Requirement 3.

4. IF the OAuth_Provider returns an error or the authorization code is invalid, THEN THE Auth_System
   SHALL redirect the client to the login page with error code `OAUTH_FAILED`.

5. WHERE Microsoft OAuth is configured, THE Auth_System SHALL support tenant-restricted login to
   allow organizations to limit access to their Azure AD tenant.

---

### Requirement 6: Token Refresh

**User Story:** As an authenticated user, I want my session to continue seamlessly, so that I am
not forced to re-login while actively working.

#### Acceptance Criteria

1. WHEN a token refresh request is received with a valid Refresh_Token cookie, THE Auth_System
   SHALL issue a new Access_Token and rotate the Refresh_Token, updating the Session in the
   Session_Store.

2. WHEN a token refresh request is received with a Refresh_Token that does not correspond to an
   active Session, THE Auth_System SHALL return HTTP 401 with error code `SESSION_NOT_FOUND`.

3. WHEN a token refresh request is received with an expired Refresh_Token, THE Auth_System SHALL
   delete the corresponding Session and return HTTP 401 with error code `SESSION_EXPIRED`.

4. THE Auth_System SHALL validate Access_Token signatures in under 200ms at p99 without making a
   network call to the Session_Store.

5. WHEN a Refresh_Token is used to obtain a new Access_Token, THE Auth_System SHALL invalidate the
   previous Refresh_Token (rotation), preventing reuse.

---

### Requirement 7: Logout

**User Story:** As a user, I want to log out of the platform, so that my session is immediately
terminated and cannot be reused.

#### Acceptance Criteria

1. WHEN a logout request is received with a valid Access_Token, THE Auth_System SHALL delete the
   corresponding Session from the Session_Store and clear the Refresh_Token cookie.

2. WHEN a logout request is received, THE Auth_System SHALL return HTTP 200 regardless of whether
   the Session existed, to prevent session enumeration.

3. WHERE a "logout from all devices" option is invoked, THE Auth_System SHALL delete all Sessions
   associated with the User from the Session_Store.

---

### Requirement 8: Password Reset

**User Story:** As a user who has forgotten my password, I want to reset it securely via email, so
that I can regain access to my account.

#### Acceptance Criteria

1. WHEN a password reset request is received with a registered email, THE Auth_System SHALL send a
   Password_Reset_Token to that email that expires in 1 hour.

2. WHEN a password reset request is received with an email not in the User_Repository, THE
   Auth_System SHALL return HTTP 200 without indicating whether the email exists, to prevent
   user enumeration.

3. WHEN a password reset completion request is received with a valid, unexpired Password_Reset_Token
   and a password meeting the strength policy, THE Auth_System SHALL update the User's `passwordHash`
   and invalidate all active Sessions for that User.

4. WHEN a Password_Reset_Token is used, THE Auth_System SHALL immediately mark it as consumed so
   it cannot be used a second time.

5. IF a password reset completion request is received with an expired or already-consumed
   Password_Reset_Token, THEN THE Auth_System SHALL return HTTP 400 with error code
   `INVALID_OR_EXPIRED_TOKEN`.

6. WHEN a password is successfully reset, THE Auth_System SHALL emit a `PasswordReset` event for
   audit logging.

---

### Requirement 9: Role-Based Access Control (RBAC)

**User Story:** As a platform admin, I want to assign roles to users, so that I can enforce
least-privilege access across the organization.

#### Acceptance Criteria

1. THE Auth_System SHALL support at minimum the roles `admin` and `member` per User, stored as
   an array in the User record.

2. WHEN an API request is received for a route requiring the `admin` role, THE Auth_System SHALL
   verify the authenticated User's `roles` array contains `admin` before allowing access.

3. WHEN an API request is received for a route requiring the `admin` role and the User does not
   hold that role, THE Auth_System SHALL return HTTP 403 with error code `INSUFFICIENT_PERMISSIONS`.

4. WHEN an Admin updates another User's roles within the same Organization, THE Auth_System SHALL
   reflect the new roles in subsequent token validations within 1 minute.

5. WHEN a User's roles are modified, THE Auth_System SHALL emit a `RolesChanged` event for audit logging.

---

### Requirement 10: Session Management and Revocation

**User Story:** As a platform admin, I want to be able to revoke a user's sessions, so that a
terminated employee or compromised account loses access immediately.

#### Acceptance Criteria

1. WHEN an Admin deactivates a User within the organization, THE Auth_System SHALL delete all
   Sessions for that User from the Session_Store within 5 seconds.

2. WHEN a deactivated User's Access_Token is presented to a protected endpoint, THE Auth_System
   SHALL return HTTP 403 with error code `ACCOUNT_DEACTIVATED` after the current token's 15-minute
   lifetime expires, or immediately if the Session has been deleted.

3. THE Auth_System SHALL support listing active Sessions for a User (session metadata: IP, user
   agent, created at, last used), accessible to the User themselves and to Admins of their Organization.

4. WHEN a User requests termination of a specific Session, THE Auth_System SHALL delete that Session
   from the Session_Store and invalidate its associated Refresh_Token.

---

## Non-Functional Requirements

### Requirement 11: Performance

**User Story:** As a platform user, I want authentication operations to complete quickly, so that
my workflow is never blocked waiting for login or token checks.

#### Acceptance Criteria

1. THE Auth_System SHALL validate Access_Token signatures within 200ms at p99 under 10,000
   concurrent sessions.

2. THE Auth_System SHALL complete login and token issuance within 500ms at p95 under normal load.

3. THE Auth_System SHALL complete password hashing (bcrypt, cost 12) asynchronously so that the
   event loop is not blocked during registration or login.

---

### Requirement 12: Security Hardening

**User Story:** As a security-conscious enterprise buyer, I want the authentication system to
implement defense-in-depth, so that a single control failure does not lead to a breach.

#### Acceptance Criteria

1. THE Auth_System SHALL store Refresh_Tokens exclusively in httpOnly, Secure, SameSite=Strict
   cookies, never in localStorage or sessionStorage.

2. THE Auth_System SHALL enforce HTTPS on all authentication endpoints by rejecting plaintext HTTP
   requests with HTTP 301.

3. THE Auth_System SHALL include HSTS, Content-Security-Policy, and X-Frame-Options headers on all
   authentication responses.

4. THE Auth_System SHALL hash passwords using bcrypt with a minimum cost factor of 12.

5. WHEN the Auth_System signs JWTs, THE Auth_System SHALL use a secret of at least 256 bits stored
   in AWS Secrets Manager, never in environment variables committed to source control.

6. THE Auth_System SHALL log all authentication events (login success, login failure, logout,
   password reset, MFA changes, role changes) with timestamp, userId or email, IP address, and
   user agent in structured JSON format.

---

### Requirement 13: Availability and Resilience

**User Story:** As a platform operator, I want authentication to remain available during partial
infrastructure failures, so that users are not locked out.

#### Acceptance Criteria

1. IF the Session_Store (Redis) becomes unavailable, THEN THE Auth_System SHALL continue to validate
   existing Access_Tokens using the JWT signature (stateless fallback) and return a `degraded`
   health status.

2. IF the User_Repository (MongoDB) primary node fails, THEN THE Auth_System SHALL read from a
   secondary replica to continue validating users, in accordance with ADR-001.

3. THE Auth_System SHALL expose a `/health` endpoint returning the status of dependencies (MongoDB,
   Redis) with response time under 50ms.

4. THE Auth_System SHALL achieve 99.9% uptime for the login endpoint, measured monthly.

---

### Requirement 14: Scalability

**User Story:** As a platform operator, I want the authentication system to scale horizontally, so
that it can support growth from 100 to 1,000,000 users without re-architecture.

#### Acceptance Criteria

1. THE Auth_System SHALL be stateless with respect to Access_Token validation so that any instance
   can handle any request without shared in-memory state.

2. THE Auth_System SHALL support horizontal scaling to at least 50 concurrent service instances
   sharing a single Session_Store cluster and User_Repository cluster.

3. WHILE the number of active Sessions exceeds 500,000, THE Session_Store SHALL shard Sessions by
   userId prefix, in accordance with ADR-002.

---

### Requirement 15: TOTP Edge Cases and Account Recovery

**User Story:** As a user who has lost access to my authenticator device, I want a secure recovery
path, so that I am not permanently locked out of my account.

#### Acceptance Criteria

1. WHEN a User completes MFA enrollment, THE Auth_System SHALL generate exactly 10 single-use
   Recovery_Codes, display them once, and store them as bcrypt-hashed values in the User record.

2. WHEN a login request is received for a User with `mfaEnabled: true` and a valid Recovery_Code is
   provided in place of a TOTP token, THE Auth_System SHALL consume the Recovery_Code (mark it used),
   issue tokens, and emit a `RecoveryCodeUsed` event for audit logging.

3. WHEN a Recovery_Code is used, THE Auth_System SHALL send a security alert email to the User's
   verified email address notifying them of the recovery event.

4. WHEN a User has consumed all 10 Recovery_Codes, THE Auth_System SHALL prevent further recovery
   code authentication and require Admin intervention or identity re-verification to regain access.

5. WHEN a User requests regeneration of Recovery_Codes, THE Auth_System SHALL require re-authentication
   (valid password and current TOTP token), invalidate all existing Recovery_Codes, and generate
   a new set of 10.

6. WHEN a TOTP token is validated during login, THE Auth_System SHALL accept tokens from the current
   30-second window and the immediately preceding window (±30 seconds), to tolerate client clock
   drift of up to 30 seconds.

7. IF a TOTP token validation fails 5 consecutive times within 10 minutes for a single User, THEN
   THE Auth_System SHALL temporarily lock the MFA_Challenge for that User for 15 minutes and emit
   a `MFABruteForceDetected` event.

---

### Requirement 16: OAuth2 Edge Cases and Provider Resilience

**User Story:** As a user who authenticates via a third-party provider, I want the platform to
handle provider-side changes gracefully, so that my access is not disrupted by events outside my
control.

#### Acceptance Criteria

1. WHEN an OAuth2 login is received and the email returned by the OAuth_Provider matches an existing
   User record that was created via a different OAuth_Provider or email/password, THE Auth_System
   SHALL link the new provider identity to the existing User record rather than creating a duplicate,
   and emit an `OAuthProviderLinked` event.

2. WHEN an OAuth2 login is received and the email returned by the OAuth_Provider matches an existing
   User record that has a different verified email provider, THE Auth_System SHALL require explicit
   User consent before linking the accounts, to prevent account takeover via email collision.

3. WHEN the Auth_System attempts to exchange an OAuth2 authorization code and the OAuth_Provider
   returns a timeout or 5xx error, THE Auth_System SHALL retry the exchange up to 2 times with
   exponential backoff before returning error code `OAUTH_PROVIDER_UNAVAILABLE` to the client.

4. IF an OAuth_Provider account associated with a User is deleted or deprovisioned, THEN THE
   Auth_System SHALL preserve the User record and allow the User to set a password or link a
   different provider, rather than deleting the account.

5. WHEN an Admin configures Microsoft OAuth with a specific Azure AD tenant ID, THE Auth_System
   SHALL reject OAuth2 callbacks from Users whose `tid` claim does not match the configured tenant,
   returning error code `TENANT_MISMATCH`.

6. WHEN an OAuth2 state parameter is absent or does not match the value stored in the session at
   callback time, THE Auth_System SHALL reject the callback and return error code `OAUTH_STATE_MISMATCH`
   to prevent CSRF attacks against the OAuth flow.

---

### Requirement 17: Credential Stuffing and Brute-Force Defense at Scale

**User Story:** As a platform security engineer, I want the authentication system to resist
automated credential attacks at the scale of millions of users, so that breached credential
lists cannot be used to compromise accounts.

#### Acceptance Criteria

1. WHILE the platform operates with more than 100,000 registered Users, THE Rate_Limiter SHALL
   enforce per-account login throttling (5 failed attempts per 15-minute window per email address)
   independently of IP-based throttling, so that distributed attacks from many IPs are still blocked.

2. WHEN a login request is received from an IP address whose IP_Reputation_Service score indicates
   a known proxy, VPN exit node, or botnet source, THE Auth_System SHALL require a CAPTCHA challenge
   before processing credentials.

3. WHEN the Auth_System detects more than 100 failed login attempts across distinct email addresses
   from a single IP address within 5 minutes, THE Rate_Limiter SHALL block all authentication
   requests from that IP for 1 hour and emit a `CredentialStuffingDetected` event.

4. WHEN a login request is received and the submitted password matches a known-breached password in
   the Pwned_Password_Check (via k-anonymity prefix query), THE Auth_System SHALL deny the login and
   prompt the User to reset their password, returning error code `PASSWORD_FOUND_IN_BREACH`.

5. THE Rate_Limiter SHALL store per-account and per-IP counters in the Session_Store (Redis) so that
   all Auth_System instances share consistent throttle state across horizontal scaling.

6. WHEN a login attempt is rate-limited at the per-account level, THE Auth_System SHALL return
   HTTP 429 with a `Retry-After` header and shall NOT distinguish this response from an
   `INVALID_CREDENTIALS` response in client-facing messaging, to prevent account enumeration.

---

### Requirement 18: Account Takeover Detection and Suspicious Login Alerts

**User Story:** As a user, I want to be notified when my account is accessed from an unrecognised
device or location, so that I can take action if the login was not initiated by me.

#### Acceptance Criteria

1. WHEN a successful login occurs, THE Auth_System SHALL compute a Device_Fingerprint from the
   user-agent, accept-language header, and platform hints, and store it in the Session record.

2. WHEN a successful login occurs and the Device_Fingerprint or origin country does not match any
   Device_Fingerprint in the User's prior 90-day Session history, THE Auth_System SHALL classify
   the login as a Suspicious_Login and emit a `SuspiciousLoginDetected` event.

3. WHEN a Suspicious_Login is detected, THE Auth_System SHALL send a security alert email to the
   User's verified email address within 60 seconds, including the login timestamp, approximate
   location (country/city derived from IP), device type, and a one-click session revocation link.

4. WHEN a User clicks the session revocation link in a Suspicious_Login alert email, THE Auth_System
   SHALL immediately invalidate the flagged Session without requiring the User to be currently
   authenticated.

5. WHEN a Suspicious_Login is detected and the User has MFA disabled, THE Auth_System SHALL still
   issue tokens but downgrade the session trust level, restricting access to read-only operations
   until the User confirms the login via email or enables MFA.

---

### Requirement 19: Token Theft Detection and Token Family Invalidation

**User Story:** As a platform security engineer, I want the system to detect when a Refresh_Token
has been stolen and used, so that compromised sessions are terminated immediately.

#### Acceptance Criteria

1. WHEN a Refresh_Token is issued, THE Auth_System SHALL assign it to a Token_Family identified by
   the original login event ID, and record the Token_Family chain in the Session_Store.

2. WHEN a token refresh request is received with a Refresh_Token that has already been rotated
   (i.e., a prior token in the same Token_Family is presented after a newer one was issued), THE
   Auth_System SHALL immediately invalidate all Sessions in that Token_Family, return HTTP 401 with
   error code `TOKEN_REUSE_DETECTED`, and emit a `RefreshTokenTheftDetected` event.

3. WHEN a `RefreshTokenTheftDetected` event is emitted, THE Auth_System SHALL send a security alert
   email to the User's verified email address advising them to change their password.

4. WHEN a token refresh request is received from a Device_Fingerprint that differs from the one
   recorded in the Session at login time, THE Auth_System SHALL require re-authentication before
   issuing a new Access_Token, returning HTTP 401 with error code `DEVICE_MISMATCH`.

---

### Requirement 20: Multi-Device Session Management

**User Story:** As a user who works across multiple devices, I want my sessions to be managed
independently per device, so that logging out of one device does not affect my other active sessions.

#### Acceptance Criteria

1. THE Auth_System SHALL support a maximum of 10 concurrent active Sessions per User; WHEN a login
   would create an 11th Session, THE Auth_System SHALL revoke the oldest Session by last-used
   timestamp before creating the new one.

2. WHEN a User views their active Sessions, THE Auth_System SHALL return each Session's Device_Fingerprint
   summary (device type, OS, browser family), approximate location (country derived from IP), created
   timestamp, and last-used timestamp.

3. WHEN a User revokes a specific Session from the session management UI, THE Auth_System SHALL
   delete only that Session from the Session_Store without affecting other active Sessions for the
   same User.

4. WHEN a new Session is created for a User who already has 5 or more active Sessions, THE Auth_System
   SHALL emit a `HighSessionCountDetected` event for operational monitoring.

---

### Requirement 21: Password Policy — History, Rotation, and Breach Checks

**User Story:** As a platform security engineer, I want password policies to prevent credential
reuse and force rotation of compromised passwords, so that the risk window after a breach is minimized.

#### Acceptance Criteria

1. WHEN a User sets a new password (via registration, reset, or change), THE Auth_System SHALL
   reject the new password if its SHA-1 prefix matches any entry in the Pwned_Password_Check
   k-anonymity response, returning error code `PASSWORD_FOUND_IN_BREACH`.

2. THE Auth_System SHALL retain the bcrypt hashes of a User's last 5 passwords in the User record;
   WHEN a User attempts to set a new password, THE Auth_System SHALL reject it if it matches any
   stored Password_History entry, returning error code `PASSWORD_RECENTLY_USED`.

3. WHERE an Organization has configured a mandatory password rotation policy, THE Auth_System SHALL
   track the `passwordLastChangedAt` timestamp per User and, WHEN the password age exceeds the
   configured interval (minimum 30 days, maximum 365 days), SHALL require the User to set a new
   password before accessing protected resources.

4. WHEN a User is forced to change their password due to rotation policy, THE Auth_System SHALL
   present the password change prompt after successful authentication rather than blocking login
   entirely, and SHALL issue a limited-scope Access_Token valid only for the password change endpoint.

5. WHEN a User changes their password voluntarily (not via reset), THE Auth_System SHALL require
   the current password before accepting the new one.

---

### Requirement 22: Cascading Failure Scenarios

**User Story:** As a platform operator, I want the authentication system to degrade gracefully when
dependent services fail, so that service disruption is minimized and users receive informative errors.

#### Acceptance Criteria

1. IF the Email_Service is unavailable when a verification or password reset email is requested,
   THEN THE Auth_System SHALL queue the email delivery request with a retry backoff (1 min, 5 min,
   15 min) and return HTTP 202 to the client indicating the request was accepted but delivery is
   pending.

2. IF the Email_Service delivery queue exceeds 15 minutes without successful delivery, THEN THE
   Auth_System SHALL emit an `EmailDeliveryDegraded` alert event and expose this in the `/health`
   endpoint as a `degraded` dependency status.

3. IF an OAuth_Provider's authorization endpoint is unreachable for more than 30 seconds, THEN THE
   Auth_System SHALL activate the Circuit_Breaker for that provider, return error code
   `OAUTH_PROVIDER_UNAVAILABLE`, and display a user-facing message recommending email/password login.

4. IF the Session_Store (Redis) becomes unavailable during a token refresh request, THEN THE
   Auth_System SHALL return HTTP 503 with error code `SESSION_STORE_UNAVAILABLE` rather than issuing
   a token without session validation, to prevent untracked session creation.

5. IF the User_Repository (MongoDB) is unavailable during a login request, THEN THE Auth_System
   SHALL return HTTP 503 with error code `USER_STORE_UNAVAILABLE` and SHALL NOT attempt to fall
   back to cached user data for authentication decisions.

6. IF the IP_Reputation_Service is unavailable, THEN THE Auth_System SHALL proceed with login
   processing without the reputation check and log a `ReputationServiceUnavailable` warning,
   rather than blocking all logins.

7. THE Auth_System SHALL implement a Circuit_Breaker for each external dependency (Email_Service,
   each OAuth_Provider, IP_Reputation_Service) with a failure threshold of 5 errors in 30 seconds
   and a recovery probe interval of 60 seconds.

---

### Requirement 23: Accessibility (WCAG 2.1 AA)

**User Story:** As a user with a disability, I want all authentication UI flows to be accessible,
so that I can register, log in, reset my password, and manage MFA without barriers.

#### Acceptance Criteria

1. THE Auth_System SHALL render all authentication forms (login, registration, password reset, MFA
   setup) with sufficient colour contrast such that text and interactive elements meet a contrast
   ratio of at least 4.5:1 against their background, in accordance with WCAG 2.1 criterion 1.4.3.

2. THE Auth_System SHALL ensure all authentication form fields have programmatically associated
   `<label>` elements and that error messages are announced to screen readers via `aria-live`
   regions or `aria-describedby` associations, in accordance with WCAG 2.1 criterion 1.3.1.

3. THE Auth_System SHALL ensure all authentication flows are fully operable using keyboard navigation
   alone, with a visible focus indicator on every interactive element, in accordance with WCAG 2.1
   criteria 2.1.1 and 2.4.7.

4. THE Auth_System SHALL not rely solely on colour to communicate form validation errors or
   authentication state; each error condition SHALL also be communicated via text, in accordance
   with WCAG 2.1 criterion 1.4.1.

5. THE Auth_System SHALL provide a text alternative for the MFA QR code (the TOTP URI as a
   copyable text string) so that users who cannot scan QR codes can manually enter the secret
   into their authenticator application.

6. WHEN session timeout is imminent, THE Auth_System SHALL notify the user at least 20 seconds
   before the session expires and provide an accessible mechanism to extend the session, in
   accordance with WCAG 2.1 criterion 2.2.1.

---

### Requirement 24: Mobile Client Considerations

**User Story:** As a mobile user, I want authentication to work reliably on slow or intermittent
networks and support device-native security features, so that I can authenticate from any mobile context.

#### Acceptance Criteria

1. WHEN a token refresh request fails due to a network timeout (no response within 10 seconds),
   THE Auth_System client SDK SHALL retry the request up to 3 times with exponential backoff
   (2s, 4s, 8s) before surfacing an authentication error to the user.

2. WHEN a mobile client presents a valid Access_Token that is within 60 seconds of expiry, THE
   Auth_System SHALL proactively issue a new Access_Token in the response without waiting for the
   client to initiate an explicit refresh request.

3. WHERE a mobile platform exposes biometric authentication (Touch ID, Face ID, Android BiometricPrompt),
   THE Auth_System SHALL support a biometric-unlock flow that decrypts a locally stored Refresh_Token
   using the platform keystore, without transmitting biometric data to the server.

4. WHEN a mobile client with a valid Refresh_Token comes online after a period of offline use, THE
   Auth_System SHALL accept the Refresh_Token for up to 7 days from its issuance date, consistent
   with the standard Refresh_Token TTL, provided the Token_Family has not been invalidated.

5. WHEN a login or refresh request is received with a payload larger than 8KB, THE Auth_System SHALL
   return HTTP 413 to protect against oversized-payload attacks from constrained mobile environments.

---

### Requirement 25: Enterprise Compliance — Audit Logs, GDPR, and Data Residency

**User Story:** As an enterprise compliance officer, I want the authentication system to maintain
tamper-evident audit logs, support data erasure requests, and respect data residency constraints,
so that the platform meets SOC 2 Type II and GDPR obligations.

#### Acceptance Criteria

1. THE Auth_System SHALL retain all Audit_Log entries for a minimum of 365 days from the event
   timestamp, in accordance with SOC 2 Type II audit evidence requirements.

2. THE Audit_Log SHALL be append-only; WHEN an attempt is made to modify or delete an individual
   Audit_Log entry via any application-layer API, THE Auth_System SHALL return HTTP 405 and emit
   an `AuditLogTamperAttempt` alert event.

3. WHEN a GDPR_Erasure_Request is received for a verified User, THE Auth_System SHALL delete or
   anonymise all personally identifiable fields from the User record (email, name, IP addresses in
   sessions) within 30 days, while retaining anonymised Audit_Log entries for the mandatory
   retention period.

4. WHEN a GDPR_Erasure_Request is processed, THE Auth_System SHALL immediately invalidate all
   active Sessions for that User and prevent future login with the erased credentials.

5. WHERE an Organization has been configured with a data residency constraint (e.g., EU-only),
   THE Auth_System SHALL store the User records and Session data for Users belonging to that
   Organization exclusively in the designated geographic region and SHALL reject writes to
   out-of-region stores.

6. THE Auth_System SHALL record the following fields in every Audit_Log entry: event type,
   timestamp (UTC, millisecond precision), userId or anonymised identifier, IP address, user agent,
   outcome (success/failure), and a correlation ID traceable to the originating HTTP request.

7. WHEN an Admin exports Audit_Log data for a User or Organization, THE Auth_System SHALL require
   `admin` role verification and SHALL log the export action itself as an Audit_Log entry.

---

### Requirement 26: JWT Key Rotation Without Downtime

**User Story:** As a platform security engineer, I want to rotate JWT signing keys without
interrupting active user sessions, so that compromised keys can be revoked on a schedule
without user-visible disruption.

#### Acceptance Criteria

1. THE Auth_System SHALL embed a `kid` (Key_Version) claim in every issued JWT header that
   identifies which JWT_Signing_Key was used to sign the token.

2. WHEN a new JWT_Signing_Key version is introduced, THE Auth_System SHALL continue to accept
   tokens signed with the previous Key_Version for the duration of the maximum Access_Token
   lifetime (15 minutes) to allow in-flight tokens to expire naturally.

3. WHEN a JWT is received for validation, THE Auth_System SHALL look up the JWT_Signing_Key
   corresponding to the `kid` claim and use that key for signature verification, supporting
   simultaneous validation of tokens signed by multiple key versions.

4. WHEN a JWT_Signing_Key version is retired, THE Auth_System SHALL reject any token bearing
   the retired Key_Version and return HTTP 401 with error code `KEY_VERSION_RETIRED`.

5. THE Auth_System SHALL retrieve JWT_Signing_Keys from AWS Secrets Manager at startup and cache
   them in memory; WHEN the cache TTL of 5 minutes expires, THE Auth_System SHALL refresh the
   key set from AWS Secrets Manager without restarting the service.

---

### Requirement 27: Admin Edge Cases and Organization Integrity

**User Story:** As a platform operator, I want the system to enforce organizational integrity
constraints so that administrative errors cannot result in an inaccessible or inconsistently
governed Organization.

#### Acceptance Criteria

1. WHEN an Admin attempts to remove the `admin` role from their own User account and they are the
   only remaining User with the `admin` role in the Organization, THE Auth_System SHALL reject the
   request and return HTTP 409 with error code `LAST_ADMIN_PROTECTION`.

2. WHEN an Admin attempts to deactivate their own account and they are the only remaining active
   Admin in the Organization, THE Auth_System SHALL reject the request and return HTTP 409 with
   error code `LAST_ADMIN_PROTECTION`.

3. WHEN an Organization is deleted, THE Auth_System SHALL cascade-invalidate all Sessions and
   Access_Tokens for all Users belonging to that Organization within 5 seconds, and SHALL soft-delete
   the User records with a `deletedAt` timestamp rather than hard-deleting them.

4. WHEN an Admin assigns a role to a User who belongs to a different Organization, THE Auth_System
   SHALL reject the request and return HTTP 403 with error code `CROSS_ORG_ROLE_ASSIGNMENT_DENIED`.

5. WHEN an Admin is demoted to `member` by another Admin, THE Auth_System SHALL invalidate the
   demoted User's current Access_Tokens within 1 minute so that the reduced privileges take effect
   before the next natural token expiry.

---

## Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| Auth response time p95 | < 500ms | CloudWatch Histogram |
| Token validation p99 | < 200ms | CloudWatch Histogram |
| Login failure rate (non-brute-force) | < 0.5% of attempts | CloudWatch Counter |
| Session revocation latency | < 5 seconds | Synthetic monitoring |
| Auth uptime (login endpoint) | >= 99.9% monthly | CloudWatch Alarm |
| MFA adoption rate (opt-in) | >= 20% of active users at 6 months | Analytics |
| Security incidents (credential breach) | 0 | Incident tracker |
| Brute-force attempts blocked | 100% over threshold | Rate limiter metrics |
| Token theft detections (reuse after rotation) | 100% detection rate | Synthetic attack simulation |
| Suspicious login email delivery latency | < 60 seconds at p95 | CloudWatch Timer |
| Credential stuffing blocks (per-account throttle) | 100% of attacks exceeding threshold | Rate limiter counter |
| WCAG 2.1 AA compliance (auth flows) | 100% of applicable criteria | Manual audit + automated tooling |
| Recovery code usage rate | < 5% of MFA logins | Analytics counter |
| JWT key rotation downtime | 0 seconds | Synthetic monitoring during rotation |
| GDPR erasure request completion time | < 30 days at p100 | Compliance tracker |
| Audit log integrity (tamper detection) | 0 successful modification attempts | Security monitoring |
| Mobile token refresh retry success rate | >= 95% after 3 retries | Client SDK telemetry |
| Last-admin protection blocks | 100% of self-demotion attempts | Application counter |

---

## Constraints

1. The system MUST use MongoDB as the User_Repository per ADR-001.
2. The system MUST use Redis as the Session_Store per ADR-002.
3. The system MUST implement JWT + Refresh Token architecture as documented in
   `docs/authentication/architecture.md`. Pure session-cookie or JWT-only approaches are excluded.
4. The system MUST use bcrypt at cost factor 12 for password hashing.
5. The system MUST NOT store Refresh_Tokens in client-accessible storage (localStorage, sessionStorage).
6. Access_Token lifetime MUST NOT exceed 15 minutes.
7. Refresh_Token lifetime MUST NOT exceed 7 days.
8. Phase 1 scope (Q1 2026): email/password + Google + GitHub OAuth + MFA. Microsoft OAuth and
   SSO/SAML are Phase 4 deliverables per the ROADMAP.
9. No code is generated before architecture review is complete, per AGENTS.md.
10. JWT signing keys MUST be stored in AWS Secrets Manager and MUST include a `kid` header claim
    to support zero-downtime key rotation.
11. The Pwned_Password_Check MUST use the k-anonymity prefix API (first 5 hex chars of SHA-1) so
    that plaintext passwords are never transmitted to the external service.
12. Password_History retention MUST cover the last 5 password hashes per User. Hashes beyond the
    5-entry window MAY be purged.
13. Audit_Log entries MUST be retained for a minimum of 365 days and MUST be stored in an
    append-only collection with application-layer write restrictions.
14. Per-account rate limiting counters MUST be stored in Redis (shared across all service instances)
    and MUST be independent of per-IP counters.
15. Maximum concurrent Sessions per User is 10; the oldest Session by last-used timestamp is
    revoked when this limit is exceeded.

---

## Assumptions

1. An email delivery service (SES or equivalent) is available for verification and password reset emails.
2. Google and GitHub OAuth2 applications have been registered and credentials are stored in AWS Secrets Manager.
3. All clients (web, future mobile) communicate over HTTPS exclusively.
4. The platform is single-region for Phase 1; multi-region is a Phase 4 concern.
5. TOTP is sufficient for MFA in Phase 1; hardware key (FIDO2/WebAuthn) support is a future consideration.
6. User deactivation is performed by Admins within the organization, not by a platform superadmin.
7. The frontend uses React with Zustand for auth state and React Query for data fetching, per
   `docs/authentication/implementation.md`.
8. Rate limiting at the Nginx layer (100 req/min per IP) supplements application-level rate limiting
   (5 login attempts per 15 min per IP).
9. An IP_Reputation_Service (e.g., AbuseIPDB, IPQualityScore, or equivalent) is available via HTTP
   API; degraded operation without it is acceptable per Requirement 22.
10. The Pwned_Password_Check relies on the HaveIBeenPwned k-anonymity API (api.pwnedpasswords.com);
    degraded operation (skipping the check with a warning log) is acceptable if the API is unavailable.
11. Mobile clients will integrate the client SDK for biometric unlock; the server does not receive
    or process any biometric data.
12. GDPR data residency constraints are configured at the Organization level by platform operators,
    not auto-detected from user location.
13. Recovery_Codes are displayed to the user exactly once at enrollment time; the platform is not
    responsible for offline storage of those codes.
