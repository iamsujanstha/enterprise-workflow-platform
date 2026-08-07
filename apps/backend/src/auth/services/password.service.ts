import { Injectable, BadRequestException, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';

const BCRYPT_ROUNDS = 12;
const DUMMY_PASSWORD = '__dummy_constant_time_hash__';

@Injectable()
export class PasswordService implements OnModuleInit {
  // Pre-computed dummy hash — ensures constant-time response for missing users
  private dummyHash!: string;

  async onModuleInit() {
    this.dummyHash = await bcrypt.hash(DUMMY_PASSWORD, BCRYPT_ROUNDS);
  }

  async hash(plaintext: string): Promise<string> {
    // async bcrypt — does not block the event loop
    return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
  }

  async verify(plaintext: string, hash: string | null): Promise<boolean> {
    // Always run bcrypt regardless of whether hash exists — prevents timing attacks
    return bcrypt.compare(plaintext, hash ?? this.dummyHash);
  }

  async hashDummy(): Promise<void> {
    // Explicit dummy run — call when user not found to pad response time
    await bcrypt.compare(DUMMY_PASSWORD, this.dummyHash);
  }

  async assertNotBreached(password: string): Promise<void> {
    // k-anonymity: only first 5 chars of SHA-1 leave the server
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    try {
      const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return; // degrade gracefully if HIBP is down

      const body = await res.text();
      const breached = body.split('\r\n').some((line) => line.startsWith(suffix));
      if (breached) {
        throw new BadRequestException({ error: 'PASSWORD_FOUND_IN_BREACH' });
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      // Network timeout / HIBP unavailable — skip check, log warning
      console.warn('HIBP check skipped:', (err as Error).message);
    }
  }

  async assertNotReused(plaintext: string, history: string[]): Promise<void> {
    for (const oldHash of history) {
      if (await bcrypt.compare(plaintext, oldHash)) {
        throw new BadRequestException({ error: 'PASSWORD_RECENTLY_USED' });
      }
    }
  }

  buildUpdatedHistory(newHash: string, history: string[]): string[] {
    return [newHash, ...history].slice(0, 5);
  }
}
