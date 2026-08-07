import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { EmailProcessor } from './processors/email.processor';
import { SessionCleanupProcessor } from './processors/session-cleanup.processor';
import { REDIS_CLIENT, redisProvider } from '../common/config/redis.config';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'email' }),
  ],
  providers: [
    redisProvider,
    EmailProcessor,
    SessionCleanupProcessor,
  ],
})
export class JobsModule {}
