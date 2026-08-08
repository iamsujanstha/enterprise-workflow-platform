import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { REDIS_CLIENT, redisProvider } from '../common/config/redis.config';

// Controllers
import { AuthController } from './controllers/auth.controller';
import { MfaController } from './controllers/mfa.controller';
import { OAuthController } from './controllers/oauth.controller';
import { SessionController } from './controllers/session.controller';

// Services
import { AuthService } from './auth.service';
import { TokenService } from './services/token.service';
import { SessionService } from './services/session.service';
import { MfaService } from './services/mfa.service';
import { OAuthService } from './services/oauth.service';
import { PasswordService } from './services/password.service';
import { RateLimitService } from './services/rate-limit.service';
import { DeviceService } from './services/device.service';

// Guards
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

// Strategies
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { GithubStrategy } from './strategies/github.strategy';

// Events
import { AuthEventsListener } from './events/auth-events.listener';

@Module({
  imports: [
    UsersModule,
    AuditModule,
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
    BullModule.registerQueue({ name: 'email' }),
  ],
  controllers: [
    AuthController,
    MfaController,
    OAuthController,
    SessionController,
  ],
  providers: [
    redisProvider,
    // Services
    AuthService,
    TokenService,
    SessionService,
    MfaService,
    OAuthService,
    PasswordService,
    RateLimitService,
    DeviceService,
    // Guards
    JwtAuthGuard,
    RolesGuard,
    // Strategies
    JwtStrategy,
    GoogleStrategy,
    GithubStrategy,
    // Listeners
    AuthEventsListener,
  ],
  exports: [JwtAuthGuard, RolesGuard, TokenService],
})
export class AuthModule {}
