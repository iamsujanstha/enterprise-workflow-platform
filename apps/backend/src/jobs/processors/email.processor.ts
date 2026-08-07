import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

@Processor('email')
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);

  @Process('send_verification_email')
  async sendVerification(job: Job) {
    this.logger.log(`Sending verification email to ${job.data.email}`);
    // TODO: Integrate with AWS SES
    // For now, log the URL
    this.logger.debug(`Verification URL: ${job.data.verificationUrl}`);
  }

  @Process('send_password_reset')
  async sendPasswordReset(job: Job) {
    this.logger.log(`Sending password reset to ${job.data.email}`);
    this.logger.debug(`Reset URL: ${job.data.resetUrl}`);
  }

  @Process('send_security_alert')
  async sendSecurityAlert(job: Job) {
    this.logger.warn(`Sending security alert to user ${job.data.userId}`);
    this.logger.debug(`Alert details:`, job.data);
  }
}
