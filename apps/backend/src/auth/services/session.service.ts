import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRedis } from '../../common/config/redis.config';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { createHmac, randomUUID } from 'crypto';

export interface CreateSessionData {
  userId: string;
  orgId: string;
  refreshToken: string;
  ip: string;
  userAgent: string;
  fingerprint: string;
}

export interface SessionData {
  userId: string;
  orgId: string;
  refreshToken: string;
  familyId: string;
  familyVersion: number;
  ip: string;
  userAgent: string;
  fingerprint: string;
  createdAt: string;
  lastUsedAt: string;
}

@Injectable()
export class SessionService {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  async createSession(data: CreateSessionData): Promise<string> {
    const sessionId = randomUUID();
    const familyId = randomUUID();
    const refreshTokenHash = this.hmac(data.refreshToken);

    const pipeline = this.redis.pipeline();

    // Session record
    pipeline.hset(`session:${sessionId}`, {
      userId: data.userId,
      orgId: data.orgId,
      refreshToken: refreshTokenHash,
      familyId,
      familyVersion: 1,
      ip: data.ip,
      userAgent: data.userAgent,
      fingerprint: data.fingerprint,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    });
    pipeline.expire(`session:${sessionId}`, 7 * 24 * 60 * 60); // 7 days

    // Token family — for reuse detection
    pipeline.hset(`token_family:${familyId}`, { currentVersion: 1, invalidated: 0 });
    pipeline.expire(`token_family:${familyId}`, 7 * 24 * 60 * 60);

    // User session index
    pipeline.sadd(`user_sessions:${data.userId}`, sessionId);
    pipeline.expire(`user_sessions:${data.userId}`, 30 * 24 * 60 * 60); // 30 days

    await pipeline.exec();
    await this.enforceSessionCap(data.userId);
    return sessionId;
  }

  async findByToken(rawToken: string): Promise<(SessionData & { id: string }) | null> {
    const hash = this.hmac(rawToken);
    
    // Scan for session with this token hash
    const sessionKeys = await this.redis.keys('session:*');
    for (const key of sessionKeys) {
      const session = await this.redis.hgetall(key);
      if (session && session.refreshToken === hash) {
        const sessionId = key.replace('session:', '');
        return { id: sessionId, ...session as any };
      }
    }
    return null;
  }

  async rotateRefreshToken(
    sessionId: string,
    newRefreshToken: string,
  ): Promise<void> {
    const session = await this.redis.hgetall(`session:${sessionId}`);
    if (!session) throw new UnauthorizedException({ error: 'SESSION_NOT_FOUND' });

    const newVersion = parseInt(session.familyVersion) + 1;
    const newHash = this.hmac(newRefreshToken);

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
    const hash = this.hmac(rawToken);
    
    // Find all sessions and check if this is a rotated (stale) token
    const sessionKeys = await this.redis.keys('session:*');
    for (const key of sessionKeys) {
      const session = await this.redis.hgetall(key);
      
      // Check token family history to detect reuse
      if (session && session.familyId) {
        const family = await this.redis.hgetall(`token_family:${session.familyId}`);
        
        // If we find a stale token (not current version) being used → invalidate entire family
        const isCurrentToken = session.refreshToken === hash;
        const currentVersion = parseInt(family.currentVersion || '0');
        const sessionVersion = parseInt(session.familyVersion || '0');
        
        if (!isCurrentToken && sessionVersion < currentVersion) {
          await this.invalidateTokenFamily(session.familyId);
          return true;
        }
      }
    }
    return false;
  }

  async invalidateSession(sessionId: string): Promise<void> {
    const session = await this.redis.hgetall(`session:${sessionId}`);
    if (!session) return;

    const pipeline = this.redis.pipeline();
    pipeline.del(`session:${sessionId}`);
    pipeline.srem(`user_sessions:${session.userId}`, sessionId);
    await pipeline.exec();
  }

  async invalidateAllUserSessions(userId: string): Promise<void> {
    const sessionIds = await this.redis.smembers(`user_sessions:${userId}`);
    if (!sessionIds.length) return;

    const pipeline = this.redis.pipeline();
    sessionIds.forEach((id) => pipeline.del(`session:${id}`));
    pipeline.del(`user_sessions:${userId}`);
    await pipeline.exec();
  }

  async listUserSessions(userId: string): Promise<SessionData[]> {
    const sessionIds = await this.redis.smembers(`user_sessions:${userId}`);
    const sessions: SessionData[] = [];

    for (const id of sessionIds) {
      const session = await this.redis.hgetall(`session:${id}`);
      if (session && Object.keys(session).length > 0) {
        sessions.push(session as any);
      }
    }

    return sessions.sort((a, b) =>
      new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
    );
  }

  private async invalidateTokenFamily(familyId: string): Promise<void> {
    await this.redis.hset(`token_family:${familyId}`, { invalidated: 1 });
    
    // Find and delete all sessions in this family
    const sessionKeys = await this.redis.keys('session:*');
    for (const key of sessionKeys) {
      const session = await this.redis.hgetall(key);
      if (session && session.familyId === familyId) {
        const sessionId = key.replace('session:', '');
        await this.invalidateSession(sessionId);
      }
    }
  }

  private async enforceSessionCap(userId: string): Promise<void> {
    const sessionIds = await this.redis.smembers(`user_sessions:${userId}`);
    if (sessionIds.length <= 10) return;

    // Fetch lastUsedAt, evict oldest
    const sessions = await Promise.all(
      sessionIds.map(async (id) => ({
        id,
        lastUsedAt: await this.redis.hget(`session:${id}`, 'lastUsedAt') ?? '0',
      }))
    );

    sessions.sort((a, b) => a.lastUsedAt.localeCompare(b.lastUsedAt));
    const oldest = sessions[0];

    await this.redis.del(`session:${oldest.id}`);
    await this.redis.srem(`user_sessions:${userId}`, oldest.id);
  }

  private hmac(value: string): string {
    const secret = this.config.getOrThrow('REDIS_HMAC_SECRET');
    return createHmac('sha256', secret).update(value).digest('hex');
  }
}
