import mongoose from 'mongoose';

const walletSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required for wallet'],
      unique: true,
      index: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: [0, 'Balance cannot be negative'],
    },
    referralIncome: {
      type: Number,
      default: 0,
      min: [0, 'Referral income cannot be negative'],
    },
    planIncome: {
      type: Number,
      default: 0,
      min: [0, 'Plan income cannot be negative'],
    },
    totalWithdrawn: {
      type: Number,
      default: 0,
      min: [0, 'Total withdrawn cannot be negative'],
    },
  },
  {
    timestamps: true,
  }
);

walletSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

export const Wallet = mongoose.model('Wallet', walletSchema);
export default Wallet;
