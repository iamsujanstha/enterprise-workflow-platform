import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '../../common/config/redis.config';
import Redis from 'ioredis';
import { authenticator } from 'otplib';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { RequestContext } from '../interfaces/jwt-payload.interface';

authenticator.options = { window: 1 }; // ±30s drift tolerance

@Injectable()
export class MfaService {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  generateSecret(userEmail: string): { secret: string; qrUri: string } {
    const secret = authenticator.generateSecret(32);
    const qrUri = authenticator.keyuri(userEmail, 'WorkflowPlatform', secret);
    return { secret, qrUri };
  }

  verifyTotp(secret: string, token: string): boolean {
    try {
      return authenticator.verify({ token, secret });
    } catch {
      return false;
    }
  }

  async generateRecoveryCodes(): Promise<{ plaintext: string[]; hashed: string[] }> {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I
    const plaintext = Array.from({ length: 10 }, () =>
      Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    );
    const hashed = await Promise.all(plaintext.map((c) => bcrypt.hash(c, 12)));
    return { plaintext, hashed };
  }

  async verifyRecoveryCode(
    code: string,
    hashedCodes: Array<{ hash: string; usedAt: Date | null }>,
  ): Promise<number> {
    // Returns index of matching unused code, or -1
    for (let i = 0; i < hashedCodes.length; i++) {
      const entry = hashedCodes[i];
      if (entry.usedAt) continue; // already used
      if (await bcrypt.compare(code, entry.hash)) return i;
    }
    return -1;
  }

  // ── MFA challenge (issued after password passes, before TOTP) ──

  async createChallenge(userId: string, ctx: RequestContext): Promise<string> {
    const challengeId = randomUUID();
    const payload = JSON.stringify({
      userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    // 5-minute TTL — user must complete TOTP within this window
    await this.redis.set(`mfa_challenge:${challengeId}`, payload, 'EX', 300);
    return challengeId;
  }

  async consumeChallenge(
    challengeId: string,
    ctx: RequestContext,
  ): Promise<string> {
    const raw = await this.redis.getdel(`mfa_challenge:${challengeId}`);
    if (!raw) throw new UnauthorizedException({ error: 'INVALID_MFA_CHALLENGE' });

    const challenge = JSON.parse(raw);

    // Bind challenge to originating device — prevents replay from different IP/UA
    if (challenge.ip !== ctx.ip || challenge.userAgent !== ctx.userAgent) {
      throw new UnauthorizedException({ error: 'DEVICE_MISMATCH' });
    }

    return challenge.userId;
  }

  // ── Brute-force protection for TOTP ──

  async recordMfaFailure(userId: string): Promise<void> {
    const key = `mfa_fail:${userId}`;
    const lua = `
      local count = redis.call('INCR', KEYS[1])
      if count == 1 then redis.call('EXPIRE', KEYS[1], 900) end
      return count
    `;
    const count = await this.redis.eval(lua, 1, key) as number;
    if (count >= 5) {
      // Lock for 15 minutes
      await this.redis.set(`mfa_locked:${userId}`, '1', 'EX', 900);
    }
  }

  async assertMfaNotLocked(userId: string): Promise<void> {
    const locked = await this.redis.get(`mfa_locked:${userId}`);
    if (locked) {
      const ttl = await this.redis.ttl(`mfa_locked:${userId}`);
      throw new UnauthorizedException({
        error: 'MFA_LOCKED',
        retryAfterSeconds: ttl,
      });
    }
  }

  async clearMfaFailures(userId: string): Promise<void> {
    await Promise.all([
      this.redis.del(`mfa_fail:${userId}`),
      this.redis.del(`mfa_locked:${userId}`),
    ]);
  }
}
