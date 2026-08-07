import {
  Controller,
  Get,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  UseInterceptors,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';
import { SkipAuth } from '../../common/decorators/skip-auth.decorator';
import { CorrelationIdInterceptor } from '../../common/interceptors/correlation-id.interceptor';
import { OAuthProfile } from '../services/oauth.service';
import { RequestContext } from '../interfaces/jwt-payload.interface';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/api/v1/auth/refresh',
};

@ApiTags('OAuth')
@Controller({ path: 'auth/oauth', version: '1' })
@UseInterceptors(CorrelationIdInterceptor)
export class OAuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  // ── Google ────────────────────────────────────────────────────────────────

  @Get('google')
  @SkipAuth()
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Initiate Google OAuth2 flow' })
  googleLogin() {
    // Passport redirects to Google — this handler body never executes
  }

  @Get('google/callback')
  @SkipAuth()
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth2 callback' })
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    return this.handleCallback(req, res);
  }

  // ── GitHub ────────────────────────────────────────────────────────────────

  @Get('github')
  @SkipAuth()
  @UseGuards(AuthGuard('github'))
  @ApiOperation({ summary: 'Initiate GitHub OAuth2 flow' })
  githubLogin() {
    // Passport redirects to GitHub — this handler body never executes
  }

  @Get('github/callback')
  @SkipAuth()
  @UseGuards(AuthGuard('github'))
  @ApiOperation({ summary: 'GitHub OAuth2 callback' })
  async githubCallback(@Req() req: Request, @Res() res: Response) {
    return this.handleCallback(req, res);
  }

  // ── Shared callback handler ───────────────────────────────────────────────

  private async handleCallback(req: Request, res: Response) {
    const profile = req.user as OAuthProfile;
    const ctx: RequestContext = {
      ip: (req.headers['x-real-ip'] as string) ?? req.ip ?? '0.0.0.0',
      userAgent: req.headers['user-agent'] ?? '',
      correlationId: (req as any).correlationId,
    };

    const result = await this.authService.handleOAuthCallback(profile, ctx);

    // Set httpOnly refresh token cookie
    res.cookie('rt', result.refreshToken, COOKIE_OPTIONS);

    // Redirect to frontend with access token in URL fragment (never in query param)
    const frontendUrl = this.config.get('APP_FRONTEND_URL', 'http://localhost:3001');
    const redirectUrl = new URL('/oauth/callback', frontendUrl);
    redirectUrl.searchParams.set('token', result.accessToken);

    res.redirect(redirectUrl.toString());
  }
}
