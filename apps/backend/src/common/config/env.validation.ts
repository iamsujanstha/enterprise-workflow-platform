import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNumber, IsString, IsOptional, validateSync, MinLength } from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  @IsOptional()
  PORT: number = 3000;

  @IsString()
  MONGO_URI: string;

  @IsString()
  REDIS_URL: string;

  @IsString()
  @MinLength(32)
  JWT_SECRET: string;

  @IsString()
  @IsOptional()
  JWT_SECRET_PREV: string;

  @IsString()
  @IsOptional()
  JWT_KID: string = 'v1';

  @IsString()
  @IsOptional()
  JWT_SECRET_NAME: string;

  @IsString()
  @MinLength(32)
  REDIS_HMAC_SECRET: string;

  @IsString()
  @IsOptional()
  GOOGLE_CLIENT_ID: string;

  @IsString()
  @IsOptional()
  GOOGLE_CLIENT_SECRET: string;

  @IsString()
  @IsOptional()
  GITHUB_CLIENT_ID: string;

  @IsString()
  @IsOptional()
  GITHUB_CLIENT_SECRET: string;

  @IsString()
  @IsOptional()
  OAUTH_CALLBACK_BASE_URL: string = 'http://localhost:3000';

  @IsString()
  @IsOptional()
  CORS_ORIGINS: string = 'http://localhost:3001';

  @IsString()
  @IsOptional()
  AWS_REGION: string = 'us-east-1';

  @IsString()
  @IsOptional()
  KMS_TOTP_KEY_ID: string;

  @IsString()
  @IsOptional()
  SES_FROM_EMAIL: string = 'noreply@example.com';

  @IsString()
  @IsOptional()
  APP_FRONTEND_URL: string = 'http://localhost:3001';
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(`Config validation error:\n${errors.toString()}`);
  }
  return validatedConfig;
}
