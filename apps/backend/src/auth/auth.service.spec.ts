import { Test } from '@nestjs/testing';
import { ConflictException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getQueueToken } from '@nestjs/bullmq';
import { AuthService } from './auth.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { SessionService } from './services/session.service';
import { MfaService } from './services/mfa.service';
import { OAuthService } from './services/oauth.service';
import { RateLimitService } from './services/rate-limit.service';
import { DeviceService } from './services/device.service';
import { UserRepository } from '../users/user.repository';
import { AuditLogRepository } from '../audit/audit-log.repository';
import { REDIS_CLIENT } from '../common/config/redis.config';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockUser = {
  _id: { toString: () => 'user-id-123' },
  email: 'test@example.com',
  passwordHash: '$2b$12$hashed',
  roles: ['member'],
  orgId: { toString: () => 'org-123' },
  emailVerified: true,
  deactivatedAt: null,
  mfaEnabled: false,
  mfaSecret: null,
  recoveryCodes: [],
  passwordHistory: [],
  deviceFingerprints: [],
  save: jest.fn(),
};

const mockUserRepo = {
  findByEmail: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  updatePasswordHistory: jest.fn(),
};

const mockPasswordService = {
  assertNotBreached: jest.fn().mockResolvedValue(undefined),
  hash: jest.fn().mockResolvedValue('$2b$12$hashed'),
  verify: jest.fn(),
  hashDummy: jest.fn().mockResolvedValue(undefined),
  assertNotReused: jest.fn().mockResolvedValue(undefined),
};

const mockTokenService = {
  generateAccessToken: jest.fn().mockResolvedValue('access-token-xyz'),
  generateRefreshToken: jest.fn().mockReturnValue('refresh-token-xyz'),
  generateSecureToken: jest.fn().mockReturnValue('secure-token-xyz'),
};

const mockSessionService = {
  createSession: jest.fn().mockResolvedValue('session-id-abc'),
  findByToken: jest.fn(),
  rotateRefreshToken: jest.fn(),
  invalidateSession: jest.fn(),
  invalidateAllUserSessions: jest.fn(),
  listUserSessions: jest.fn().mockResolvedValue([]),
  detectAndInvalidateReuse: jest.fn().mockResolvedValue(false),
};

const mockMfaService = {
  createChallenge: jest.fn().mockResolvedValue('challenge-id-xyz'),
  assertMfaNotLocked: jest.fn().mockResolvedValue(undefined),
};

const mockRateLimitService = {
  isIpBlocked: jest.fn().mockResolvedValue(false),
  assertNotThrottled: jest.fn().mockResolvedValue(undefined),
  recordFailure: jest.fn(),
  clearFailures: jest.fn(),
};

const mockDeviceService = {
  computeFingerprint: jest.fn().mockReturnValue('fingerprint-abc'),
  isSuspiciousLogin: jest.fn().mockReturnValue(false),
  updateFingerprint: jest.fn().mockResolvedValue(undefined),
};

