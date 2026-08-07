import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthService } from '../auth.service';
import { MfaVerifyDto, MfaConfirmDto, MfaDisableDto, MfaRecoveryDto } from '../dto/mfa.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { SkipAuth } from '../../common/decorators/skip-auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CorrelationIdInterceptor } from '../../common/interceptors/correlation-id.interceptor';
import { JwtPayload, RequestContext } from '../interfaces/jwt-payload.interface';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/api/v1/auth/refresh',
};

function extractCtx(req: Request): RequestContext {
  return {
    ip: (req.headers['x-real-ip'] as string) ?? req.ip ?? '0.0.0.0',
    userAgent: req.headers['user-agent'] ?? '',
    correlationId: (req as any).correlationId,
  };
}

@ApiTags('MFA')
@Controller({ path: 'auth/mfa', version: '1' })
@UseInterceptors(CorrelationIdInterceptor)
export class MfaController {
  constructor(private readonly authService: AuthService) {}

  @Post('verify')
  @SkipAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit TOTP code to complete MFA login' })
  async verifyMfa(
    @Body() dto: MfaVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyMfa(
      dto.challengeId,
      dto.token,
      extractCtx(req),
    );
    res.cookie('rt', result.refreshToken, COOKIE_OPTIONS);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('recovery')
  @SkipAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Use a recovery code to complete MFA login' })
  async mfaRecovery(
    @Body() dto: MfaRecoveryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyMfaRecovery(
      dto.challengeId,
      dto.code,
      extractCtx(req),
    );
    res.cookie('rt', result.refreshToken, COOKIE_OPTIONS);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('setup')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initiate MFA setup — returns QR code URI' })
  async setupMfa(@CurrentUser() user: JwtPayload) {
    return this.authService.setupMfa(user.sub);
  }

  @Post('confirm')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm MFA setup with TOTP token — activates MFA' })
  async confirmMfa(
    @Body() dto: MfaConfirmDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return this.authService.confirmMfa(user.sub, dto.token, extractCtx(req));
  }

  @Post('disable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disable MFA (requires current password)' })
  async disableMfa(
    @Body() dto: MfaDisableDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    await this.authService.disableMfa(user.sub, dto.password, extractCtx(req));
  }
}
