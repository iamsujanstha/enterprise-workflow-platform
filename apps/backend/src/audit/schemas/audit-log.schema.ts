import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AuditLogDocument = AuditLog & Document;

@Schema({ timestamps: false, versionKey: false })
export class AuditLog {
  @Prop({ required: true, index: -1 })
  timestamp: Date;

  @Prop({ required: true })
  eventType: string;

  @Prop({ type: Types.ObjectId, index: true })
  userId: Types.ObjectId | null;

  @Prop({ type: String })
  email: string | null;

  @Prop({ type: Types.ObjectId, index: true })
  orgId: Types.ObjectId | null;

  @Prop({ required: true })
  ip: string;

  @Prop()
  userAgent: string;

  @Prop({ required: true, enum: ['success', 'failure'] })
  outcome: 'success' | 'failure';

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;

  @Prop({ required: true })
  correlationId: string;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

// Compound indexes for compliance queries
AuditLogSchema.index({ timestamp: -1 });
AuditLogSchema.index({ userId: 1, timestamp: -1 });
AuditLogSchema.index({ orgId: 1, timestamp: -1 });

// TTL: auto-expire after 365 days — GDPR minimum
AuditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 31_536_000 });
