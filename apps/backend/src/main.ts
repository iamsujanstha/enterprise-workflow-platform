import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { WinstonModule } from 'nest-winston';
import { createWinstonLogger } from './common/config/logger.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger(createWinstonLogger()),
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);
  const isDev = configService.get('NODE_ENV') !== 'production';

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        scriptSrc: ["'self'"],
      },
    },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  }));

  // Cookie parser — needed to read httpOnly refresh token cookie
  app.use(cookieParser());

  // CORS — restrict to known origins in production
  app.enableCors({
    origin: configService.get('CORS_ORIGINS', 'http://localhost:3001').split(','),
    credentials: true, // required for httpOnly cookie to be sent cross-origin
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID'],
  });

  // URI versioning: /api/v1/auth/*
  app.enableVersioning({ type: VersioningType.URI });
  app.setGlobalPrefix('api');

  // Global validation pipe — strips unknown fields, transforms types
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    stopAtFirstError: false,
  }));

  // Global exception filter — structured error responses
  app.useGlobalFilters(new HttpExceptionFilter());

  // OpenAPI docs (dev only)
  if (isDev) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Auth API')
      .setDescription('Authentication System API')
      .setVersion('1.0')
      .addBearerAuth()
      .addCookieAuth('refreshToken')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(port, '0.0.0.0');
  console.log(`Auth API running on port ${port}`);
}

bootstrap();
