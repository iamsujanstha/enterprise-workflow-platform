import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { OAuthProfile } from '../services/oauth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    const clientID = configService.get('GOOGLE_CLIENT_ID', '');
    super({
      clientID: clientID || 'DISABLED',
      clientSecret: configService.get('GOOGLE_CLIENT_SECRET', 'DISABLED'),
      callbackURL: `${configService.get('OAUTH_CALLBACK_BASE_URL', 'http://localhost:3000')}/api/v1/auth/oauth/google/callback`,
      scope: ['email', 'profile'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<void> {
    const oauthProfile: OAuthProfile = {
      provider: 'google',
      providerId: profile.id,
      email: profile.emails[0].value,
      displayName: profile.displayName,
    };
    done(null, oauthProfile);
  }
}
