import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { UserDocument } from '../../users/schemas/user.schema';
import { RequestContext } from '../interfaces/jwt-payload.interface';

@Injectable()
export class DeviceService {
  computeFingerprint(ctx: RequestContext): string {
    // Fingerprint from stable browser signals — not IP (changes on mobile)
    const normalized = [
      ctx.userAgent || '',
    ].join('|');

    return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  }

  isKnownDevice(user: UserDocument, fingerprint: string): boolean {
    const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - NINETY_DAYS;

    return user.deviceFingerprints.some(
      (d) =>
        d.fingerprint === fingerprint &&
        new Date(d.lastSeenAt).getTime() > cutoff
    );
  }

  isSuspiciousLogin(user: UserDocument, fingerprint: string): boolean {
    // Suspicious if first seen on this device in last 90 days
    if (!user.deviceFingerprints.length) return false; // first login ever — not suspicious
    return !this.isKnownDevice(user, fingerprint);
  }

  async updateFingerprint(user: UserDocument, fingerprint: string): Promise<void> {
    const existing = user.deviceFingerprints.find((d) => d.fingerprint === fingerprint);

    if (existing) {
      existing.lastSeenAt = new Date();
    } else {
      user.deviceFingerprints.push({
        fingerprint,
        country: 'unknown',
        lastSeenAt: new Date(),
      });

      // Keep last 20 device fingerprints
      if (user.deviceFingerprints.length > 20) {
        user.deviceFingerprints.sort(
          (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
        );
        user.deviceFingerprints = user.deviceFingerprints.slice(0, 20);
      }
    }

    await user.save();
  }
}
