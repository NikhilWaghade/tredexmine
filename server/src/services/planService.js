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
 * Detects whether multi-document transactions are supported on the current MongoDB connection.
 * Requires an active connection and a replica set or mongos cluster topology.
 * Standalone MongoDB ('Single' topology) does not support multi-document transactions.
 * @returns {boolean}
 */
export const isTransactionSupported = () => {
  if (mongoose.connection?.readyState !== 1) {
    return false;
  }
  const client = mongoose.connection?.client;
  const topology = client?.topology;
  if (!topology) {
    return false;
  }
  const descType = topology.description?.type;
  if (descType === 'Single') {
    return false;
  }
  if (
    descType === 'ReplicaSetWithPrimary' ||
    descType === 'Sharded' ||
    descType === 'LoadBalanced'
  ) {
    return true;
  }
  return false;
};

/**
 * Purchase an active plan using the user's wallet balance.
 * Requires mandatory idempotency key to prevent duplicate purchases.
 * Uses atomic multi-document transactions when supported, and robust compensating rollback in fallback mode.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string|mongoose.Types.ObjectId} planId
 * @param {Object} [options]
 * @param {string} [options.idempotencyKey] - Mandatory idempotency key
 * @param {mongoose.ClientSession} [options.session] - Optional pre-existing session
 * @returns {Promise<{ userPlan: UserPlan, walletBalance: number, isIdempotent?: boolean }>}
 */
