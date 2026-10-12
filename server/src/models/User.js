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
    referralCode: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      uppercase: true,
    },
    referredBy: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
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

  // Generate unique referral code if missing
  if (!this.referralCode) {
    this.referralCode = generateUniqueReferralCode();
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
