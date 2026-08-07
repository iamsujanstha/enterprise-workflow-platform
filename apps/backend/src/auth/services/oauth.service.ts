import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRedis } from '../../common/config/redis.config';
import Redis from 'ioredis';
import { randomBytes } from 'crypto';
import { UserRepository } from '../../users/user.repository';
import { UserDocument } from '../../users/schemas/user.schema';

export interface OAuthProfile {
  provider: 'google' | 'github';
  providerId: string;
  email: string;
  displayName?: string;
}

@Injectable()
export class OAuthService {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly userRepo: UserRepository,
  ) {}

  // ── PKCE state management ──

  async generateState(provider: string): Promise<string> {
    const state = randomBytes(32).toString('base64url');
    // 10-minute TTL — OAuth callback must arrive within this window
    await this.redis.set(`oauth_state:${state}`, provider, 'EX', 600);
    return state;
  }

  async validateAndConsumeState(state: string): Promise<string | null> {
    // getdel is atomic — prevents replay
    const provider = await this.redis.getdel(`oauth_state:${state}`);
    return provider;
  }

  // ── Account linking / creation ──

  async findOrCreateUser(profile: OAuthProfile): Promise<UserDocument> {
    // 1. Try to find by OAuth provider ID
    const byProvider = await this.userRepo.findByOAuthProvider(
      profile.provider,
      profile.providerId,
    );
    if (byProvider) return byProvider;

    // 2. Try to find by email — link new provider to existing account
    const byEmail = await this.userRepo.findByEmail(profile.email);
    if (byEmail) {
      // Link this OAuth provider to the existing account
      await this.userRepo.addOAuthProvider(
        byEmail._id.toString(),
        profile.provider,
        profile.providerId,
      );
      return byEmail;
    }

    // 3. Create new user from OAuth profile
    return this.userRepo.create({
      email: profile.email.toLowerCase(),
      emailVerified: true, // OAuth providers verify email
      passwordHash: null,  // no password for OAuth-only users
      roles: ['member'],
      oauthProviders: [{
        provider: profile.provider,
        providerId: profile.providerId,
        linkedAt: new Date(),
      }],
    });
  }
}