const mockAuditRepo = { insertOne: jest.fn().mockResolvedValue(undefined) };
const mockEventEmitter = { emit: jest.fn() };
const mockRedis = {
  set: jest.fn().mockResolvedValue('OK'),
  get: jest.fn().mockResolvedValue(null),
  getdel: jest.fn(),
};
const mockEmailQueue = { add: jest.fn().mockResolvedValue(undefined) };

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  const ctx = { ip: '127.0.0.1', userAgent: 'jest', correlationId: 'test-corr' };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserRepository, useValue: mockUserRepo },
        { provide: AuditLogRepository, useValue: mockAuditRepo },
        { provide: PasswordService, useValue: mockPasswordService },
        { provide: TokenService, useValue: mockTokenService },
        { provide: SessionService, useValue: mockSessionService },
        { provide: MfaService, useValue: mockMfaService },
        { provide: OAuthService, useValue: {} },
        { provide: RateLimitService, useValue: mockRateLimitService },
        { provide: DeviceService, useValue: mockDeviceService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: getQueueToken('email'), useValue: mockEmailQueue },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  beforeEach(() => jest.clearAllMocks());

  // ── register ──────────────────────────────────────────────────────────────

  describe('register', () => {
    it('creates a new user', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockUserRepo.create.mockResolvedValue(mockUser);

      const result = await service.register(
        { email: 'new@example.com', password: 'StrongP@ss1' },
        ctx,
      );

      expect(result.email).toBe('test@example.com');
      expect(mockPasswordService.assertNotBreached).toHaveBeenCalledWith('StrongP@ss1');
      expect(mockEmailQueue.add).toHaveBeenCalledWith(
        'send_verification_email',
        expect.any(Object),
      );
    });

    it('throws ConflictException for duplicate email', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(mockUser);
      await expect(
        service.register({ email: 'test@example.com', password: 'StrongP@ss1' }, ctx),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── login ─────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('returns SUCCESS with tokens for valid credentials', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(mockUser);
      mockPasswordService.verify.mockResolvedValue(true);

      const result = await service.login(
        { email: 'test@example.com', password: 'StrongP@ss1' },
        ctx,
      );

      expect(result.status).toBe('SUCCESS');
      if (result.status === 'SUCCESS') {
        expect(result.accessToken).toBe('access-token-xyz');
        expect(result.refreshToken).toBe('refresh-token-xyz');
      }
    });

    it('throws UnauthorizedException for wrong password', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(mockUser);
      mockPasswordService.verify.mockResolvedValue(false);

      await expect(
        service.login({ email: 'test@example.com', password: 'wrong' }, ctx),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockRateLimitService.recordFailure).toHaveBeenCalled();
    });

    it('throws UnauthorizedException for non-existent user', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockPasswordService.verify.mockResolvedValue(false);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'anything' }, ctx),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws ForbiddenException for deactivated account', async () => {
      mockUserRepo.findByEmail.mockResolvedValue({
        ...mockUser,
        deactivatedAt: new Date(),
      });
      mockPasswordService.verify.mockResolvedValue(true);

      await expect(
        service.login({ email: 'test@example.com', password: 'StrongP@ss1' }, ctx),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException for unverified email', async () => {
      mockUserRepo.findByEmail.mockResolvedValue({
        ...mockUser,
        emailVerified: false,
      });
      mockPasswordService.verify.mockResolvedValue(true);

      await expect(
        service.login({ email: 'test@example.com', password: 'StrongP@ss1' }, ctx),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns MFA_REQUIRED when MFA is enabled', async () => {
      mockUserRepo.findByEmail.mockResolvedValue({ ...mockUser, mfaEnabled: true });
      mockPasswordService.verify.mockResolvedValue(true);

      const result = await service.login(
        { email: 'test@example.com', password: 'StrongP@ss1' },
        ctx,
      );

      expect(result.status).toBe('MFA_REQUIRED');
      if (result.status === 'MFA_REQUIRED') {
        expect(result.mfaChallenge).toBe('challenge-id-xyz');
      }
    });

    it('checks rate limiting before touching the DB', async () => {
      mockRateLimitService.assertNotThrottled.mockRejectedValueOnce(
        new Error('ACCOUNT_THROTTLED'),
      );

      await expect(
        service.login({ email: 'test@example.com', password: 'any' }, ctx),
      ).rejects.toThrow();
      expect(mockUserRepo.findByEmail).not.toHaveBeenCalled();
    });
  });

  // ── refresh ───────────────────────────────────────────────────────────────

  describe('refresh', () => {
    it('rotates tokens for a valid refresh token', async () => {
      mockSessionService.findByToken.mockResolvedValue({
        id: 'session-id',
        userId: 'user-id-123',
        ...mockUser,
      });
      mockUserRepo.findById.mockResolvedValue(mockUser);

      const result = await service.refresh('valid-refresh-token', ctx);

      expect(result.accessToken).toBe('access-token-xyz');
      expect(result.newRefreshToken).toBe('refresh-token-xyz');
      expect(mockSessionService.rotateRefreshToken).toHaveBeenCalled();
    });

    it('throws for missing refresh token', async () => {
      await expect(service.refresh(undefined, ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('throws for invalid refresh token and checks for reuse', async () => {
      mockSessionService.findByToken.mockResolvedValue(null);

      await expect(service.refresh('stale-token', ctx)).rejects.toThrow(UnauthorizedException);
      expect(mockSessionService.detectAndInvalidateReuse).toHaveBeenCalled();
    });
  });
});
