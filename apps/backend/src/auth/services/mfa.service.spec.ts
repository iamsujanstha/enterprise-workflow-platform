import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MfaService } from './mfa.service';
import { REDIS_CLIENT } from '../../common/config/redis.config';
import { authenticator } from 'otplib';

const mockRedis = {
  set: jest.fn().mockResolvedValue('OK'),
  get: jest.fn().mockResolvedValue(null),
  getdel: jest.fn(),
  eval: jest.fn().mockResolvedValue(1),
  del: jest.fn().mockResolvedValue(1),
  ttl: jest.fn().mockResolvedValue(900),
};

describe('MfaService', () => {
  let service: MfaService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MfaService,
        { provide: REDIS_CLIENT, useValue: mockRedis },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(), getOrThrow: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(MfaService);
  });

  beforeEach(() => jest.clearAllMocks());

  it('generates a TOTP secret and QR URI', () => {
    const { secret, qrUri } = service.generateSecret('user@example.com');
    expect(secret).toBeTruthy();
    expect(qrUri).toContain('otpauth://totp');
    expect(qrUri).toContain('user%40example.com');
  });

  it('verifies a valid TOTP token', () => {
    const { secret } = service.generateSecret('user@example.com');
    const token = authenticator.generate(secret);
    expect(service.verifyTotp(secret, token)).toBe(true);
  });

  it('rejects an invalid TOTP token', () => {
    const { secret } = service.generateSecret('user@example.com');
    expect(service.verifyTotp(secret, '000000')).toBe(false);
  });

  it('generates 10 recovery codes', async () => {
    const { plaintext, hashed } = await service.generateRecoveryCodes();
    expect(plaintext).toHaveLength(10);
    expect(hashed).toHaveLength(10);
    plaintext.forEach((code) => {
      expect(code).toHaveLength(8);
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
    });
  });

  it('verifies a valid recovery code', async () => {
    const { plaintext, hashed } = await service.generateRecoveryCodes();
    const hashedCodes = hashed.map((hash) => ({ hash, usedAt: null }));
    const index = await service.verifyRecoveryCode(plaintext[3], hashedCodes);
    expect(index).toBe(3);
  });

  it('rejects an already-used recovery code', async () => {
    const { plaintext, hashed } = await service.generateRecoveryCodes();
    const hashedCodes = hashed.map((hash, i) => ({
      hash,
      usedAt: i === 3 ? new Date() : null, // code[3] is used
    }));
    const index = await service.verifyRecoveryCode(plaintext[3], hashedCodes);
    expect(index).toBe(-1);
  });

  it('creates an MFA challenge', async () => {
    const challengeId = await service.createChallenge('user-123', {
      ip: '127.0.0.1',
      userAgent: 'Test/1.0',
    });
    expect(typeof challengeId).toBe('string');
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining('mfa_challenge:'),
      expect.any(String),
      'EX',
      300,
    );
  });
});
