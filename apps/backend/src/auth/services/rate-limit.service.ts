import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRedis } from '../../common/config/redis.config';
import Redis from 'ioredis';

// Atomic INCR + EXPIRE in one round-trip — no race condition
const LUA_INCR_WITH_TTL = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  return count
`;

@Injectable()
export class RateLimitService {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  async assertNotThrottled(email: string, ip: string): Promise<void> {
    const [accountCount, ipCount] = await Promise.all([
      this.redis.get(`login_fail_account:${email}`),
      this.redis.get(`login_fail_ip:${ip}`),
    ]);

    if (Number(accountCount) >= 5) {
      const ttl = await this.redis.ttl(`login_fail_account:${email}`);
      throw new HttpException(
        { error: 'ACCOUNT_THROTTLED', retryAfterSeconds: ttl },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (Number(ipCount) >= 100) {
      throw new HttpException(
        { error: 'IP_THROTTLED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordFailure(email: string, ip: string): Promise<void> {
    const WINDOW = 15 * 60; // 15 minutes
    await Promise.all([
      this.redis.eval(LUA_INCR_WITH_TTL, 1, `login_fail_account:${email}`, WINDOW),
      this.redis.eval(LUA_INCR_WITH_TTL, 1, `login_fail_ip:${ip}`, WINDOW),
      this.recordStuffingCandidate(ip, email),
    ]);
  }

  async clearFailures(email: string, ip: string): Promise<void> {
    await Promise.all([
      this.redis.del(`login_fail_account:${email}`),
      this.redis.del(`login_fail_ip:${ip}`),
    ]);
  }

  async isIpBlocked(ip: string): Promise<boolean> {
    const blocked = await this.redis.get(`ip_blocked:${ip}`);
    return blocked === '1';
  }

  private async recordStuffingCandidate(ip: string, email: string): Promise<void> {
    const key = `login_stuffing_ip:${ip}`;

    // Use SADD to track distinct emails from this IP in a 5-min window
    const luaStuffing = `
      redis.call('SADD', KEYS[1], ARGV[1])
      redis.call('EXPIRE', KEYS[1], 300)
      return redis.call('SCARD', KEYS[1])
    `;

    const count = await this.redis.eval(luaStuffing, 1, key, email) as number;

    if (count >= 100) {
      // Block IP for 1 hour
      await this.redis.set(`ip_blocked:${ip}`, '1', 'EX', 3600);
    }
  }
}
