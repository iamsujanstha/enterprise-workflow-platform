import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';
import { ConfigService } from '@nestjs/config';
import { OAuthProfile } from '../services/oauth.service';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.get('GITHUB_CLIENT_ID', ''),
      clientSecret: configService.get('GITHUB_CLIENT_SECRET', ''),
      callbackURL: `${configService.get('OAUTH_CALLBACK_BASE_URL', 'http://localhost:3000')}/api/v1/auth/oauth/github/callback`,
      scope: ['user:email'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: Function,
  ): Promise<void> {
    const email =
      profile.emails?.find((e: any) => e.primary)?.value ??
      profile.emails?.[0]?.value;

    const oauthProfile: OAuthProfile = {
      provider: 'github',
      providerId: profile.id,
      email,
      displayName: profile.displayName || profile.username,
    };
    done(null, oauthProfile);
  }
}
