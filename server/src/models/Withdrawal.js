import mongoose from 'mongoose';

const withdrawalSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required for withdrawal'],
      index: true,
    },
    wallet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Wallet',
      required: [true, 'Wallet reference is required for withdrawal'],
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'Withdrawal amount is required'],
      min: [1, 'Withdrawal amount must be at least 1 INR'],
    },
    currency: {
      type: String,
      default: 'INR',
      trim: true,
      uppercase: true,
    },
    withdrawalReference: {
      type: String,
      required: [true, 'Unique withdrawal reference is required'],
      unique: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: [
          'PENDING',
          'APPROVED',
          'REJECTED',
          'PROCESSING',
          'COMPLETED',
          'FAILED',
          'CANCELLED',
        ],
        message: 'Invalid withdrawal status: {VALUE}',
      },
      default: 'PENDING',
      index: true,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      index: true,
    },
    payoutMethod: {
      type: String,
      enum: ['upi', 'bank_transfer'],
      default: 'upi',
    },
    payoutDetails: {
      accountHolderName: {
        type: String,
        trim: true,
        default: '',
      },
      maskedIdentifier: {
        type: String,
        trim: true,
        default: '',
      },
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: '',
    },
    adminNotes: {
      type: String,
      trim: true,
      default: '',
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    refundIssued: {
      type: Boolean,
      default: false,
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

// Indexes for query performance and idempotency protection
withdrawalSchema.index({ user: 1, createdAt: -1 });
withdrawalSchema.index({ status: 1, createdAt: -1 });
withdrawalSchema.index({ user: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

withdrawalSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

export const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);
export default Withdrawal;
