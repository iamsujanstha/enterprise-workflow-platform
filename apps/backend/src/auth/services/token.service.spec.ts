import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TokenService } from './token.service';

const TEST_SECRET = 'test-secret-that-is-at-least-32-chars-long!!';

describe('TokenService', () => {
  let service: TokenService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        JwtModule.register({ secret: TEST_SECRET }),
      ],
      providers: [
        TokenService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              if (key === 'JWT_SECRET') return TEST_SECRET;
              throw new Error(`Unknown key: ${key}`);
            },
            get: (key: string, def?: any) => {
              if (key === 'JWT_KID') return 'v1';
              if (key === 'JWT_SECRET_PREV') return undefined;
              return def;
            },
          },
        },
      ],
    }).compile();

    service = module.get(TokenService);
  });

  it('generates a refresh token', () => {
    const token = service.generateRefreshToken();
    expect(token).toHaveLength(43); // 32 bytes base64url
  });

  it('generates two unique refresh tokens', () => {
    const t1 = service.generateRefreshToken();
    const t2 = service.generateRefreshToken();
    expect(t1).not.toBe(t2);
  });

  it('generates a secure token', () => {
    const token = service.generateSecureToken(32);
    expect(token.length).toBeGreaterThan(0);
  });

  it('generates a unique secure token each time', () => {
    const t1 = service.generateSecureToken();
    const t2 = service.generateSecureToken();
    expect(t1).not.toBe(t2);
  });
});
