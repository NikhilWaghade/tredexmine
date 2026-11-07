import mongoose from 'mongoose';

const depositSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required for deposit'],
      index: true,
    },
    wallet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Wallet',
      required: [true, 'Wallet reference is required for deposit'],
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'Deposit amount is required'],
      min: [1, 'Deposit amount must be at least 1 INR'],
    },
    currency: {
      type: String,
      default: 'INR',
      trim: true,
      uppercase: true,
    },
    depositReference: {
      type: String,
      required: [true, 'Unique deposit reference is required'],
      unique: true,
      trim: true,
      index: true,
    },
    provider: {
      type: String,
      enum: {
        values: ['razorpay', 'mock'],
        message: 'Deposit provider must be either razorpay or mock',
      },
      default: 'mock',
    },
    orderId: {
      type: String,
      trim: true,
      index: true,
    },
    paymentId: {
      type: String,
      trim: true,
      sparse: true,
    },
    status: {
      type: String,
      enum: {
        values: ['created', 'pending', 'completed', 'failed'],
        message: 'Deposit status must be created, pending, completed, or failed',
      },
      default: 'created',
      index: true,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      sparse: true,
      index: true,
    },
    creditedAt: {
      type: Date,
    },
    failureReason: {
      type: String,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    isTest: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for querying user deposits ordered by recency
depositSchema.index({ user: 1, createdAt: -1 });

depositSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

export const Deposit = mongoose.model('Deposit', depositSchema);
export default Deposit;
