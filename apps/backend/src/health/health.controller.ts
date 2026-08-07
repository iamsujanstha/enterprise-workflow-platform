import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { InjectRedis } from '../common/config/redis.config';
import { SkipAuth } from '../common/decorators/skip-auth.decorator';
import Redis from 'ioredis';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Health')
@Controller({ path: 'auth/health', version: '1' })
export class HealthController {
  constructor(
    @InjectConnection() private readonly mongoose: Connection,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  @Get()
  @SkipAuth()
  @ApiOperation({ summary: 'Service health check' })
  async health() {
    const [mongoStatus, redisStatus] = await Promise.all([
      this.checkMongo(),
      this.checkRedis(),
    ]);

    const allHealthy = mongoStatus.status === 'healthy' && redisStatus.status === 'healthy';
    const status = allHealthy ? 'healthy' : 'degraded';

    return {
      status,
      version: process.env.npm_package_version ?? '1.0.0',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      dependencies: {
        mongodb: mongoStatus,
        redis: redisStatus,
      },
    };
  }

  private async checkMongo() {
    try {
      const start = Date.now();
      await this.mongoose.db?.admin().ping();
      return {
        status: 'healthy',
        latencyMs: Date.now() - start,
        state: this.mongoose.readyState,
      };
    } catch (err) {
      return { status: 'unhealthy', error: (err as Error).message };
    }
  }

  private async checkRedis() {
    try {
      const start = Date.now();
      await this.redis.ping();
      const info = await this.redis.info('memory');
      const usedMemory = info.match(/used_memory:(\d+)/)?.[1];

      return {
        status: 'healthy',
        latencyMs: Date.now() - start,
        usedMemoryBytes: usedMemory ? parseInt(usedMemory) : undefined,
      };
    } catch (err) {
      return { status: 'unhealthy', error: (err as Error).message };
    }
  }
}
