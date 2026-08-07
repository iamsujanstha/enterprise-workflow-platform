import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export const redisProvider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (cfg: ConfigService): Redis => {
    const client = new Redis(cfg.getOrThrow('REDIS_URL'), {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        if (times > 10) return null; // stop retrying after 10 attempts
        return Math.min(times * 100, 3000);
      },
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        return err.message.includes(targetError);
      },
      lazyConnect: false,
    });

    client.on('error', (err) => console.error('Redis error:', err.message));
    client.on('connect', () => console.log('Redis connected'));

    return client;
  },
};

export const InjectRedis = () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@nestjs/common').Inject(REDIS_CLIENT);
