import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';

export interface AuditEntry {
  eventType: string;
  userId?: string;
  email?: string;
  orgId?: string;
  ip: string;
  userAgent?: string;
  outcome: 'success' | 'failure';
  metadata?: Record<string, unknown>;
  correlationId: string;
}

@Injectable()
export class AuditLogRepository {
  constructor(@InjectModel(AuditLog.name) private model: Model<AuditLogDocument>) {}

  async insertOne(entry: AuditEntry): Promise<void> {
    await this.model.create({
      ...entry,
      timestamp: new Date(),
    });
  }

  async insertMany(entries: AuditEntry[]): Promise<void> {
    const docs = entries.map((e) => ({ ...e, timestamp: new Date() }));
    await this.model.insertMany(docs, { ordered: false });
  }

  async findByUser(
    userId: string,
    limit = 50,
    skip = 0,
  ): Promise<AuditLogDocument[]> {
    return this.model
      .find({ userId })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .exec();
  }
}
