import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  AuthEvents,
  LoginSuccessEvent,
  TokenTheftEvent,
  SuspiciousLoginEvent,
} from './auth.events';

@Injectable()
export class AuthEventsListener {
  private readonly logger = new Logger(AuthEventsListener.name);

  constructor(@InjectQueue('email') private readonly emailQueue: Queue) {}

  @OnEvent(AuthEvents.LOGIN_SUCCESS)
  onLoginSuccess(event: LoginSuccessEvent) {
    if (event.suspicious) {
      // Non-blocking — don't await, failure here shouldn't affect the user
      this.emailQueue
        .add('send_security_alert', {
          userId: event.userId,
          ip: event.ip,
          userAgent: event.userAgent,
        })
        .catch((err) => this.logger.error('Failed to queue security alert', err));
    }
  }

  @OnEvent(AuthEvents.TOKEN_THEFT_DETECTED)
  onTokenTheft(event: TokenTheftEvent) {
    this.logger.error('TOKEN THEFT DETECTED', event);
    this.emailQueue
      .add(
        'send_security_alert',
        { userId: event.userId, alertType: 'TOKEN_THEFT' },
        { priority: 1 }, // highest priority
      )
      .catch((err) => this.logger.error('Failed to queue theft alert', err));
  }

  @OnEvent(AuthEvents.SUSPICIOUS_LOGIN)
  onSuspiciousLogin(event: SuspiciousLoginEvent) {
    this.logger.warn('Suspicious login detected', event);
  }
}
