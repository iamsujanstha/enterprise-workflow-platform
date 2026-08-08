import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AuditModule } from './audit/audit.module';
import { JobsModule } from './jobs/jobs.module';
import { HealthModule } from './health/health.module';
import { validate } from './common/config/env.validation';

@Module({
  imports: [
    // Configuration — loads .env and validates required vars
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      envFilePath: ['.env.local', '.env'],
    }),

    // MongoDB connection
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        uri: cfg.getOrThrow('MONGO_URI'),
        dbName: cfg.get('MONGO_DB_NAME', 'auth'),
        maxPoolSize: 10,
        minPoolSize: 2,
        maxIdleTimeMS: 60_000,
        serverSelectionTimeoutMS: 5_000,
        socketTimeoutMS: 45_000,
      }),
    }),

    // BullMQ queue backed by Redis
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        connection: {
          host: new URL(cfg.getOrThrow('REDIS_URL')).hostname,
          port: Number(new URL(cfg.getOrThrow('REDIS_URL')).port) || 6379,
        },
      }),
    }),

    // Global event bus — decouples auth events from side-effect handlers
    EventEmitterModule.forRoot({ wildcard: true }),

    // Cron jobs (session cleanup, audit archival)
    ScheduleModule.forRoot(),

    // Outer-layer throttle (Nginx handles per-IP; this catches edge cases)
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),

    // Feature modules
    AuthModule,
    UsersModule,
    AuditModule,
    JobsModule,
    HealthModule,
  ],
})
export class AppModule {}
