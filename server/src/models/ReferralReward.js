import mongoose from 'mongoose';

const referralRewardSchema = new mongoose.Schema(
  {
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Referrer reference is required'],
      index: true,
    },
    referredUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Referred user reference is required'],
      unique: true,
      index: true,
    },
    rewardAmount: {
      type: Number,
      required: [true, 'Reward amount is required'],
      min: [0, 'Reward amount must be non-negative'],
    },
    planAmount: {
      type: Number,
      default: 0,
      min: [0, 'Plan amount must be non-negative'],
    },
    currency: {
      type: String,
      default: 'INR',
      trim: true,
      uppercase: true,
    },
    qualifyingPayment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      sparse: true,
      unique: true,
      index: true,
    },
    qualifyingPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plan',
      required: [true, 'Qualifying plan reference is required'],
    },
    status: {
      type: String,
      enum: {
        values: ['PENDING', 'CREDITED', 'REVERSED'],
        message: 'Status must be PENDING, CREDITED, or REVERSED',
      },
      default: 'PENDING',
      index: true,
    },
    reference: {
      type: String,
      required: [true, 'Reward reference is required'],
      unique: true,
      index: true,
    },
    ledgerTransaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
    },
    creditedAt: {
      type: Date,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Virtual field accessors for schema flexibility
referralRewardSchema.virtual('referrerUserId').get(function () {
  return this.referrer;
});
referralRewardSchema.virtual('referredUserId').get(function () {
  return this.referredUser;
});
referralRewardSchema.virtual('qualifyingPaymentId').get(function () {
  return this.qualifyingPayment;
});
referralRewardSchema.virtual('qualifyingPlanId').get(function () {
  return this.qualifyingPlan;
});

referralRewardSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

export const ReferralReward = mongoose.model('ReferralReward', referralRewardSchema);
export default ReferralReward;