export const purchasePlan = async (userId, planId, options = {}) => {
  const { idempotencyKey, session: providedSession = null } = options;

  // 1. Validate plan ID format
  if (!mongoose.Types.ObjectId.isValid(planId)) {
    const error = new Error('Invalid plan ID format');
    error.statusCode = 400;
    throw error;
  }

  // 2. Validate user ID format
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    const error = new Error('Invalid user ID format');
    error.statusCode = 400;
    throw error;
  }

  // 3. Validate mandatory idempotency key
  if (
    idempotencyKey === undefined ||
    idempotencyKey === null ||
    typeof idempotencyKey !== 'string' ||
    idempotencyKey.trim().length === 0
  ) {
    const error = new Error('Idempotency key is required for plan purchase');
    error.statusCode = 400;
    throw error;
  }

  const trimmedKey = idempotencyKey.trim();
  if (trimmedKey.length > 255) {
    const error = new Error('Idempotency key cannot exceed 255 characters');
    error.statusCode = 400;
    throw error;
  }

  // 4. Retrieve active plan
  const plan = await Plan.findOne({ _id: planId, isActive: true });
  if (!plan) {
    const error = new Error('Plan not found or is currently inactive');
    error.statusCode = 404;
    throw error;
  }

  // 5. Pre-check idempotency: if already processed for this user, return immediately without debiting
  const existingUserPlan = await UserPlan.findOne({ user: userId, idempotencyKey: trimmedKey });
  if (existingUserPlan) {
    const wallet = await getWalletByUserId(userId);
    return {
      userPlan: existingUserPlan,
      walletBalance: wallet.balance,
      isIdempotent: true,
    };
  }

  // 6. Ensure user's wallet exists and check balance
  const wallet = await getWalletByUserId(userId);
  if (wallet.balance < plan.price) {
    const error = new Error('Insufficient wallet balance');
    error.statusCode = 400;
    throw error;
  }

  // 7. Check multi-document transaction support on active connection
  let session = providedSession;
  let ownSession = false;
  let transactionStarted = false;

  if (!session && isTransactionSupported()) {
    try {
      session = await mongoose.startSession();
      session.startTransaction();
      transactionStarted = true;
      ownSession = true;
    } catch (sessionErr) {
      if (session) {
        try {
          await session.endSession();
        } catch (_) {}
        session = null;
      }
      transactionStarted = false;
      ownSession = false;
    }
  } else if (session) {
    transactionStarted = true;
  }

  let walletDebited = false;
  let createdUserPlan = null;
  let createdTransaction = null;

  try {
    const sessionOpt = transactionStarted && session ? { session } : {};

    // In transaction mode, re-verify idempotency within the session snapshot
    if (transactionStarted && session) {
      const txExisting = await UserPlan.findOne({ user: userId, idempotencyKey: trimmedKey }).session(session);
      if (txExisting) {
        if (ownSession) {
          await session.commitTransaction();
        }
        const currentWallet = await getWalletByUserId(userId);
        return {
          userPlan: txExisting,
          walletBalance: currentWallet.balance,
          isIdempotent: true,
        };
      }
    }

    // 8. Atomically deduct wallet balance with precondition check (balance >= plan.price)
    const updatedWallet = await Wallet.findOneAndUpdate(
      { user: userId, balance: { $gte: plan.price } },
      { $inc: { balance: -plan.price } },
      { new: true, ...sessionOpt }
    );

    if (!updatedWallet) {
      if (ownSession && transactionStarted && session) {
        await session.abortTransaction();
      }

      // Check if a concurrent request with the same idempotency key already debited the balance and activated the plan
      let existingConcurrent = await UserPlan.findOne({ user: userId, idempotencyKey: trimmedKey });
      if (!existingConcurrent) {
        for (let attempt = 0; attempt < 5 && !existingConcurrent; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          existingConcurrent = await UserPlan.findOne({ user: userId, idempotencyKey: trimmedKey });
        }
      }
      if (existingConcurrent) {
        const currentWallet = await getWalletByUserId(userId);
        return {
          userPlan: existingConcurrent,
          walletBalance: currentWallet.balance,
          isIdempotent: true,
        };
      }

      const error = new Error('Insufficient wallet balance');
      error.statusCode = 400;
      throw error;
    }
    walletDebited = true;

    // 9. Calculate subscription dates
    const startDate = new Date();
    const durationMs = plan.durationDays * 24 * 60 * 60 * 1000;
    const endDate = new Date(startDate.getTime() + durationMs);

    // 10. Create UserPlan record snapshot
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
      idempotencyKey: trimmedKey,
    };

    if (transactionStarted && session) {
      const createdPlans = await UserPlan.create([userPlanData], { session });
      createdUserPlan = Array.isArray(createdPlans) ? createdPlans[0] : createdPlans;
    } else {
      const created = await UserPlan.create(userPlanData);
      createdUserPlan = Array.isArray(created) ? created[0] : created;
    }

    // 11. Create matching debit Transaction record referencing the created UserPlan with balance snapshots
    const userPlanRef = createdUserPlan?._id
      ? createdUserPlan._id.toString()
      : createdUserPlan?.id
      ? createdUserPlan.id.toString()
      : trimmedKey;

    const balanceAfter = updatedWallet.balance;
    const balanceBefore = Math.round((updatedWallet.balance + plan.price) * 100) / 100;

    const transactionData = {
      user: userId,
      wallet: updatedWallet._id,
      type: 'debit',
      amount: plan.price,
      description: `Plan Purchase: ${plan.name}`,
      status: 'completed',
      reference: userPlanRef,
      balanceBefore,
      balanceAfter,
    };

    if (transactionStarted && session) {
      const createdTxs = await Transaction.create([transactionData], { session });
      createdTransaction = Array.isArray(createdTxs) ? createdTxs[0] : createdTxs;
      if (ownSession) {
        await session.commitTransaction();
      }
    } else {
      const created = await Transaction.create(transactionData);
      createdTransaction = Array.isArray(created) ? created[0] : created;
    }

    return {
      userPlan: createdUserPlan,
      walletBalance: updatedWallet.balance,
      transaction: createdTransaction,
      isIdempotent: false,
    };
  } catch (error) {
    // 1. Transaction mode rollback: cleanly rewinds all session writes without manual compensating refund
    if (ownSession && transactionStarted && session) {
      try {
        await session.abortTransaction();
      } catch (_) {
        // Ignore abort error if already aborted or connection closed
      }
    }

    // 2. Fallback mode compensating rollback:
    // Only if multi-document transaction was NOT active and the wallet was actually debited
    if (!transactionStarted && walletDebited) {
      try {
        await Wallet.findOneAndUpdate({ user: userId }, { $inc: { balance: plan.price } });
        walletDebited = false; // Mark refunded to prevent any subsequent double refund
      } catch (refundErr) {
        console.error('[PlanService] Failed to refund wallet balance:', refundErr.message);
      }

      if (createdUserPlan?._id) {
        try {
          if (mongoose.connection?.readyState === 1 || Object.prototype.hasOwnProperty.call(UserPlan, 'findByIdAndDelete')) {
            await UserPlan.findByIdAndDelete(createdUserPlan._id);
          }
          createdUserPlan = null;
        } catch (deleteErr) {
          console.error('[PlanService] Failed to delete orphaned UserPlan:', deleteErr.message);
        }
      }

      if (createdTransaction?._id) {
        try {
          if (mongoose.connection?.readyState === 1 || Object.prototype.hasOwnProperty.call(Transaction, 'findByIdAndDelete')) {
            await Transaction.findByIdAndDelete(createdTransaction._id);
          }
          createdTransaction = null;
        } catch (deleteErr) {
          console.error('[PlanService] Failed to delete orphaned Transaction:', deleteErr.message);
        }
      }
    }

    // 3. Handle concurrent duplicate key collisions and transaction write conflicts gracefully
    const isDuplicateKey =
      error.code === 11000 ||
      (typeof error.message === 'string' && error.message.includes('11000')) ||
      (typeof error.hasErrorLabel === 'function' && error.hasErrorLabel('TransientTransactionError')) ||
      error.code === 112; // WriteConflict

    if (isDuplicateKey) {
      let existing = await UserPlan.findOne({ user: userId, idempotencyKey: trimmedKey });
      if (!existing) {
        for (let attempt = 0; attempt < 5 && !existing; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          existing = await UserPlan.findOne({ user: userId, idempotencyKey: trimmedKey });
        }
      }
      if (existing) {
        const currentWallet = await getWalletByUserId(userId);
        return {
          userPlan: existing,
          walletBalance: currentWallet.balance,
          isIdempotent: true,
        };
      }
    }

    throw error;
  } finally {
    if (ownSession && session) {
      try {
        await session.endSession();
      } catch (_) {
        // Ignore session cleanup error
      }
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

/**
 * Get all plans including inactive ones (Administrator only)
 * @returns {Promise<Array<Plan>>}
 */
export const getAllPlansAdmin = async () => {
  return Plan.find({}).sort({ sortOrder: 1, createdAt: 1 });
};

/**
 * Get any plan by ID, regardless of active status (Administrator only)
 * @param {string|mongoose.Types.ObjectId} planId
 * @returns {Promise<Plan>}
 */
export const getPlanByIdAdmin = async (planId) => {
  if (!mongoose.Types.ObjectId.isValid(planId)) {
    const error = new Error('Invalid plan ID format');
    error.statusCode = 400;
    throw error;
  }

  const plan = await Plan.findById(planId);
  if (!plan) {
    const error = new Error('Plan not found');
    error.statusCode = 404;
    throw error;
  }

  return plan;
};

/**
 * Update an existing plan's editable fields (Administrator only)
 * Existing user purchases and transactions remain untouched as immutable snapshots
 * @param {string|mongoose.Types.ObjectId} planId
 * @param {Object} updateData
 * @returns {Promise<Plan>}
 */
export const updatePlan = async (planId, updateData) => {
  if (!mongoose.Types.ObjectId.isValid(planId)) {
    const error = new Error('Invalid plan ID format');
    error.statusCode = 400;
    throw error;
  }

  const plan = await Plan.findById(planId);
  if (!plan) {
    const error = new Error('Plan not found');
    error.statusCode = 404;
    throw error;
  }

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
  } = updateData;

  if (name !== undefined) plan.name = name.trim();
  if (tag !== undefined) plan.tag = String(tag).trim();
  if (description !== undefined) plan.description = String(description).trim();
  if (price !== undefined) plan.price = price;
  if (durationDays !== undefined) plan.durationDays = durationDays;
  if (dailyRoiRate !== undefined) plan.dailyRoiRate = dailyRoiRate;
  if (hashRate !== undefined) plan.hashRate = String(hashRate).trim();
  if (features !== undefined) plan.features = Array.isArray(features) ? features : [];
  if (isActive !== undefined) plan.isActive = Boolean(isActive);
  if (sortOrder !== undefined) plan.sortOrder = sortOrder;

  await plan.save();
  return plan;
};

/**
 * Toggle or explicitly set active status of a plan (Administrator only)
 * @param {string|mongoose.Types.ObjectId} planId
 * @param {boolean} [targetStatus]
 * @returns {Promise<Plan>}
 */
export const togglePlanStatus = async (planId, targetStatus) => {
  if (!mongoose.Types.ObjectId.isValid(planId)) {
    const error = new Error('Invalid plan ID format');
    error.statusCode = 400;
    throw error;
  }

  const plan = await Plan.findById(planId);
  if (!plan) {
    const error = new Error('Plan not found');
    error.statusCode = 404;
    throw error;
  }

  plan.isActive = typeof targetStatus === 'boolean' ? targetStatus : !plan.isActive;
  await plan.save();
  return plan;
};

export default {
  isTransactionSupported,
  getActivePlans,
  getActivePlanById,
  purchasePlan,
  getUserActivePlans,
  createPlan,
  getAllPlansAdmin,
  getPlanByIdAdmin,
  updatePlan,
  togglePlanStatus,
};
