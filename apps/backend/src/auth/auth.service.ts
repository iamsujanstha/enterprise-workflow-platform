import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRedis } from '../common/config/redis.config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import Redis from 'ioredis';
import { Types } from 'mongoose';
import { UserRepository } from '../users/user.repository';
import { AuditLogRepository } from '../audit/audit-log.repository';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { SessionService } from './services/session.service';
import { MfaService } from './services/mfa.service';
import { OAuthService, OAuthProfile } from './services/oauth.service';
import { RateLimitService } from './services/rate-limit.service';
import { DeviceService } from './services/device.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto, ResetPasswordDto } from './dto/login.dto';
import { AuthEvents, LoginSuccessEvent } from './events/auth.events';
import { RequestContext, PublicUser } from './interfaces/jwt-payload.interface';
import { UserDocument } from '../users/schemas/user.schema';
import { createHash } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly auditRepo: AuditLogRepository,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly mfaService: MfaService,
    private readonly oauthService: OAuthService,
    private readonly rateLimitService: RateLimitService,
    private readonly deviceService: DeviceService,
    private readonly eventEmitter: EventEmitter2,
    @InjectRedis() private readonly redis: Redis,
    @InjectQueue('email') private readonly emailQueue: Queue,
  ) {}

  // ── Registration ──────────────────────────────────────────────────────────

  async register(dto: RegisterDto, ctx: RequestContext): Promise<{ id: string; email: string }> {
    await this.passwordService.assertNotBreached(dto.password);

    const existing = await this.userRepo.findByEmail(dto.email.toLowerCase());
    if (existing) {
      await this.passwordService.hashDummy(); // constant-time delay
      throw new ConflictException({ error: 'EMAIL_ALREADY_EXISTS' });
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    const user = await this.userRepo.create({
      email: dto.email.toLowerCase(),
      passwordHash,
      roles: ['member'],
      emailVerified: false,
      orgId: dto.orgId ? new Types.ObjectId(dto.orgId) : undefined,
    });

    // Generate and store email verification token
    const token = this.tokenService.generateSecureToken();
    await this.redis.set(`email_verify:${token}`, user._id.toString(), 'EX', 86400); // 24h

    await this.emailQueue.add('send_verification_email', {
      email: user.email,
      userId: user._id.toString(),
      verificationUrl: `${process.env.APP_FRONTEND_URL}/verify-email?token=${token}`,
    });

    this.eventEmitter.emit(AuthEvents.USER_REGISTERED, {
      userId: user._id.toString(),
      email: user.email,
    });

    await this.auditRepo.insertOne({
      eventType: 'user_registered',
      userId: user._id.toString(),
      email: user.email,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      outcome: 'success',
      correlationId: ctx.correlationId ?? '',
    });

    return { id: user._id.toString(), email: user.email };
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  async login(
    dto: LoginDto,
    ctx: RequestContext,
  ): Promise<
    | { status: 'MFA_REQUIRED'; mfaChallenge: string }
    | { status: 'SUCCESS'; accessToken: string; refreshToken: string; user: PublicUser }
  > {
    // 1. Check if IP is blocked
    if (await this.rateLimitService.isIpBlocked(ctx.ip)) {
      throw new ForbiddenException({ error: 'IP_BLOCKED' });
    }

    // 2. Rate limit check before touching the DB
    await this.rateLimitService.assertNotThrottled(dto.email, ctx.ip);

    // 3. User lookup — always run bcrypt even if user not found (timing attack prevention)
    const user = await this.userRepo.findByEmail(dto.email.toLowerCase());
    const isValid = await this.passwordService.verify(
      dto.password,
      user?.passwordHash ?? null,
    );

    if (!user || !isValid) {
      await this.rateLimitService.recordFailure(dto.email, ctx.ip);
      await this.auditRepo.insertOne({
        eventType: 'login_failed',
        email: dto.email,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        outcome: 'failure',
        metadata: { reason: 'INVALID_CREDENTIALS' },
        correlationId: ctx.correlationId ?? '',
      });
      this.eventEmitter.emit(AuthEvents.LOGIN_FAILED, { email: dto.email, ip: ctx.ip });
      throw new UnauthorizedException({ error: 'INVALID_CREDENTIALS' });
    }

    // 4. Account status checks
    if (user.deactivatedAt) {
      throw new ForbiddenException({ error: 'ACCOUNT_DEACTIVATED' });
    }
    if (!user.emailVerified) {
      throw new ForbiddenException({ error: 'EMAIL_NOT_VERIFIED' });
    }

    // 5. MFA gate — issue challenge token, not full session
    if (user.mfaEnabled) {
      await this.mfaService.assertMfaNotLocked(user._id.toString());
      const challengeId = await this.mfaService.createChallenge(user._id.toString(), ctx);
      return { status: 'MFA_REQUIRED', mfaChallenge: challengeId };
    }

    // 6. Issue session
    const result = await this.issueSession(user, ctx);
    return { status: 'SUCCESS', ...result };
  }

  // ── MFA verify (completes login after TOTP) ───────────────────────────────

  async verifyMfa(
    challengeId: string,
    totpToken: string,
    ctx: RequestContext,
  ): Promise<{ accessToken: string; refreshToken: string; user: PublicUser }> {
    const userId = await this.mfaService.consumeChallenge(challengeId, ctx);
    const user = await this.userRepo.findById(userId);

    if (!user || !user.mfaSecret) {
      throw new UnauthorizedException({ error: 'INVALID_MFA_CHALLENGE' });
    }

    const valid = this.mfaService.verifyTotp(user.mfaSecret, totpToken);
    if (!valid) {
      await this.mfaService.recordMfaFailure(userId);
      await this.auditRepo.insertOne({
        eventType: 'mfa_failed',
        userId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        outcome: 'failure',
        correlationId: ctx.correlationId ?? '',
      });
      throw new UnauthorizedException({ error: 'INVALID_MFA_TOKEN' });
    }

    await this.mfaService.clearMfaFailures(userId);
    return this.issueSession(user, ctx, true);
  }

  async verifyMfaRecovery(
    challengeId: string,
    code: string,
    ctx: RequestContext,
  ): Promise<{ accessToken: string; refreshToken: string; user: PublicUser }> {
    const userId = await this.mfaService.consumeChallenge(challengeId, ctx);
    const user = await this.userRepo.findById(userId);
    if (!user) throw new UnauthorizedException({ error: 'INVALID_MFA_CHALLENGE' });

    const codeIndex = await this.mfaService.verifyRecoveryCode(code, user.recoveryCodes);
    if (codeIndex === -1) {
      throw new UnauthorizedException({ error: 'INVALID_RECOVERY_CODE' });
    }

    await this.userRepo.useRecoveryCode(userId, user.recoveryCodes[codeIndex].hash);

    this.eventEmitter.emit(AuthEvents.RECOVERY_CODE_USED, { userId });
    await this.auditRepo.insertOne({
      eventType: 'recovery_code_used',
      userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      outcome: 'success',
      correlationId: ctx.correlationId ?? '',
    });

    return this.issueSession(user, ctx, true);
  }

  // ── Token refresh ─────────────────────────────────────────────────────────

  async refresh(
    rawRefreshToken: string | undefined,
    ctx: RequestContext,
  ): Promise<{ accessToken: string; newRefreshToken: string }> {
    if (!rawRefreshToken) {
      throw new UnauthorizedException({ error: 'SESSION_NOT_FOUND' });
    }

    const session = await this.sessionService.findByToken(rawRefreshToken);

    if (!session) {
      // Token not found — check if it's a reuse attempt (previously rotated token)
      const wasReuse = await this.sessionService.detectAndInvalidateReuse(rawRefreshToken);
      if (wasReuse) {
        this.eventEmitter.emit(AuthEvents.TOKEN_THEFT_DETECTED, { ip: ctx.ip });
      }
      throw new UnauthorizedException({ error: 'SESSION_NOT_FOUND' });
    }

    const user = await this.userRepo.findById(session.userId);
    if (!user || user.deactivatedAt) {
      await this.sessionService.invalidateSession(session.id);
      throw new ForbiddenException({ error: 'ACCOUNT_DEACTIVATED' });
    }

    const newRefreshToken = this.tokenService.generateRefreshToken();
    await this.sessionService.rotateRefreshToken(session.id, newRefreshToken);
    const accessToken = await this.tokenService.generateAccessToken(user);

    return { accessToken, newRefreshToken };
  }

  // ── Logout ────────────────────────────────────────────────────────────────

  async logout(userId: string, rawRefreshToken: string | undefined): Promise<void> {
    if (rawRefreshToken) {
      const session = await this.sessionService.findByToken(rawRefreshToken);
      if (session) await this.sessionService.invalidateSession(session.id);
    }
    this.eventEmitter.emit(AuthEvents.LOGOUT, { userId });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.sessionService.invalidateAllUserSessions(userId);
    this.eventEmitter.emit(AuthEvents.LOGOUT, { userId, allDevices: true });
  }

  // ── Email verification ────────────────────────────────────────────────────

  async verifyEmail(token: string): Promise<void> {
    const userId = await this.redis.getdel(`email_verify:${token}`);
    if (!userId) throw new BadRequestException({ error: 'INVALID_VERIFICATION_TOKEN' });

    await this.userRepo.update(userId, { emailVerified: true });
    this.eventEmitter.emit(AuthEvents.EMAIL_VERIFIED, { userId });
  }

  async resendVerification(email: string): Promise<void> {
    // Always return success to prevent email enumeration
    const user = await this.userRepo.findByEmail(email.toLowerCase());
    if (!user || user.emailVerified) return;

    // Invalidate any existing token
    const token = this.tokenService.generateSecureToken();
    await this.redis.set(`email_verify:${token}`, user._id.toString(), 'EX', 86400);

    await this.emailQueue.add('send_verification_email', {
      email: user.email,
      userId: user._id.toString(),
      verificationUrl: `${process.env.APP_FRONTEND_URL}/verify-email?token=${token}`,
    });
  }

  // ── Password reset ────────────────────────────────────────────────────────

  async forgotPassword(email: string, ctx: RequestContext): Promise<void> {
    // Always return success — prevent email enumeration
    const user = await this.userRepo.findByEmail(email.toLowerCase());
    if (!user) return;

    const token = this.tokenService.generateSecureToken();
    const tokenHash = createHash('sha256').update(token).digest('hex');

    await this.redis.set(`pwd_reset:${tokenHash}`, user._id.toString(), 'EX', 3600); // 1h

    await this.emailQueue.add('send_password_reset', {
      email: user.email,
      resetUrl: `${process.env.APP_FRONTEND_URL}/reset-password?token=${token}`,
    });

    this.eventEmitter.emit(AuthEvents.PASSWORD_RESET_REQUESTED, { userId: user._id.toString() });
  }

  async resetPassword(dto: ResetPasswordDto, ctx: RequestContext): Promise<void> {
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    const userId = await this.redis.getdel(`pwd_reset:${tokenHash}`);
    if (!userId) throw new BadRequestException({ error: 'INVALID_OR_EXPIRED_TOKEN' });

    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundException({ error: 'USER_NOT_FOUND' });

    await this.passwordService.assertNotBreached(dto.newPassword);
    await this.passwordService.assertNotReused(dto.newPassword, user.passwordHistory);

    const newHash = await this.passwordService.hash(dto.newPassword);
    await this.userRepo.updatePasswordHistory(userId, newHash, user.passwordHistory);

    // Invalidate all sessions after password reset
    await this.sessionService.invalidateAllUserSessions(userId);

    this.eventEmitter.emit(AuthEvents.PASSWORD_RESET_COMPLETE, { userId });
    await this.auditRepo.insertOne({
      eventType: 'password_reset',
      userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      outcome: 'success',
      correlationId: ctx.correlationId ?? '',
    });
  }

  // ── MFA setup ─────────────────────────────────────────────────────────────

  async setupMfa(userId: string): Promise<{ qrUri: string; secret: string }> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundException({ error: 'USER_NOT_FOUND' });

    const { secret, qrUri } = this.mfaService.generateSecret(user.email);

    // Store unconfirmed secret temporarily — only persisted on confirm
    await this.redis.set(`mfa_setup:${userId}`, secret, 'EX', 600); // 10-min window

    return { qrUri, secret };
  }

  async confirmMfa(
    userId: string,
    totpToken: string,
    ctx: RequestContext,
  ): Promise<{ recoveryCodes: string[] }> {
    const secret = await this.redis.getdel(`mfa_setup:${userId}`);
    if (!secret) throw new BadRequestException({ error: 'MFA_SETUP_EXPIRED' });

    const valid = this.mfaService.verifyTotp(secret, totpToken);
    if (!valid) throw new BadRequestException({ error: 'INVALID_MFA_TOKEN' });

    const { plaintext, hashed } = await this.mfaService.generateRecoveryCodes();

    await this.userRepo.setMfa(
      userId,
      secret,
      hashed.map((hash) => ({ hash, usedAt: null })),
      true,
    );

    this.eventEmitter.emit(AuthEvents.MFA_ENABLED, { userId });
    await this.auditRepo.insertOne({
      eventType: 'mfa_enabled',
      userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      outcome: 'success',
      correlationId: ctx.correlationId ?? '',
    });

    return { recoveryCodes: plaintext };
  }

  async disableMfa(
    userId: string,
    password: string,
    ctx: RequestContext,
  ): Promise<void> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundException({ error: 'USER_NOT_FOUND' });

    const valid = await this.passwordService.verify(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException({ error: 'INVALID_CREDENTIALS' });

    await this.userRepo.setMfa(userId, null, [], false);

    this.eventEmitter.emit(AuthEvents.MFA_DISABLED, { userId });
    await this.auditRepo.insertOne({
      eventType: 'mfa_disabled',
      userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      outcome: 'success',
      correlationId: ctx.correlationId ?? '',
    });
  }

  // ── OAuth ─────────────────────────────────────────────────────────────────

  async handleOAuthCallback(
    profile: OAuthProfile,
    ctx: RequestContext,
  ): Promise<{ accessToken: string; refreshToken: string; user: PublicUser }> {
    const user = await this.oauthService.findOrCreateUser(profile);

    if (user.deactivatedAt) {
      throw new ForbiddenException({ error: 'ACCOUNT_DEACTIVATED' });
    }

    return this.issueSession(user, ctx);
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  async listSessions(userId: string) {
    return this.sessionService.listUserSessions(userId);
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    // Verify session belongs to this user before revoking
    const members = await this.redis.smembers(`user_sessions:${userId}`);
    if (!members.includes(sessionId)) {
      throw new ForbiddenException({ error: 'SESSION_NOT_OWNED' });
    }
    await this.sessionService.invalidateSession(sessionId);
    this.eventEmitter.emit(AuthEvents.SESSION_REVOKED, { userId, sessionId });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async issueSession(
    user: UserDocument,
    ctx: RequestContext,
    mfaUsed = false,
  ): Promise<{ accessToken: string; refreshToken: string; user: PublicUser }> {
    const fingerprint = this.deviceService.computeFingerprint(ctx);
    const suspicious = this.deviceService.isSuspiciousLogin(user, fingerprint);

    const [accessToken, refreshToken] = await Promise.all([
      this.tokenService.generateAccessToken(user),
      Promise.resolve(this.tokenService.generateRefreshToken()),
    ]);

    const sessionId = await this.sessionService.createSession({
      userId: user._id.toString(),
      orgId: user.orgId?.toString() ?? '',
      refreshToken,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      fingerprint,
    });

    // Update device fingerprint in background
    this.deviceService.updateFingerprint(user, fingerprint).catch(() => {});

    await this.rateLimitService.clearFailures(user.email, ctx.ip);

    const event: LoginSuccessEvent = {
      userId: user._id.toString(),
      orgId: user.orgId?.toString() ?? '',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      mfaUsed,
      suspicious,
      sessionId,
    };
    this.eventEmitter.emit(AuthEvents.LOGIN_SUCCESS, event);

    if (suspicious) {
      this.eventEmitter.emit(AuthEvents.SUSPICIOUS_LOGIN, {
        userId: user._id.toString(),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    }

    await this.auditRepo.insertOne({
      eventType: 'login_success',
      userId: user._id.toString(),
      orgId: user.orgId?.toString(),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      outcome: 'success',
      metadata: { mfaUsed, suspicious, sessionId },
      correlationId: ctx.correlationId ?? '',
    });

    return { accessToken, refreshToken, user: this.sanitize(user) };
  }

  private sanitize(user: UserDocument): PublicUser {
    return {
      id: user._id.toString(),
      email: user.email,
      roles: user.roles,
      orgId: user.orgId?.toString() ?? '',
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      createdAt: user.createdAt,
    };
  }
}
