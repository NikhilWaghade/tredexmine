import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required for payment record'],
      index: true,
    },
    plan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plan',
      required: [true, 'Plan reference is required for payment record'],
      index: true,
    },
    gateway: {
      type: String,
      default: 'razorpay',
      trim: true,
    },
    orderId: {
      type: String,
      required: [true, 'Gateway order ID is required'],
      unique: true,
      trim: true,
      index: true,
    },
    paymentId: {
      type: String,
      trim: true,
      sparse: true,
      unique: true,
      index: true,
    },
    signature: {
      type: String,
      trim: true,
    },
    amount: {
      type: Number,
      required: [true, 'Payment amount in INR is required'],
      min: [0.01, 'Payment amount must be greater than zero'],
    },
    amountInPaise: {
      type: Number,
      required: [true, 'Payment amount in paise is required'],
      min: [1, 'Payment amount in paise must be positive integer'],
    },
    currency: {
      type: String,
      default: 'INR',
      trim: true,
      uppercase: true,
    },
    receipt: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: ['created', 'authorized', 'captured', 'failed', 'refunded'],
        message: 'Status must be created, authorized, captured, failed, or refunded',
      },
      default: 'created',
      index: true,
    },
    paymentMethod: {
      type: String,
      default: 'upi',
      trim: true,
    },
    userPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserPlan',
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    activatedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for querying user payments ordered by recency
paymentSchema.index({ user: 1, createdAt: -1 });

// Index for status queries
paymentSchema.index({ status: 1 });

paymentSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

export const Payment = mongoose.model('Payment', paymentSchema);
export default Payment;
