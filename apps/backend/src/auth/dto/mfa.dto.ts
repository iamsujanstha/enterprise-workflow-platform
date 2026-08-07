import { IsString, Length, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MfaVerifyDto {
  @ApiProperty({ description: 'MFA challenge ID from login response' })
  @IsString()
  challengeId: string;

  @ApiProperty({ description: '6-digit TOTP token', example: '123456' })
  @IsString()
  @Length(6, 6)
  token: string;
}

export class MfaConfirmDto {
  @ApiProperty({ description: '6-digit TOTP token to confirm setup' })
  @IsString()
  @Length(6, 6)
  token: string;
}

export class MfaDisableDto {
  @ApiProperty({ description: 'Current password to confirm disable action' })
  @IsString()
  password: string;
}

export class RecoveryCodeDto {
  @ApiProperty({ description: '8-character recovery code' })
  @IsString()
  @Length(8, 8)
  code: string;
}

export class MfaRecoveryDto {
  @ApiProperty()
  @IsString()
  challengeId: string;

  @ApiProperty({ description: '8-character recovery code' })
  @IsString()
  code: string;
}
