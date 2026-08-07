import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UserRepository {
  constructor(@InjectModel(User.name) private model: Model<UserDocument>) {}

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.model.findOne({ email: email.toLowerCase() }).exec();
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.model.findById(id).exec();
  }

  async findByOAuthProvider(provider: string, providerId: string): Promise<UserDocument | null> {
    return this.model.findOne({
      oauthProviders: { $elemMatch: { provider, providerId } },
    }).exec();
  }

  async create(data: Partial<User>): Promise<UserDocument> {
    const user = new this.model(data);
    return user.save();
  }

  async update(id: string, data: Partial<User>): Promise<UserDocument | null> {
    return this.model.findByIdAndUpdate(id, { $set: data }, { new: true }).exec();
  }

  async addOAuthProvider(
    userId: string,
    provider: string,
    providerId: string,
  ): Promise<UserDocument | null> {
    return this.model.findByIdAndUpdate(
      userId,
      {
        $addToSet: {
          oauthProviders: { provider, providerId, linkedAt: new Date() },
        },
        $set: { emailVerified: true },
      },
      { new: true },
    ).exec();
  }

  async updatePasswordHistory(
    userId: string,
    newHash: string,
    history: string[],
  ): Promise<void> {
    const updated = [newHash, ...history].slice(0, 5);
    await this.model.findByIdAndUpdate(userId, {
      $set: {
        passwordHash: newHash,
        passwordHistory: updated,
        passwordLastChangedAt: new Date(),
      },
    });
  }

  async setMfa(
    userId: string,
    secret: string | null,
    recoveryCodes: Array<{ hash: string; usedAt: Date | null }>,
    enabled: boolean,
  ): Promise<void> {
    await this.model.findByIdAndUpdate(userId, {
      $set: { mfaEnabled: enabled, mfaSecret: secret, recoveryCodes },
    });
  }

  async useRecoveryCode(userId: string, codeHash: string): Promise<void> {
    await this.model.updateOne(
      { _id: userId, 'recoveryCodes.hash': codeHash },
      { $set: { 'recoveryCodes.$.usedAt': new Date() } },
    );
  }

  async deactivate(userId: string): Promise<void> {
    await this.model.findByIdAndUpdate(userId, {
      $set: { deactivatedAt: new Date() },
    });
  }

  async listByOrg(orgId: string): Promise<UserDocument[]> {
    return this.model.find({ orgId: new Types.ObjectId(orgId) }).exec();
  }
}
