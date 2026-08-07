import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { UserDocument } from '../../users/schemas/user.schema';

interface KeyEntry {
  secret: string;
  kid: string;
  expiresAt: number;
}

@Injectable()
export class TokenService {
  // In-memory key cache — refreshed every 5 minutes
  private keyCache: Map<string, KeyEntry> = new Map();
  private currentKid: string | null = null;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async generateAccessToken(user: UserDocument): Promise<string> {
    const { secret, kid } = this.getSigningKey();
    const payload: JwtPayload = {
      sub: user._id.toString(),
      roles: user.roles,
      orgId: user.orgId?.toString() ?? '',
    };
    return this.jwtService.signAsync(payload, {
      secret,
      expiresIn: '15m',
      header: { alg: 'HS256', kid },
    });
  }

  generateRefreshToken(): string {
    // 256-bit cryptographically secure opaque token
    return randomBytes(32).toString('base64url');
  }

  generateSecureToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  async verifyAccessToken(token: string): Promise<JwtPayload> {
    try {
      // Try current key first
      const { secret, kid } = this.getSigningKey();
      return await this.jwtService.verifyAsync<JwtPayload>(token, { secret });
    } catch {
      // Try previous key (grace period during rotation)
      const prevSecret = this.configService.get<string>('JWT_SECRET_PREV');
      if (prevSecret) {
        try {
          return await this.jwtService.verifyAsync<JwtPayload>(token, { secret: prevSecret });
        } catch {
          // fall through
        }
      }
      throw new UnauthorizedException({ error: 'TOKEN_INVALID' });
    }
  }

  private getSigningKey(): { secret: string; kid: string } {
    const now = Date.now();

    // Check if we have a valid cached key
    if (this.currentKid) {
      const cached = this.keyCache.get(this.currentKid);
      if (cached && cached.expiresAt > now) {
        return { secret: cached.secret, kid: cached.kid };
      }
    }

    // Load from env / secrets manager
    const secret = this.configService.getOrThrow<string>('JWT_SECRET');
    const kid = this.configService.get<string>('JWT_KID', 'v1');

    const entry: KeyEntry = {
      secret,
      kid,
      expiresAt: now + 5 * 60 * 1000, // 5-minute TTL
    };

    this.keyCache.set(kid, entry);
    this.currentKid = kid;

    return { secret, kid };
  }
}
