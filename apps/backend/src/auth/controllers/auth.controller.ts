import {
  Controller,
  Post,
  Get,
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
import { RegisterDto } from '../dto/register.dto';
import { LoginDto, ForgotPasswordDto, ResetPasswordDto, VerifyEmailDto } from '../dto/login.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { SkipAuth } from '../../common/decorators/skip-auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CorrelationIdInterceptor } from '../../common/interceptors/correlation-id.interceptor';
import { JwtPayload, RequestContext } from '../interfaces/jwt-payload.interface';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/api/v1/auth/refresh',
};

function extractCtx(req: Request): RequestContext {
  return {
    ip: (req.headers['x-real-ip'] as string) ?? req.ip ?? '0.0.0.0',
    userAgent: req.headers['user-agent'] ?? '',
    correlationId: (req as any).correlationId,
  };
}

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
@UseInterceptors(CorrelationIdInterceptor)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @SkipAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user account' })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, extractCtx(req));
  }

  @Post('login')
  @SkipAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email + password' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto, extractCtx(req));

    if (result.status === 'MFA_REQUIRED') {
      return { status: 'MFA_REQUIRED', mfaChallenge: result.mfaChallenge };
    }

    // Set httpOnly refresh token cookie — never expose in response body
    res.cookie('rt', result.refreshToken, COOKIE_OPTIONS);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('refresh')
  @SkipAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token and get new access token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.rt;
    const result = await this.authService.refresh(refreshToken, extractCtx(req));

    res.cookie('rt', result.newRefreshToken, COOKIE_OPTIONS);
    return { accessToken: result.accessToken };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout current session' })
  async logout(
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user.sub, req.cookies?.rt);
    res.clearCookie('rt', { path: '/api/v1/auth/refresh' });
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout all sessions for this user' })
  async logoutAll(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logoutAll(user.sub);
    res.clearCookie('rt', { path: '/api/v1/auth/refresh' });
  }

  @Post('forgot-password')
  @SkipAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    await this.authService.forgotPassword(dto.email, extractCtx(req));
    // Always return 200 — prevent email enumeration
    return { message: 'If that email exists, a reset link has been sent.' };
  }

  @Post('reset-password')
  @SkipAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Complete password reset with token' })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    await this.authService.resetPassword(dto, extractCtx(req));
  }

  @Post('verify-email')
  @SkipAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Verify email address with token' })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.authService.verifyEmail(dto.token);
  }

  @Post('verify-email/resend')
  @SkipAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend email verification link' })
  async resendVerification(@Body('email') email: string) {
    await this.authService.resendVerification(email);
    return { message: 'Verification email sent if address is registered.' };
  }
}
