import mongoose from 'mongoose';

const planSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Plan name is required'],
      trim: true,
      minlength: [2, 'Plan name must be at least 2 characters'],
      maxlength: [100, 'Plan name cannot exceed 100 characters'],
    },
    tag: {
      type: String,
      trim: true,
      default: '',
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    price: {
      type: Number,
      required: [true, 'Plan price is required'],
      min: [0.01, 'Plan price must be greater than zero'],
    },
    durationDays: {
      type: Number,
      required: [true, 'Plan duration in days is required'],
      min: [1, 'Plan duration must be at least 1 day'],
      validate: {
        validator: Number.isInteger,
        message: 'Plan duration in days must be an integer',
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
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for querying active plans sorted by sortOrder and createdAt
planSchema.index({ isActive: 1, sortOrder: 1, createdAt: 1 });

planSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

export const Plan = mongoose.model('Plan', planSchema);
export default Plan;
