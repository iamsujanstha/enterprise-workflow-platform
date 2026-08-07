import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRedis } from '../../common/config/redis.config';
import Redis from 'ioredis';

@Injectable()
export class SessionCleanupProcessor {
  private readonly logger = new Logger(SessionCleanupProcessor.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  // Runs every hour — prunes stale session IDs from user session sets
  @Cron(CronExpression.EVERY_HOUR)
  async pruneOrphanedSessionRefs() {
    this.logger.debug('Running session cleanup');
    let cleaned = 0;

    const stream = this.redis.scanStream({ match: 'user_sessions:*', count: 100 });

    stream.on('data', async (keys: string[]) => {
      for (const key of keys) {
        const sessionIds = await this.redis.smembers(key);
        for (const sessionId of sessionIds) {
          const exists = await this.redis.exists(`session:${sessionId}`);
          if (!exists) {
            await this.redis.srem(key, sessionId);
            cleaned++;
          }
        }
      }
    });

    stream.on('end', () => {
      if (cleaned > 0) {
        this.logger.log(`Session cleanup complete: removed ${cleaned} stale refs`);
      }
    });

    stream.on('error', (err) => {
      this.logger.error('Session cleanup error', err);
    });
  }
}
