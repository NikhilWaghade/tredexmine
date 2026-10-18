import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required for transaction'],
      index: true,
    },
    wallet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Wallet',
      required: [true, 'Wallet reference is required for transaction'],
      index: true,
    },
    type: {
      type: String,
      enum: {
        values: ['credit', 'debit'],
        message: 'Transaction type must be either credit or debit',
      },
      required: [true, 'Transaction type is required'],
    },
    amount: {
      type: Number,
      required: [true, 'Transaction amount is required'],
      min: [0, 'Transaction amount must be positive'],
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: {
        values: ['pending', 'completed', 'failed'],
        message: 'Transaction status must be pending, completed, or failed',
      },
      default: 'completed',
    },
    reference: {
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

// Unique sparse index for idempotent transaction references
transactionSchema.index({ reference: 1 }, { unique: true, sparse: true });

transactionSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

export const Transaction = mongoose.model('Transaction', transactionSchema);
export default Transaction;
