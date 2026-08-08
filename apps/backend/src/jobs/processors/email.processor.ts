import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

@Processor('email')
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case 'send_verification_email':
        return this.sendVerification(job);
      case 'send_password_reset':
        return this.sendPasswordReset(job);
      case 'send_security_alert':
        return this.sendSecurityAlert(job);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async sendVerification(job: Job): Promise<void> {
    this.logger.log(`Sending verification email to ${job.data.email}`);
    // TODO: Integrate with AWS SES
    // For now, log the URL
    this.logger.debug(`Verification URL: ${job.data.verificationUrl}`);
  }

  private async sendPasswordReset(job: Job): Promise<void> {
    this.logger.log(`Sending password reset to ${job.data.email}`);
    this.logger.debug(`Reset URL: ${job.data.resetUrl}`);
  }

  private async sendSecurityAlert(job: Job): Promise<void> {
    this.logger.warn(`Sending security alert to user ${job.data.userId}`);
    this.logger.debug(`Alert details:`, job.data);
  }
}
