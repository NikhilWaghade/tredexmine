import mongoose from 'mongoose';
import { Plan } from '../models/Plan.js';
import { UserPlan } from '../models/UserPlan.js';
import { Wallet } from '../models/Wallet.js';
import { Transaction } from '../models/Transaction.js';
import { getWalletByUserId } from './walletService.js';

/**
 * Get all active plans sorted by sortOrder and createdAt
 * @returns {Promise<Array<Plan>>}
 */
export const getActivePlans = async () => {
  return Plan.find({ isActive: true }).sort({ sortOrder: 1, createdAt: 1 });
};

/**
 * Get an active plan by ID
 * @param {string|mongoose.Types.ObjectId} planId
 * @returns {Promise<Plan>}
 */
export const getActivePlanById = async (planId) => {
  if (!mongoose.Types.ObjectId.isValid(planId)) {
    const error = new Error('Invalid plan ID format');
    error.statusCode = 400;
    throw error;
  }

  const plan = await Plan.findOne({ _id: planId, isActive: true });
  if (!plan) {
    const error = new Error('Plan not found');
    error.statusCode = 404;
    throw error;
  }

  return plan;
};

/**
 * Purchase an active plan using the user's wallet balance
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string|mongoose.Types.ObjectId} planId
 * @param {Object} [options]
 * @param {string} [options.idempotencyKey]
 * @returns {Promise<{ userPlan: UserPlan, walletBalance: number, isIdempotent?: boolean }>}
 */
export const purchasePlan = async (userId, planId, options = {}) => {
  const { idempotencyKey } = options;

  // 1. Validate plan ID format
  if (!mongoose.Types.ObjectId.isValid(planId)) {
    const error = new Error('Invalid plan ID format');
    error.statusCode = 400;
    throw error;
  }

  // 2. Check idempotency if a key is supplied
  if (idempotencyKey) {
    const trimmedKey = String(idempotencyKey).trim();
    if (trimmedKey.length > 0) {
      const existingUserPlan = await UserPlan.findOne({ user: userId, idempotencyKey: trimmedKey });
      if (existingUserPlan) {
        const wallet = await getWalletByUserId(userId);
        return {
          userPlan: existingUserPlan,
          walletBalance: wallet.balance,
          isIdempotent: true,
        };
      }
    }
  }

  // 3. Retrieve active plan
  const plan = await Plan.findOne({ _id: planId, isActive: true });
  if (!plan) {
    const error = new Error('Plan not found or is currently inactive');
    error.statusCode = 404;
    throw error;
  }

  // 4. Ensure user's wallet exists
  const wallet = await getWalletByUserId(userId);

  // 5. Pre-check balance
  if (wallet.balance < plan.price) {
    const error = new Error('Insufficient wallet balance');
    error.statusCode = 400;
    throw error;
  }

  // 6. Check transaction support on the active database connection
  let session = null;
  let transactionStarted = false;

  if (mongoose.connection?.readyState === 1) {
    try {
      session = await mongoose.startSession();
      session.startTransaction();
      transactionStarted = true;
    } catch (sessionErr) {
      // Graceful fallback for standalone MongoDB deployments where transactions are not supported
      if (session) {
        session.endSession();
        session = null;
      }
      transactionStarted = false;
    }
  }

  try {
    const sessionOpt = transactionStarted && session ? { session } : {};

    // 7. Atomically deduct wallet balance with precondition check (balance >= plan.price)
    const updatedWallet = await Wallet.findOneAndUpdate(
      { user: userId, balance: { $gte: plan.price } },
      { $inc: { balance: -plan.price } },
      { new: true, ...sessionOpt }
    );

    if (!updatedWallet) {
      if (transactionStarted && session) {
        await session.abortTransaction();
      }
      const error = new Error('Insufficient wallet balance');
      error.statusCode = 400;
      throw error;
    }

    // 8. Calculate subscription dates
    const startDate = new Date();
    const durationMs = plan.durationDays * 24 * 60 * 60 * 1000;
    const endDate = new Date(startDate.getTime() + durationMs);

    // 9. Create UserPlan record snapshot
    const userPlanData = {
      user: userId,
      plan: plan._id,
      planName: plan.name,
      price: plan.price,
      durationDays: plan.durationDays,
      dailyRoiRate: plan.dailyRoiRate,
      hashRate: plan.hashRate,
      features: plan.features,
      startDate,
      endDate,
      status: 'active',
      ...(idempotencyKey ? { idempotencyKey: String(idempotencyKey).trim() } : {}),
    };

    let userPlan;
    if (transactionStarted && session) {
      const createdPlans = await UserPlan.create([userPlanData], { session });
      userPlan = createdPlans[0];
    } else {
      userPlan = await UserPlan.create(userPlanData);
    }

    // 10. Create matching debit Transaction record
    const transactionData = {
      user: userId,
      wallet: updatedWallet._id,
      type: 'debit',
      amount: plan.price,
      description: `Plan Purchase: ${plan.name}`,
      status: 'completed',
    };

    if (transactionStarted && session) {
      await Transaction.create([transactionData], { session });
      await session.commitTransaction();
    } else {
      // Compensating write rollback for deployments without multi-document transaction support
      try {
        await Transaction.create(transactionData);
      } catch (txError) {
        await Wallet.findOneAndUpdate({ user: userId }, { $inc: { balance: plan.price } });
        if (userPlan?._id) {
          await UserPlan.findByIdAndDelete(userPlan._id);
        }
        throw txError;
      }
    }

    return {
      userPlan,
      walletBalance: updatedWallet.balance,
      isIdempotent: false,
    };
  } catch (error) {
    if (transactionStarted && session) {
      try {
        await session.abortTransaction();
      } catch (abortErr) {
        // Ignore abort error if already aborted
      }
    }
    throw error;
  } finally {
    if (session) {
      session.endSession();
    }
  }
};

/**
 * Get active plans subscribed by a specific authenticated user
 * @param {string|mongoose.Types.ObjectId} userId
 * @returns {Promise<Array<UserPlan>>}
 */
export const getUserActivePlans = async (userId) => {
  const now = new Date();
  return UserPlan.find({
    user: userId,
    status: 'active',
    $or: [
      { endDate: { $exists: false } },
      { endDate: null },
      { endDate: { $gt: now } },
    ],
  }).sort({ createdAt: -1 });
};

/**
 * Create a new plan in MongoDB (Administrator only)
 * Persists only allowed schema fields and ignores unintended properties
 * @param {Object} planData
 * @returns {Promise<Plan>}
 */
export const createPlan = async (planData) => {
  const {
    name,
    tag,
    description,
    price,
    durationDays,
    dailyRoiRate,
    hashRate,
    features,
    isActive,
    sortOrder,
  } = planData;

  const plan = await Plan.create({
    name: name?.trim(),
    tag: tag !== undefined ? String(tag).trim() : '',
    description: description !== undefined ? String(description).trim() : '',
    price,
    durationDays,
    dailyRoiRate: dailyRoiRate !== undefined ? dailyRoiRate : 0,
    hashRate: hashRate !== undefined ? String(hashRate).trim() : '',
    features: Array.isArray(features) ? features : [],
    isActive: isActive !== undefined ? isActive : true,
    sortOrder: sortOrder !== undefined ? sortOrder : 0,
  });

  return plan;
};

export default {
  getActivePlans,
  getActivePlanById,
  purchasePlan,
  getUserActivePlans,
  createPlan,
};
