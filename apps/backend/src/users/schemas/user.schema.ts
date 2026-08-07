import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, index: true })
  email: string;

  @Prop({ type: String, default: null })
  passwordHash: string | null;

  @Prop({ type: [String], default: [] })
  passwordHistory: string[];

  @Prop({ type: Date })
  passwordLastChangedAt: Date;

  @Prop({ type: [String], default: ['member'] })
  roles: string[];

  @Prop({ type: Types.ObjectId, ref: 'Organization', index: true })
  orgId: Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  emailVerified: boolean;

  @Prop({ type: Date, default: null })
  deactivatedAt: Date | null;

  @Prop({ type: Boolean, default: false })
  mfaEnabled: boolean;

  @Prop({ type: String, default: null })
  mfaSecret: string | null;

  @Prop({
    type: [{
      hash: String,
      usedAt: { type: Date, default: null },
    }],
    default: [],
  })
  recoveryCodes: Array<{ hash: string; usedAt: Date | null }>;

  @Prop({
    type: [{
      provider: String,
      providerId: String,
      linkedAt: Date,
    }],
    default: [],
  })
  oauthProviders: Array<{ provider: string; providerId: string; linkedAt: Date }>;

  @Prop({
    type: [{
      fingerprint: String,
      country: String,
      lastSeenAt: Date,
    }],
    default: [],
  })
  deviceFingerprints: Array<{ fingerprint: string; country: string; lastSeenAt: Date }>;

  createdAt?: Date;
  updatedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Indexes
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ orgId: 1 });
UserSchema.index({ 'oauthProviders.provider': 1, 'oauthProviders.providerId': 1 });
