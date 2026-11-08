import mongoose from 'mongoose';
import bcryptjs from 'bcryptjs';
import crypto from 'crypto';
import validator from 'validator';

/**
 * Generate a random 8-character uppercase alphanumeric referral code
 */
const generateUniqueReferralCode = () => {
  return 'TXM' + crypto.randomBytes(3).toString('hex').toUpperCase();
};

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [60, 'Name cannot exceed 60 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: (value) => validator.isEmail(value),
        message: 'Please provide a valid email address',
      },
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false, // Hidden by default from queries
    },
    role: {
      type: String,
      enum: {
        values: ['user', 'admin'],
        message: 'Role must be either user or admin',
      },
      default: 'user',
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    referralCode: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    referralCodeUsed: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
    },
    referralRewardStatus: {
      type: String,
      enum: {
        values: ['NOT_ELIGIBLE', 'PENDING', 'REWARDED'],
        message: 'referralRewardStatus must be NOT_ELIGIBLE, PENDING, or REWARDED',
      },
      default: 'NOT_ELIGIBLE',
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Pre-save hook: Hash password and generate referralCode if not provided
userSchema.pre('save', async function () {
  // Hash password if modified or new
  if (this.isModified('password')) {
    const salt = await bcryptjs.genSalt(10);
    this.password = await bcryptjs.hash(this.password, salt);
  }

  // Prevent mutating referralCode or referredBy after initial creation
  if (!this.isNew) {
    if (this.isModified('referralCode')) {
      throw new Error('Referral code cannot be modified after registration');
    }
    if (this.isModified('referredBy')) {
      throw new Error('Referral attribution cannot be modified after registration');
    }
    if (this.isModified('referralCodeUsed')) {
      throw new Error('Used referral code record is immutable');
    }
  }

  // Generate unique referral code if missing
  if (!this.referralCode) {
    this.referralCode = generateUniqueReferralCode();
  }
});

// Guard: Prevent modification of referral fields via direct update queries
userSchema.pre(['updateOne', 'findOneAndUpdate', 'updateMany'], function () {
  const update = this.getUpdate();
  if (update) {
    if (update.$set) {
      delete update.$set.referralCode;
      delete update.$set.referredBy;
      delete update.$set.referralCodeUsed;
    } else {
      delete update.referralCode;
      delete update.referredBy;
      delete update.referralCodeUsed;
    }
  }
});

// Instance method to compare password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcryptjs.compare(enteredPassword, this.password);
};

// Static method to generate referral code
userSchema.statics.generateReferralCode = generateUniqueReferralCode;

// Sanitize output JSON
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.__v;
    return ret;
  },
});

export const User = mongoose.model('User', userSchema);
export default User;
