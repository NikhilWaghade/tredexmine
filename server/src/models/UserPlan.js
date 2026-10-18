import mongoose from 'mongoose';

const userPlanSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required for user plan'],
      index: true,
    },
    plan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plan',
      required: [true, 'Plan reference is required for user plan'],
      index: true,
    },
    planName: {
      type: String,
      required: [true, 'Plan name snapshot is required'],
      trim: true,
    },
    price: {
      type: Number,
      required: [true, 'Purchase price snapshot is required'],
      min: [0.01, 'Purchase price must be positive'],
    },
    durationDays: {
      type: Number,
      required: [true, 'Duration snapshot in days is required'],
      min: [1, 'Duration must be at least 1 day'],
      validate: {
        validator: Number.isInteger,
        message: 'Duration days must be an integer',
      },
    },
    dailyRoiRate: {
      type: Number,
      default: 0,
      min: [0, 'Daily ROI rate cannot be negative'],
    },
    hashRate: {
      type: String,
      trim: true,
      default: '',
    },
    features: {
      type: [String],
      default: [],
    },
    startDate: {
      type: Date,
      default: Date.now,
      required: [true, 'Start date is required'],
    },
    endDate: {
      type: Date,
      required: [true, 'End date is required'],
    },
    status: {
      type: String,
      enum: {
        values: ['active', 'completed', 'cancelled'],
        message: 'Status must be active, completed, or cancelled',
      },
      default: 'active',
      index: true,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      sparse: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for user active plans lookup
userPlanSchema.index({ user: 1, status: 1, createdAt: -1 });

// Compound unique index for scoped user idempotency keys
userPlanSchema.index({ user: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

userPlanSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

export const UserPlan = mongoose.model('UserPlan', userPlanSchema);
export default UserPlan;
