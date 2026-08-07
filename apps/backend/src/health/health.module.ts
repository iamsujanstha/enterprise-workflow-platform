import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { REDIS_CLIENT, redisProvider } from '../common/config/redis.config';

@Module({
  providers: [redisProvider],
  controllers: [HealthController],
})
export class HealthModule {}
