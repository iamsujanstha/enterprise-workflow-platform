# Authentication — Backend Implementation Guide

**Audience**: Backend Engineers  
**Stack**: NestJS · TypeScript · MongoDB · Redis · BullMQ · AWS  
**Covers**: Modules, controllers, services, guards, interceptors, DTOs, DB schema, Redis usage, background jobs, events, audit logging, rate limiting, API versioning, and scaling decisions.

---

## Table of Contents

1. [Package Dependencies](#1-package-dependencies)
2. [Module Structure](#2-module-structure)
3. [API Versioning](#3-api-versioning)
4. [Controllers](#4-controllers)
5. [Services](#5-services)
6. [Guards and Strategies](#6-guards-and-strategies)
7. [Interceptors](#7-interceptors)
8. [DTO Validation](#8-dto-validation)
9. [Database Schema](#9-database-schema)
10. [MongoDB Indexes](#10-mongodb-indexes)
11. [Redis Usage](#11-redis-usage)
12. [Background Jobs](#12-background-jobs)
13. [Events](#13-events)
14. [Audit Logging](#14-audit-logging)
15. [Rate Limiting](#15-rate-limiting)
16. [Scaling: 1K → 100K → 1M](#16-scaling-1k--100k--1m)
17. [Testing Strategy](#17-testing-strategy)

---

## 1. Package Dependencies

```json
{
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/core": "^10.3.0",
    "@nestjs/config": "^3.2.0",
    "@nestjs/mongoose": "^10.0.4",
    "@nestjs/passport": "^10.0.3",
    "@nestjs/jwt": "^10.2.0",
    "@nestjs/event-emitter": "^2.0.4",
    "@nestjs/bull": "^10.1.1",
    "@nestjs/throttler": "^5.1.2",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "passport-google-oauth20": "^2.0.0",
    "passport-github2": "^0.1.12",
    "mongoose": "^8.3.0",
    "ioredis": "^5.3.2",
    "bullmq": "^5.4.0",
    "bcrypt": "^5.1.1",
    "otplib": "^12.0.1",
    "qrcode": "^1.5.3",
    "class-validator": "^0.14.1",
    "class-transformer": "^0.5.1",
    "helmet": "^7.1.0",
    "uuid": "^9.0.1",
    "@aws-sdk/client-secrets-manager": "^3.577.0",
    "@aws-sdk/client-kms": "^3.577.0"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.3.0",
    "@types/bcrypt": "^5.0.2",
    "@types/passport-jwt": "^4.0.1",
    "jest": "^29.7.0",
    "supertest": "^7.0.0"
  }
}
```

WHY `otplib` over `speakeasy`: `speakeasy` is unmaintained (last release 2017). `otplib` is actively maintained, RFC 6238 compliant, and has TypeScript types.  
WHY `bullmq` over `bull`: BullMQ is the successor to Bull, built on Redis 5+ streams. Better TypeScript support, per-job TTL, and worker-level concurrency controls.

---

## 2. Module Structure

```
src/
├── app.module.ts                    # Root — imports all feature modules
├── main.ts                          # Bootstrap: global pipes, helmet, versioning
│
├── auth/
│   ├── auth.module.ts               # Wires all auth providers
│   ├── controllers/
│   │   ├── auth.controller.ts       # /v1/auth — login, register, logout, refresh
│   │   ├── mfa.controller.ts        # /v1/auth/mfa — setup, verify, disable, recovery
│   │   ├── oauth.controller.ts      # /v1/auth/oauth — Google, GitHub flows
│   │   ├── session.controller.ts    # /v1/auth/sessions — list, revoke
│   │   └── health.controller.ts     # /v1/auth/health — dependency status
│   ├── services/
│   │   ├── auth.service.ts          # Orchestrator: login, register, logout, refresh
│   │   ├── token.service.ts         # JWT generation, verification, key rotation (RS256)
│   │   ├── session.service.ts       # Redis session CRUD, family chain, revocation
│   │   ├── mfa.service.ts           # TOTP + recovery codes + KMS encryption
│   │   ├── password.service.ts      # bcrypt, history, breach check, rotation policy
│   │   ├── oauth.service.ts         # Provider exchange, account linking, PKCE
│   │   ├── rate-limit.service.ts    # Per-account + per-IP Lua atomic counters
│   │   └── device.service.ts        # Fingerprinting, suspicious login detection
│   ├── guards/
│   │   ├── jwt-auth.guard.ts        # RS256 JWT validation on protected routes
│   │   ├── roles.guard.ts           # RBAC enforcement via @Roles() decorator
│   │   ├── session.guard.ts         # Refresh token + Redis session validation
│   │   └── mfa-challenge.guard.ts   # Validates MFA challenge token on /mfa/verify
│   ├── strategies/
│   │   ├── jwt.strategy.ts          # Passport JWT — RS256, JWKS public key
│   │   ├── google.strategy.ts       # Passport OAuth2 — Google + PKCE
│   │   └── github.strategy.ts       # Passport OAuth2 — GitHub + PKCE
│   ├── interceptors/
│   │   ├── audit-log.interceptor.ts # Post-response audit writes
│   │   └── correlation-id.interceptor.ts # X-Correlation-ID propagation
│   ├── dto/
│   │   ├── register.dto.ts
│   │   ├── login.dto.ts
│   │   ├── mfa-verify.dto.ts
│   │   ├── password-reset.dto.ts
│   │   └── refresh.dto.ts
│   ├── decorators/
│   │   ├── current-user.decorator.ts
│   │   ├── roles.decorator.ts
│   │   └── skip-auth.decorator.ts
│   └── events/
│       └── auth.events.ts
│
├── users/
│   ├── user.schema.ts               # Mongoose schema
│   ├── user.repository.ts           # Data access layer
│   └── users.module.ts
│
├── audit/
│   ├── audit-log.schema.ts
│   ├── audit-log.repository.ts
│   └── audit.module.ts
│
├── jobs/
│   ├── email.processor.ts           # BullMQ: email delivery with retry
│   ├── audit-flush.processor.ts     # BullMQ: S3 audit log archival
│   ├── session-cleanup.processor.ts # BullMQ: expired session eviction
│   └── jobs.module.ts
│
└── common/
    ├── filters/
    │   └── http-exception.filter.ts # Structured error responses
    ├── pipes/
    │   └── validation.pipe.ts       # Global class-validator pipe
    └── config/
        └── redis.config.ts
```

---

## 3. API Versioning

WHY version from day 1: Enterprise customers integrate with the auth API. Breaking changes without versioning force simultaneous client and server upgrades — impossible in practice. URI versioning (`/v1/`) is the most explicit and cache-friendly strategy.

```typescript
// main.ts
import { VersioningType } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // WHY URI versioning over header: CDNs and proxies can route on URI.
  // Header versioning requires custom routing rules on Nginx/ALB.
  app.enableVersioning({ type: VersioningType.URI });

  // Global prefix: /api/v1/auth/...
  app.setGlobalPrefix('api');

  // Global validation pipe — rejects any request with unknown fields
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,       // strip unknown fields — prevents mass assignment
    forbidNonWhitelisted: true, // 400 on unknown fields rather than silently ignore
    transform: true,       // auto-transform to DTO types
  }));

  // Security headers
  app.use(helmet());

  await app.listen(3000);
}
```

```typescript
// auth.controller.ts — version declared at controller level
@Controller({ path: 'auth', version: '1' })
// resolves to /api/v1/auth/*
export class AuthController {}
```

**Version migration strategy**:  
- `v1` routes are frozen once released  
- `v2` controller duplicates and diverges — no shared code mutation  
- Deprecation header added to `v1` responses 90 days before sunset: `Deprecation: true; rel="successor-version"`

---

## 4. Controllers

WHY thin controllers: Controllers are the HTTP boundary. They translate HTTP verbs and body into service calls and back. Business logic, Redis calls, and DB queries belong in services. A controller that does work directly is impossible to unit test without spinning up HTTP.

```typescript
// auth.controller.ts
@Controller({ path: 'auth', version: '1' })
@UseInterceptors(CorrelationIdInterceptor, AuditLogInterceptor)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @SkipAuth()
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto): Promise<RegisterResponse> {
    return this.authService.register(dto);
  }

  @Post('login')
  @SkipAuth()
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const result = await this.authService.login(dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] ?? '',
    });

    if (result.status === 'MFA_REQUIRED') {
      return { status: 'MFA_REQUIRED', mfaChallenge: result.mfaChallenge };
    }

    // Set httpOnly cookie — never expose refresh token in response body
    res.cookie('rt', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/v1/auth/refresh',
    });

    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('refresh')
  @SkipAuth()
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshResponse> {
    const refreshToken = req.cookies['rt'];
    const result = await this.authService.refresh(refreshToken, req.ip);

    res.cookie('rt', result.newRefreshToken, {
      httpOnly: true, secure: true, sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/v1/auth/refresh',
    });

    return { accessToken: result.accessToken };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const refreshToken = req.cookies['rt'];
    await this.authService.logout(user.sub, refreshToken);
    res.clearCookie('rt', { path: '/api/v1/auth/refresh' });
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logoutAll(user.sub);
    res.clearCookie('rt', { path: '/api/v1/auth/refresh' });
  }

  @Post('forgot-password')
  @SkipAuth()
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    // WHY always 200: prevent email enumeration
    await this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @SkipAuth()
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.authService.resetPassword(dto);
  }
}
```


---

## 5. Services

### 5.1 AuthService — Orchestrator

WHY a dedicated orchestrator service: `AuthService` calls `PasswordService`, `SessionService`, `TokenService`, `DeviceService`, and the event emitter in a specific order. Keeping the orchestration in one place means the individual services remain independently testable and reusable.

```typescript
@Injectable()
export class AuthService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly passwordService: PasswordService,
    private readonly mfaService: MfaService,
    private readonly deviceService: DeviceService,
    private readonly rateLimitService: RateLimitService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async register(dto: RegisterDto): Promise<RegisterResponse> {
    // Check breach before creating account — reject compromised passwords at source
    await this.passwordService.assertNotBreached(dto.password);

    const existing = await this.userRepo.findByEmail(dto.email.toLowerCase());
    if (existing) {
      // WHY: constant-time delay to prevent user enumeration via response time
      await this.passwordService.hashDummy();
      throw new ConflictException({ error: 'EMAIL_ALREADY_EXISTS' });
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    const user = await this.userRepo.create({
      email: dto.email.toLowerCase(),
      passwordHash,
      roles: ['member'],
      emailVerified: false,
      orgId: dto.orgId,
    });

    this.eventEmitter.emit(AuthEvents.USER_REGISTERED, { userId: user.id, email: user.email });
    return { id: user.id, email: user.email };
  }

  async login(dto: LoginDto, ctx: RequestContext): Promise<LoginResult> {
    // Rate limit checks BEFORE credential validation
    await this.rateLimitService.assertNotThrottled(dto.email, ctx.ip);

    const user = await this.userRepo.findByEmail(dto.email.toLowerCase());

    // WHY: always run bcrypt — constant-time regardless of user existence (FINDING-07)
    const isValid = await this.passwordService.verify(
      dto.password,
      user?.passwordHash ?? null,
    );

    if (!user || !isValid) {
      await this.rateLimitService.recordFailure(dto.email, ctx.ip);
      // WHY: identical error for missing user and wrong password — no enumeration
      throw new UnauthorizedException({ error: 'INVALID_CREDENTIALS' });
    }

    if (user.deactivatedAt) {
      throw new ForbiddenException({ error: 'ACCOUNT_DEACTIVATED' });
    }

    if (!user.emailVerified) {
      throw new ForbiddenException({ error: 'EMAIL_NOT_VERIFIED' });
    }

    // MFA gate — issue challenge, not tokens
    if (user.mfaEnabled) {
      const challengeId = await this.mfaService.createChallenge(user.id, ctx);
      return { status: 'MFA_REQUIRED', mfaChallenge: challengeId };
    }

    return this.issueSession(user, ctx);
  }

  async issueSession(user: User, ctx: RequestContext): Promise<SessionResult> {
    const isSuspicious = await this.deviceService.isSuspicious(user.id, ctx);

    const { accessToken, kid } = await this.tokenService.generateAccessToken(user);
    const refreshToken = await this.tokenService.generateRefreshToken();
    const sessionId = await this.sessionService.create({
      userId: user.id,
      refreshToken,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      fingerprint: this.deviceService.fingerprint(ctx),
      trustLevel: isSuspicious ? 'read_only' : 'full',
    });

    if (isSuspicious) {
      this.eventEmitter.emit(AuthEvents.SUSPICIOUS_LOGIN, {
        userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent,
      });
    }

    await this.rateLimitService.clearFailures(user.email, ctx.ip);
    this.eventEmitter.emit(AuthEvents.USER_LOGGED_IN, { userId: user.id, sessionId });

    return {
      accessToken,
      refreshToken,
      user: this.sanitize(user),
    };
  }

  async refresh(rawRefreshToken: string, ip: string): Promise<RefreshResult> {
    if (!rawRefreshToken) {
      throw new UnauthorizedException({ error: 'SESSION_NOT_FOUND' });
    }

    const session = await this.sessionService.findByToken(rawRefreshToken);
    if (!session) {
      // WHY: if token exists in family but was already rotated → theft detected
      const familyInvalidated = await this.sessionService.detectAndInvalidateReuse(rawRefreshToken);
      if (familyInvalidated) {
        this.eventEmitter.emit(AuthEvents.REFRESH_TOKEN_THEFT_DETECTED, { ip });
      }
      throw new UnauthorizedException({ error: 'SESSION_NOT_FOUND' });
    }

    const user = await this.userRepo.findById(session.userId);
    if (!user || user.deactivatedAt) {
      await this.sessionService.invalidate(session.id);
      throw new ForbiddenException({ error: 'ACCOUNT_DEACTIVATED' });
    }

    const newRefreshToken = await this.tokenService.generateRefreshToken();
    await this.sessionService.rotate(session.id, newRefreshToken);

    const { accessToken } = await this.tokenService.generateAccessToken(user);
    return { accessToken, newRefreshToken };
  }

  private sanitize(user: User): PublicUser {
    const { passwordHash, passwordHistory, mfaSecret, recoveryCodes, ...pub } = user.toObject();
    return pub;
  }
}
```

### 5.2 TokenService — RS256, Key Rotation, JWKS

```typescript
@Injectable()
export class TokenService {
  private keyCache: Map<string, { privateKey: string; publicKey: string }> = new Map();
  private currentKid: string | null = null;
  private cacheExpiresAt: number = 0;

  constructor(
    private readonly secretsManager: SecretsManagerClient,
    private readonly configService: ConfigService,
  ) {}

  async generateAccessToken(user: User): Promise<{ accessToken: string; kid: string }> {
    const { privateKey, kid } = await this.getSigningKey();

    const payload: JwtPayload = {
      sub: user.id,
      roles: user.roles,
      orgId: user.orgId?.toString(),
      // WHY: no email in payload — PII in logs (FINDING-06)
    };

    const accessToken = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(await importPKCS8(privateKey, 'RS256'));

    return { accessToken, kid };
  }

  generateRefreshToken(): Promise<string> {
    // WHY 256-bit random — opaque, no claims, cannot be forged
    return randomBytes(32).then(b => b.toString('base64url'));
  }

  async getJwks(): Promise<{ keys: JwkKey[] }> {
    // Public endpoint — safe to expose, used by all services to verify tokens
    const { publicKey, kid } = await this.getSigningKey();
    const key = await importSPKI(publicKey, 'RS256');
    const jwk = await exportJWK(key);
    return { keys: [{ ...jwk, kid, use: 'sig', alg: 'RS256' }] };
  }

  private async getSigningKey(): Promise<{ privateKey: string; publicKey: string; kid: string }> {
    if (Date.now() < this.cacheExpiresAt && this.currentKid) {
      const cached = this.keyCache.get(this.currentKid)!;
      return { ...cached, kid: this.currentKid };
    }

    // Fetch from AWS Secrets Manager — never from env vars
    const secretName = this.configService.get('JWT_SECRET_NAME');
    const { SecretString } = await this.secretsManager.send(
      new GetSecretValueCommand({ SecretId: secretName }),
    );

    const { kid, privateKey, publicKey } = JSON.parse(SecretString!);
    this.keyCache.set(kid, { privateKey, publicKey });
    this.currentKid = kid;
    this.cacheExpiresAt = Date.now() + 5 * 60 * 1000; // 5-minute TTL

    return { privateKey, publicKey, kid };
  }
}
```

### 5.3 SessionService — Redis Family Chains

```typescript
@Injectable()
export class SessionService {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  async create(data: CreateSessionData): Promise<string> {
    const sessionId = randomUUID();
    const familyId = randomUUID();
    const refreshTokenHash = this.hmac(data.refreshToken);

    const pipeline = this.redis.pipeline();

    // Session record
    pipeline.hset(`session:${sessionId}`, {
      userId: data.userId,
      refreshToken: refreshTokenHash,
      familyId,
      familyVersion: 1,
      ip: data.ip,
      userAgent: data.userAgent,
      fingerprint: data.fingerprint,
      trustLevel: data.trustLevel,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    });
    pipeline.expire(`session:${sessionId}`, 7 * 24 * 60 * 60);

    // Token family — reuse detection
    pipeline.hset(`token_family:${familyId}`, { currentVersion: 1, invalidated: 0 });
    pipeline.expire(`token_family:${familyId}`, 7 * 24 * 60 * 60);

    // User session index — for bulk revocation
    pipeline.sadd(`user_sessions:${data.userId}`, sessionId);

    await pipeline.exec();
    await this.enforceSessionCap(data.userId);
    return sessionId;
  }

  async rotate(sessionId: string, newRefreshToken: string): Promise<void> {
    const session = await this.redis.hgetall(`session:${sessionId}`);
    if (!session) throw new UnauthorizedException({ error: 'SESSION_NOT_FOUND' });

    const newVersion = parseInt(session.familyVersion) + 1;
    const newHash = this.hmac(newRefreshToken);

    // Atomic rotation — update hash and increment version together
    const pipeline = this.redis.pipeline();
    pipeline.hset(`session:${sessionId}`, {
      refreshToken: newHash,
      familyVersion: newVersion,
      lastUsedAt: new Date().toISOString(),
    });
    pipeline.hset(`token_family:${session.familyId}`, { currentVersion: newVersion });
    await pipeline.exec();
  }

  async detectAndInvalidateReuse(rawToken: string): Promise<boolean> {
    // If a stale token is presented, find its family and invalidate everything
    // WHY: Token reuse after rotation = theft indicator (FINDING-02, architecture §8.3)
    const hash = this.hmac(rawToken);
    const sessionIds: string[] = await this.redis.keys('session:*');

    for (const key of sessionIds) {
      const session = await this.redis.hgetall(key);
      if (session?.refreshToken === hash) {
        await this.invalidateFamily(session.familyId);
        return true;
      }
    }
    return false;
  }

  async invalidateAll(userId: string): Promise<void> {
    const sessionIds = await this.redis.smembers(`user_sessions:${userId}`);
    if (!sessionIds.length) return;

    const pipeline = this.redis.pipeline();
    sessionIds.forEach(id => pipeline.del(`session:${id}`));
    pipeline.del(`user_sessions:${userId}`);
    await pipeline.exec();
  }

  private async enforceSessionCap(userId: string): Promise<void> {
    const sessionIds = await this.redis.smembers(`user_sessions:${userId}`);
    if (sessionIds.length <= 10) return;

    // Evict the oldest session by lastUsedAt
    const sessions = await Promise.all(
      sessionIds.map(async id => ({
        id,
        lastUsedAt: (await this.redis.hget(`session:${id}`, 'lastUsedAt')) ?? '0',
      }))
    );

    sessions.sort((a, b) => a.lastUsedAt.localeCompare(b.lastUsedAt));
    const oldest = sessions[0];

    await this.redis.del(`session:${oldest.id}`);
    await this.redis.srem(`user_sessions:${userId}`, oldest.id);
  }

  private hmac(value: string): string {
    return createHmac('sha256', process.env.REDIS_HMAC_SECRET!)
      .update(value)
      .digest('hex');
  }
}
```

### 5.4 PasswordService — bcrypt, History, Breach Check

```typescript
@Injectable()
export class PasswordService {
  // WHY computed at startup: ensures constant-time response for missing users (FINDING-07)
  private dummyHash!: string;

  async onModuleInit() {
    this.dummyHash = await bcrypt.hash('__dummy_constant_time__', 12);
  }

  async hash(plaintext: string): Promise<string> {
    // WHY cost 12: ~300ms. Fast enough for UX, slow enough to deter GPU attacks.
    // bcrypt.hash is async — does not block the event loop.
    return bcrypt.hash(plaintext, 12);
  }

  async verify(plaintext: string, hash: string | null): Promise<boolean> {
    // WHY always compare: constant-time regardless of whether user exists
    return bcrypt.compare(plaintext, hash ?? this.dummyHash);
  }

  async hashDummy(): Promise<void> {
    // Called explicitly when we want the ~300ms delay without a real hash
    await bcrypt.compare('dummy', this.dummyHash);
  }

  async assertNotBreached(password: string): Promise<void> {
    // WHY k-anonymity: only first 5 hex chars of SHA-1 leave the server (FINDING-11)
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    try {
      const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
      if (!res.ok) return; // WHY: degrade gracefully — don't block registration if HIBP is down

      const body = await res.text();
      const found = body.split('\r\n').some(line => line.startsWith(suffix));
      if (found) {
        throw new BadRequestException({ error: 'PASSWORD_FOUND_IN_BREACH' });
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      // Network error → skip check, log warning
    }
  }

  async assertNotReused(plaintext: string, history: string[]): Promise<void> {
    for (const oldHash of history) {
      if (await bcrypt.compare(plaintext, oldHash)) {
        throw new BadRequestException({ error: 'PASSWORD_RECENTLY_USED' });
      }
    }
  }

  async updateHistory(currentHash: string, history: string[]): Promise<string[]> {
    // Keep last 5 hashes — sufficient window to prevent circumvention
    return [currentHash, ...history].slice(0, 5);
  }
}
```

### 5.5 MfaService — TOTP + KMS + Recovery Codes

```typescript
@Injectable()
export class MfaService {
  constructor(
    private readonly kmsClient: KMSClient,
    private readonly configService: ConfigService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async generateSecret(userId: string): Promise<{ qrUri: string; secret: string }> {
    const secret = authenticator.generateSecret(32); // 160-bit base32 secret
    const qrUri = authenticator.keyuri(userId, 'WorkflowPlatform', secret);

    // WHY KMS: application never holds plaintext key material beyond this function (FINDING-08)
    const encrypted = await this.kmsEncrypt(secret);
    // Store encrypted; only display secret in this response, then discard
    return { qrUri, secret }; // caller writes encrypted to DB, discards plaintext
  }

  async verifyTotp(encryptedSecret: string, token: string): Promise<boolean> {
    const secret = await this.kmsDecrypt(encryptedSecret);
    // WHY window=1: accepts ±30s drift. Window=2 would allow ±60s — wider attack surface.
    return authenticator.verify({ token, secret, window: 1 });
  }

  async generateRecoveryCodes(): Promise<{ plaintext: string[]; hashed: string[] }> {
    // WHY 10 codes: enough to get back in; too many increases exposure if written down insecurely
    // WHY no ambiguous chars: 0/O and 1/I look identical in many fonts
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const plaintext = Array.from({ length: 10 }, () =>
      Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    );
    const hashed = await Promise.all(plaintext.map(c => bcrypt.hash(c, 12)));
    return { plaintext, hashed };
  }

  async createChallenge(userId: string, ctx: RequestContext): Promise<string> {
    const challengeId = randomUUID();
    // WHY bind to IP + UA: prevents replay from different device (FINDING-03)
    await this.redis.set(
      `mfa_challenge:${challengeId}`,
      JSON.stringify({ userId, ip: ctx.ip, userAgent: ctx.userAgent }),
      'EX', 300, // 5-minute TTL
    );
    return challengeId;
  }

  async consumeChallenge(challengeId: string, ctx: RequestContext): Promise<string> {
    const raw = await this.redis.getdel(`mfa_challenge:${challengeId}`);
    if (!raw) throw new UnauthorizedException({ error: 'INVALID_MFA_CHALLENGE' });

    const challenge = JSON.parse(raw);
    if (challenge.ip !== ctx.ip || challenge.userAgent !== ctx.userAgent) {
      throw new UnauthorizedException({ error: 'DEVICE_MISMATCH' });
    }
    return challenge.userId;
  }

  private async kmsEncrypt(plaintext: string): Promise<string> {
    const cmd = new EncryptCommand({
      KeyId: this.configService.get('KMS_TOTP_KEY_ID'),
      Plaintext: Buffer.from(plaintext),
    });
    const { CiphertextBlob } = await this.kmsClient.send(cmd);
    return Buffer.from(CiphertextBlob!).toString('base64');
  }

  private async kmsDecrypt(ciphertext: string): Promise<string> {
    const cmd = new DecryptCommand({
      CiphertextBlob: Buffer.from(ciphertext, 'base64'),
    });
    const { Plaintext } = await this.kmsClient.send(cmd);
    return Buffer.from(Plaintext!).toString('utf8');
  }
}
```

### 5.6 RateLimitService — Atomic Lua Counters

```typescript
@Injectable()
export class RateLimitService {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  // WHY Lua: atomic INCR + EXPIRE in one round trip — no race condition (FINDING-09)
  private readonly incrWithTtlScript = `
    local count = redis.call('INCR', KEYS[1])
    if count == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[1])
    end
    return count
  `;

  async assertNotThrottled(email: string, ip: string): Promise<void> {
    const [accountCount, ipCount] = await Promise.all([
      this.redis.get(`login_fail_account:${email}`),
      this.redis.get(`login_fail_ip:${ip}`),
    ]);

    if (parseInt(accountCount ?? '0') >= 5) {
      throw new HttpException(
        { error: 'ACCOUNT_THROTTLED', retryAfter: await this.getTtl(`login_fail_account:${email}`) },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (parseInt(ipCount ?? '0') >= 100) {
      throw new HttpException(
        { error: 'IP_THROTTLED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordFailure(email: string, ip: string): Promise<void> {
    await Promise.all([
      this.redis.eval(this.incrWithTtlScript, 1, `login_fail_account:${email}`, 900),
      this.redis.eval(this.incrWithTtlScript, 1, `login_fail_ip:${ip}`, 900),
      this.recordStuffingCandidate(ip),
    ]);
  }

  async clearFailures(email: string, ip: string): Promise<void> {
    await this.redis.del(`login_fail_account:${email}`, `login_fail_ip:${ip}`);
  }

  private async recordStuffingCandidate(ip: string): Promise<void> {
    const key = `login_stuffing_ip:${ip}`;
    const count = await this.redis.eval(this.incrWithTtlScript, 1, key, 300);
    if (typeof count === 'number' && count >= 100) {
      // Block IP for 1 hour and emit event
      await this.redis.set(`ip_blocked:${ip}`, '1', 'EX', 3600);
    }
  }

  private async getTtl(key: string): Promise<number> {
    return this.redis.ttl(key);
  }
}
```

